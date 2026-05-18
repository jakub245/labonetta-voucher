import supabase from '../lib/supabase.js'
import { createPayment } from '../lib/gopay.js'
import { generateVoucherCode } from '../lib/codes.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { amount, email } = req.body

  // Validate
  if (![500, 1000].includes(Number(amount))) {
    return res.status(400).json({ error: 'Neplatná hodnota voucheru' })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Neplatný email' })
  }

  try {
    // Generate unique voucher code (retry if collision)
    let code
    let attempts = 0
    while (attempts < 5) {
      code = generateVoucherCode()
      const { data } = await supabase
        .from('vouchers')
        .select('id')
        .eq('code', code)
        .single()
      if (!data) break // code is unique
      attempts++
    }

    const expiresAt = new Date()
    expiresAt.setFullYear(expiresAt.getFullYear() + 1)

    // Save pending voucher to Supabase
    const { data: voucher, error: dbError } = await supabase
      .from('vouchers')
      .insert({
        code,
        amount: Number(amount),
        email,
        status: 'pending',
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single()

    if (dbError) throw dbError

    const baseUrl = process.env.NEXT_PUBLIC_URL || `https://${req.headers.host}`

    // Create GoPay payment
    const payment = await createPayment({
      amount: Number(amount),
      email,
      voucherCode: code,
      returnUrl: `${baseUrl}/success.html?id=${voucher.id}`,
      notifyUrl: `${baseUrl}/api/payment-notify`
    })

    // Save GoPay payment ID
    await supabase
      .from('vouchers')
      .update({ gopay_id: payment.id })
      .eq('id', voucher.id)

    // Return GoPay gateway URL for redirect
    return res.status(200).json({
      gw_url: payment.gw_url,
      voucher_id: voucher.id
    })

  } catch (err) {
    console.error('create-payment error:', err)
    return res.status(500).json({ error: 'Chyba při vytváření platby' })
  }
}
