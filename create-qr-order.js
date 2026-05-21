import supabase from '../lib/supabase.js'
import { generateVoucherCode } from '../lib/codes.js'
import QRCode from 'qrcode'

// Bankovní údaje Labonetta — změnit na ostré
const BANK_IBAN    = 'CZ6508000000192000145399' // placeholder, vyměnit
const BANK_ACCOUNT = 'CZ65 0800 0000 19 2000 1453 99'
const RECIPIENT    = 'Labonetta s.r.o.'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, items, customer_name, customer_phone } = req.body
  console.log('REQ BODY:', JSON.stringify(req.body))
  console.log('customer_name:', customer_name, '| customer_phone:', customer_phone)
  if (!email || !items) return res.status(400).json({ error: 'Chybí email nebo items' })

  const validItems = items.filter(i => i.qty > 0)
  if (!validItems.length) return res.status(400).json({ error: 'Prázdná objednávka' })

  const total = validItems.reduce((sum, i) => sum + i.amount * i.qty, 0)

  // Variabilní symbol — 10 číslic, unikátní
  const vs = Date.now().toString().slice(-10)

  // Expiry za 1 rok
  const expiresAt = new Date()
  expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  // Vytvoř vouchery v DB se stavem pending_qr
  const voucherRecords = []
  for (const item of validItems) {
    for (let i = 0; i < item.qty; i++) {
      let code, attempts = 0
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
        customer_name:  customer_name  || null,
        customer_phone: customer_phone || null,
        status: 'pending_qr',
        variable_symbol: vs,
        expires_at: expiresAt.toISOString()
      })
    }
  }

  console.log('INSERT RECORDS:', JSON.stringify(voucherRecords))

const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/vouchers`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Prefer': 'return=representation'
  },
  body: JSON.stringify(voucherRecords)
})
const vouchers = await insertRes.json()
const error = insertRes.ok ? null : vouchers

  if (error) {
    console.error('Supabase error:', error)
    return res.status(500).json({ error: error.message })
  }

  // Vygeneruj SPAYD QR string
  const spayd = [
    'SPD*1.0',
    `ACC:${IBAN_to_spayd(BANK_IBAN)}`,
    `AM:${total}.00`,
    `CC:CZK`,
    `MSG:Voucher Labonetta`,
    `X-VS:${vs}`
  ].join('*')

  // Vygeneruj QR jako base64 PNG
  const qrDataUrl = await QRCode.toDataURL(spayd, {
    width: 300,
    margin: 2,
    color: { dark: '#1a1a1a', light: '#ffffff' }
  })

  return res.status(200).json({
    success: true,
    vs,
    total,
    bank_account: BANK_ACCOUNT,
    recipient: RECIPIENT,
    qr_data_url: qrDataUrl,
    vouchers: vouchers.map(v => ({ code: v.code, amount: v.amount }))
  })
}

function IBAN_to_spayd(iban) {
  // SPAYD očekává IBAN bez mezer
  return iban.replace(/\s/g, '')
}
