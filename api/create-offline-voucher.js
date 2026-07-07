import supabase from '../lib/supabase.js'
import { generateVoucherCode } from '../lib/codes.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth
  const auth = req.headers.authorization?.replace('Bearer ', '')
  if (auth !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const amount = Number(req.body.amount)
  if (![500, 1000].includes(amount)) {
    return res.status(400).json({ error: 'Neplatná částka' })
  }

  // Generuj unikátní kód — stejná logika jako online
  let code, attempts = 0
  while (attempts < 5) {
    code = generateVoucherCode()
    const { data } = await supabase.from('vouchers').select('code').eq('code', code).single()
    if (!data) break
    attempts++
  }

  const expiresAt = new Date()
  expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  const { data: voucher, error } = await supabase
    .from('vouchers')
    .insert({
      code,
      amount,
      email: 'osobni-prodej@labonetta.cz',
      status: 'paid',
      source: 'offline',
      paid_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString()
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({
    success: true,
    code: voucher.code,
    amount: voucher.amount,
    expires_at: voucher.expires_at
  })
}
