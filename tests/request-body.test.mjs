import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { guardModelRequests, prepareRequestBody } from '../src/runtime/request-body.ts'

const image = (data) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } })
const bytes = (value) => Buffer.byteLength(JSON.stringify(value))

test('按 UTF-8 请求总字节数清理最旧图片，保留新图、中文、工具协议及原始对象', () => {
  const old = image('a'.repeat(2000))
  const recent = image('b'.repeat(2000))
  const payload = {
    model: 'local',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '旧图片分析：保留中文结论' }, old] },
      {
        role: 'assistant',
        tool_calls: [{ id: 'read-1', function: { name: 'read', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'read-1', content: '最近图片的文字说明' },
      { role: 'user', content: [recent] }
    ],
    tools: [{ function: { description: '工具定义'.repeat(100) } }]
  }
  const original = structuredClone(payload)
  const prepared = prepareRequestBody(payload, bytes(payload) - 1000)
  assert.equal(prepared.removed, 1)
  assert.ok(prepared.bytes <= bytes(payload) - 1000)
  assert.equal(prepared.bytes, bytes(prepared.payload))
  assert.equal(prepared.mediaBytes, bytes(recent))
  assert.equal(prepared.payload.messages[0].content[0].text, '旧图片分析：保留中文结论')
  assert.match(prepared.payload.messages[0].content[1].text, /省略.*图片或文档/)
  assert.equal(prepared.payload.messages[3].content[0], recent)
  assert.equal(prepared.payload.messages[1], payload.messages[1])
  assert.equal(prepared.payload.tools, payload.tools)
  assert.deepEqual(payload, original)
})

test('清理各协议的媒体块，保留工具调用参数中的同名字段及文字内容', () => {
  const attachment = { type: 'image', source: { type: 'base64', data: 'a'.repeat(1000) } }
  const cases = [
    {
      input: [
        {
          type: 'function_call_output',
          call_id: 't',
          output: [{ type: 'input_image', image_url: 'data:image/png;base64,a' }]
        }
      ]
    },
    { context: { messages: [{ role: 'user', content: [attachment] }] } },
    {
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't', content: [attachment] }]
        }
      ]
    },
    { messages: [{ role: 'user', content: [{ type: 'document', source: { data: 'pdf' } }] }] },
    {
      input: [
        { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,a' }] }
      ]
    },
    {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_file', file_data: 'data:application/pdf;base64,a' }]
        }
      ]
    },
    { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'a' } }] }] },
    {
      messages: [
        {
          role: 'user',
          content: [
            { toolResult: { toolUseId: 't', content: [{ image: { source: { bytes: 'a' } } }] } }
          ]
        }
      ]
    }
  ]
  for (const payload of cases) {
    const original = structuredClone(payload)
    const prepared = prepareRequestBody(payload, Infinity, true)
    assert.equal(prepared.removed, 1, JSON.stringify(payload))
    assert.match(JSON.stringify(prepared.payload), /省略/)
    assert.deepEqual(payload, original)
  }
  const parameters = { type: 'image', source: { data: 'this is a tool argument' } }
  const payload = {
    messages: [{ role: 'assistant', content: [{ type: 'tool_use', input: parameters }] }],
    tools: [{ input_schema: { const: parameters } }]
  }
  assert.equal(prepareRequestBody(payload, Infinity, true).payload, payload)
})

test('文字及工具定义本身超过预算时明确报错，不截断文字或修改输入', () => {
  const payload = { messages: [{ role: 'user', content: '用户限制'.repeat(1000) }] }
  assert.throws(() => prepareRequestBody(payload, 1000), /移除图片和文档后仍有.*文字或其他内容/)
  assert.equal(payload.messages[0].content, '用户限制'.repeat(1000))
})

const model = {
  api: 'openai-completions',
  provider: 'custom',
  id: 'local',
  baseUrl: 'http://localhost'
}
const message = (errorMessage) => ({
  role: 'assistant',
  api: model.api,
  provider: model.provider,
  model: model.id,
  content: [],
  stopReason: errorMessage ? 'error' : 'stop',
  errorMessage,
  timestamp: Date.now(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }
})

function guardedRuntime(respond) {
  const runtime = {
    stream(_model, context, options) {
      const stream = createAssistantMessageEventStream()
      void (async () => {
        const payload = (await options.onPayload(context, _model)) ?? context
        for (const event of await respond(payload)) stream.push(event)
        stream.end()
      })()
      return stream
    }
  }
  runtime.streamSimple = runtime.stream
  guardModelRequests(runtime)
  return runtime
}

test('413 只在响应开始前恢复一次，先执行原有 payload 钩子并保留原始上下文', async () => {
  const requests = []
  let hooks = 0
  const runtime = guardedRuntime((payload) => {
    requests.push(payload)
    return requests.length === 1
      ? [
          {
            type: 'error',
            reason: 'error',
            error: message('413 Failed to buffer the request body: length limit exceeded')
          }
        ]
      : [{ type: 'done', reason: 'stop', message: message() }]
  })
  const context = {
    messages: [
      { role: 'user', content: [{ type: 'text', text: '保留这条指令' }, image('a'.repeat(1000))] }
    ]
  }
  const original = structuredClone(context)
  const stream = runtime.streamSimple(model, context, {
    onPayload(payload) {
      hooks++
      return { ...payload, marker: 'extension' }
    }
  })
  const events = []
  for await (const event of stream) events.push(event)
  assert.equal((await stream.result()).stopReason, 'stop')
  assert.equal(requests.length, 2)
  assert.equal(hooks, 2)
  assert.equal(events.length, 1)
  assert.equal(requests[1].marker, 'extension')
  assert.equal(requests[1].messages[0].content[0].text, '保留这条指令')
  assert.doesNotMatch(JSON.stringify(requests[1]), /data:image/)
  assert.deepEqual(context, original)
})

test('无媒体、再次 413、已开始输出和用户取消均不会无限重试', async () => {
  for (const scenario of ['text', 'twice', 'started', 'aborted']) {
    let requests = 0
    const controller = new AbortController()
    const runtime = guardedRuntime(() => {
      requests++
      if (scenario === 'aborted') controller.abort()
      return [
        ...(scenario === 'started' ? [{ type: 'start', partial: message() }] : []),
        { type: 'error', reason: 'error', error: message('413 request_too_large') }
      ]
    })
    const context = {
      messages: [
        { role: 'user', content: scenario === 'text' ? 'hello' : [image('a'.repeat(1000))] }
      ]
    }
    const result = await runtime.stream(model, context, { signal: controller.signal }).result()
    assert.equal(result.stopReason, 'error')
    assert.equal(requests, scenario === 'twice' ? 2 : 1, scenario)
    if (scenario === 'twice') assert.match(result.errorMessage, /移除.*仍超过/)
  }
})

test('保留扩展提供商通过 end(result) 返回最终消息的流协议', { timeout: 1000 }, async () => {
  const result = message()
  const runtime = {
    stream() {
      const stream = createAssistantMessageEventStream()
      stream.end(result)
      return stream
    }
  }
  runtime.streamSimple = runtime.stream
  guardModelRequests(runtime)
  assert.equal(await runtime.stream(model, { messages: [] }).result(), result)
})
