'use server'

import { requireUser } from '@/lib/auth'
import { createCustomer, updateCustomer, addFollowUp, completeFollowUp } from '@/lib/customers'
import { run, str, safeBack } from '@/lib/action'

const input = (f: FormData) => ({
  name: str(f, 'name'), phone: str(f, 'phone'), whatsapp: str(f, 'whatsapp'), email: str(f, 'email'), source: str(f, 'source'),
  campaignId: str(f, 'campaign_id') || null, requirements: str(f, 'requirements'), notes: str(f, 'notes'),
})

export async function createCustomerAction(f: FormData) {
  const u = await requireUser()
  await run('/customers/new', 'Customer saved.', async () => {
    const c = await createCustomer(input(f), u.id)
    if (str(f, 'follow_up_on')) await addFollowUp(c.id, str(f, 'follow_up_on'), str(f, 'follow_up_note') || 'Follow up on enquiry', u.id)
    return f.get('then') === 'booking' ? `/bookings/new?customer=${c.id}` : `/customers/${c.id}`
  })
}

export async function updateCustomerAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'id')
  await run(`/customers/${id}`, 'Customer updated.', async () => { await updateCustomer(id, input(f), u.id) })
}

export async function addFollowUpAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'customer_id')
  await run(safeBack(f, `/customers/${id}`), 'Follow-up added.', async () => { await addFollowUp(id, str(f, 'due_on'), str(f, 'note'), u.id, str(f, 'booking_id') || null, str(f, 'method') || null) })
}

export async function completeFollowUpAction(f: FormData) {
  const u = await requireUser()
  await run(safeBack(f, '/today'), 'Follow-up marked done.', async () => { await completeFollowUp(str(f, 'id'), u.id) })
}
