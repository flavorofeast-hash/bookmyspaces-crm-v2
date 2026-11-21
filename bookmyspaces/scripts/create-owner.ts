// Usage: CRM_DATABASE_URL=... npm run db:create-owner -- "Name" email@example.com 'password'
import { pool } from '../src/lib/db'
import { createUser } from '../src/lib/setup'

const [name, email, password] = process.argv.slice(2)
const f = new FormData(); f.set('name', name ?? ''); f.set('email', email ?? ''); f.set('password', password ?? '')
createUser(f, 'owner').then(() => { console.log('Owner created:', email); return pool().end() }).catch((e) => { console.error(e.message); process.exit(1) })
