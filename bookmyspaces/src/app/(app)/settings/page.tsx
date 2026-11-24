import { metaEnv, appPublicUrl } from '@/lib/env'
import { requireOwner } from '@/lib/auth'
import { q, q1 } from '@/lib/db'
import { getSettings } from '@/lib/setup'
import { waStatus } from '@/lib/whatsapp'
import * as A from './actions'
import { PageHeader, Card, Flash, Field, Hidden, Badge, Reveal, Empty } from '@/components/ui'
import { SubmitButton } from '@/components/client'
import { inr, fmtDateTime } from '@/lib/format'

const KINDS: Record<string, string> = { room: 'Room', hall: 'Hall', rooftop: 'Rooftop', other: 'Other space' }
const UNITS: Record<string, string> = { night: 'per night', slot: 'per slot / event', day: 'per day', hour: 'per hour', person: 'per guest', session: 'per session' }

function SpaceFields({ s }: { s?: any }) {
  return (
    <>
      <Field label="Type"><select name="kind" defaultValue={s?.kind ?? 'room'} className="input">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Category"><input name="room_type" defaultValue={s?.room_type ?? ''} placeholder="NOT CONFIGURED (e.g. Deluxe AC)" className="input" /></Field>
      <Field label="Capacity (guests)"><input type="number" name="capacity" min={0} defaultValue={s?.capacity ?? ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Max occupancy"><input type="number" name="max_occupancy" min={0} defaultValue={s?.max_occupancy ?? ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Minimum price (₹)" hint="Owner-set lower limit for staff"><input type="number" name="min_price" min={0} step="1" defaultValue={s && s.min_price !== null && s.min_price !== undefined ? Number(s.min_price) : ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Maximum price (₹)" hint="Owner-set upper limit for staff"><input type="number" name="max_price" min={0} step="1" defaultValue={s && s.max_price !== null && s.max_price !== undefined ? Number(s.max_price) : ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Standard rate (₹)" hint="Leave empty until known — it cannot be booked without a rate. Weekday/date rates: Rates page"><input type="number" name="price" min={0} step="1" defaultValue={s && s.price !== null ? Number(s.price) : ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Price is"><select name="price_unit" defaultValue={s ? s.price_unit ?? '' : 'night'} className="input"><option value="">NOT CONFIRMED (cannot be booked)</option>{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Facilities & amenities"><input name="facilities" defaultValue={s?.facilities ?? ''} placeholder="NOT CONFIGURED (e.g. AC, TV)" className="input" /></Field>
      <Field label="Description"><input name="description" defaultValue={s?.description ?? ''} placeholder="NOT CONFIGURED" className="input" /></Field>
      <Field label="Booking rules"><input name="booking_rules" defaultValue={s?.booking_rules ?? ''} placeholder="e.g. min 2 nights, no events after 10 pm" className="input" /></Field>
    </>
  )
}

export default async function SettingsPage(props: { searchParams: Promise<{ ok?: string; err?: string; import?: string; added?: string }> }) {
  const searchParams = await props.searchParams
  const me = await requireOwner()
  const [s, properties, spaces, slots, packages, users, replies, templates, legacy] = await Promise.all([
    getSettings(),
    q<any>(`SELECT * FROM crm.properties ORDER BY sort_order, name`),
    q<any>(`SELECT * FROM crm.spaces ORDER BY sort_order, kind, name`),
    q<any>(`SELECT id, name, start_time::text AS st, end_time::text AS et FROM crm.event_slots ORDER BY sort_order`),
    q<any>(`SELECT * FROM crm.packages ORDER BY name`),
    q<any>(`SELECT id, name, email, role, active, last_login_at, uses_default_password FROM crm.app_users ORDER BY created_at`),
    q<any>(`SELECT * FROM crm.quick_replies ORDER BY sort_order`),
    q<any>(`SELECT * FROM crm.wa_templates ORDER BY name`),
    q1<any>(`SELECT to_regclass('public.leads') IS NOT NULL AS has_table`),
  ])
  const legacyCount = legacy?.has_table ? (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM public.leads`))!.n : 0
  const imported = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT unnest(legacy_lead_ids) FROM crm.customers) x`))!.n
  const wa = waStatus()
  const env = (k: string) => Boolean(k === 'APP_PUBLIC_URL' ? appPublicUrl() : metaEnv(k))
  return (
    <>
      <PageHeader title="Settings" subtitle="Business details, properties, rooms and spaces, prices, staff and connections" />
      <Flash ok={searchParams.added ? `Added ${searchParams.added} space(s).` : searchParams.import ?? searchParams.ok} err={searchParams.err} />
      <nav className="flex flex-wrap gap-2 mb-4 text-sm">
        {[['business', 'Business'], ['properties', 'Properties'], ['spaces', 'Rooms & spaces'], ['slots', 'Event time slots'], ['packages', 'Packages'], ['users', 'Login'], ['replies', 'Quick replies'], ['templates', 'WhatsApp templates'], ['connections', 'Connections'], ['import', 'Import old leads']].map(([k, l]) => <a key={k} href={`#${k}`} className="link">{l}</a>)}
      </nav>
      <div className="space-y-4">
        <Card title="Business details" className="scroll-mt-20" >
          <form action={A.saveSettingsAction} className="grid sm:grid-cols-2 gap-3" id="business">
            <Field label="Business name"><input name="business_name" defaultValue={s.business_name} className="input" /></Field>
            <Field label="Business WhatsApp number" hint="Used for campaign links, e.g. 9051459463"><input name="whatsapp_number" defaultValue={s.whatsapp_number ?? ''} className="input" /></Field>
            <Field label="Phone"><input name="phone" defaultValue={s.phone ?? ''} className="input" /></Field>
            <Field label="Email"><input name="email" defaultValue={s.email ?? ''} className="input" /></Field>
            <Field label="Address" className="sm:col-span-2"><textarea name="address" rows={2} defaultValue={s.address ?? ''} className="input" /></Field>
            <Field label="UPI ID (printed on quotations & bills)"><input name="upi_id" defaultValue={s.upi_id ?? ''} className="input" /></Field>
            <Field label="Bank details"><textarea name="bank_details" rows={2} defaultValue={s.bank_details ?? ''} className="input" /></Field>
            <Field label="Document footer" className="sm:col-span-2"><input name="document_footer" defaultValue={s.document_footer ?? ''} className="input" /></Field>
            <Field label="Room check-in time"><input type="time" name="checkin_time" defaultValue={s.checkin.slice(0, 5)} className="input" /></Field>
            <Field label="Room check-out time"><input type="time" name="checkout_time" defaultValue={s.checkout.slice(0, 5)} className="input" /></Field>
            <Field label="Business hours start (for auto-reply)"><input type="time" name="hours_start" defaultValue={s.hours_start.slice(0, 5)} className="input" /></Field>
            <Field label="Business hours end"><input type="time" name="hours_end" defaultValue={s.hours_end.slice(0, 5)} className="input" /></Field>
            <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="auto_reply_enabled" defaultChecked={s.auto_reply_enabled} /> Send an automatic WhatsApp reply to a customer’s first message, and outside business hours</label>
            <Field label="Auto-reply text" className="sm:col-span-2"><textarea name="auto_reply_text" rows={2} defaultValue={s.auto_reply_text} className="input" /></Field>
            <div className="sm:col-span-2"><SubmitButton>Save business details</SubmitButton></div>
          </form>
        </Card>

        <Card title="Properties">
          <div id="properties" className="space-y-3">
            {properties.map((p) => (
              <form key={p.id} action={A.savePropertyAction} className="grid sm:grid-cols-5 gap-2 items-end border-b border-slate-100 pb-3">
                <Hidden name="id" value={p.id} />
                <Field label="Name"><input name="name" defaultValue={p.name} className="input" /></Field>
                <Field label="Address" className="sm:col-span-2"><input name="address" defaultValue={p.address ?? ''} className="input" /></Field>
                <Field label="Active"><select name="active" defaultValue={p.active ? 'on' : 'off'} className="input"><option value="on">Active</option><option value="off">Hidden</option></select></Field>
                <SubmitButton className="btn-secondary">Save</SubmitButton>
                <Field label="Booking rules" className="sm:col-span-4"><input name="booking_rules" defaultValue={p.booking_rules ?? ''} placeholder="e.g. check-in 2 pm, no outside food, music until 10 pm" className="input" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="food_packages_enabled" defaultChecked={p.food_packages_enabled} /> Food packages</label>
              </form>
            ))}
            <form action={A.savePropertyAction} className="grid sm:grid-cols-5 gap-2 items-end">
              <Field label="New property name"><input name="name" required className="input" /></Field>
              <Field label="Address" className="sm:col-span-3"><input name="address" className="input" /></Field>
              <SubmitButton>Add property</SubmitButton>
            </form>
          </div>
        </Card>

        <Card title="Rooms, halls & rooftop spaces">
          <div id="spaces" className="space-y-5">
            {properties.length === 0 && <Empty>Add a property first.</Empty>}
            {properties.map((p) => {
              const list = spaces.filter((x) => x.property_id === p.id)
              return (
                <div key={p.id}>
                  <h3 className="font-medium mb-2">{p.name} <span className="text-xs muted">({list.filter((x) => x.kind === 'room').length} rooms, {list.filter((x) => x.kind !== 'room').length} event spaces)</span></h3>
                  {list.length === 0 ? <Empty>No rooms or spaces yet.</Empty> : (
                    <div className="overflow-x-auto"><table className="table">
                      <thead><tr><th>Name</th><th>Type</th><th>Capacity</th><th>Price</th><th>Facilities</th><th>Status</th><th></th></tr></thead>
                      <tbody>{list.map((x) => (
                        <tr key={x.id} className={x.active ? '' : 'text-slate-400'}>
                          <td className="font-medium">{x.name}</td><td>{KINDS[x.kind]} · {x.room_type ?? <span className="text-amber-700">category not configured</span>}</td><td>{x.capacity ?? <span className="text-amber-700">NOT CONFIGURED</span>}</td>
                          <td>{x.price === null ? <span className="text-amber-700">rate NOT CONFIGURED</span> : <>{inr(x.price)}</>} <span className="text-xs">{x.price_unit ? UNITS[x.price_unit] : <span className="text-amber-700">unit NOT CONFIRMED</span>}</span>{x.min_price !== null && <div className="text-xs muted">range {inr(x.min_price)} – {inr(x.max_price)}</div>}</td><td className="text-xs">{x.facilities ?? <span className="text-amber-700">NOT CONFIGURED</span>}</td>
                          <td>{!x.active ? 'Hidden' : x.price === null ? <span className="text-amber-700">Not bookable (no rate)</span> : !x.price_unit ? <span className="text-amber-700">Not bookable (unit not confirmed)</span> : 'Bookable'}</td>
                          <td><Reveal label="Edit">
                            <form action={A.updateSpaceAction} className="grid sm:grid-cols-2 gap-2 min-w-[18rem]">
                              <Hidden name="id" value={x.id} />
                              <Field label="Name"><input name="name" defaultValue={x.name} className="input" /></Field>
                              <SpaceFields s={x} />
                              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={x.active} /> Active (bookable)</label>
                              <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                            </form>
                          </Reveal></td>
                        </tr>))}</tbody>
                    </table></div>
                  )}
                </div>
              )
            })}
            {properties.length > 0 && (
              <form action={A.addSpacesAction} className="grid sm:grid-cols-3 gap-2 border-t border-slate-100 pt-4">
                <div className="sm:col-span-3 text-sm font-medium">Add rooms or spaces</div>
                <Field label="Property"><select name="property_id" className="input">{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                <Field label="Name" hint="For several rooms: a prefix like “Room”"><input name="name" required className="input" placeholder="Room / Celebration Hall" /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="How many"><input type="number" name="count" min={1} max={50} defaultValue={1} className="input" /></Field>
                  <Field label="Numbering from" hint="e.g. 101"><input type="number" name="start_number" className="input" /></Field>
                </div>
                <SpaceFields />
                <div className="sm:col-span-3"><SubmitButton>Add</SubmitButton></div>
                <p className="sm:col-span-3 text-xs muted">Example: Name “Room”, How many 5, Numbering from 101 → Room 101 … Room 105. Each physical room is separate, so the system can stop double bookings room by room.</p>
              </form>
            )}
          </div>
        </Card>

        <Card title="Event time slots">
          <div id="slots" className="space-y-2">
            {slots.map((sl) => (
              <form key={sl.id} action={A.saveSlotAction} className="grid grid-cols-4 gap-2 items-end">
                <Hidden name="id" value={sl.id} />
                <Field label="Name"><input name="name" defaultValue={sl.name} className="input" /></Field>
                <Field label="Start"><input type="time" name="start_time" defaultValue={sl.st.slice(0, 5)} className="input" /></Field>
                <Field label="End"><input type="time" name="end_time" defaultValue={sl.et.slice(0, 5)} className="input" /></Field>
                <SubmitButton className="btn-secondary">Save</SubmitButton>
              </form>
            ))}
            <form action={A.saveSlotAction} className="grid grid-cols-4 gap-2 items-end">
              <Field label="New slot"><input name="name" required className="input" /></Field>
              <Field label="Start"><input type="time" name="start_time" required className="input" /></Field>
              <Field label="End"><input type="time" name="end_time" required className="input" /></Field>
              <SubmitButton>Add</SubmitButton>
            </form>
          </div>
        </Card>

        <Card title="Food & event packages">
          <div id="packages" className="space-y-3">
            <p className="text-xs muted">Packages appear on bookings only when they have a price and their property has “Food packages” ticked (Properties above).</p>
            {packages.map((p) => (
              <form key={p.id} action={A.savePackageAction} className="grid sm:grid-cols-6 gap-2 items-end border-b border-slate-100 pb-3">
                <Hidden name="id" value={p.id} />
                <Field label="Package name"><input name="name" defaultValue={p.name} className="input" /></Field>
                <Field label="Property"><select name="property_id" defaultValue={p.property_id ?? ''} className="input"><option value="">All properties</option>{properties.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></Field>
                <Field label="Menu / what’s included" className="sm:col-span-2"><input name="description" defaultValue={p.description ?? ''} placeholder="NOT CONFIGURED" className="input" /></Field>
                <Field label="Price (₹)"><input type="number" name="price" min={0} defaultValue={p.price === null ? '' : Number(p.price)} placeholder="NOT CONFIGURED" className="input" /></Field>
                <Field label="Price is"><select name="price_basis" defaultValue={p.price_basis} className="input"><option value="per_person">per guest</option><option value="flat">flat</option></select></Field>
                <Field label="Minimum guests"><input type="number" name="min_guests" min={0} defaultValue={p.min_guests ?? ''} placeholder="NOT CONFIGURED" className="input" /></Field>
                <Field label="Optional add-ons" className="sm:col-span-2"><input name="add_ons" defaultValue={p.add_ons ?? ''} placeholder="e.g. DJ ₹5,000, decoration ₹3,000" className="input" /></Field>
                <Field label="Availability"><select name="active" defaultValue={p.active ? 'on' : 'off'} className="input"><option value="on">Available</option><option value="off">Not available</option></select></Field>
                <SubmitButton className="btn-secondary">Save</SubmitButton>
              </form>
            ))}
            <form action={A.savePackageAction} className="grid sm:grid-cols-6 gap-2 items-end">
              <Field label="New package"><input name="name" required className="input" /></Field>
              <Field label="Property"><select name="property_id" className="input"><option value="">All properties</option>{properties.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></Field>
              <Field label="Menu / what’s included" className="sm:col-span-2"><input name="description" className="input" /></Field>
              <Field label="Price (₹)"><input type="number" name="price" min={0} placeholder="NOT CONFIGURED" className="input" /></Field>
              <Field label="Price is"><select name="price_basis" className="input"><option value="per_person">per guest</option><option value="flat">flat</option></select></Field>
              <Field label="Minimum guests"><input type="number" name="min_guests" min={0} className="input" /></Field>
              <Field label="Optional add-ons" className="sm:col-span-2"><input name="add_ons" className="input" /></Field>
              <SubmitButton>Add</SubmitButton>
            </form>
          </div>
        </Card>

        <Card title="Logins & staff">
          <div id="users" className="space-y-3 text-sm">
            <p className="muted"><b>Owner</b> logins can open Settings and void payments or documents. <b>Staff</b> logins can handle customers, bookings, quotations, payments, receipts and refunds, but cannot open Settings or void anything. Changing a password signs out that login on every device.</p>
            {users.map((u) => (
              <div key={u.id} className="space-y-2 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                <p><b>{u.name}</b> · username <b className="font-mono">{u.email}</b> · <b>{u.role === 'owner' ? 'Owner' : 'Staff'}</b>{!u.active && <span className="ml-2 text-red-700 font-medium">deactivated</span>} · last sign-in {u.last_login_at ? fmtDateTime(u.last_login_at) : 'never'}
                  {u.uses_default_password && <span className="ml-2 text-red-700 font-medium">still using the default password</span>}</p>
                {u.active && <>
                  <form action={A.changeUsernameAction} className="flex flex-wrap gap-2 items-end"><Hidden name="user_id" value={u.id} />
                    <Field label="New username"><input name="username" required minLength={3} className="input" autoCapitalize="none" /></Field><SubmitButton className="btn-secondary">Change username</SubmitButton></form>
                  <form action={A.resetPasswordAction} className="flex flex-wrap gap-2 items-end"><Hidden name="user_id" value={u.id} />
                    <Field label="New password"><input type="password" name="password" minLength={8} required className="input" autoComplete="new-password" /></Field><SubmitButton className="btn-secondary">Change password</SubmitButton></form>
                  <form action={A.signOutAllAction}><Hidden name="user_id" value={u.id} /><SubmitButton className="btn-secondary btn-sm">Sign out all devices</SubmitButton></form>
                </>}
                {u.id !== me.id && <form action={A.toggleUserAction}><Hidden name="user_id" value={u.id} /><Hidden name="active" value={u.active ? 'false' : 'true'} />
                  <SubmitButton className={u.active ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}>{u.active ? 'Deactivate (signs out at once)' : 'Reactivate'}</SubmitButton></form>}
              </div>))}
            <form action={A.createUserAction} className="border-t border-slate-100 pt-3 grid sm:grid-cols-2 gap-2 items-end">
              <p className="sm:col-span-2 font-medium">Add a login</p>
              <Field label="Person's name"><input name="name" required className="input" /></Field>
              <Field label="Username"><input name="username" required minLength={3} className="input" autoCapitalize="none" /></Field>
              <Field label="Password"><input type="password" name="password" required minLength={10} className="input" autoComplete="new-password" /></Field>
              <Field label="Access"><select name="role" defaultValue="staff" className="input"><option value="staff">Staff (no Settings, no voiding)</option><option value="owner">Owner (full access)</option></select></Field>
              <div className="sm:col-span-2"><SubmitButton className="btn-primary">Add login</SubmitButton></div>
            </form>
            <p className="text-xs muted">The live CRM only accepts a strong password (10+ characters, not easy to guess). Give each person their own login; deactivate it when they leave.</p>
          </div>
        </Card>

        <Card title="WhatsApp quick replies">
          <div id="replies" className="space-y-2">
            {replies.map((r) => (
              <div key={r.id} className="flex gap-2 items-start">
                <form action={A.saveQuickReplyAction} className="flex-1 grid sm:grid-cols-4 gap-2">
                  <Hidden name="id" value={r.id} />
                  <input name="title" defaultValue={r.title} className="input" />
                  <input name="body" defaultValue={r.body} className="input sm:col-span-2" />
                  <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                </form>
                <form action={A.deleteQuickReplyAction}><Hidden name="id" value={r.id} /><SubmitButton className="btn-secondary btn-sm text-red-700">Remove</SubmitButton></form>
              </div>
            ))}
            <form action={A.saveQuickReplyAction} className="grid sm:grid-cols-4 gap-2">
              <input name="title" required placeholder="Button label" className="input" />
              <input name="body" required placeholder="Message text" className="input sm:col-span-2" />
              <SubmitButton>Add</SubmitButton>
            </form>
          </div>
        </Card>

        <Card title="WhatsApp approved templates">
          <div id="templates" className="space-y-2 text-sm">
            <p className="text-xs muted">After 24 hours of customer silence, WhatsApp only allows templates approved in WhatsApp Manager (business.facebook.com → WhatsApp Manager → Message templates). Add each approved template’s exact name here.</p>
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-2"><span className="font-mono">{t.name}</span><span className="muted">({t.language}){t.uses_name_param ? ' · uses customer name' : ''} {t.description}</span>
                <form action={A.deleteTemplateAction}><Hidden name="id" value={t.id} /><SubmitButton className="text-xs text-red-600 hover:underline">Remove</SubmitButton></form></div>
            ))}
            <form action={A.saveTemplateAction} className="grid sm:grid-cols-5 gap-2 items-end">
              <Field label="Template name"><input name="name" required className="input" placeholder="booking_followup" /></Field>
              <Field label="Language"><input name="language" defaultValue="en" className="input" /></Field>
              <Field label="Description" className="sm:col-span-2"><input name="description" className="input" /></Field>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="uses_name_param" /> Has {'{{1}}'} = customer name</label>
              <SubmitButton className="btn-secondary">Add template</SubmitButton>
            </form>
          </div>
        </Card>

        <Card title="Connections">
          <div id="connections" className="text-sm space-y-2">
            {[
              ['Database', true, 'Connected'],
              ['WhatsApp — receive messages', wa.canReceive, 'Needs WHATSAPP_APP_SECRET and WHATSAPP_WEBHOOK_VERIFY_TOKEN; webhook URL: /api/whatsapp/webhook'],
              ['WhatsApp — send replies', wa.canSend, 'Needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID'],
              ['Facebook publishing', env('META_PAGE_ID') && env('META_PAGE_ACCESS_TOKEN'), 'Needs META_PAGE_ID and META_PAGE_ACCESS_TOKEN (connection is checked live on each post)'],
              ['Instagram publishing', env('INSTAGRAM_BUSINESS_ACCOUNT_ID') && env('META_PAGE_ACCESS_TOKEN') && env('APP_PUBLIC_URL'), 'Needs INSTAGRAM_BUSINESS_ACCOUNT_ID, META_PAGE_ACCESS_TOKEN and APP_PUBLIC_URL'],
              ['Customer document links', env('APP_PUBLIC_URL'), 'Needs APP_PUBLIC_URL (this site’s address)'],
              ['Google Business', false, 'Manual posting (API access must be approved by Google first)'],
            ].map(([label, ok, need]) => (
              <div key={label as string} className="flex items-start gap-2"><Badge value={ok ? 'confirmed' : 'tentative'} label={ok ? 'Set' : 'Not set'} /><span><b>{label as string}</b>{!ok && <span className="muted"> — {need as string}</span>}</span></div>
            ))}
            <p className="text-xs muted">Secret values are entered in Vercel (Project → Settings → Environment Variables), never in this screen.</p>
          </div>
        </Card>

        <Card title="Import leads from the old CRM">
          <div id="import" className="text-sm space-y-2">
            {legacy?.has_table ? (
              <>
                <p>The old CRM has <b>{legacyCount}</b> leads. <b>{imported}</b> have been imported so far. Every original field is kept on the customer record; leads with the same mobile are merged; leads without a mobile are kept and flagged. Running it again never creates duplicates.</p>
                <form action={A.importLeadsAction}><SubmitButton pendingText="Importing…">Import old leads now</SubmitButton></form>
              </>
            ) : <p className="muted">No old-CRM leads table in this database (nothing to import).</p>}
          </div>
        </Card>
      </div>
    </>
  )
}
