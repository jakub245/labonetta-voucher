// Automatické párování QR plateb s avízy z ČSOB Business Connectoru.
//
// 1. Atomicky si vezme zámek (RPC bank_sync_try_lock), aby neběžely dva
//    synchronizační běhy najednou a aby se banka nevolala častěji, než je nutné.
// 2. Stáhne seznam nových avíz (GetDownloadFileList_v2, typ AVIZO).
// 3. Každý nový soubor stáhne, rozparsuje a projde příchozí platby.
// 4. Platbu s VS naší objednávky a správnou částkou rovnou označí jako
//    zaplacenou a pošle vouchery; vše ostatní, co s vouchery souvisí,
//    uloží k ručnímu řešení v adminu. Platby, které s vouchery nesouvisí
//    (dodavatelé, terminál…), se nikam neukládají.

import realSupabase from './supabase.js'
import { bcConfigFromEnv, getDownloadFileList, downloadFile } from './csob-bc.js'
import { decodeXml, parseAvizo } from './bank-avizo.js'
import { fulfillQrOrder } from './fulfill.js'

export const STATE_ID = 'labonetta' // připraveno na víc podniků: jeden řádek stavu na podnik
const FIRST_RUN_LOOKBACK_DAYS = 3

// ČSOB povoluje max. 30 volání za 20 minut (na smlouvu + certifikát). Při
// překročení vrací chybu 1101 a každé další volání blokaci prodlužuje.
// Proto: nikdy častěji než 1× za 60 s, automaticky 1× za 90 s, a po 1101
// 20 minut úplný klid.
export const MIN_INTERVAL_SEC = 60
export const AUTO_INTERVAL_SEC = 90
const RATE_LIMIT_BACKOFF_MS = 20 * 60 * 1000

export async function runBankSync({ minIntervalSec = AUTO_INTERVAL_SEC, deps = {} } = {}) {
  const supabase = deps.supabase || realSupabase
  const bc = deps.bc || { bcConfigFromEnv, getDownloadFileList, downloadFile }
  const fulfill = deps.fulfill || fulfillQrOrder

  const { data: locked, error: lockErr } = await supabase
    .rpc('bank_sync_try_lock', { p_id: STATE_ID, p_min_interval_sec: Math.max(minIntervalSec, MIN_INTERVAL_SEC) })
  if (lockErr) throw new Error(`Zámek synchronizace: ${lockErr.message}`)
  if (!locked?.length) return { skipped: 'busy_or_recent' }
  const state = locked[0]

  const summary = { files: 0, transactions: 0, paid: 0, review: 0, ignored: 0, pending_files: 0, errors: [] }
  let hadError = false
  let rateLimited = false
  let nextTimestamp = null

  try {
    const cfg = bc.bcConfigFromEnv()
    const list = await bc.getDownloadFileList(cfg, {
      prevQueryTimestamp: state.prev_query_timestamp || null,
      createdAfter: state.prev_query_timestamp ? null : new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 864e5),
      fileTypes: ['AVIZO']
    })
    nextTimestamp = list.queryTimestamp

    for (const file of list.files) {
      if (file.status === 'F') { summary.errors.push(`Banka hlásí trvalou chybu souboru ${file.filename}`); continue }
      if (!file.url) { summary.pending_files++; continue } // status R: banka soubor ještě připravuje
      const res = await processFile(supabase, bc, cfg, fulfill, file, summary)
      if (res === 'error') hadError = true
    }
  } catch (err) {
    hadError = true
    if (err.bcCode === '1101') rateLimited = true
    summary.errors.push(err.message)
  }

  // Časové razítko posouváme jen po bezchybném běhu, kde už banka nic
  // nepřipravuje. Jinak se ptáme znovu s původním razítkem (tak to žádá
  // příručka ČSOB) a už zpracované soubory přeskočí tabulka bank_files.
  const now = new Date()
  const patch = {
    locked_until: rateLimited ? new Date(now.getTime() + RATE_LIMIT_BACKOFF_MS).toISOString() : null,
    last_error: summary.errors.join(' | ') || null
  }
  if (!hadError) {
    patch.last_success_at = now.toISOString()
    if (nextTimestamp && !summary.pending_files) patch.prev_query_timestamp = nextTimestamp
  }
  await supabase.from('bank_sync_state').update(patch).eq('id', STATE_ID)

  return summary
}

