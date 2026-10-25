import test from 'node:test'
import assert from 'node:assert/strict'
import { Type } from 'typebox'
import {
  createStructuredOutputTool,
  parseStructuredOutput,
  structuredOutputOptions
} from '../src/runtime/structured-output.ts'

const response = (value, name = 'structured_output') => ({
  stopReason: 'toolUse',
  content: [{ type: 'toolCall', id: 'result', name, arguments: value }]
})

test('结构化输出工具按每次传入的 Schema 生成并校验，不绑定固定接口', () => {
  const firstSchema = Type.Object({ answer: Type.String() }, { additionalProperties: false })
  const secondSchema = Type.Object({ count: Type.Integer() }, { additionalProperties: false })
  const first = createStructuredOutputTool(firstSchema)
  const second = createStructuredOutputTool(secondSchema)
  assert.equal(first.parameters, firstSchema)
  assert.equal(second.parameters, secondSchema)
  assert.deepEqual(parseStructuredOutput(first, response({ answer: '完成' })), { answer: '完成' })
  assert.deepEqual(parseStructuredOutput(second, response({ count: 2 })), { count: 2 })
  assert.throws(() => parseStructuredOutput(second, response({ answer: '完成' })))
  assert.throws(() => parseStructuredOutput(second, response({ count: '2' })))
})

test('只接受一次完整的目标工具调用，正文、其他工具、多次调用和解析错误均无效', () => {
  const tool = createStructuredOutputTool(Type.Object({ approved: Type.Boolean() }))
  const valid = response({ approved: true })
  for (const stopReason of ['stop', 'toolUse']) {
    assert.deepEqual(parseStructuredOutput(tool, { ...valid, stopReason }), { approved: true })
  }
  const malformed = response({ approved: true })
  malformed.content[0].argumentsError = 'truncated JSON'
  for (const result of [
    { stopReason: 'stop', content: [{ type: 'text', text: '{"approved":true}' }] },
    response({ approved: true }, 'write'),
    { ...valid, content: [...valid.content, ...valid.content] },
    { ...valid, content: [...valid.content, ...response({}, 'write').content] },
    { ...valid, content: [] },
    ...['length', 'error', 'aborted'].map((stopReason) => ({ ...valid, stopReason })),
    malformed
  ]) {
    assert.throws(() => parseStructuredOutput(tool, result), /无效的结构化输出/)
  }
})

test('按各 API 协议选择工具，兼容不允许强制选择的 Claude 型号及未知扩展 API', () => {
  for (const api of ['google-generative-ai', 'google-vertex'])
    assert.equal(structuredOutputOptions(api).toolChoice, 'any')
  for (const api of [
    'openai-completions',
    'openai-responses',
    'azure-openai-responses',
    'openai-codex-responses',
    'mistral-conversations',
    'pi-messages'
  ])
    assert.equal(structuredOutputOptions(api).toolChoice, 'required')
  for (const api of ['anthropic-messages', 'bedrock-converse-stream', 'custom-api'])
    assert.equal(structuredOutputOptions(api).toolChoice, 'auto')
})
