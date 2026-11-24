'use server'

import { requireOwner } from '@/lib/auth'
import { savePackage, saveAddon } from '@/lib/catalogue'
import { run } from '@/lib/action'

export async function savePackageAction(f: FormData) { const u = await requireOwner(); await run('/catalogue#packages', 'Package saved.', async () => { await savePackage(f, u) }) }
export async function saveAddonAction(f: FormData) { const u = await requireOwner(); await run('/catalogue#addons', 'Add-on saved.', async () => { await saveAddon(f, u) }) }
