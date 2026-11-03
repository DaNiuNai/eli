import {
  lazyStream,
  type Api,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ModelsApiStreamOptions,
  type StreamOptions
} from '@earendil-works/pi-ai'
import type { Models as ModelRuntime } from '@earendil-works/pi-ai'
import { AsyncLocalStorage } from 'node:async_hooks'

const auxiliary = new AsyncLocalStorage<boolean>()
export function auxiliaryRequest<T>(operation: () => Promise<T>): Promise<T> {
  return auxiliary.run(true, operation)
}

const mib = 1024 * 1024
const guardedRequest = Symbol('eli.requestBodyGuard')
const omittedMedia =
  '[eli：为控制请求体大小，已省略此处的图片或文档。相关文字仍保留；需要查看细节时请重新读取原文件。]'

type ObjectValue = Record<string, unknown>
export type RequestBodyListener = (bytes: number, sessionId: string | undefined) => void
type Stream<T extends StreamOptions> = (
  model: Model<Api>,
  context: Context,
  options?: T
) => AssistantMessageEventStream

function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
}

function mapArray(value: unknown, map: (item: unknown) => unknown): unknown {
  if (!Array.isArray(value)) return value
  const mapped = value.map(map)
  return mapped.some((item, index) => item !== value[index]) ? mapped : value
}

function mapField(value: unknown, key: string, map: (field: unknown) => unknown): unknown {
  const record = object(value)
  if (!record || !(key in record)) return value
  const mapped = map(record[key])
  return mapped === record[key] ? value : { ...record, [key]: mapped }
}

/** 只遍历协议的消息内容，不能把工具参数、JSON Schema 或普通文本当作附件。 */
function mapMedia(
  payload: unknown,
  replace: (block: ObjectValue, placeholder: ObjectValue) => unknown
): unknown {
  const block = (value: unknown): unknown => {
    const record = object(value)
    if (!record) return value
    if (
      ['image', 'image_url', 'document', 'input_image', 'input_file'].includes(String(record.type))
    ) {
      return replace(record, {
        type: record.type === 'input_image' || record.type === 'input_file' ? 'input_text' : 'text',
        text: omittedMedia
      })
    }
    // Google / Bedrock 的内容块没有 type 字段。
    const data = object(
      record.inlineData ?? record.inline_data ?? record.fileData ?? record.file_data
    )
    if (
      record.image ||
      record.document ||
      (data && /^(?:image\/|application\/)/i.test(String(data.mimeType ?? data.mime_type)))
    ) {
      return replace(record, { text: omittedMedia })
    }
    if (record.type === 'tool_result') return mapField(record, 'content', blocks)
    if (record.toolResult) {
      return mapField(record, 'toolResult', (result) => mapField(result, 'content', blocks))
    }
    return value
  }
  const blocks = (value: unknown): unknown => mapArray(value, block)
  let mapped = mapField(payload, 'messages', (messages) =>
    mapArray(messages, (message) => mapField(message, 'content', blocks))
  )
  mapped = mapField(mapped, 'input', (input) =>
    mapArray(input, (message) => {
      const type = object(message)?.type
      return type === 'function_call_output' || type === 'custom_tool_call_output'
        ? mapField(message, 'output', blocks)
        : mapField(message, 'content', blocks)
    })
  )
  mapped = mapField(mapped, 'contents', (contents) =>
    mapArray(contents, (content) => mapField(content, 'parts', blocks))
  )
  // pi-messages 在 context 内传递 SDK 消息，仍只处理消息内容。
  return mapField(mapped, 'context', (context) =>
    mapField(context, 'messages', (messages) =>
      mapArray(messages, (message) => mapField(message, 'content', blocks))
    )
  )
}

export interface PreparedRequestBody {
  payload: unknown
  bytes: number
  mediaBytes: number
  mediaCount: number
  removed: number
}

function sizeMessage(body: PreparedRequestBody): string {
  return `请求体约 ${(body.bytes / mib).toFixed(2)} MiB，其中图片或文档约 ${(body.mediaBytes / mib).toFixed(2)} MiB`
}

/** 按实际 JSON 的 UTF-8 字节数逐个清理最旧媒体，保留文字及原始会话对象。 */
export function prepareRequestBody(
  payload: unknown,
  maxBytes = Infinity,
  stripAll = false
): PreparedRequestBody {
  const body: PreparedRequestBody = {
    payload,
    bytes: jsonBytes(payload),
    mediaBytes: 0,
    mediaCount: 0,
    removed: 0
  }
  const selected = new Set<number>()
  let removedBytes = 0
  mapMedia(payload, (block, placeholder) => {
    const index = body.mediaCount++
    const bytes = jsonBytes(block)
    body.mediaBytes += bytes
    if (stripAll || body.bytes > maxBytes) {
      selected.add(index)
      body.bytes += jsonBytes(placeholder) - bytes
      body.removed++
      removedBytes += bytes
    }
    return block
  })
  if (selected.size) {
    let index = 0
    body.payload = mapMedia(payload, (block, placeholder) =>
      selected.has(index++) ? placeholder : block
    )
    body.bytes = jsonBytes(body.payload)
    body.mediaBytes -= removedBytes
  }
  if (body.bytes > maxBytes) {
    throw new Error(
      `请求体超过发送预算 ${(maxBytes / mib).toFixed(0)} MiB；移除图片和文档后仍有 ${(body.bytes / mib).toFixed(2)} MiB 文字或其他内容。请压缩会话、缩短输入或减少工具输出。`
    )
  }
  return body
}

