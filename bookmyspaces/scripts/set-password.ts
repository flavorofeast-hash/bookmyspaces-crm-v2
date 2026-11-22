// Usage: CRM_DATABASE_URL=... npm run db:set-password -- <username> '<new strong password>'
// Changes the shared login's password and signs out every device.
import { pool, q1 } from '../src/lib/db'
import { setUserPassword } from '../src/lib/setup'

const [username, password] = process.argv.slice(2)
;(async () => {
  const u = await q1<{ id: string }>(`SELECT id FROM crm.app_users WHERE email = $1`, [(username ?? '').trim().toLowerCase()])
  if (!u) throw new Error('No login with that username.')
  await setUserPassword(u.id, password ?? '')
  console.log('Password changed for', username, '— all devices signed out.')
})().then(() => pool().end()).catch((e) => { console.error(e.message); process.exit(1) })
