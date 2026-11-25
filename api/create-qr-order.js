import supabase from '../lib/supabase.js'
import { generateVoucherCode } from '../lib/codes.js'
import { sendAdminNotification, sendOrderConfirmation } from '../lib/mailer.js'
import QRCode from 'qrcode'

const BANK_IBAN    = process.env.BANK_IBAN
const BANK_ACCOUNT = process.env.BANK_ACCOUNT
const RECIPIENT    = process.env.BANK_OWNER
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body || {}

  // Ochrana proti robotům: skryté pole, které člověk nevidí a nevyplní
  if (body.website) return res.status(400).json({ error: 'Objednávku se nepodařilo odeslat.' })

  // Vstupy od zákazníka – vše ověřit na serveru, prohlížeči se nevěří
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const email          = text(body.email, 254)
  const customer_name  = text(body.customer_name, 120) || null
  const customer_phone = text(body.customer_phone, 40) || null

  if (!/^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/.test(email)) {
    return res.status(400).json({ error: 'Zadejte prosím platný e-mail.' })
  }
  if (!customer_name) return res.status(400).json({ error: 'Zadejte prosím jméno.' })
  if (customer_phone && !/^[0-9+()\s./-]{6,40}$/.test(customer_phone)) {
    return res.status(400).json({ error: 'Telefon obsahuje neplatné znaky.' })
  }

  // Jen nabízené hodnoty voucherů a rozumný počet kusů (částku nikdy nebrat z prohlížeče)
  const ALLOWED_AMOUNTS = [500, 1000]
  const MAX_VOUCHERS = 20
  if (!Array.isArray(body.items)) return res.status(400).json({ error: 'Prázdná objednávka' })
  const validItems = []
  for (const i of body.items) {
    const amount = Number(i?.amount)
    const qty = Number(i?.qty)
    if (qty === 0) continue
    if (!ALLOWED_AMOUNTS.includes(amount) || !Number.isInteger(qty) || qty < 0) {
      return res.status(400).json({ error: 'Neplatná položka objednávky' })
    }
    validItems.push({ amount, qty })
  }
  const voucherCount = validItems.reduce((n, i) => n + i.qty, 0)
  if (!voucherCount) return res.status(400).json({ error: 'Prázdná objednávka' })
  if (voucherCount > MAX_VOUCHERS) {
    return res.status(400).json({ error: `Najednou lze objednat nejvýš ${MAX_VOUCHERS} voucherů. Pro větší množství nás prosím kontaktujte.` })
  }

  // Limit proti zahlcení: nejvýš 5 objednávek na jeden e-mail za hodinu a 60 nezaplacených voucherů za 10 minut celkem
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const [{ data: recentByEmail, error: rlErr1 }, { count: recentAll, error: rlErr2 }] = await Promise.all([
    supabase.from('vouchers').select('variable_symbol').eq('email', email).gte('created_at', hourAgo),
    supabase.from('vouchers').select('id', { count: 'exact', head: true }).eq('status', 'pending_qr').gte('created_at', tenMinAgo)
  ])
  if (rlErr1 || rlErr2) return res.status(500).json({ error: 'Objednávku se teď nepodařilo vytvořit, zkuste to prosím za chvíli.' })
  if (new Set((recentByEmail || []).map(r => r.variable_symbol)).size >= 5 || (recentAll || 0) >= 60) {
    return res.status(429).json({ error: 'Objednávek je teď příliš mnoho. Zkuste to prosím za chvíli, případně nás kontaktujte.' })
  }

  const total = validItems.reduce((sum, i) => sum + i.amount * i.qty, 0)
  const vs = Date.now().toString().slice(-10)

  const expiresAt = new Date()
  expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  const voucherRecords = []
  for (const item of validItems) {
    for (let i = 0; i < item.qty; i++) {
      let code, attempts = 0
      while (attempts < 5) {
        code = generateVoucherCode()
        const { data } = await supabase.from('vouchers').select('code').eq('code', code).single()
        if (!data) break
        attempts++
      }
      voucherRecords.push({
        code,
        amount: Number(item.amount),
        email,
        customer_name,
        customer_phone,
        status: 'pending_qr',
        variable_symbol: vs,
        expires_at: expiresAt.toISOString()
      })
    }
  }

  const { data: vouchers, error } = await supabase
    .from('vouchers')
    .insert(voucherRecords)
    .select()

  if (error) return res.status(500).json({ error: error.message })

  // Generuj QR PLATBU (potrebuje ji i potvrzovaci mail zakaznikovi)
  const spayd = [
    'SPD*1.0',
    `ACC:${IBAN_to_spayd(BANK_IBAN)}`,
    `AM:${total}.00`,
    `CC:CZK`,
    `MSG:Voucher Labonetta`,
    `X-VS:${vs}`
  ].join('*')

  const qrDataUrl = await QRCode.toDataURL(spayd, {
    width: 300,
    margin: 2,
    color: { dark: '#1a1a1a', light: '#ffffff' }
  })

  // Potvrzovaci mail zakaznikovi (s QR a platebnimi udaji) - nesmi shodit objednavku
  let confirmationSent = false
  try {
    await sendOrderConfirmation({
      to: email,
      vouchers,
      total,
      vs,
      bank_account: BANK_ACCOUNT,
      recipient: RECIPIENT,
      qr_data_url: qrDataUrl
    })
    confirmationSent = true
  } catch (confirmErr) {
    console.error('order confirmation error:', confirmErr)
  }

  // Notifikace podniku o nove objednavce - nesmi shodit objednavku
  if (ADMIN_NOTIFY_EMAIL) {
    try {
      await sendAdminNotification({
        to: ADMIN_NOTIFY_EMAIL,
        vouchers,
        total,
        vs,
        customer_name,
        customer_phone,
        email
      })
    } catch (notifyErr) {
      console.error('admin notification error:', notifyErr)
    }
  }

  return res.status(200).json({
    success: true,
    vs,
    total,
    bank_account: BANK_ACCOUNT,
    recipient: RECIPIENT,
    qr_data_url: qrDataUrl,
    confirmation_sent: confirmationSent
    // Kódy voucherů se před zaplacením do prohlížeče neposílají
  })
}

function IBAN_to_spayd(iban) {
  return iban.replace(/\s/g, '')
}
