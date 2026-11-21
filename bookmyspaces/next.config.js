/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg'],
  outputFileTracingIncludes: { '/setup': ['./db/migrations/**/*'] },
  experimental: {
    serverActions: {
      allowedOrigins: ['bookmyspaces.in', 'www.bookmyspaces.in', '*.vercel.app', 'localhost:3000'],
      bodySizeLimit: '6mb',
    },
  },
  async headers() {
    return [
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}
module.exports = nextConfig
