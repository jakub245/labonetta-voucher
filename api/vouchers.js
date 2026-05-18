import supabase from '../lib/supabase.js'

export default async function handler(req, res) {
  // Simple password check via Authorization header
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // GET /api/vouchers — list all vouchers
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('vouchers')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  // PATCH /api/vouchers — redeem a voucher
  if (req.method === 'PATCH') {
    const { id } = req.body

    if (!id) return res.status(400).json({ error: 'Missing voucher id' })

    const { data: voucher } = await supabase
      .from('vouchers')
      .select('status')
      .eq('id', id)
      .single()

    if (!voucher) return res.status(404).json({ error: 'Voucher not found' })
    if (voucher.status === 'redeemed') return res.status(400).json({ error: 'Voucher already redeemed' })
    if (voucher.status !== 'paid') return res.status(400).json({ error: 'Voucher not paid' })

    const { data, error } = await supabase
      .from('vouchers')
      .update({
        status: 'redeemed',
        redeemed_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
