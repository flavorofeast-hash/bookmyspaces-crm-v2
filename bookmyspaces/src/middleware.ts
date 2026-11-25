import { NextResponse, type NextRequest } from 'next/server'

// Fast gate only: pages without a session cookie go to /login. The cookie's
// signature, expiry and the user's active status are verified on the server
// for every page (requireUser) and every action.
const PUBLIC = ['/login', '/setup', '/d/', '/api/whatsapp/webhook', '/api/meta/webhook', '/api/media/', '/api/health', '/logout']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next()
  if (!req.cookies.get('bms_session')?.value) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
