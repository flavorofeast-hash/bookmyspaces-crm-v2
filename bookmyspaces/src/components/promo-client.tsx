'use client'

import '@fontsource/noto-sans-bengali/400.css'
import '@fontsource/noto-sans-bengali/700.css'
import { useEffect, useRef, useState } from 'react'
import { logPromoEvent } from '@/app/(app)/marketing/studio-actions'

export type PromoText = {
  propertyName: string; location: string | null; headlineEn: string; headlineBn: string; language: 'en' | 'bn' | 'both'
  offerLine: string | null; contactLine: string; code: string
}
export type Photo = { token: string; title: string | null }

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Bengali", "Nirmala UI", "Vrinda", sans-serif`
const BRAND = '#0f766e'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Photo could not be loaded')); i.src = src })
}
async function fontsReady() {
  try { await Promise.all([document.fonts.load(`700 40px "Noto Sans Bengali"`, 'বাংলা'), document.fonts.load(`400 40px "Noto Sans Bengali"`, 'বাংলা')]) } catch { /* fall back to system fonts */ }
}

/** Draws a photo to fill the frame by cropping (never stretching). zoom ≥ 1 for a slow push-in. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, zoom = 1, alpha = 1) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom
  const w = img.naturalWidth * s, h = img.naturalHeight * s
  ctx.globalAlpha = alpha
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
  ctx.globalAlpha = 1
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/), lines: string[] = []
  let line = ''
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w } else line = t
  }
  if (line) lines.push(line)
  return lines
}

/** Text block drawn from the bottom up; returns the top y used. */
function drawText(ctx: CanvasRenderingContext2D, W: number, H: number, t: PromoText, o: { headline?: boolean } = { headline: true }) {
  const u = (W / 1080) * (H / W > 1.5 ? 1.15 : 1), pad = 64 * (W / 1080), maxW = W - pad * 2
  const g = ctx.createLinearGradient(0, H * 0.35, 0, H)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0.85)')
  ctx.fillStyle = g; ctx.fillRect(0, H * 0.35, W, H * 0.65)
  const top = ctx.createLinearGradient(0, 0, 0, 220 * u)
  top.addColorStop(0, 'rgba(0,0,0,0.6)'); top.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = top; ctx.fillRect(0, 0, W, 220 * u)
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff'
  ctx.font = `700 ${40 * u}px ${FONT}`
  ctx.fillText(t.propertyName.toUpperCase(), pad, pad + 30 * u)
  if (t.location) { ctx.font = `400 ${28 * u}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(t.location, pad, pad + 72 * u) }
  // bottom-up
  let y = H - pad
  ctx.font = `700 ${32 * u}px ${FONT}`
  const pill = t.contactLine || ''
  if (pill) {
    const lines = wrap(ctx, pill, maxW - 48 * u).slice(0, 2)
    const ph = lines.length * 42 * u + 28 * u
    ctx.fillStyle = BRAND
    roundRect(ctx, pad, y - ph, maxW, ph, 18 * u); ctx.fill()
    ctx.fillStyle = '#fff'
    lines.forEach((l, i) => ctx.fillText(l, pad + 24 * u, y - ph + 14 * u + 32 * u + i * 42 * u))
    y -= ph + 24 * u
  }
  ctx.font = `400 ${26 * u}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText(`Code ${t.code} · bookmyspaces.in`, pad, y); y -= 44 * u
  if (t.offerLine) {
    ctx.font = `700 ${34 * u}px ${FONT}`; ctx.fillStyle = '#fde68a'
    const ls = wrap(ctx, t.offerLine, maxW).slice(0, 2).reverse()
    for (const l of ls) { ctx.fillText(l, pad, y); y -= 46 * u }
    y -= 8 * u
  }
  if (o.headline !== false) {
    const heads: [string, number][] = t.language === 'en' ? [[t.headlineEn, 76]] : t.language === 'bn' ? [[t.headlineBn, 72]] : [[t.headlineBn, 46], [t.headlineEn, 76]]
    for (const [h, size] of heads) {
      ctx.font = `700 ${size * u}px ${FONT}`; ctx.fillStyle = '#fff'
      const ls = wrap(ctx, h, maxW).slice(0, 3).reverse()
      for (const l of ls) { ctx.fillText(l, pad, y); y -= size * 1.18 * u }
      y -= 10 * u
    }
  }
  return y
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

const track = (id: string, kind: string, detail?: string) => { logPromoEvent(id, kind, detail).catch(() => {}) }

// ── Promotional images ─────────────────────────────────────────────────────────

const FORMATS = [{ key: 'square', label: 'Square 1:1 (posts)', W: 1080, H: 1080 }, { key: 'portrait', label: 'Portrait 4:5 (Instagram)', W: 1080, H: 1350 }, { key: 'story', label: 'Story 9:16 (Status / Stories)', W: 1080, H: 1920 }]

export function PromoImages({ promotionId, photos, text, fileBase }: { promotionId: string; photos: Photo[]; text: PromoText; fileBase: string }) {
  const [hero, setHero] = useState(0)
  const refs = useRef<(HTMLCanvasElement | null)[]>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    ;(async () => {
      try {
        await fontsReady()
        const img = await loadImage(`/api/media/${photos[hero].token}`)
        if (off) return
        FORMATS.forEach((f, i) => {
          const c = refs.current[i]; if (!c) return
          c.width = f.W; c.height = f.H
          const ctx = c.getContext('2d')!
          ctx.fillStyle = '#111'; ctx.fillRect(0, 0, f.W, f.H)
          drawCover(ctx, img, f.W, f.H)
          drawText(ctx, f.W, f.H, text)
        })
        setErr(null)
      } catch (e) { setErr((e as Error).message) }
    })()
    return () => { off = true }
  }, [hero, photos, text])

  const download = (i: number) => {
    const c = refs.current[i]; if (!c) return
    c.toBlob((b) => {
      if (!b) return
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${fileBase}-${FORMATS[i].key}.jpg`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      track(promotionId, 'downloaded_image', FORMATS[i].key)
    }, 'image/jpeg', 0.92)
  }
  return (
    <div>
      {photos.length > 1 && <div className="mb-3">
        <div className="text-xs muted mb-1">Main photo (tap to change)</div>
        <div className="flex gap-2 overflow-x-auto pb-1">{photos.map((p, i) => (
          <button key={p.token} type="button" onClick={() => setHero(i)} className={`shrink-0 rounded border-2 ${i === hero ? 'border-teal-600' : 'border-transparent'}`}>
            <img src={`/api/media/${p.token}`} alt={p.title ?? ''} className="w-16 h-16 object-cover rounded" />
          </button>))}</div>
      </div>}
      {err && <p className="text-sm text-red-700">{err}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{FORMATS.map((f, i) => (
        <div key={f.key} className="space-y-2">
          <canvas ref={(el) => { refs.current[i] = el }} className="w-full h-auto rounded border border-slate-200 bg-slate-900" data-format={f.key} />
          <button type="button" className="btn-secondary btn-sm w-full" onClick={() => download(i)}>Download {f.label}</button>
        </div>))}</div>
    </div>
  )
}

// ── Copy with tracking ─────────────────────────────────────────────────────────

export function TrackedCopy({ promotionId, text, label, kind }: { promotionId: string; text: string; label: string; kind: 'copied_caption' | 'copied_whatsapp' }) {
  const [done, setDone] = useState(false)
  return <button type="button" className="btn-secondary btn-sm" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); track(promotionId, kind, label) } catch { setDone(false) }
  }}>{done ? 'Copied ✓' : label}</button>
}

export function TrackedLink({ promotionId, href, children, className }: { promotionId: string; href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className ?? 'btn-secondary btn-sm'} onClick={() => track(promotionId, 'opened_destination', href)}>{children}</a>
}

// ── Short video (real MP4, made in the browser with WebCodecs) ─────────────────

const VFORMATS = { '9:16': { W: 720, H: 1280 }, '1:1': { W: 1080, H: 1080 }, '16:9': { W: 1280, H: 720 } } as const

/** Soft generated background music (no licence needed): slow chords with gentle fades. */
async function builtInMusic(seconds: number, sampleRate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate)
  const master = ctx.createGain(); master.gain.value = 0.18; master.connect(ctx.destination)
  const chords = [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]]
  const len = 4
  for (let t = 0, k = 0; t < seconds; t += len, k++) {
    for (const f of chords[k % chords.length]) {
      for (const det of [-3, 3]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = det
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 1.2); g.gain.linearRampToValueAtTime(0.18, t + len - 0.6); g.gain.linearRampToValueAtTime(0, t + len + 0.6)
        o.connect(g); g.connect(master); o.start(t); o.stop(Math.min(seconds, t + len + 0.7))
      }
    }
  }
  master.gain.setValueAtTime(0.18, Math.max(0, seconds - 2)); master.gain.linearRampToValueAtTime(0, seconds)
  return ctx.startRendering()
}

async function fileMusic(file: File, seconds: number, sampleRate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate)
  const buf = await ctx.decodeAudioData(await file.arrayBuffer())
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = buf.duration < seconds
  const g = ctx.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.8, 1); g.gain.setValueAtTime(0.8, Math.max(1, seconds - 2)); g.gain.linearRampToValueAtTime(0, seconds)
  src.connect(g); g.connect(ctx.destination); src.start(0)
  return ctx.startRendering()
}

export function VideoMaker({ promotionId, photos, text, fileBase }: { promotionId: string; photos: Photo[]; text: PromoText; fileBase: string }) {
  const [sel, setSel] = useState<string[]>(photos.slice(0, 10).map((p) => p.token))
  const [secs, setSecs] = useState(15)
  const [fmt, setFmt] = useState<keyof typeof VFORMATS>('9:16')
  const [music, setMusic] = useState<'none' | 'builtin' | 'file'>('builtin')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [out, setOut] = useState<{ url: string; size: number; audio: string | null; w: number; h: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const supported = typeof window !== 'undefined' && 'VideoEncoder' in window

  async function render() {
    setErr(null); setOut(null)
    try {
      if (!sel.length) throw new Error('Choose at least one photo.')
      if (music === 'file' && !file) throw new Error('Choose a music file, or pick “Built-in soft music” or “No music”.')
      setBusy('Preparing photos…')
      await fontsReady()
      const imgs = await Promise.all(sel.map((t) => loadImage(`/api/media/${t}`)))
      const { W, H } = VFORMATS[fmt], fps = 30, total = secs * fps
      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer')
      let codec = ''
      for (const c of ['avc1.640028', 'avc1.4D4028', 'avc1.42E028', 'avc1.42E01F']) {
        const s = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: 3_500_000, framerate: fps })
        if (s.supported) { codec = c; break }
      }
      if (!codec) throw new Error('This browser cannot encode MP4 (H.264) video. Use Google Chrome or Microsoft Edge.')
      // audio
      let audio: AudioBuffer | null = null, aCodec: 'aac' | 'opus' | null = null, aRate = 44100
      if (music !== 'none') {
        setBusy('Preparing music…')
        const aacOk = (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 128000 }).catch(() => ({ supported: false }))).supported
        if (aacOk) { aCodec = 'aac'; aRate = 44100 } else if ((await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }).catch(() => ({ supported: false }))).supported) { aCodec = 'opus'; aRate = 48000 }
        if (aCodec) audio = music === 'builtin' ? await builtInMusic(secs, aRate) : await fileMusic(file!, secs, aRate)
      }
      const target = new ArrayBufferTarget()
      const muxer = new Muxer({ target, fastStart: 'in-memory', video: { codec: 'avc', width: W, height: H, frameRate: fps },
        ...(audio && aCodec ? { audio: { codec: aCodec, numberOfChannels: 2, sampleRate: aRate } } : {}) })
      let failure: Error | null = null
      const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e as Error } })
      enc.configure({ codec, width: W, height: H, bitrate: fmt === '1:1' ? 3_500_000 : 2_500_000, framerate: fps, avc: { format: 'avc' } })
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')!
      const intro = 2.5 * fps, outro = 3 * fps, body = total - intro - outro, per = body / imgs.length, fade = Math.min(0.6 * fps, per / 3)
      const u = W / 1080
      for (let i = 0; i < total; i++) {
        if (failure) throw failure
        ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H)
        if (i < intro) {
          drawCover(ctx, imgs[0], W, H, 1 + 0.05 * (i / intro))
          ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H)
          const a = Math.min(1, i / (0.6 * fps)); ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
          ctx.font = `700 ${Math.round(Math.min(W, H) / 13)}px ${FONT}`
          wrap(ctx, text.propertyName, W * 0.85).forEach((l, k, arr) => ctx.fillText(l, W / 2, H / 2 - (arr.length - 1) * 40 * u + k * 80 * u))
          ctx.font = `400 ${Math.round(Math.min(W, H) / 26)}px ${FONT}`
          const sub = text.language === 'bn' ? text.headlineBn : text.headlineEn
          wrap(ctx, sub, W * 0.85).slice(0, 2).forEach((l, k) => ctx.fillText(l, W / 2, H / 2 + 90 * u + k * 50 * u))
          if (text.location) { ctx.font = `400 ${Math.round(Math.min(W, H) / 34)}px ${FONT}`; ctx.fillText(text.location, W / 2, H / 2 + 200 * u) }
          ctx.globalAlpha = 1; ctx.textAlign = 'left'
        } else if (i >= total - outro) {
          const k = i - (total - outro)
          drawCover(ctx, imgs[imgs.length - 1], W, H, 1.08)
          ctx.fillStyle = `rgba(15,118,110,${Math.min(0.88, k / (0.5 * fps) * 0.88)})`; ctx.fillRect(0, 0, W, H)
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
          ctx.font = `700 ${Math.round(Math.min(W, H) / 15)}px ${FONT}`
          ctx.fillText(text.language === 'bn' ? 'এখনই বুক করুন' : 'Book now', W / 2, H / 2 - 120 * u)
          ctx.font = `700 ${Math.round(Math.min(W, H) / 24)}px ${FONT}`
          wrap(ctx, text.contactLine, W * 0.86).slice(0, 3).forEach((l, n) => ctx.fillText(l, W / 2, H / 2 + n * 56 * u))
          ctx.font = `400 ${Math.round(Math.min(W, H) / 32)}px ${FONT}`
          ctx.fillText(`${text.propertyName} · Code ${text.code}`, W / 2, H / 2 + 220 * u)
          ctx.fillText('bookmyspaces.in', W / 2, H / 2 + 270 * u)
          ctx.textAlign = 'left'
        } else {
          const t = i - intro, idx = Math.min(imgs.length - 1, Math.floor(t / per)), local = t - idx * per
          drawCover(ctx, imgs[idx], W, H, 1 + 0.08 * (local / per))
          if (idx > 0 && local < fade) drawCover(ctx, imgs[idx - 1], W, H, 1.08, 1 - local / fade)
          drawText(ctx, W, H, text, { headline: idx === 0 || idx === imgs.length - 1 })
        }
        const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) })
        enc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close()
        while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4))
        if (i % 15 === 0) { setBusy(`Making video… ${Math.round((i / total) * 100)}%`); await new Promise((r) => setTimeout(r, 0)) }
      }
      await enc.flush(); enc.close()
      if (audio && aCodec) {
        setBusy('Adding music…')
        const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure = e as Error } })
        aenc.configure({ codec: aCodec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate: aRate, numberOfChannels: 2, bitrate: 128000 })
        const L = audio.getChannelData(0), R = audio.getChannelData(1), N = 1024
        for (let s = 0; s < audio.length; s += N) {
          const n = Math.min(N, audio.length - s), data = new Float32Array(n * 2)
          data.set(L.subarray(s, s + n), 0); data.set(R.subarray(s, s + n), n)
          const ad = new AudioData({ format: 'f32-planar', sampleRate: aRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(s * 1e6 / aRate), data })
          aenc.encode(ad); ad.close()
        }
        await aenc.flush(); aenc.close()
        if (failure) throw failure
      }
      muxer.finalize()
      const blob = new Blob([target.buffer], { type: 'video/mp4' })
      setOut({ url: URL.createObjectURL(blob), size: blob.size, audio: audio ? (aCodec === 'aac' ? 'AAC' : 'Opus') : null, w: W, h: H })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  if (!supported) return <p className="text-sm text-amber-700">This browser cannot make videos. Open this page in Google Chrome or Microsoft Edge (computer or Android phone).</p>
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs muted mb-1">Photos in the video ({sel.length} selected — 5 to 10 works best)</div>
        <div className="flex gap-2 overflow-x-auto pb-1">{photos.map((p) => {
          const on = sel.includes(p.token)
          return <button key={p.token} type="button" onClick={() => setSel(on ? sel.filter((x) => x !== p.token) : sel.length >= 10 ? sel : [...sel, p.token])} className={`shrink-0 rounded border-2 ${on ? 'border-teal-600' : 'border-transparent opacity-50'}`}>
            <img src={`/api/media/${p.token}`} alt={p.title ?? ''} className="w-14 h-14 object-cover rounded" /></button>
        })}</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <label>Length <select className="input" value={secs} onChange={(e) => setSecs(Number(e.target.value))}>{[15, 30, 45].map((s) => <option key={s} value={s}>{s} seconds</option>)}</select></label>
        <label>Shape <select className="input" value={fmt} onChange={(e) => setFmt(e.target.value as any)}><option value="9:16">9:16 Reels / Shorts / Status</option><option value="1:1">1:1 Feed post</option><option value="16:9">16:9 YouTube / Facebook</option></select></label>
        <label>Music <select className="input" value={music} onChange={(e) => setMusic(e.target.value as any)}><option value="builtin">Built-in soft music (no licence needed)</option><option value="file">My music file</option><option value="none">No music</option></select></label>
      </div>
      {music === 'file' && <div className="text-sm"><input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <p className="text-xs muted mt-1">Only use music you have the right to use (your own, licensed, or royalty-free with permission for social media).</p></div>}
      <button type="button" className="btn-primary" disabled={!!busy} onClick={render}>{busy ?? 'Make MP4 video'}</button>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {out && <div className="space-y-2">
        <video src={out.url} controls playsInline className="max-h-[480px] rounded border border-slate-200 bg-black" data-testid="promo-video" />
        <div className="text-xs muted">MP4 · {out.w}×{out.h} · {secs}s · {(out.size / 1048576).toFixed(1)} MB · {out.audio ? `music (${out.audio})` : 'no music'}{out.audio === 'Opus' ? ' — this browser cannot make AAC sound; some apps may play it silent. Use Chrome on Windows/Mac/Android for AAC.' : ''}</div>
        <a href={out.url} download={`${fileBase}-${fmt.replace(':', 'x')}-${secs}s.mp4`} className="btn-primary inline-block" onClick={() => track(promotionId, 'downloaded_video', `${fmt} ${secs}s`)}>Download MP4</a>
      </div>}
    </div>
  )
}
