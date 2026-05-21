// TEST ONLY - simuluje uspesnou platbu bez GoPay
// Pouziti: POST /api/test-order s body { email, items }
// ODSTRANIT pred nasazenim do produkce!

import supabase from '../lib/supabase.js'
import { generateVoucherCode } from '../lib/codes.js'
import { generateVoucherPdf } from '../lib/pdf.js'
import { sendVoucherEmail } from '../lib/mailer.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Bezpecnostni pojistka - pouze pokud neni nastaveno DISABLE_TEST
  if (process.env.DISABLE_TEST === 'true') {
    return res.status(403).json({ error: 'Test endpoint disabled' })
  }

  const { email, items, customer_name, customer_phone } = req.body
  if (!email || !items) {
    return res.status(400).json({ error: 'Chybi email nebo items' })
  }

  // DEBUG - smazat po otestovani
  console.log('RESEND_API_KEY prefix:', process.env.RESEND_API_KEY?.substring(0, 8))
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL?.substring(0, 20))

  try {
    const expiresAt = new Date()
    expiresAt.setFullYear(expiresAt.getFullYear() + 1)

    // Vytvor vouchery
    const voucherRecords = []
    for (const item of items.filter(i => i.qty > 0)) {
      for (let i = 0; i < item.qty; i++) {
        let code
        let attempts = 0
        while (attempts < 5) {
          code = generateVoucherCode()
          const { data } = await supabase.from('vouchers').select('id').eq('code', code).single()
          if (!data) break
          attempts++
        }
        voucherRecords.push({
          code,
          amount: Number(item.amount),
          email,
          customer_name:  customer_name  || null,
          customer_phone: customer_phone || null,
          status: 'paid',
          gopay_id: Math.floor(Math.random() * 1000000),
          paid_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString()
        })
      }
    }

    const { data: vouchers, error } = await supabase
      .from('vouchers')
      .insert(voucherRecords)
      .select()

    if (error) throw error

    // Generuj PDF a posli email
    const attachments = []
    for (const voucher of vouchers) {
      const pdfBuffer = await generateVoucherPdf(voucher.amount, voucher.code)
      const amountStr = voucher.amount === 1000 ? '1000' : '500'
      attachments.push({
        filename: `voucher-labonetta-${amountStr}kc-${voucher.code}.pdf`,
        content: pdfBuffer.toString('base64'),
        code: voucher.code,
        amount: voucher.amount
      })
    }

    await sendVoucherEmail({ to: email, vouchers, attachments })

    return res.status(200).json({
      success: true,
      message: `Vytvoreno ${vouchers.length} voucheru, email odeslan na ${email}`,
      vouchers: vouchers.map(v => ({ code: v.code, amount: v.amount }))
    })

  } catch (err) {
    console.error('test-order error:', err)
    return res.status(500).json({ error: err.message })
  }
}
