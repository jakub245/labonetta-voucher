import supabase from '../lib/supabase.js'
import { runBankSync, AUTO_INTERVAL_SEC } from '../lib/bank-sync.js'

// Stav QR objednávky pro stránku s QR kódem (polling).
// Vrací jen stav — žádné kódy voucherů ani osobní údaje.
// Když objednávka ještě čeká, zkusí se mezitím podívat do banky
// (nejvýš jednou za 90 s pro všechny dohromady — ČSOB má limit 30 volání / 20 min).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const vs = String(req.query?.vs || '')
  if (!/^\d{1,10}$/.test(vs)) return res.status(400).json({ error: 'Neplatný variabilní symbol' })

  let status = await readStatus(vs)
  if (status === 'pending') {
    try {
      const r = await runBankSync({ minIntervalSec: AUTO_INTERVAL_SEC })
      if (!r.skipped) status = await readStatus(vs)
    } catch (err) {
      console.error('order-status: bank sync selhal', err.message)
    }
  }
  return res.status(200).json({ status })
}

async function readStatus(vs) {
  const { data, error } = await supabase
    .from('vouchers')
    .select('status')
    .eq('variable_symbol', vs)
  if (error || !data?.length) return 'unknown'
  const s = data.map(v => v.status)
  if (s.every(x => x === 'cancelled')) return 'cancelled'
  if (s.some(x => x === 'pending_qr')) return 'pending'
  return 'paid'
}
