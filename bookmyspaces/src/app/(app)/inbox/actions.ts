'use server'

import { requireUser } from '@/lib/auth'
import { sendText, sendTemplate, sendMedia, setAiPaused } from '@/lib/whatsapp'
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

export async function sendMediaAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'customer_id')
  await run(`/inbox/${id}`, 'File sent.', async () => {
    const file = f.get('file')
    if (!(file instanceof File) || !file.size) throw new Error('Choose a file.')
    const r = await sendMedia(id, file, str(f, 'caption'), u.id)
    if (!r.ok) throw new Error(`WhatsApp did not accept the file: ${r.error}`)
  })
}

export async function setAiAction(f: FormData) {
  const u = await requireUser()
  const id = str(f, 'customer_id')
  const pause = str(f, 'pause') === '1'
  await run(`/inbox/${id}`, pause ? 'AI paused — staff are handling this chat.' : 'AI replies resumed for this chat.', async () => { await setAiPaused(id, pause, u.id) })
}
