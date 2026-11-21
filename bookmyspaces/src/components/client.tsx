'use client'

import { useFormStatus } from 'react-dom'
import { useState } from 'react'
import clsx from 'clsx'

/** Disables itself while the form is being saved, so a payment can't be recorded twice by double-tapping. */
export function SubmitButton({ children, className, name, value, pendingText }: { children: React.ReactNode; className?: string; name?: string; value?: string; pendingText?: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={clsx(className ?? 'btn-primary')}>
      {pending ? pendingText ?? 'Saving…' : children}
    </button>
  )
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className={className ?? 'btn-secondary btn-sm'}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000) } catch { setDone(false) } }}>
      {done ? 'Copied ✓' : label}
    </button>
  )
}

export function PrintButton({ label = 'Print / Save as PDF' }: { label?: string }) {
  return <button type="button" className="btn-primary" onClick={() => window.print()}>{label}</button>
}

export function QuickReplyBox({ replies, name = 'body', disabled }: { replies: { id: string; title: string; body: string }[]; name?: string; disabled?: boolean }) {
  const [text, setText] = useState('')
  return (
    <div className="space-y-2">
      {replies.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {replies.map((r) => (
            <button key={r.id} type="button" disabled={disabled} className="btn-secondary btn-sm" onClick={() => setText(r.body)}>{r.title}</button>
          ))}
        </div>
      )}
      <textarea name={name} value={text} onChange={(e) => setText(e.target.value)} rows={3} required disabled={disabled}
        className="input" placeholder="Type your reply…" />
    </div>
  )
}

export function CharCount({ name, defaultValue, limit, rows = 6 }: { name: string; defaultValue?: string; limit: number; rows?: number }) {
  const [v, setV] = useState(defaultValue ?? '')
  return (
    <div>
      <textarea name={name} value={v} onChange={(e) => setV(e.target.value)} rows={rows} className="input" />
      <div className={clsx('text-xs mt-1', v.length > limit ? 'text-red-600' : 'muted')}>{v.length} / {limit} characters (Instagram limit)</div>
    </div>
  )
}
