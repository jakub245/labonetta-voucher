// Parser avíz a výpisů ČSOB. Kódování obvykle windows-1250.
// - ISO 20022 camt.052/053/054 (<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.05x…">):
//   formát, ve kterém ČSOB BC skutečně posílá avíza (ověřeno 16. 11. 2026).
//   Každý pohyb je <Ntry>, symboly jsou v <Ref> s předponou „VS:", „SS:", „KS:".
// - „XML ČSOB" (FINSTA): každý pohyb je blok <FINSTA05>.

import crypto from 'node:crypto'

export function decodeXml(buf) {
  const head = buf.subarray(0, 200).toString('latin1')
  const enc = (head.match(/encoding=["']([\w-]+)["']/i)?.[1] || 'utf-8').toLowerCase()
  try {
    return new TextDecoder(enc).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

// Vrátí seznam pohybů, nebo null, když formát neznáme (pak soubor nesmíme tiše zahodit).
export function parseAvizo(text) {
  return parseCamt(text) ?? parseFinsta(text)
}

// ISO 20022 camt.052 / camt.053 / camt.054
export function parseCamt(text) {
  if (!/urn:iso:std:iso:20022:tech:xsd:camt\.05[234]/.test(text)) return null
  const acctBlock = block(text, 'Acct') || ''
  const account = ibanToCz(field(acctBlock, 'IBAN')) || field(block(acctBlock, 'Othr') || '', 'Id')
  const txs = []

  for (const ntry of blocks(text, 'Ntry')) {
    const credit = field(ntry, 'CdtDbtInd') === 'CRDT'
    const reversal = field(ntry, 'RvslInd') === 'true'
    const sts = block(ntry, 'Sts') || ''              // camt.05x.001.02: <Sts>BOOK</Sts>, novější: <Sts><Cd>BOOK</Cd></Sts>
    const status = field(sts, 'Cd') || sts.trim() || null
    const booked = !status || status === 'BOOK'
    const direction = !booked ? 'pending' : (credit ? 'C' : 'D') + (reversal ? 'R' : '')
    const entryAmt = amountTag(ntry)
    const date = (field(block(ntry, 'BookgDt') || '', 'Dt') || field(block(ntry, 'BookgDt') || '', 'DtTm') ||
                  field(block(ntry, 'ValDt') || '', 'Dt') || '').slice(0, 10) || null
    const ntryRef = field(ntry, 'AcctSvcrRef') || field(ntry, 'NtryRef')
    const details = blocks(ntry, 'TxDtls')

    ;(details.length ? details : [ntry]).forEach((d, i) => {
      const sym = symbols(blocks(d, 'Ref').map(decode))
      const parties = block(d, 'RltdPties') || ''
      const agents = block(d, 'RltdAgts') || ''
      const side = credit ? 'Dbtr' : 'Cdtr'           // protistrana: u příchozí platby plátce
      const txAmt = details.length > 1 ? amountTag(block(d, 'TxAmt') || block(d, 'InstdAmt') || '') : null
      const amt = txAmt?.amount != null ? txAmt : entryAmt
      const ref = field(block(d, 'Refs') || '', 'AcctSvcrRef') || ntryRef
      const tx = {
        direction,
        amount: amt.amount,
        currency: amt.currency || 'CZK',
        vs: sym.vs, ss: sym.ss, ks: sym.ks,
        date,
        counterAccount: partyAccount(block(parties, `${side}Acct`), block(agents, `${side}Agt`)),
        counterName: field(block(parties, side) || '', 'Nm'),
        message: blocks(d, 'Ustrd').map(decode).join(' ').trim() || null,
        bankRef: ref ? (details.length > 1 ? `${ref}/${i + 1}` : ref) : null,
        account
      }
      tx.bankTxId = tx.bankRef ? `${account || ''}:${date || ''}:${tx.bankRef}` : transactionId(tx, i)
      txs.push(tx)
    })
  }
  return txs
}

// „VS:123", „SS:4", „KS:0308"; samotné číslo bez předpony bereme jako VS
function symbols(refs) {
  const out = { vs: null, ss: null, ks: null }
  for (const r of refs) {
    for (const m of r.matchAll(/\b(VS|SS|KS)\s*[:/]?\s*(\d+)/gi)) {
      const k = m[1].toLowerCase()
      out[k] ||= normalizeSymbol(m[2])
    }
    if (!out.vs && /^\d{1,10}$/.test(r.trim())) out.vs = normalizeSymbol(r)
  }
  return out
}

function amountTag(xml) {
  const m = xml.match(/<Amt(?:\s+Ccy="([A-Z]{3})")?\s*>([^<]+)<\/Amt>/)
  return { amount: m ? parseAmount(m[2]) : null, currency: m?.[1] || null }
}

// Účet protistrany jako „předčíslí-číslo/kód banky"
function partyAccount(acct, agent) {
  if (!acct) return null
  const iban = field(acct, 'IBAN')
  if (iban) return ibanToCz(iban) || iban
  const num = field(block(acct, 'Othr') || '', 'Id')
  const bank = agent ? field(block(agent, 'Othr') || '', 'Id') : null
  return num ? (bank ? `${num}/${bank}` : num) : null
}

// CZkk BBBB PPPPPP CCCCCCCCCC → „P-C/BBBB" (bez úvodních nul)
export function ibanToCz(iban) {
  const m = iban?.replace(/\s/g, '').match(/^CZ\d{2}(\d{4})(\d{6})(\d{10})$/)
  if (!m) return null
  const prefix = m[2].replace(/^0+/, ''), num = m[3].replace(/^0+/, '')
  return `${prefix ? prefix + '-' : ''}${num}/${m[1]}`
}

function block(xml, name) {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1] ?? null
}
function blocks(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'))].map(m => m[1])
}
function decode(v) {
  return v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim()
}

export function parseFinsta(text) {
  if (!/<FINSTA[\s>]/.test(text)) return null
  const account = field(text, 'S25_CISLO_UCTU')
  const items = [...text.matchAll(/<FINSTA05>([\s\S]*?)<\/FINSTA05>/g)].map(m => m[1])

  return items.map(b => {
    const f = name => field(b, name)
    const vs = normalizeSymbol(f('S86_VARSYMOUR')) || normalizeSymbol(f('S86_VARSYMPAR'))
    const tx = {
      direction: f('S61_CD_INDIK'),            // C = připsáno, D = odepsáno, CR/DR = storno
      amount: parseAmount(f('S61_CASTKA')),
      currency: f('S61_MENA') || 'CZK',
      vs,
      ss: normalizeSymbol(f('S86_SPECSYMOUR')),
      ks: normalizeSymbol(f('S86_KONSTSYM')),
      date: parseCzDate(f('S61_DATUM')),
      counterAccount: [f('PART_ACCNO'), f('PART_BANK_ID')].filter(Boolean).join('/') || null,
      counterName: f('PART_ACC_ID'),
      message: [f('PART_ID1_1'), f('PART_ID1_2'), f('PART_ID2_1'), f('PART_ID2_2'), f('PART_MSG_1'), f('PART_MSG_2')]
        .filter(Boolean).join(' ').trim() || null,
      bankRef: f('FACAERQ') || f('REF_TRANS_SYS') || null,
      account
    }
    tx.bankTxId = transactionId(tx, f('S28_POR_CISLO'))
    return tx
  })
}

// Stabilní ID pohybu: bankovní reference, jinak otisk klíčových údajů.
function transactionId(tx, seq) {
  if (tx.bankRef) return `${tx.account || ''}:${tx.bankRef}`
  const raw = [tx.account, tx.date, tx.amount, tx.vs, tx.counterAccount, seq].join('|')
  return 'h:' + crypto.createHash('sha1').update(raw).digest('hex')
}

export function normalizeSymbol(s) {
  if (!s) return null
  const digits = String(s).replace(/\D/g, '').replace(/^0+/, '')
  return digits || null
}

export function parseAmount(s) {
  if (!s) return null
  const n = Number(String(s).replace(/\s/g, '').replace(/^\+/, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.abs(n) : null
}

function parseCzDate(s) {
  const m = s?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (s || null)
}

function field(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))
  if (!m) return null
  return decode(m[1]) || null
}
