import crypto from 'crypto'
import supabase from './supabase.js'

// Společné ověření přihlášení pro administraci, obsluhu a cron.
// - hesla se porovnávají v konstantním čase (nedá se hádat podle doby odpovědi)
// - chybné pokusy se zapisují do tabulky admin_login_failures; po 10 chybách
//   z jedné IP adresy za 15 minut se další pokusy z ní odmítají (i se správným heslem)
// - IP adresy se mažou po 24 hodinách (osobní údaj, drží se jen nezbytně dlouho)

const WINDOW_MIN = 15
const MAX_FAILURES = 10
const TABLE = 'admin_login_failures'

function same(a, b) {
  if (!a || !b) return false
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function roleFor(token) {
  const env = process.env
  if (same(token, env.ADMIN_PASSWORD?.trim())) return 'admin'
  if (same(token, env.STAFF_PASSWORD?.trim()) || same(token, env.STAFF_TOKEN?.trim())) return 'staff'
  if (same(token, env.CRON_SECRET?.trim())) return 'cron'
  return null
}

function clientIp(req) {
  const h = req.headers || {}
  return String(h['x-real-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim() || 'neznama'
}

// Vrátí roli, pokud je povolená. Jinak sám odpoví 401 / 403 / 429 a vrátí null.
export async function requireRole(req, res, allowed) {
  const token = (req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }

  const ip = clientIp(req)
  const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', since)
  if (error) console.error('auth: kontrola pokusů selhala', error.message) // výpadek tabulky nesmí zamknout administraci
  if ((count || 0) >= MAX_FAILURES) {
    res.status(429).json({ error: `Příliš mnoho chybných pokusů o přihlášení. Zkuste to znovu za ${WINDOW_MIN} minut.` })
    return null
  }

  const role = roleFor(token)
  if (!role) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    await Promise.all([
      supabase.from(TABLE).insert({ ip }),
      supabase.from(TABLE).delete().lt('created_at', dayAgo)
    ]).catch(e => console.error('auth: zápis pokusu selhal', e.message))
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }

  if (!allowed.includes(role)) {
    res.status(403).json({ error: 'K této akci nemáte oprávnění' })
    return null
  }
  return role
}
