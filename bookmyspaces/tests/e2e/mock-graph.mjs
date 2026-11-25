// Stand-in for graph.facebook.com during local end-to-end tests. Records every call.
import http from 'node:http'
import fs from 'node:fs'
const log = process.env.MOCK_LOG ?? '/tmp/mock-graph.log'
fs.writeFileSync(log, '')
let n = Date.now() // unique across restarts, so ids never collide with earlier runs
http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    fs.appendFileSync(log, JSON.stringify({ method: req.method, url: req.url, body: body.slice(0, 500) }) + '\n')
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.url === '/v1/messages') { // stand-in for api.anthropic.com (ANTHROPIC_BASE_URL)
      const b = JSON.parse(body || '{}'); const last = b.messages?.at(-1)?.content ?? ''
      const facts = (b.system ?? '').includes('BUSINESS FACTS')
      return json(200, { content: [{ type: 'text', text: /book|date|available/i.test(last) ? 'Thank you! Our team will check availability and reply shortly.\n<<HANDOVER: availability request>>' : `Hello! (mock AI, approved facts ${facts ? 'received' : 'missing'}) How many guests are you expecting?` }] })
    }
    if (/\/MEDIAIN\d*$/.test(req.url)) return json(200, { url: 'http://localhost:4010/download/photo.jpg', mime_type: 'image/jpeg' })
    if (req.url === '/download/photo.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])) }
    if (req.url.endsWith('/media')) return json(200, { id: 'MEDIAUP' + ++n })
    if (req.url.includes('/PAGE1/messages')) return json(200, { recipient_id: 'x', message_id: 'm_out' + ++n })
    if (req.url.includes('/subscribed_apps')) return json(200, req.method === 'POST' ? { success: true } : { data: [{ name: 'BookMySpaces', subscribed_fields: ['messages', 'leadgen'] }] })
    if (req.url.includes('/PSIDE2E?fields')) return json(200, { first_name: 'ZZ TEST', last_name: 'Messenger' })
    if (req.url.includes('/FORME2E?fields')) return json(200, { name: 'Skyline rooms form' })
    if (req.url.includes('/LEADE2E?fields')) return json(200, { id: 'LEADE2E', created_time: new Date().toISOString(), platform: 'fb', form_id: 'FORME2E', ad_id: 'AD1', ad_name: 'Skyline rooms ad', campaign_id: 'C1', campaign_name: 'Skyline Dec', field_data: [{ name: 'full_name', values: ['ZZ TEST Form Lead'] }, { name: 'phone_number', values: ['+919800000077'] }, { name: 'email', values: ['zz@test.invalid'] }, { name: 'how_many_guests', values: ['2 guests'] }] })
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
