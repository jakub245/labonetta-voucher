import supabase from '../lib/supabase.js'
import { getPaymentStatus } from '../lib/gopay.js'
import { generateVoucherPdf } from '../lib/pdf.js'
import { sendVoucherEmail } from '../lib/mailer.js'

export default async function handler(req, res) {
  const paymentId = req.query.id

  if (!paymentId) {
    return res.status(400).json({ error: 'Missing payment id' })
  }

  try {
    // Check payment status with GoPay
    const payment = await getPaymentStatus(paymentId)

    if (payment.state !== 'PAID') {
      return res.status(200).json({ status: payment.state })
    }

    // Find all vouchers for this payment
    const { data: vouchers, error: findError } = await supabase
      .from('vouchers')
      .select('*')
      .eq('gopay_id', Number(paymentId))

    if (findError || !vouchers || vouchers.length === 0) {
      console.error('Vouchers not found for gopay_id:', paymentId)
      return res.status(404).json({ error: 'Vouchers not found' })
    }

    // Idempotency — already processed
    if (vouchers.every(v => v.status === 'paid')) {
      return res.status(200).json({ status: 'already_processed' })
    }

    // Mark all as paid
    await supabase
      .from('vouchers')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('gopay_id', Number(paymentId))

    // Generate PDF for each voucher
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

    // Send single email with all PDFs attached
    const email = vouchers[0].email
    await sendVoucherEmail({ to: email, vouchers, attachments })

    return res.status(200).json({ status: 'ok' })

  } catch (err) {
    console.error('payment-notify error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
