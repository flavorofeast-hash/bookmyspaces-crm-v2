import { requireUser } from '@/lib/auth'
import { q } from '@/lib/db'
import { createCustomerAction } from '../actions'
import { CustomerFields } from '@/components/customer-form'
import { PageHeader, Card, Flash, Field } from '@/components/ui'
import { SubmitButton } from '@/components/client'

export default async function NewCustomerPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser() // every page checks the session itself; the layout check alone can be skipped by client navigations
  const searchParams = await props.searchParams
  const campaigns = await q<any>(`SELECT id, name, code FROM crm.campaigns ORDER BY created_at DESC`)
  return (
    <>
      <PageHeader title="Add customer / enquiry" subtitle="If the mobile number already exists you will be taken to that customer instead of creating a duplicate." />
      <Flash ok={searchParams.ok} err={searchParams.err} />
      <Card>
        <form action={createCustomerAction} className="space-y-4">
          <CustomerFields campaigns={campaigns} />
          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <Field label="Follow up on (optional)"><input type="date" name="follow_up_on" className="input" /></Field>
            <Field label="Follow-up note"><input name="follow_up_note" placeholder="e.g. Call back with prices" className="input" /></Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <SubmitButton>Save customer</SubmitButton>
            <SubmitButton name="then" value="booking" className="btn-secondary">Save and create booking / enquiry →</SubmitButton>
          </div>
        </form>
      </Card>
    </>
  )
}