async function processFile(supabase, bc, cfg, fulfill, file, summary) {
  const key = { file_name: file.filename, file_type: file.type, bank_created_at: file.createdAt }

  const { data: existing } = await supabase
    .from('bank_files')
    .select('id, status')
    .match(key)
    .maybeSingle()
  if (existing && existing.status !== 'error') return 'skipped'

  let fileRowId = existing?.id
  if (!fileRowId) {
    const { data: inserted, error } = await supabase
      .from('bank_files')
      .insert({ ...key, status: 'processing' })
      .select('id')
      .single()
    if (error) { summary.errors.push(`Soubor ${file.filename}: ${error.message}`); return 'error' }
    fileRowId = inserted.id
  }

  try {
    const buf = await bc.downloadFile(cfg, file.url)
    const txs = parseAvizo(decodeXml(buf))
    summary.files++

    if (!txs) {
      // Neznámý formát (např. avíza nastavená jako MT942/PDF). Neblokujeme další
      // běhy, ale ukážeme to v adminu, aby se formát v CEB přepnul.
      const msg = `Avízo ${file.filename} má neznámý formát (čekáme XML ISO 20022 nebo XML ČSOB) — zkontrolujte nastavení avíz v CEB`
      summary.errors.push(msg)
      await supabase.from('bank_files').update({ status: 'unparsed', error: msg, processed_at: new Date().toISOString() }).eq('id', fileRowId)
      return 'unparsed'
    }

    for (const tx of txs) {
      summary.transactions++
      const result = await processTransaction(supabase, fulfill, tx, file.filename)
      if (result === 'paid') summary.paid++
      else if (result === 'ignored' || result === 'duplicate') summary.ignored++
      else summary.review++
    }

    await supabase.from('bank_files').update({ status: 'done', error: null, processed_at: new Date().toISOString() }).eq('id', fileRowId)
    return 'done'
  } catch (err) {
    summary.errors.push(`Soubor ${file.filename}: ${err.message}`)
    await supabase.from('bank_files').update({ status: 'error', error: err.message }).eq('id', fileRowId)
    return 'error'
  }
}

export async function processTransaction(supabase, fulfill, tx, fileName) {
  if (tx.direction !== 'C') return 'ignored' // jen připsané platby, ne odchozí ani storna

  // Hledáme objednávku podle VS (u nás vždy 10 číslic, banka může vynechat úvodní nuly)
  let orders = []
  if (tx.vs) {
    const candidates = [...new Set([tx.vs, tx.vs.padStart(10, '0')])]
    const { data, error } = await supabase
      .from('vouchers')
      .select('id, status, amount, variable_symbol')
      .in('variable_symbol', candidates)
    if (error) throw new Error(`Hledání objednávky: ${error.message}`)
    orders = data || []
  }
  const mentionsVoucher = /voucher/i.test(tx.message || '')
  if (!orders.length && !mentionsVoucher) return 'ignored'

  // Záznam platby — unikátní bank_tx_id zajistí, že se nic nezpracuje dvakrát
  const { data: inserted, error: insErr } = await supabase
    .from('bank_transactions')
    .upsert({
      bank_tx_id: tx.bankTxId,
      file_name: fileName,
      booked_on: tx.date,
      amount: tx.amount,
      currency: tx.currency,
      vs: tx.vs,
      counter_account: tx.counterAccount,
      counter_name: tx.counterName,
      message: tx.message,
      result: 'processing'
    }, { onConflict: 'bank_tx_id', ignoreDuplicates: true })
    .select('id')
  if (insErr) throw new Error(`Uložení platby: ${insErr.message}`)
  let txRowId = inserted?.[0]?.id
  if (!txRowId) {
    // Už známe. Zpracujeme znovu jen pozůstatek běhu, který spadl uprostřed
    // (souběh je vyloučený zámkem), jinak jde o duplicitu.
    const { data: prev } = await supabase
      .from('bank_transactions').select('id, result').eq('bank_tx_id', tx.bankTxId).maybeSingle()
    if (prev?.result !== 'processing') return 'duplicate'
    txRowId = prev.id
  }

  const active = orders.filter(o => o.status !== 'cancelled')
  const pending = orders.filter(o => o.status === 'pending_qr')
  const orderVs = orders[0]?.variable_symbol || null
  const expected = pending.reduce((s, o) => s + Number(o.amount), 0)

  let result, error = null
  if (!orders.length) {
    result = 'unknown_vs'
  } else if (!active.length) {
    result = 'order_cancelled'
  } else if (pending.length !== active.length) {
    result = 'already_paid'
  } else if (tx.currency !== 'CZK' || Math.abs(tx.amount - expected) > 0.005) {
    result = 'amount_mismatch'
  } else {
    const r = await fulfill(orderVs, { bankTxId: tx.bankTxId })
    if (r.ok) result = 'paid'
    else if (r.reason === 'not_pending') result = 'already_paid'
    else { result = 'email_failed'; error = r.error || r.reason }
  }

  await supabase
    .from('bank_transactions')
    .update({
      result,
      needs_review: result !== 'paid',
      order_vs: orderVs,
      expected_amount: orders.length ? (pending.length ? expected : active.reduce((s, o) => s + Number(o.amount), 0)) : null,
      error
    })
    .eq('id', txRowId)

  return result
}
