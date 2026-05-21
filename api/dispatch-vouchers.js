import supabase from '../lib/supabase.js'
import { generateVoucherPdf } from '../lib/pdf.js'
import { sendVoucherEmail } from '../lib/mailer.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth
  const auth = req.headers.authorization?.replace('Bearer ', '')
  if (auth !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { vs } = req.body // variabilní symbol
  if (!vs) return res.status(400).json({ error: 'Chybí variabilní symbol' })

  // Načti všechny vouchery s tímto VS
  const { data: vouchers, error } = await supabase
    .from('vouchers')
    .select('*')
    .eq('variable_symbol', vs)
    .eq('status', 'pending_qr')

  if (error || !vouchers?.length) {
    return res.status(404).json({ error: 'Objednávka nenalezena nebo již odeslána' })
  }

  const email = vouchers[0].email

  try {
    // Generuj PDF pro každý voucher
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

    // Pošli email
    await sendVoucherEmail({ to: email, vouchers, attachments })

    // Aktualizuj stav na paid
    await supabase
      .from('vouchers')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('variable_symbol', vs)

    return res.status(200).json({
      success: true,
      sent_to: email,
      vouchers: vouchers.map(v => ({ code: v.code, amount: v.amount }))
    })

  } catch (err) {
    console.error('dispatch error:', err)
    return res.status(500).json({ error: err.message })
  }
}
