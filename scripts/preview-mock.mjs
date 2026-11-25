// Lokální náhled voucherové stránky BEZ ostrého systému: statické soubory + falešné API.
// /api/create-qr-order vrátí smyšlenou objednávku (nic se neuloží, žádný e-mail),
// /api/order-status hlásí 2× „pending" a pak „paid", ať jde projít i obrazovku „Hotovo".
// Spuštění: node scripts/preview-mock.mjs [port]   (výchozí 4177)
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const root = join(import.meta.dirname, '..')
const port = Number(process.argv[2]) || 4177
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf'
}
const FAKE_QR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fff"/>' +
  '<rect x="20" y="20" width="260" height="260" fill="none" stroke="#1a1a1a" stroke-width="8" stroke-dasharray="20 12"/>' +
  '<text x="150" y="160" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#1a1a1a">TEST QR</text></svg>')
const polls = new Map()

const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)
  if (url.pathname === '/api/create-qr-order' && req.method === 'POST') {
    let body
    try { body = JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString() || '{}') } catch { return json(res, 400, { error: 'Neplatný JSON' }) }
    const items = Array.isArray(body.items) ? body.items.filter(i => i.qty > 0) : []
    if (!body.email || !items.length) return json(res, 400, { error: 'Chybí email nebo items' })
    const total = items.reduce((s, i) => s + i.amount * i.qty, 0)
    const vs = Date.now().toString().slice(-10)
    console.log('MOCK objednávka', JSON.stringify(body), '→ VS', vs)
    return json(res, 200, { success: true, vs, total, bank_account: '000000000/0000', recipient: 'TEST', qr_data_url: FAKE_QR, confirmation_sent: true })
  }
  if (url.pathname === '/api/order-status') {
    const vs = url.searchParams.get('vs'); const n = (polls.get(vs) || 0) + 1; polls.set(vs, n)
    console.log('MOCK stav', vs, n)
    return json(res, 200, { status: n > 2 ? 'paid' : 'pending' })
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'V náhledu není' })

  let path = url.pathname === '/admin' ? '/admin.html' : url.pathname
  const p = normalize(join(root, decodeURIComponent(path)))
  if (!p.startsWith(root) || /(^|\/)\.|^\/(lib|scripts|api)\//.test(path)) { res.writeHead(404); return res.end() }
  for (const f of [p, join(p, 'index.html')]) {
    try {
      if ((await stat(f)).isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
        return res.end(await readFile(f))
      }
    } catch {}
  }
  res.writeHead(404); res.end('404')
}).listen(port, () => console.log(`Náhled voucheru s falešným API: http://localhost:${port}`))
