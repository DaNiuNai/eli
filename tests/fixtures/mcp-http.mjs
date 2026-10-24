import { createServer } from 'node:http'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function mcpHttpServer(t, { requireAuth = false, rejectAuth = false } = {}) {
  const requests = []
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    if (rejectAuth || (requireAuth && req.headers.authorization !== 'Bearer mcp-test-only')) {
      res.writeHead(401, { 'www-authenticate': 'Bearer' }).end()
      return
    }
    let text = ''
    for await (const chunk of req) text += chunk
    const request = JSON.parse(text)
    requests.push(request)
    if (request.id === undefined) {
      res.writeHead(202).end()
      return
    }
    let result
    if (request.method === 'initialize') {
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'eli-test-http', version: '1.0.0' }
      }
    } else if (request.method === 'tools/list') {
      result =
        request.params?.cursor === 'second'
          ? { tools: [{ name: 'second', inputSchema: { type: 'object', properties: {} } }] }
          : {
              tools: [
                {
                  name: 'echo',
                  description: 'HTTP test echo',
                  inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
                }
              ],
              nextCursor: 'second'
            }
    } else if (request.method === 'tools/call') {
      result = { content: [{ type: 'text', text: `mcp-echo:${request.params.arguments.value}` }] }
    } else result = {}
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, requests }
}
