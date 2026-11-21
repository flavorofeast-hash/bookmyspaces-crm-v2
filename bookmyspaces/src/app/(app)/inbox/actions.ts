'use server'

import { requireUser } from '@/lib/auth'
import { sendText, sendTemplate } from '@/lib/whatsapp'
import { run, str } from '@/lib/action'

export async function sendReplyAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'customer_id')
  await run(`/inbox/${id}`, 'Message sent.', async () => {
    const r = await sendText(id, str(f, 'body'), u.id)
    if (!r.ok) throw new Error(`WhatsApp did not accept the message: ${r.error}`)
  })
}

export async function sendTemplateAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'customer_id')
  await run(`/inbox/${id}`, 'Template message sent.', async () => {
    const r = await sendTemplate(id, str(f, 'template_id'), u.id)
    if (!r.ok) throw new Error(`WhatsApp did not accept the template: ${r.error}`)
  })
}
