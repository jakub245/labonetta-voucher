import supabase from '../lib/supabase.js'
import { generateVoucherCode } from '../lib/codes.js'
import QRCode from 'qrcode'

const BANK_IBAN    = process.env.BANK_IBAN
const BANK_ACCOUNT = process.env.BANK_ACCOUNT
const RECIPIENT    = process.env.BANK_OWNER

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const email          = req.body.email
  const items          = req.body.items
  const customer_name  = req.body.customer_name  || null
  const customer_phone = req.body.customer_phone || null

  if (!email || !items) return res.status(400).json({ error: 'Chybí email nebo items' })

  const validItems = items.filter(i => i.qty > 0)
  if (!validItems.length) return res.status(400).json({ error: 'Prázdná objednávka' })

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
  return iban.replace(/\s/g, '')
}