function requestBudget(model: Model<Api>): number {
  let hostname = ''
  try {
    hostname = new URL(model.baseUrl).hostname
  } catch {
    // 自定义提供商可能没有 HTTP 地址；没有已知上限时仅做 413 恢复。
  }
  // 已知服务端上限之外预留 1 MiB；不能把某一提供商的限制套到所有模型。
  if (model.provider === 'deepseek' || hostname === 'api.deepseek.com') return 47 * mib
  if (model.provider === 'anthropic' || hostname === 'api.anthropic.com') return 31 * mib
  return Infinity
}

function bodyTooLarge(message: string | undefined): boolean {
  return /\b413\b|request_too_large|failed to buffer the request body.*length limit exceeded/i.test(
    message ?? ''
  )
}

async function* responseEvents(
  stream: AssistantMessageEventStream
): AsyncGenerator<AssistantMessageEvent> {
  let completed = false
  for await (const event of stream) {
    if (event.type === 'done' || event.type === 'error') completed = true
    yield event
  }
  // 扩展提供商也可以通过 end(result) 结束，必须保留这种 SDK 流协议。
  if (!completed) {
    const result = await stream.result()
    if (result.stopReason === 'error' || result.stopReason === 'aborted') {
      yield { type: 'error', reason: result.stopReason, error: result }
    } else if (result.stopReason !== 'pending') {
      yield { type: 'done', reason: result.stopReason, message: result }
    } else throw new Error('模型响应未正常结束')
  }
}

function guardStream<T extends StreamOptions>(
  source: Stream<T>,
  onRequestBody?: RequestBodyListener,
  blockImages = false
): Stream<T> {
  return (model, context, options) => {
    // 虚拟模型可能再次进入 streamSimple；同一逻辑请求只安装一次恢复层。
    if ((options as T & { [guardedRequest]?: boolean })?.[guardedRequest])
      return source(model, context, options)

    async function* events(): AsyncGenerator<AssistantMessageEvent> {
      for (let attempt = 0; attempt < 2; attempt++) {
        let prepared: PreparedRequestBody | undefined
        let started = false
        let retry = false
        const stream = source(
          model,
          context,
          Object.assign({}, options, {
            [guardedRequest]: true,
            onPayload: async (payload: unknown, requestModel: Model<Api>) => {
              const transformed = await options?.onPayload?.(payload, requestModel)
              prepared = prepareRequestBody(
                transformed === undefined ? payload : transformed,
                requestBudget(requestModel),
                blockImages || attempt > 0
              )
              if (!auxiliary.getStore()) onRequestBody?.(prepared.bytes, options?.sessionId)
              return prepared.payload
            }
          })
        )
        for await (const event of responseEvents(stream)) {
          if (
            event.type === 'error' &&
            event.reason !== 'aborted' &&
            !options?.signal?.aborted &&
            !started &&
            bodyTooLarge(event.error.errorMessage)
          ) {
            if (attempt === 0 && prepared && prepared.mediaCount > prepared.removed) {
              retry = true
              break
            }
            yield {
              ...event,
              error: {
                ...event.error,
                errorMessage: `HTTP 413：${prepared ? sizeMessage(prepared) : '请求体过大'}。${attempt > 0 || prepared?.removed ? '移除发送内容中的图片和文档后仍超过服务端限制。' : ''}请压缩会话、缩短输入或减少工具输出。`
              }
            }
          } else {
            started = true
            yield event
          }
        }
        if (!retry) return
      }
    }
    return lazyStream(model, async () => events())
  }
}

/** 同时覆盖普通对话、子 Agent、摘要和 complete 调用；不依赖特定 HTTP 适配器。 */
export function guardModelRequests(
  runtime: Pick<ModelRuntime, 'stream' | 'streamSimple'>,
  onRequestBody?: RequestBodyListener,
  blockImages = false
): void {
  const stream = runtime.stream.bind(runtime)
  runtime.stream = <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>
  ) =>
    guardStream<ModelsApiStreamOptions<TApi>>(
      (_model, context, options) => stream(model, context, options),
      onRequestBody,
      blockImages
    )(model, context, options)
  runtime.streamSimple = guardStream(runtime.streamSimple.bind(runtime), onRequestBody, blockImages)
}
