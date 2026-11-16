import supabase from '../lib/supabase.js'
import { STATE_ID } from '../lib/bank-sync.js'

// Platby z banky k ručnímu řešení (jen manager).
// GET   → { payments: [...nevyřešené], sync: { last_success_at, last_error } }
// PATCH → { id, note } označí platbu jako vyřešenou
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  const auth = req.headers.authorization?.replace('Bearer ', '')
  if (!process.env.ADMIN_PASSWORD || auth !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method === 'GET') {
    const [{ data: payments, error }, { data: sync }] = await Promise.all([
      supabase
        .from('bank_transactions')
        .select('id, booked_on, amount, currency, vs, counter_account, counter_name, message, order_vs, expected_amount, result, error, created_at')
        .eq('needs_review', true)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('bank_sync_state')
        .select('last_success_at, last_run_at, last_error')
        .eq('id', STATE_ID)
        .maybeSingle()
    ])
    // Tabulky ještě neexistují (migrace nespuštěna) → admin jen nic neukáže
    if (error) return res.status(200).json({ payments: [], sync: null, not_ready: true })
    return res.status(200).json({ payments, sync })
  }

  if (req.method === 'PATCH') {
    const { id, note } = req.body || {}
    if (!id) return res.status(400).json({ error: 'Chybí id platby' })
    const { data, error } = await supabase
      .from('bank_transactions')
      .update({ resolved_at: new Date().toISOString(), resolved_note: note ? String(note).slice(0, 500) : null })
      .eq('id', id)
      .is('resolved_at', null)
      .select('id')
    if (error) return res.status(500).json({ error: error.message })
    if (!data?.length) return res.status(404).json({ error: 'Platba nenalezena nebo už vyřešená' })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
