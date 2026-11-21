// Usage: CRM_DATABASE_URL=... npm run db:import-leads   (same as Settings → Import old leads)
import { pool } from '../src/lib/db'
import { importLegacyLeads } from '../src/lib/customers'

importLegacyLeads(null).then((r) => { console.log(r); return pool().end() }).catch((e) => { console.error(e.message); process.exit(1) })
