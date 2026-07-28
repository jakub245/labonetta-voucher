import supabase from '../lib/supabase.js'
import { generateVoucherCode } from '../lib/codes.js'
import { generateVoucherPdf } from '../lib/pdf.js'
import { sendVoucherEmail } from '../lib/mailer.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth — pouze manager (admin heslo). Obsluha kompenzaci vytvořit nesmí.
  const auth = req.headers.authorization?.replace('Bearer ', '')
  if (!auth || auth !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const amount = Number(req.body.amount)
  if (![500, 1000].includes(amount)) {
    return res.status(400).json({ error: 'Neplatná částka' })
  }

  const email = (req.body.email || '').trim()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Neplatný email' })
  }

  // Generuj unikátní kód — stejná logika jako online/offline
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
      email,
      status: 'paid',
      source: 'comp',
      paid_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString()
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // PDF + email — stejně jako dispatch-vouchers
  try {
    const pdfBuffer = await generateVoucherPdf(voucher.amount, voucher.code)
    const amountStr = voucher.amount === 1000 ? '1000' : '500'
    await sendVoucherEmail({
      to: email,
      vouchers: [voucher],
      attachments: [{
        filename: `voucher-labonetta-${amountStr}kc-${voucher.code}.pdf`,
        content: pdfBuffer.toString('base64'),
        code: voucher.code,
        amount: voucher.amount
      }]
    })
  } catch (err) {
    console.error('comp voucher email error:', err)
    return res.status(500).json({
      error: 'Voucher byl vytvořen, ale email se nepodařilo odeslat: ' + err.message,
      code: voucher.code
    })
  }

  return res.status(200).json({
    success: true,
    code: voucher.code,
    amount: voucher.amount
  })
}
