import type {
  Api,
  AssistantMessage,
  ModelsApiStreamOptions,
  Static,
  Tool,
  TSchema
} from '@earendil-works/pi-ai'
import { Value } from 'typebox/value'

/** 每次请求根据目标 Schema 声明，仅用来接收最终响应，不注册或执行实际工具。 */
export function createStructuredOutputTool<T extends TSchema>(schema: T): Tool<T> {
  return {
    name: 'structured_output',
    description: '调用一次此工具，将最终结果作为符合所给 JSON Schema 的参数提交。',
    parameters: schema,
    constrainedSampling: { type: 'json_schema', strict: 'prefer' }
  }
}

/** 只提供一个输出工具；支持时强制调用，兼容不允许强制工具选择的 Claude 型号。 */
export function structuredOutputOptions(api: Api): ModelsApiStreamOptions<Api> {
  switch (api) {
    case 'anthropic-messages':
      return { toolChoice: 'auto', thinkingEnabled: false }
    case 'google-generative-ai':
    case 'google-vertex':
      return { toolChoice: 'any', thinking: { enabled: false } }
    case 'bedrock-converse-stream':
      return { toolChoice: 'auto' }
    case 'openai-completions':
    case 'openai-responses':
    case 'azure-openai-responses':
    case 'openai-codex-responses':
    case 'mistral-conversations':
    case 'pi-messages':
      return { toolChoice: 'required' }
    default:
      return { toolChoice: 'auto' }
  }
}

export function parseStructuredOutput<T extends TSchema>(
  tool: Tool<T>,
  result: AssistantMessage
): Static<T> {
  const calls = result.content.filter((part) => part.type === 'toolCall')
  if (
    (result.stopReason !== 'toolUse' && result.stopReason !== 'stop') ||
    calls.length !== 1 ||
    calls[0].name !== tool.name ||
    calls[0].argumentsError !== undefined ||
    !Value.Check(tool.parameters, calls[0].arguments)
  )
    throw new Error('无效的结构化输出工具调用')
  return calls[0].arguments as Static<T>
}
