const RESEND_API_KEY = 're_hzrAKTct_HGuhYncQFFd2An3BEzJ1Kw7t'

// Sends one email per voucher with its own PDF attachment
export async function sendVoucherEmail({ to, vouchers, attachments }) {

  for (const attachment of attachments) {
    const voucher = vouchers.find(v => v.code === attachment.code)
    const amt = attachment.amount === 1000 ? '1 000' : '500'
    const subject = `Váš voucher Labonetta ${amt} Kč`

    const html = `
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Bai Jamjuree',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:560px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr>
        <td style="background:#1a1a1a;padding:24px 40px;">
          <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,0.5);">LABONETTA</p>
        </td>
      </tr>
      <tr><td style="height:3px;background:#C0623A;"></td></tr>

      <!-- Body -->
      <tr>
        <td style="padding:40px 40px 32px;">

          <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#1a1a1a;line-height:1.1;">
            Jdeme na pizzu!
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#6b7280;font-weight:400;line-height:1.6;">
            Váš voucher v hodnotě <strong style="color:#1a1a1a;">${amt} Kč</strong> je připraven v příloze.
          </p>

          <!-- Code box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <td style="background:#f3f4f6;border-radius:8px;padding:20px 24px;">
                <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;">Kód voucheru</p>
                <p style="margin:0;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:2px;font-family:monospace;">${attachment.code}</p>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 8px;font-size:14px;color:#4b5563;line-height:1.7;">
            Voucher uplatníte osobně v naší provozovně. Stačí ukázat PDF obsluze.
          </p>
          <p style="margin:0 0 32px;font-size:14px;color:#4b5563;line-height:1.7;">
            Platí na veškerou útratu — pizzu, antipasti, víno i kávu.<br>
            <strong style="color:#1a1a1a;">Prosek i Kobylisy.</strong>
          </p>

          <a href="https://prosek.labonetta.cz/booking"
             style="display:inline-block;background:#1B7F72;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:13px;font-weight:600;letter-spacing:0.5px;">
            Rezervovat stůl →
          </a>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
          <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
            Labonetta · labonetta.cz<br>
            Platnost voucheru: 1 rok od data zakoupení
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Labonetta <noreply@labonetta.cz>',
        to,
        subject,
        html,
        attachments: [{
          filename: attachment.filename,
          content: attachment.content
        }]
      })
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(`Resend error: ${JSON.stringify(err)}`)
    }
  }
}
