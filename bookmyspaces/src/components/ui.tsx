import Link from 'next/link'
import clsx from 'clsx'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="text-sm muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, actions, children, className, pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-slate-100">
          <h2 className="h2">{title}</h2>
          {actions}
        </div>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  )
}

const badgeColors: Record<string, string> = {
  enquiry: 'bg-amber-100 text-amber-800', quoted: 'bg-sky-100 text-sky-800', confirmed: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-slate-200 text-slate-700', cancelled: 'bg-red-100 text-red-700', issued: 'bg-emerald-100 text-emerald-800',
  void: 'bg-red-100 text-red-700', free: 'bg-emerald-100 text-emerald-800', booked: 'bg-red-100 text-red-700',
  tentative: 'bg-amber-100 text-amber-800', sent: 'bg-slate-100 text-slate-700', delivered: 'bg-sky-100 text-sky-800',
  read: 'bg-emerald-100 text-emerald-800', failed: 'bg-red-100 text-red-700', sending: 'bg-slate-100 text-slate-600',
  received: 'bg-slate-100 text-slate-600', published: 'bg-emerald-100 text-emerald-800', posted_manually: 'bg-sky-100 text-sky-800',
  draft: 'bg-slate-100 text-slate-600', owner: 'bg-violet-100 text-violet-800', staff: 'bg-slate-100 text-slate-700',
}
export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={clsx('inline-block rounded-full px-2 py-0.5 text-xs font-medium', badgeColors[value] ?? 'bg-slate-100 text-slate-700')}>{label ?? value.replace(/_/g, ' ')}</span>
}

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null
  return (
    <div role={err ? 'alert' : 'status'} className={clsx('mb-4 rounded-lg px-4 py-3 text-sm border', err ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800')}>
      {err ?? ok}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm muted py-3">{children}</p>
}

export function Field({ label, children, className, hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs muted mt-1">{hint}</span>}
    </label>
  )
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: 'warn' | 'good' }) {
  const inner = (
    <div className={clsx('card card-pad h-full', tone === 'warn' && 'border-amber-300', href && 'hover:border-brand-500 transition')}>
      <div className="text-xs muted">{label}</div>
      <div className={clsx('text-xl sm:text-2xl font-semibold mt-1', tone === 'warn' && 'text-amber-700', tone === 'good' && 'text-emerald-700')}>{value}</div>
      {sub && <div className="text-xs muted mt-1">{sub}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

export function Hidden({ name, value }: { name: string; value: string | number | null | undefined }) {
  return <input type="hidden" name={name} value={value ?? ''} />
}

/** For dangerous actions: the form only appears after "Open". No browser pop-ups. */
export function Reveal({ label, children, danger }: { label: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <details className="group">
      <summary className={clsx('cursor-pointer list-none inline-flex', danger ? 'btn-secondary btn-sm text-red-700' : 'btn-secondary btn-sm')}>{label}</summary>
      <div className="mt-2 p-3 rounded-lg border border-slate-200 bg-slate-50">{children}</div>
    </details>
  )
}
