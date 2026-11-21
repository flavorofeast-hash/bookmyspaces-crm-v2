import { SOURCE_LABEL } from '@/lib/format'
import { Field } from './ui'
import { formatPhone } from '@/lib/phone'

export function CustomerFields({ c, campaigns }: { c?: any; campaigns: { id: string; name: string; code: string }[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Name *"><input name="name" required defaultValue={c?.name ?? ''} className="input" /></Field>
      <Field label="Mobile number" hint="Any format: 98300 12345, +91…, 0…"><input name="phone" type="tel" defaultValue={c?.phone ? formatPhone(c.phone) : ''} className="input" /></Field>
      <Field label="WhatsApp number" hint="Leave empty if same as mobile"><input name="whatsapp" type="tel" defaultValue={c?.whatsapp && c.whatsapp !== c.phone ? formatPhone(c.whatsapp) : ''} className="input" /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={c?.email ?? ''} className="input" /></Field>
      <Field label="How did they find us?">
        <select name="source" defaultValue={c?.source ?? 'walk_in'} className="input">
          {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Campaign">
        <select name="campaign_id" defaultValue={c?.campaign_id ?? ''} className="input">
          <option value="">— none —</option>
          {campaigns.map((cp) => <option key={cp.id} value={cp.id}>{cp.name} ({cp.code})</option>)}
        </select>
      </Field>
      <Field label="Requirements" className="sm:col-span-2" hint="What they want: event type, date, guests, rooms, food…">
        <textarea name="requirements" rows={3} defaultValue={c?.requirements ?? ''} className="input" />
      </Field>
      <Field label="Notes" className="sm:col-span-2"><textarea name="notes" rows={2} defaultValue={c?.notes ?? ''} className="input" /></Field>
    </div>
  )
}
