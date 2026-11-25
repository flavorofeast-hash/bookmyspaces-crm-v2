'use server'

import { requireUser } from '@/lib/auth'
import { updateLead } from '@/lib/leads'
import { run, str, num } from '@/lib/action'

export async function updateLeadAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'id')
  await run(`/leads/${id}`, 'Lead saved.', async () => {
    await updateLead(id, {
      status: str(f, 'status'), assignedTo: str(f, 'assigned_to') || null, nextFollowUp: str(f, 'next_follow_up') || null,
      propertyId: str(f, 'property_id') || null, category: str(f, 'category') || null, requestedDates: str(f, 'requested_dates') || null,
      guests: num(f, 'guests'), budget: str(f, 'budget') || null, note: str(f, 'note') || null,
    }, u.id)
  })
}
