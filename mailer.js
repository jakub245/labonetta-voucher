import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendVoucherEmail({ to, amount, voucherCode, pdfBuffer }) {
  const amountFormatted = amount === 1000 ? '1 000' : '500'

  const html = `
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#C0623A;padding:32px;text-align:center;">
              <p style="margin:0;color:rgba(255,255,255,0.8);font-size:11px;letter-spacing:4px;text-transform:uppercase;">LABONETTA</p>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.6);font-size:10px;letter-spacing:2px;">Pizza jako z Neapole</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 48px;">
              <h1 style="margin:0 0 16px;font-size:28px;color:#1B7F72;font-weight:normal;">
                Jdeme na pizzu! 🍕
              </h1>
              <p style="margin:0 0 24px;font-size:16px;color:#444;line-height:1.6;">
                Váš voucher v hodnotě <strong>${amountFormatted} Kč</strong> je připraven.
                Najdete ho v příloze tohoto emailu jako PDF soubor.
              </p>

              <!-- Code box -->
              <div style="background:#f5f0eb;border-radius:6px;padding:20px 24px;margin:0 0 24px;">
                <p style="margin:0 0 4px;font-size:11px;color:#999;letter-spacing:1px;text-transform:uppercase;">Kód voucheru</p>
                <p style="margin:0;font-size:24px;font-weight:bold;color:#111;letter-spacing:2px;font-family:monospace;">${voucherCode}</p>
              </div>

              <p style="margin:0 0 8px;font-size:14px;color:#666;line-height:1.6;">
                Voucher uplatníte osobně na naší provozovně na Proseku.
                Stačí ukázat PDF obsluze.
              </p>
              <p style="margin:0 0 32px;font-size:14px;color:#666;line-height:1.6;">
                Platí na veškerou útratu do Labonetty — pizzu, antipasti, víno i kávu.
              </p>

              <a href="https://prosek.labonetta.cz" style="display:inline-block;background:#1B7F72;color:#fff;text-decoration:none;padding:14px 28px;border-radius:4px;font-size:14px;letter-spacing:1px;">
                Rezervovat stůl →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f5f0eb;padding:24px 48px;border-top:1px solid #e8e0d8;">
              <p style="margin:0;font-size:12px;color:#999;line-height:1.6;">
                Labonetta Prosek · prosek.labonetta.cz<br>
                V případě dotazů nás kontaktujte na emailu nebo přes náš web.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

  await resend.emails.send({
    from: process.env.RESEND_FROM,
    to,
    subject: `Váš voucher Labonetta ${amountFormatted} Kč 🍕`,
    html,
    attachments: [
      {
        filename: `voucher-labonetta-${amountFormatted.replace(' ', '')}-kc.pdf`,
        content: pdfBuffer.toString('base64')
      }
    ]
  })
}
