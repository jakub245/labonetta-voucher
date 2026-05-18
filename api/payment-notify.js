import supabase from '../lib/supabase.js'
import { getPaymentStatus } from '../lib/gopay.js'
import { generateVoucherPdf } from '../lib/pdf.js'
import { sendVoucherEmail } from '../lib/mailer.js'

export default async function handler(req, res) {
  // GoPay sends GET with ?id=payment_id
  const paymentId = req.query.id

  if (!paymentId) {
    return res.status(400).json({ error: 'Missing payment id' })
  }

  try {
    // Get payment status from GoPay
    const payment = await getPaymentStatus(paymentId)

    if (payment.state !== 'PAID') {
      // Not paid yet — GoPay will retry notification
      return res.status(200).json({ status: payment.state })
    }

    // Find voucher by gopay_id
    const { data: voucher, error: findError } = await supabase
      .from('vouchers')
      .select('*')
      .eq('gopay_id', Number(paymentId))
      .single()

    if (findError || !voucher) {
      console.error('Voucher not found for gopay_id:', paymentId)
      return res.status(404).json({ error: 'Voucher not found' })
    }

    // Idempotency — already processed
    if (voucher.status === 'paid') {
      return res.status(200).json({ status: 'already_processed' })
    }

    // Mark as paid
    await supabase
      .from('vouchers')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString()
      })
      .eq('id', voucher.id)

    // Generate PDF voucher
    const pdfBuffer = await generateVoucherPdf(voucher.amount, voucher.code)

    // Send email with PDF
    await sendVoucherEmail({
      to: voucher.email,
      amount: voucher.amount,
      voucherCode: voucher.code,
      pdfBuffer
    })

    return res.status(200).json({ status: 'ok' })

  } catch (err) {
    console.error('payment-notify error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
