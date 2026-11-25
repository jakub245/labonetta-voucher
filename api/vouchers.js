import supabase from '../lib/supabase.js'
import { requireRole } from '../lib/auth.js'

export default async function handler(req, res) {
  // Nikdy necachovat — odpověď závisí na roli (heslu/tokenu)
  res.setHeader('Cache-Control', 'no-store, max-age=0')

  const role = await requireRole(req, res, ['admin', 'staff'])
  if (!role) return

  // GET /api/vouchers — list vouchers (role vrácena v těle odpovědi)
  if (req.method === 'GET') {
    let query = supabase
      .from('vouchers')
      .select('*')
      .neq('status', 'cancelled') // stornované (smazané) objednávky se nezobrazují
      .order('created_at', { ascending: false })

    // Obsluha (staff) vidí jen zaplacené a uplatněné — ne nezaplacené
    if (role === 'staff') {
      query = query.in('status', ['paid', 'redeemed'])
    }

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ role, vouchers: data })
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

  // DELETE /api/vouchers — smazání NEZAPLACENÉ objednávky (pouze admin).
  // Řeší zmatené zákazníky, kteří založí objednávku vícekrát a nezaplatí ji.
  // Zaplacené ani uplatněné vouchery smazat nelze — dvojitá pojistka níže.
  if (req.method === 'DELETE') {
    if (role !== 'admin') return res.status(403).json({ error: 'Mazat může jen manager' })

    const { vs, id } = req.body
    if (!vs && !id) return res.status(400).json({ error: 'Chybí variabilní symbol nebo id' })

    // Načti cílové vouchery (bez už stornovaných) a ověř, že žádný není zaplacený/uplatněný
    let query = supabase.from('vouchers').select('id, status').neq('status', 'cancelled')
    query = vs ? query.eq('variable_symbol', vs) : query.eq('id', id)
    const { data: targets, error: findError } = await query

    if (findError) return res.status(500).json({ error: findError.message })
    if (!targets?.length) return res.status(404).json({ error: 'Objednávka nenalezena' })
    if (targets.some(t => !['pending', 'pending_qr'].includes(t.status))) {
      return res.status(400).json({ error: 'Lze mazat jen nezaplacené objednávky' })
    }

    // „Smazání" = storno přes UPDATE, ne fyzický DELETE. Databázový klíč nemá
    // právo mazat řádky a PostgREST v tom případě tiše smaže 0 řádků bez chyby
    // — vouchery se pak po refreshi vracely. UPDATE práva má (redeem/dispatch).
    // Stornované kusy z výpisu filtruje GET; v DB zůstávají pro audit.
    // Stav je navíc omezen i přímo v update dotazu (kdyby mezitím někdo zaplatil).
    let del = supabase
      .from('vouchers')
      .update({ status: 'cancelled' })
      .in('status', ['pending', 'pending_qr'])
    del = vs ? del.eq('variable_symbol', vs) : del.eq('id', id)
    const { data: deleted, error: delError } = await del.select('id')

    if (delError) return res.status(500).json({ error: delError.message })
    if (!deleted?.length) {
      // Nic se nezměnilo — nesmíme hlásit úspěch, jinak UI ukáže smazáno a řádky se vrátí
      return res.status(500).json({ error: 'Smazání se do databáze nepropsalo. Obnovte stránku a zkuste to znovu.' })
    }
    return res.status(200).json({ success: true, deleted: deleted.length })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
