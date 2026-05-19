import { Resend } from 'resend'

const resend = new Resend('re_hzrAKTct_HGuhYncQFFd2An3BEzJ1Kw7t') 

export async function sendVoucherEmail({ to, vouchers, attachments }) {
  const totalAmount = vouchers.reduce((sum, v) => sum + v.amount, 0)
  const totalFormatted = totalAmount.toLocaleString('cs') + ' Kč'
  const count = vouchers.length

  // Summary lines per voucher
  const summaryRows = attachments.map(a => {
    const amt = a.amount === 1000 ? '1 000' : '500'
    return `
      <tr>
        <td style="padding:10px 0;font-size:13px;color:#333;border-bottom:1px solid #f0ebe4;">${amt} Kč voucher</td>
        <td style="padding:10px 0;font-size:12px;color:#aaa;border-bottom:1px solid #f0ebe4;font-family:monospace;letter-spacing:1px;">${a.code}</td>
      </tr>`
  }).join('')

  const html = `
<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F3EE;font-family:'DM Sans',Georgia,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EE;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;width:100%;">

      <!-- Header -->
      <tr>
        <td style="background:#0f0f0f;padding:28px 40px;">
          <p style="margin:0;font-size:10px;font-weight:500;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,0.4);">LABONETTA · PROSEK</p>
        </td>
      </tr>

      <!-- Terra accent line -->
      <tr><td style="height:3px;background:#C0623A;"></td></tr>

      <!-- Body -->
      <tr>
        <td style="padding:40px 40px 32px;">
          <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:32px;font-weight:700;color:#0f0f0f;line-height:1.1;">
            Jdeme na pizzu!
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#888;font-weight:300;line-height:1.6;">
            ${count === 1 ? 'Váš voucher' : `Vaše ${count} vouchery`} v hodnotě <strong style="color:#0f0f0f;">${totalFormatted}</strong> ${count === 1 ? 'je' : 'jsou'} připraven${count === 1 ? '' : 'y'} v příloze.
          </p>

          <!-- Voucher summary table -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <th style="text-align:left;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#aaa;padding-bottom:8px;border-bottom:1px solid #e5e7eb;font-weight:500;">Voucher</th>
              <th style="text-align:left;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#aaa;padding-bottom:8px;border-bottom:1px solid #e5e7eb;font-weight:500;">Kód</th>
            </tr>
            ${summaryRows}
          </table>

          <p style="margin:0 0 8px;font-size:13px;color:#555;line-height:1.7;">
            Voucher${count > 1 ? 'y' : ''} uplatníte osobně na naší provozovně na Proseku. Stačí ukázat PDF obsluze.
          </p>
          <p style="margin:0 0 32px;font-size:13px;color:#555;line-height:1.7;">
            Platí na veškerou útratu — pizzu, antipasti, víno i kávu.
          </p>

          <a href="https://prosek.labonetta.cz/booking" style="display:inline-block;background:#1B7F72;color:#fff;text-decoration:none;padding:14px 28px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;">
            Rezervovat stůl →
          </a>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f9f7f4;padding:20px 40px;border-top:1px solid #ece8e2;">
          <p style="margin:0;font-size:11px;color:#bbb;line-height:1.6;">
            Labonetta Prosek · prosek.labonetta.cz<br>
            Platnost voucherů: 1 rok od data zakoupení
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`

  await resend.emails.send({
    from: process.env.RESEND_FROM,
    to,
    subject: count === 1
      ? `Váš voucher Labonetta ${attachments[0].amount === 1000 ? '1 000' : '500'} Kč`
      : `Vaše vouchery Labonetta · ${totalFormatted}`,
    html,
    attachments: attachments.map(a => ({
      filename: a.filename,
      content: a.content
    }))
  })
}
