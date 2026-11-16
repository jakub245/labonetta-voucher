// Společný přechod objednávky pending_qr → paid + odeslání voucherů e-mailem.
// Používá ho ruční tlačítko v adminu (api/dispatch-vouchers.js) i automatické
// párování plateb z banky (lib/bank-sync.js).
//
// Pořadí je záměrné: nejdřív objednávku „zabereme" podmíněným UPDATE
// (jen řádky ve stavu pending_qr), teprve pak posíláme e-mail. Dva souběžné
// pokusy (cron + manager) tak nikdy nepošlou voucher dvakrát. Když e-mail
// selže, stav vrátíme na pending_qr, aby šlo odeslání zopakovat z adminu.

import supabase from './supabase.js'
import { generateVoucherPdf } from './pdf.js'
import { sendVoucherEmail } from './mailer.js'

export async function fulfillQrOrder(vs, { bankTxId = null } = {}) {
  const update = { status: 'paid', paid_at: new Date().toISOString() }
  if (bankTxId) update.bank_tx_id = bankTxId

  const { data: vouchers, error } = await supabase
    .from('vouchers')
    .update(update)
    .eq('variable_symbol', vs)
    .eq('status', 'pending_qr')
    .select()

  if (error) return { ok: false, reason: 'db_error', error: error.message }
  if (!vouchers?.length) return { ok: false, reason: 'not_pending' }

  const email = vouchers[0].email
  try {
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
    return { ok: true, email, vouchers }
  } catch (err) {
    console.error('fulfill: e-mail selhal, vracím objednávku do pending_qr', vs, err)
    const revert = { status: 'pending_qr', paid_at: null }
    if (bankTxId) revert.bank_tx_id = null
    await supabase
      .from('vouchers')
      .update(revert)
      .in('id', vouchers.map(v => v.id))
      .eq('status', 'paid')
    return { ok: false, reason: 'email_failed', error: err.message }
  }
}
