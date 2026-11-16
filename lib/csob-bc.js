// Klient pro ČSOB CEB Business Connector — POUZE ČTENÍ.
// SOAP 1.1 přes mutual TLS (klientský certifikát z .p12). Používáme jedinou
// operaci GetDownloadFileList_v2 (seznam souborů ke stažení) a pak HTTPS GET
// na URL souboru se stejným certifikátem. Nahrávání plateb (Upload*) záměrně
// neimplementujeme.

import https from 'node:https'

const ENDPOINTS = {
  prod: 'https://ceb-bc.csob.cz/cebbc/api',
  test: 'https://testceb-bc.csob.cz/cebbc/api'
}
const NS_GET = 'http://ceb-bc.csob.cz/CEBBCWS/GetDownloadFileList_v2'
const TIMEOUT_MS = 20000

export function bcConfigFromEnv(env = process.env) {
  const missing = ['CSOB_BC_P12_BASE64', 'CSOB_BC_P12_PASSWORD', 'CSOB_BC_CONTRACT_NUMBER']
    .filter(k => !env[k])
  if (missing.length) {
    const err = new Error(`Chybí nastavení ČSOB BC: ${missing.join(', ')}`)
    err.code = 'BC_NOT_CONFIGURED'
    throw err
  }
  return {
    pfx: Buffer.from(env.CSOB_BC_P12_BASE64.replace(/\s/g, ''), 'base64'),
    passphrase: env.CSOB_BC_P12_PASSWORD.trim(),
    contractNumber: String(env.CSOB_BC_CONTRACT_NUMBER).trim(),
    endpoint: ENDPOINTS[env.CSOB_BC_ENV === 'test' ? 'test' : 'prod']
  }
}

// Seznam souborů ke stažení. fileTypes např. ['AVIZO'].
export async function getDownloadFileList(cfg, { prevQueryTimestamp, createdAfter, fileTypes } = {}) {
  if (!/^\d+$/.test(cfg.contractNumber)) throw new Error('Číslo smlouvy CEB musí být číslo')

  const filter = []
  if (fileTypes?.length) {
    filter.push(`<get:FileTypes>${fileTypes.map(t => `<get:FileType>${xmlEscape(t)}</get:FileType>`).join('')}</get:FileTypes>`)
  }
  if (createdAfter) filter.push(`<get:CreatedAfter>${toApiDate(createdAfter)}</get:CreatedAfter>`)

  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:get="${NS_GET}">` +
    '<soapenv:Header/><soapenv:Body><get:GetDownloadFileListRequest_v2>' +
    `<get:ContractNumber>${cfg.contractNumber}</get:ContractNumber>` +
    (prevQueryTimestamp ? `<get:PrevQueryTimestamp>${xmlEscape(prevQueryTimestamp)}</get:PrevQueryTimestamp>` : '') +
    (filter.length ? `<get:Filter>${filter.join('')}</get:Filter>` : '') +
    '</get:GetDownloadFileListRequest_v2></soapenv:Body></soapenv:Envelope>'

  const res = await request(cfg, cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '"GetDownloadFileList_v2"'
    },
    body
  })
  const text = res.body.toString('utf8')

  if (res.status !== 200 || /<(\w+:)?Fault>/.test(text)) {
    // Podrobnosti jsou v <detail><CEBBCError><Code/><Text/><TicketId/>, faultstring bývá jen „SERVER"
    const msg = tag(text, 'Text') || tag(text, 'faultstring') || `HTTP ${res.status}`
    const code = tag(text, 'Code') || tag(text, 'faultcode') || ''
    const ticket = tag(text, 'TicketId')
    const err = new Error(`ČSOB BC chyba: ${msg}${code ? ` (${code})` : ''}${ticket ? ` [ticket ${ticket}]` : ''}`)
    err.status = res.status
    err.bcCode = tag(text, 'Code') || null // 1011 = certifikát/smlouva neaktivní, 1101 = moc volání
    err.detail = text.slice(0, 2000)
    throw err
  }

  return {
    queryTimestamp: tag(text, 'QueryTimestamp'),
    ticketId: tag(text, 'TicketId'),
    files: blocks(text, 'FileDetail').map(b => ({
      url: (tag(b, 'Url') || '').trim(),
      filename: tag(b, 'Filename'),
      type: tag(b, 'Type'),
      createdAt: tag(b, 'CreationDateTime'),
      size: Number(tag(b, 'Size') || 0),
      status: tag(b, 'Status') // D = ke stažení, R = už importováno, F = trvalá chyba
    }))
  }
}

// Stáhne soubor z URL vrácené bankou. Certifikát posíláme jen na domény ČSOB.
export async function downloadFile(cfg, url) {
  const u = new URL(url)
  if (u.protocol !== 'https:' || !/(^|\.)csob\.cz$/i.test(u.hostname)) {
    throw new Error(`Odmítnuto stahování mimo ČSOB: ${u.hostname}`)
  }
  const res = await request(cfg, url, { method: 'GET' })
  if (res.status !== 200) throw new Error(`Stažení souboru selhalo: HTTP ${res.status}`)
  return res.body
}

function request(cfg, url, { method, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      pfx: cfg.pfx,
      passphrase: cfg.passphrase,
      headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers,
      timeout: TIMEOUT_MS
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('timeout', () => req.destroy(new Error('ČSOB BC neodpověděl včas')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// ── mini XML helpery (odpovědi BC jsou ploché, bez atributů, které bychom potřebovali)
function tag(xml, name) {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`))
  return m ? xmlUnescape(m[1]).trim() : null
}
function blocks(xml, name) {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g')
  return [...xml.matchAll(re)].map(m => m[1])
}
function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function xmlUnescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
// Příručka ČSOB uvádí formát YYYY-MM-DDTHH:MM:SS+ZZ:ZZ
function toApiDate(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

export const _test = { tag, blocks }
