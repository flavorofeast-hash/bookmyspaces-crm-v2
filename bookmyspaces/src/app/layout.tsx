import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = { title: 'BookMySpaces CRM', robots: 'noindex, nofollow' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  )
}
