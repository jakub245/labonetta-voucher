import supabase from './supabase.js'
import { sendUnpaidReminder } from './mailer.js'

// Upozornění na objednávky, které ani hodinu po vytvoření nejsou zaplacené.
// Volá se po kontrole banky (api/bank-sync), takže e-mail odchází, až když
// banka platbu opravdu nenašla. Každá objednávka se hlásí jen jednou
// (sloupec vouchers.unpaid_notified_at). Starší než 7 dní se už nehlásí.
export const UNPAID_AFTER_MIN = 60
export const UNPAID_MAX_AGE_DAYS = 7

export async function notifyUnpaid({ deps = {} } = {}) {
  const db = deps.supabase || supabase
  const send = deps.sendUnpaidReminder || sendUnpaidReminder
  const to = deps.adminEmail ?? process.env.ADMIN_NOTIFY_EMAIL

  const now = Date.now()
  const olderThan = new Date(now - UNPAID_AFTER_MIN * 60 * 1000).toISOString()
  const newerThan = new Date(now - UNPAID_MAX_AGE_DAYS * 864e5).toISOString()

  const { data: rows, error } = await db.from('vouchers')
    .select('variable_symbol, amount, email, customer_name, customer_phone, created_at')
    .eq('status', 'pending_qr')
    .is('unpaid_notified_at', null)
    .lt('created_at', olderThan)
    .gt('created_at', newerThan)
  if (error) throw new Error(`nezaplacené objednávky: ${error.message}`)
  if (!rows?.length) return { notified: 0 }

  // Zabrat objednávky dřív, než se pošle e-mail — souběžný běh je pak už nenajde
  const vsList = [...new Set(rows.map(r => r.variable_symbol))]
  const stamp = new Date(now).toISOString()
  const { data: claimed, error: claimErr } = await db.from('vouchers')
    .update({ unpaid_notified_at: stamp })
    .in('variable_symbol', vsList)
    .eq('status', 'pending_qr')
    .is('unpaid_notified_at', null)
    .select('variable_symbol')
  if (claimErr) throw new Error(`nezaplacené objednávky: ${claimErr.message}`)
  const claimedVs = new Set((claimed || []).map(r => r.variable_symbol))
  if (!claimedVs.size) return { notified: 0 }
  // Bez adresy jen označit (ať se kvůli tomu banka dál nekontroluje); upozornění ukáže admin
  if (!to) return { notified: 0, skipped: 'no_admin_email' }

  const orders = groupOrders(rows.filter(r => claimedVs.has(r.variable_symbol)))
  const { data: state } = await db.from('bank_sync_state').select('last_success_at').eq('id', 'labonetta').maybeSingle()

  try {
    await send({ to, orders, lastCheckAt: state?.last_success_at || null })
  } catch (err) {
    // E-mail neodešel → zkusit znovu při příští kontrole
    await db.from('vouchers').update({ unpaid_notified_at: null }).in('variable_symbol', [...claimedVs]).eq('unpaid_notified_at', stamp)
    throw err
  }
  return { notified: orders.length }
}

function groupOrders(rows) {
  const map = new Map()
  for (const r of rows) {
    const o = map.get(r.variable_symbol) || {
      vs: r.variable_symbol, email: r.email, customer_name: r.customer_name,
      customer_phone: r.customer_phone, created_at: r.created_at, total: 0, count: 0
    }
    o.total += Number(r.amount) || 0
    o.count++
    map.set(r.variable_symbol, o)
  }
  return [...map.values()].sort((a, b) => a.created_at < b.created_at ? -1 : 1)
}
