// Usage: CRM_DATABASE_URL=... npm run db:migrate
import { pool } from '../src/lib/db'
import { applyMigrations } from '../src/lib/migrate'

applyMigrations(pool()).then((a) => { console.log(a.length ? `Applied: ${a.join(', ')}` : 'Database already up to date.'); return pool().end() })
  .catch((e) => { console.error(e.message); process.exit(1) })
