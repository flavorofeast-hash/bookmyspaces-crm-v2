// Security regression: a forged session cookie combined with a client-navigation (RSC) request
// must never return CRM data. Usage: BASE=http://localhost:3000 node tests/e2e/forged-session-check.mjs
const BASE = process.env.BASE ?? 'http://localhost:3000'
const pages = ['today', 'customers', 'customers/new', 'bookings', 'bookings/new', 'billing', 'inbox', 'marketing', 'settings']
const tree = (seg) => encodeURIComponent(JSON.stringify(['', { children: ['(app)', { children: [seg, { children: ['__PAGE__', {}] }] }, null, null, true] }, null, null, true]))
let bad = 0
for (const p of pages) {
  for (const cookie of ['bms_session=forged.value', '']) {
    const r = await fetch(`${BASE}/${p}`, { headers: { RSC: '1', 'Next-Router-State-Tree': tree(p.split('/')[0]), ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual' })
    const t = r.status === 200 ? await r.text() : ''
    const leaked = /TEST Lead|Rahul|Sunita|₹|BK-\d{4}|RCP-\d{4}|\+91 /.test(t) && !/NEXT_REDIRECT/.test(t)
    console.log(leaked ? 'LEAK' : 'ok  ', p, cookie ? '(forged cookie)' : '(no cookie)', r.status, /NEXT_REDIRECT;[^;]*;\/login/.test(t) ? 'redirect→/login' : '')
    if (leaked) bad++
  }
}
console.log(bad ? `FAIL: ${bad} leak(s)` : 'PASS: no CRM data without a valid session')
process.exit(bad ? 1 : 0)
