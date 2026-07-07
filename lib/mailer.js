const RESEND_API_KEY = process.env.RESEND_API_KEY

// Sends one email with all vouchers as separate PDF attachments
export async function sendVoucherEmail({ to, vouchers, attachments }) {
  const count = attachments.length
  const totalAmount = vouchers.reduce((sum, v) => sum + v.amount, 0)
  const totalFormatted = totalAmount.toLocaleString('cs') + ' Kč'

  const subject = count === 1
    ? `Váš voucher Labonetta ${attachments[0].amount === 1000 ? '1 000' : '500'} Kč`
    : `Vaše vouchery Labonetta · ${totalFormatted}`

  // Summary rows — one per voucher
  const summaryRows = attachments.map(a => {
    const amt = a.amount === 1000 ? '1 000' : '500'
    return `
      <tr>
        <td style="padding:12px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #e5e7eb;">${amt} Kč voucher</td>
        <td style="padding:12px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;font-family:monospace;letter-spacing:1px;text-align:right;">${a.code}</td>
      </tr>`
  }).join('')

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
          <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
            ${count === 1 ? 'Váš voucher je' : `Vaše ${count} vouchery jsou`} připraveny v příloze.
          </p>

          <!-- Voucher summary -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <th style="text-align:left;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Voucher</th>
              <th style="text-align:right;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Kód</th>
            </tr>
            ${summaryRows}
          </table>

          <p style="margin:0 0 8px;font-size:14px;color:#4b5563;line-height:1.7;">
            Voucher${count > 1 ? 'y' : ''} uplatníte osobně v naší provozovně. Stačí ukázat PDF obsluze.
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
            Platnost voucherů: 1 rok od data zakoupení
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
      attachments: attachments.map(a => ({
        filename: a.filename,
        content: a.content
      }))
    })
  })

  if (!response.ok) {
    const err = await response.json()
    throw new Error(`Resend error: ${JSON.stringify(err)}`)
  }
}

// Sends an internal notification to the restaurant when a new order is placed
// (before payment). Purely informational — never blocks order creation.
export async function sendAdminNotification({ to, vouchers, total, vs, customer_name, customer_phone, email }) {
  const totalFormatted = Number(total).toLocaleString('cs') + ' Kč'
  const count = vouchers.length

  const rows = vouchers.map(v => {
    const amt = v.amount === 1000 ? '1 000' : (v.amount === 500 ? '500' : v.amount.toLocaleString('cs'))
    return `
      <tr>
        <td style="padding:10px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #e5e7eb;">${amt} Kč voucher</td>
        <td style="padding:10px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;font-family:monospace;letter-spacing:1px;text-align:right;">${v.code}</td>
      </tr>`
  }).join('')

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

      <tr>
        <td style="background:#1a1a1a;padding:24px 40px;">
          <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,0.5);">LABONETTA · ADMIN</p>
        </td>
      </tr>
      <tr><td style="height:3px;background:#1B7F72;"></td></tr>

      <tr>
        <td style="padding:36px 40px 28px;">

          <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1a1a1a;line-height:1.15;">
            Nová objednávka voucherů
          </h1>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
            Objednávka čeká na platbu. Po připsání platby ji potvrďte v adminu.
          </p>

          <!-- Zákazník -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#6b7280;">Jméno</td>
              <td style="padding:6px 0;font-size:14px;color:#1a1a1a;font-weight:600;text-align:right;">${customer_name || 'neuvedeno'}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#6b7280;">E-mail</td>
              <td style="padding:6px 0;font-size:14px;color:#1a1a1a;font-weight:600;text-align:right;">${email}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#6b7280;">Telefon</td>
              <td style="padding:6px 0;font-size:14px;color:#1a1a1a;font-weight:600;text-align:right;">${customer_phone || 'neuvedeno'}</td>
            </tr>
          </table>

          <!-- Vouchery -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <th style="text-align:left;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Voucher</th>
              <th style="text-align:right;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Kód</th>
            </tr>
            ${rows}
          </table>

          <!-- Platba -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#e8f5f3;border-radius:10px;">
            <tr>
              <td style="padding:16px 20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:13px;color:#12574d;">Celková částka</td>
                    <td style="font-size:18px;color:#1B7F72;font-weight:700;text-align:right;">${totalFormatted}</td>
                  </tr>
                  <tr>
                    <td style="font-size:13px;color:#12574d;padding-top:6px;">Variabilní symbol</td>
                    <td style="font-size:14px;color:#12574d;font-weight:600;text-align:right;padding-top:6px;font-family:monospace;letter-spacing:1px;">${vs}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <p style="margin:24px 0 0;text-align:center;">
            <a href="https://labonetta-voucher.vercel.app/admin.html"
               style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:13px;font-weight:600;letter-spacing:0.5px;">
              Otevřít admin →
            </a>
          </p>

        </td>
      </tr>

      <tr>
        <td style="background:#f9fafb;padding:18px 40px;border-top:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
          <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
            Automatická notifikace · Labonetta voucher systém
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
      reply_to: email,
      subject: `Nová objednávka · ${totalFormatted} · VS ${vs}`,
      html
    })
  })

  if (!response.ok) {
    const err = await response.json()
    throw new Error(`Resend admin notification error: ${JSON.stringify(err)}`)
  }
}
