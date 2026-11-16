// Jednorázová zkouška spojení s ČSOB Business Connectorem z Macu (jen čtení).
// Použití:  node scripts/csob-bc-probe.mjs <číslo smlouvy CEB> [test|prod] [dní zpět]
// Certifikát čte z ~/Claude/csob-bc/. Stažená avíza ukládá tamtéž do samples/
// (obsahují skutečná bankovní data — nikdy je nedávat do repa).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bcConfigFromEnv, getDownloadFileList, downloadFile } from '../lib/csob-bc.js'
import { decodeXml, parseAvizo } from '../lib/bank-avizo.js'

const [contract, env = 'test', days = '7'] = process.argv.slice(2)
if (!contract) { console.error('Zadej číslo smlouvy CEB'); process.exit(1) }

const dir = path.join(os.homedir(), 'Claude', 'csob-bc')
const cfg = bcConfigFromEnv({
  CSOB_BC_P12_BASE64: fs.readFileSync(path.join(dir, 'labonetta-bc.p12')).toString('base64'),
  CSOB_BC_P12_PASSWORD: fs.readFileSync(path.join(dir, 'labonetta-bc.p12.password.txt'), 'utf8').trim(),
  CSOB_BC_CONTRACT_NUMBER: contract,
  CSOB_BC_ENV: env
})

console.log(`Endpoint: ${cfg.endpoint}`)
const t0 = Date.now()
const list = await getDownloadFileList(cfg, { createdAfter: new Date(Date.now() - Number(days) * 864e5) })
console.log(`OK za ${Date.now() - t0} ms · QueryTimestamp ${list.queryTimestamp} · souborů: ${list.files.length}`)
for (const f of list.files) console.log(`  ${f.type.padEnd(6)} ${f.createdAt}  ${f.status}  ${f.size} B  ${f.filename}`)

const avizo = list.files.find(f => f.type === 'AVIZO' && f.url)
if (avizo) {
  const buf = await downloadFile(cfg, avizo.url)
  fs.mkdirSync(path.join(dir, 'samples'), { recursive: true, mode: 0o700 })
  const out = path.join(dir, 'samples', avizo.filename)
  fs.writeFileSync(out, buf, { mode: 0o600 })
  const text = decodeXml(buf)
  const txs = parseAvizo(text)
  console.log(`\nAvízo uloženo: ${out}`)
  console.log(`Začátek souboru: ${text.slice(0, 80).replace(/\s+/g, ' ')}`)
  console.log(txs ? `Formát rozpoznán, pohybů: ${txs.length}, z toho příchozích: ${txs.filter(t => t.direction === 'C').length}, s VS: ${txs.filter(t => t.vs).length}`
                  : 'Neznámý formát souboru — parser je potřeba upravit nebo přepnout formát avíz v CEB.')
}
