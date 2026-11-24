// Real-browser check of the Marketing & Promotion Studio: upload → approve → generate → images → MP4.
// Usage: BASE=http://localhost:3000 LOGIN=owner@demo.test PASSWORD=… PHOTOS=/tmp/ph node tests/e2e/promo-studio.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:3000', OUT = process.env.OUT ?? '/tmp/promo-out'
fs.mkdirSync(OUT, { recursive: true })
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
await page.setViewport({ width: 1366, height: 900 })
page.setDefaultTimeout(30000)
const go = (p) => page.goto(BASE + p, { waitUntil: 'networkidle0' })
const settle = async () => { await page.waitForNetworkIdle({ idleTime: 500, timeout: 20000 }).catch(() => {}); await new Promise((r) => setTimeout(r, 400)) }
const ok = (m) => console.log('PASS', m)

await go('/login')
await page.type('input[name=email]', process.env.LOGIN)
await page.type('input[type=password]', process.env.PASSWORD)
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type=submit]')])

// 1. upload photos to MonuRama, category rooftop
await go('/marketing/gallery')
const input = await page.$('input[type=file][name=images]')
await input.uploadFile(...fs.readdirSync(process.env.PHOTOS).map((f) => path.join(process.env.PHOTOS, f)))
await page.$eval('form:has(input[name=images]) select[name=property_id]', (s) => { s.value = [...s.options].find((o) => o.text === 'MonuRama Homestay').value })
await page.$eval('form:has(input[name=images]) select[name=category]', (s) => { s.value = 'rooftop' })
await page.$eval('form:has(input[name=images])', (f) => f.requestSubmit()); await settle()
const n = await page.$$eval('[data-media]', (els) => els.length)
if (n < 6) throw new Error('uploaded ' + n); ok(`uploaded ${n} photos`)

// 2. owner approves each
for (let i = 0; i < n; i++) {
  await go('/marketing/gallery')
  const done = await page.$$eval('[data-media]', (cards, i) => { const f = cards[i].querySelector('form'); const c = f.querySelector('input[name=approved]'); if (c.checked) return true; c.checked = true; f.requestSubmit(); return false }, i)
  if (!done) await settle()
}
await go('/marketing/gallery?approved=yes')
ok(`approved ${await page.$$eval('[data-media]', (e) => e.length)} photos`)

// 3. generate MonuRama rooftop promotion (English + Bengali)
await go('/marketing/studio')
const href = await page.$$eval('a', (as) => as.find((a) => a.textContent.startsWith('MonuRama Homestay')).getAttribute('href'))
await go(href)
await page.select('select[name=promo_type]', 'rooftop')
await page.select('select[name=language]', 'both')
await page.$eval('form:has(select[name=promo_type])', (f) => f.requestSubmit()); await settle()
if (!page.url().includes('/marketing/promotions/')) throw new Error('no promotion page: ' + page.url())
ok('promotion generated ' + page.url())

// 4. images render; save them
await page.waitForFunction(() => [...document.querySelectorAll('canvas[data-format]')].every((c) => c.width >= 1080))
const imgs = await page.$$eval('canvas[data-format]', (cs) => cs.map((c) => ({ f: c.dataset.format, w: c.width, h: c.height, d: c.toDataURL('image/jpeg', 0.92) })))
for (const i of imgs) fs.writeFileSync(`${OUT}/rooftop-${i.f}.jpg`, Buffer.from(i.d.split(',')[1], 'base64'))
ok('images ' + imgs.map((i) => `${i.f} ${i.w}x${i.h}`).join(', '))
const caption = await page.$eval('pre', (p) => p.textContent)
fs.writeFileSync(`${OUT}/rooftop-caption.txt`, caption)
ok('caption has Bengali: ' + /[ঀ-৿]/.test(caption))

// 5. MP4: 15 s, 9:16, built-in music
await page.$$eval('button', (bs) => bs.find((b) => b.textContent === 'Make MP4 video').click())
await page.waitForSelector('[data-testid=promo-video]', { timeout: 240000 })
const vid = await page.evaluate(async () => {
  const v = document.querySelector('[data-testid=promo-video]')
  const b = await fetch(v.src).then((r) => r.blob())
  const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  await new Promise((r) => { if (v.readyState >= 1) r(); else v.onloadedmetadata = r })
  return { b64: btoa(s), size: b.size, duration: v.duration, w: v.videoWidth, h: v.videoHeight, info: v.nextElementSibling.textContent }
})
fs.writeFileSync(`${OUT}/rooftop-9x16-15s.mp4`, Buffer.from(vid.b64, 'base64'))
ok(`video in browser: ${vid.w}x${vid.h} ${vid.duration.toFixed(2)}s ${vid.size} bytes — ${vid.info}`)
await page.screenshot({ path: `${OUT}/promotion-page.png`, fullPage: true })
await browser.close()
