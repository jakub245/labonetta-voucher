import { fulfillQrOrder } from '../lib/fulfill.js'
import { requireRole } from '../lib/auth.js'

// Ruční potvrzení QR platby managerem v adminu.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth
  if (!(await requireRole(req, res, ['admin']))) return

  const { vs } = req.body // variabilní symbol
  if (!vs) return res.status(400).json({ error: 'Chybí variabilní symbol' })

  const result = await fulfillQrOrder(vs)

  if (result.ok) {
    return res.status(200).json({
      success: true,
      sent_to: result.email,
      vouchers: result.vouchers.map(v => ({ code: v.code, amount: v.amount }))
    })
  }
  if (result.reason === 'not_pending') {
    return res.status(404).json({ error: 'Objednávka nenalezena nebo již odeslána' })
  }
  console.error('dispatch error:', result)
  return res.status(500).json({ error: result.error || 'Odeslání selhalo' })
}
