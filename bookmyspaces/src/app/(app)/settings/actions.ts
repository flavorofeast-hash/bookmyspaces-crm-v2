'use server'

import { requireOwner } from '@/lib/auth'
import { saveSettings, saveProperty, addSpaces, updateSpace, savePackage, saveSlot, createUser, setUserPassword, setUserActive } from '@/lib/setup'
import { importLegacyLeads } from '@/lib/customers'
import { run, str } from '@/lib/action'
import { q } from '@/lib/db'

const B = '/settings'
export async function saveSettingsAction(f: FormData) { await requireOwner(); await run(B, 'Business details saved.', async () => { await saveSettings(f) }) }
export async function savePropertyAction(f: FormData) { await requireOwner(); await run(B + '#properties', 'Property saved.', async () => { await saveProperty(f) }) }
export async function addSpacesAction(f: FormData) {
  await requireOwner()
  let n = 0
  await run(B + '#spaces', 'Saved.', async () => { n = await addSpaces(f); return `${B}?added=${n}#spaces` })
}
export async function updateSpaceAction(f: FormData) { await requireOwner(); await run(B + '#spaces', 'Space updated.', async () => { await updateSpace(f) }) }
export async function savePackageAction(f: FormData) { await requireOwner(); await run(B + '#packages', 'Package saved.', async () => { await savePackage(f) }) }
export async function saveSlotAction(f: FormData) { await requireOwner(); await run(B + '#slots', 'Time slot saved.', async () => { await saveSlot(f) }) }
export async function createUserAction(f: FormData) { await requireOwner(); await run(B + '#users', 'User added. Give them their email and password.', async () => { await createUser(f) }) }
export async function resetPasswordAction(f: FormData) { await requireOwner(); await run(B + '#users', 'Password changed. They must sign in again.', async () => { await setUserPassword(str(f, 'user_id'), String(f.get('password') ?? '')) }) }
export async function toggleUserAction(f: FormData) { const u = await requireOwner(); await run(B + '#users', 'User updated.', async () => { await setUserActive(str(f, 'user_id'), f.get('active') === 'true', u.id) }) }
export async function saveQuickReplyAction(f: FormData) {
  await requireOwner()
  await run(B + '#replies', 'Quick reply saved.', async () => {
    if (!str(f, 'title') || !str(f, 'body')) throw new Error('Title and text are required.')
    if (str(f, 'id')) await q(`UPDATE crm.quick_replies SET title=$2, body=$3 WHERE id=$1`, [str(f, 'id'), str(f, 'title'), str(f, 'body')])
    else await q(`INSERT INTO crm.quick_replies (title, body, sort_order) VALUES ($1,$2,(SELECT COALESCE(max(sort_order),0)+1 FROM crm.quick_replies))`, [str(f, 'title'), str(f, 'body')])
  })
}
export async function deleteQuickReplyAction(f: FormData) { await requireOwner(); await run(B + '#replies', 'Quick reply removed.', async () => { await q(`DELETE FROM crm.quick_replies WHERE id = $1`, [str(f, 'id')]) }) }
export async function saveTemplateAction(f: FormData) {
  await requireOwner()
  await run(B + '#templates', 'Template saved.', async () => {
    const name = str(f, 'name')
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error('Use the exact template name from WhatsApp Manager (lowercase letters, numbers, underscores).')
    await q(`INSERT INTO crm.wa_templates (name, language, description, uses_name_param) VALUES ($1,$2,$3,$4)
             ON CONFLICT (name) DO UPDATE SET language = EXCLUDED.language, description = EXCLUDED.description, uses_name_param = EXCLUDED.uses_name_param`,
      [name, str(f, 'language') || 'en', str(f, 'description') || null, f.get('uses_name_param') === 'on'])
  })
}
export async function deleteTemplateAction(f: FormData) { await requireOwner(); await run(B + '#templates', 'Template removed.', async () => { await q(`DELETE FROM crm.wa_templates WHERE id = $1`, [str(f, 'id')]) }) }
export async function importLeadsAction() {
  const u = await requireOwner()
  let msg = ''
  await run(B + '#import', 'Import finished.', async () => {
    const r = await importLegacyLeads(u.id)
    msg = `Found ${r.found} old leads: ${r.created} new customers, ${r.merged} merged into existing customers (same mobile), ${r.skipped} already imported, ${r.noPhone} without a mobile number (kept and flagged).`
    return `${B}?import=${encodeURIComponent(msg)}#import`
  })
}
