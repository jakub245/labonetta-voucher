import { runBankSync, MIN_INTERVAL_SEC, AUTO_INTERVAL_SEC } from '../lib/bank-sync.js'
import { notifyUnpaid } from '../lib/unpaid.js'

// Spuštění párování plateb z banky.
// - GET  z cronu (Supabase pg_cron při čekající objednávce, Vercel 1× denně),
//        hlavička Authorization: Bearer CRON_SECRET
// - POST z adminu (heslo managera); { force: true } zkrátí odstup na minimum (60 s)
// Po kontrole banky se ještě pošle upozornění na objednávky nezaplacené déle než hodinu.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  const auth = req.headers.authorization?.replace('Bearer ', '').trim()
  const cronSecret = process.env.CRON_SECRET?.trim()
  const isCron = !!cronSecret && auth === cronSecret
  const isAdmin = !!process.env.ADMIN_PASSWORD && auth === process.env.ADMIN_PASSWORD

  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!isCron && !isAdmin) return res.status(401).json({ error: 'Unauthorized' })

  const force = req.method === 'POST' && req.body?.force === true
  let summary
  try {
    summary = await runBankSync({ minIntervalSec: isCron || force ? MIN_INTERVAL_SEC : AUTO_INTERVAL_SEC })
  } catch (err) {
    console.error('bank-sync error:', err)
    return res.status(500).json({ error: err.message })
  }

  // Upozornění nesmí shodit výsledek párování (např. když ještě chybí sloupec v DB)
  let unpaid
  try {
    unpaid = await notifyUnpaid()
  } catch (err) {
    console.error('unpaid reminder error:', err.message)
    unpaid = { notified: 0, error: err.message }
  }
  return res.status(200).json({ success: true, ...summary, unpaid })
}
