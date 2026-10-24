import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function mcpOAuthServer(t) {
  let origin
  let client
  let challenge
  let exchanges = 0
  const calls = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin)
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const json = (value, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      json({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        resource_documentation: `${origin}/docs/auth`
      })
      return
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        authorization_response_iss_parameter_supported: true
      })
      return
    }
    let text = ''
    for await (const chunk of req) text += chunk
    if (url.pathname === '/register') {
      client = JSON.parse(text)
      json({ ...client, client_id: 'eli-mcp-test-client' }, 201)
      return
    }
    if (url.pathname === '/authorize') {
      assert.equal(url.searchParams.get('client_id'), 'eli-mcp-test-client')
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
      assert.ok(client.redirect_uris.includes(url.searchParams.get('redirect_uri')))
      challenge = url.searchParams.get('code_challenge')
      const callback = new URL(url.searchParams.get('redirect_uri'))
      callback.searchParams.set('code', 'eli-mcp-test-code')
      callback.searchParams.set('state', url.searchParams.get('state'))
      callback.searchParams.set('iss', origin)
      res.writeHead(302, { location: callback.href }).end()
      return
    }
    if (url.pathname === '/token') {
      const params = new URLSearchParams(text)
      assert.equal(params.get('grant_type'), 'authorization_code')
      assert.equal(params.get('code'), 'eli-mcp-test-code')
      assert.equal(
        createHash('sha256').update(params.get('code_verifier')).digest('base64url'),
        challenge
      )
      exchanges++
      json({ access_token: 'eli-mcp-test-access-token', token_type: 'Bearer', expires_in: 3600 })
      return
    }
    if (url.pathname !== '/mcp' || req.method !== 'POST') {
      res.writeHead(404).end()
      return
    }
    if (req.headers.authorization !== 'Bearer eli-mcp-test-access-token') {
      res
        .writeHead(401, {
          'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
        })
        .end()
      return
    }
    const request = JSON.parse(text)
    if (request.id === undefined) {
      res.writeHead(202).end()
      return
    }
    let result = {}
    if (request.method === 'initialize')
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'eli-test-oauth', version: '1.0.0' }
      }
    if (request.method === 'tools/list')
      result = {
        tools: [
          {
            name: 'echo',
            inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
          }
        ]
      }
    if (request.method === 'tools/call') {
      calls.push(request)
      result = { content: [{ type: 'text', text: `mcp-echo:${request.params.arguments.value}` }] }
    }
    json({ jsonrpc: '2.0', id: request.id, result })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return { url: `${origin}/mcp`, calls, exchanges: () => exchanges }
}
