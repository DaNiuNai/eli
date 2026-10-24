import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const log = process.argv[2]
const stalled = process.argv.includes('--stall')
appendFileSync(log, `${JSON.stringify({ pid: process.pid, cwd: process.cwd() })}\n`)
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const request = JSON.parse(line)
  appendFileSync(log, `${JSON.stringify({ method: request.method })}\n`)
  if (request.id === undefined || stalled) return
  let result
  if (request.method === 'initialize') {
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'eli-test-mcp', version: '1.0.0' }
    }
  } else if (request.method === 'tools/list') {
    result = {
      tools: [
        {
          name: 'echo',
          description: 'Local test echo',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
        }
      ]
    }
  } else if (request.method === 'tools/call') {
    result = { content: [{ type: 'text', text: `mcp-echo:${request.params.arguments.value}` }] }
  } else if (request.method === 'ping') result = {}
  else {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })}\n`
    )
    return
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
})
input.on('close', () => process.exit(0))
