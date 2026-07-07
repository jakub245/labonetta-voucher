import supabase from '../lib/supabase.js'

// Ověří heslo a vrátí roli: 'admin' | 'staff' | null
function getRole(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '')
  if (auth && auth === process.env.ADMIN_PASSWORD) return 'admin'
  if (auth && process.env.STAFF_PASSWORD && auth === process.env.STAFF_PASSWORD) return 'staff'
  return null
}

export default async function handler(req, res) {
  const role = getRole(req)
  if (!role) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // GET /api/vouchers — list vouchers
  if (req.method === 'GET') {
    let query = supabase
      .from('vouchers')
      .select('*')
      .order('created_at', { ascending: false })

    // Obsluha (staff) vidí jen zaplacené a uplatněné — ne nezaplacené
    if (role === 'staff') {
      query = query.in('status', ['paid', 'redeemed'])
    }

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    // Přidej roli do hlavičky odpovědi, ať frontend ví, co zobrazit
    res.setHeader('X-User-Role', role)
    return res.status(200).json(data)
  }

  // PATCH /api/vouchers — redeem a voucher (admin i staff)
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
