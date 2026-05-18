import supabase from '../lib/supabase.js'
import { createPayment } from '../lib/gopay.js'
import { generateVoucherCode } from '../lib/codes.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { items, email } = req.body
  // items = [{ amount: 500, qty: 2 }, { amount: 1000, qty: 1 }]

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Neplatný email' })
  }

  // Validate items
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Prázdný košík' })
  }

  const validAmounts = [500, 1000]
  const filteredItems = items.filter(i => validAmounts.includes(Number(i.amount)) && Number(i.qty) > 0)
  if (filteredItems.length === 0) {
    return res.status(400).json({ error: 'Neplatné položky košíku' })
  }

  const totalAmount = filteredItems.reduce((sum, i) => sum + Number(i.amount) * Number(i.qty), 0)

  try {
    // Generate voucher codes for all items
    const voucherRecords = []
    const expiresAt = new Date()
    expiresAt.setFullYear(expiresAt.getFullYear() + 1)

    for (const item of filteredItems) {
      for (let i = 0; i < Number(item.qty); i++) {
        // Generate unique code
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
          status: 'pending',
          expires_at: expiresAt.toISOString()
        })
      }
    }

    // Save all vouchers as pending
    const { data: vouchers, error: dbError } = await supabase
      .from('vouchers')
      .insert(voucherRecords)
      .select()

    if (dbError) throw dbError

    // Use first voucher ID as order reference
    const orderRef = `LAB-${Date.now()}`
    const voucherIds = vouchers.map(v => v.id).join(',')

    const baseUrl = process.env.NEXT_PUBLIC_URL || `https://${req.headers.host}`

    // Create GoPay payment for total amount
    const payment = await createPayment({
      amount: totalAmount,
      email,
      voucherCode: orderRef,
      returnUrl: `${baseUrl}/success.html`,
      notifyUrl: `${baseUrl}/api/payment-notify`
    })

    // Save GoPay ID to all vouchers in this order
    await supabase
      .from('vouchers')
      .update({ gopay_id: payment.id })
      .in('id', vouchers.map(v => v.id))

    return res.status(200).json({ gw_url: payment.gw_url })

  } catch (err) {
    console.error('create-payment error:', err)
    return res.status(500).json({ error: 'Chyba při vytváření platby' })
  }
}
