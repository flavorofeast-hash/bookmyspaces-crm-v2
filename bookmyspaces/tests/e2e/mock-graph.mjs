// Stand-in for graph.facebook.com during local end-to-end tests. Records every call.
import http from 'node:http'
import fs from 'node:fs'
const log = process.env.MOCK_LOG ?? '/tmp/mock-graph.log'
fs.writeFileSync(log, '')
let n = 0
http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    fs.appendFileSync(log, JSON.stringify({ method: req.method, url: req.url, body: body.slice(0, 500) }) + '\n')
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.url.includes('/messages')) {
      if (body.includes('919999900000')) return json(400, { error: { message: '(#131030) Recipient phone number not in allowed list', code: 131030 } })
      return json(200, { messages: [{ id: 'wamid.MOCK' + ++n }] })
    }
    if (req.url.includes('/PAGE1/photos') || req.url.includes('/PAGE1/feed')) return json(200, { id: 'PHOTO' + ++n, post_id: 'PAGE1_' + n })
    if (req.url.includes('fields=permalink_url')) return json(200, { permalink_url: 'https://facebook.com/PAGE1/posts/mock' })
    if (req.url.includes('PAGE1?fields')) return json(200, { id: 'PAGE1', name: 'BookMySpaces (mock Page)' })
    if (req.url.includes('IG1?fields')) return json(200, { id: 'IG1', username: 'bookmyspaces_mock' })
    if (req.url.endsWith('/IG1/media')) return json(200, { id: 'CONTAINER' + ++n })
    if (req.url.endsWith('/IG1/media_publish')) return json(200, { id: 'IGMEDIA' + ++n })
    if (req.url.includes('fields=permalink')) return json(200, { permalink: 'https://instagram.com/p/mock' })
    json(404, { error: { message: 'mock: unknown ' + req.url } })
  })
}).listen(4010, () => console.log('mock graph on 4010'))
