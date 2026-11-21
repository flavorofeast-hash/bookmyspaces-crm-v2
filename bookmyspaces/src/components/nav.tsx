'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

const ICONS: Record<string, string> = {
  today: 'M3 10h18M7 3v4M17 3v4M5 6h14a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z',
  customers: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0',
  bookings: 'M4 7h16M4 12h16M4 17h10',
  billing: 'M7 3h10l3 3v15H4V3h3zm2 6h6m-6 4h6m-6 4h4',
  inbox: 'M4 5h16v11H8l-4 4V5z',
  marketing: 'M3 11l15-6v14L3 13v-2zm4 3v4a2 2 0 004 0v-3',
}

export const NAV = [
  { href: '/today', label: 'Today', icon: 'today' },
  { href: '/customers', label: 'Customers', icon: 'customers' },
  { href: '/bookings', label: 'Bookings', icon: 'bookings' },
  { href: '/billing', label: 'Billing', icon: 'billing' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox' },
  { href: '/marketing', label: 'Marketing', icon: 'marketing' },
]

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  )
}

export function Nav({ unread, userName, isOwner, businessName }: { unread: number; userName: string; isOwner: boolean; businessName: string }) {
  const path = usePathname()
  const active = (href: string) => path === href || path.startsWith(href + '/')
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="no-print hidden md:flex md:w-56 md:flex-col md:fixed md:inset-y-0 bg-slate-900 text-slate-100">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="font-semibold">{businessName}</div>
          <div className="text-xs text-slate-400">CRM</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm', active(n.href) ? 'bg-white text-slate-900 font-medium' : 'text-slate-300 hover:bg-slate-800')}>
              <Icon name={n.icon} />
              <span className="flex-1">{n.label}</span>
              {n.href === '/inbox' && unread > 0 && <span className="rounded-full bg-emerald-500 text-white text-xs px-1.5">{unread}</span>}
            </Link>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-slate-800 space-y-1 text-sm">
          {isOwner && <Link href="/settings" className={clsx('block rounded-lg px-3 py-2', active('/settings') ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-slate-800')}>Settings</Link>}
          <div className="px-3 py-1 text-xs text-slate-400 truncate">Signed in as {userName}</div>
          <form action="/logout" method="post"><button className="w-full text-left rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">Sign out</button></form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="no-print md:hidden sticky top-0 z-20 flex items-center justify-between bg-slate-900 text-white px-4 py-3">
        <span className="font-semibold">{businessName}</span>
        <div className="flex items-center gap-3 text-sm">
          {isOwner && <Link href="/settings" className="text-slate-300">Settings</Link>}
          <form action="/logout" method="post"><button className="text-slate-300">Sign out</button></form>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="no-print md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 grid grid-cols-6">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={clsx('relative flex flex-col items-center gap-0.5 py-2 text-[11px]', active(n.href) ? 'text-brand-600 font-medium' : 'text-slate-500')}>
            <Icon name={n.icon} />
            {n.label}
            {n.href === '/inbox' && unread > 0 && <span className="absolute top-1 right-3 rounded-full bg-emerald-500 text-white text-[10px] px-1">{unread}</span>}
          </Link>
        ))}
      </nav>
    </>
  )
}
