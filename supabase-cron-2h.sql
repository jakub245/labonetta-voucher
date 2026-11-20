-- Pozdní platby: kontrola banky každé 2 hodiny, dokud objednávka čeká (nejdéle 3 dny).
-- Spustit v Supabase → SQL Editor (jednou). Navazuje na supabase-migration-unpaid.sql.
--
-- Výsledné časování pro každou QR objednávku:
--   0–20 min    banka každé 2 minuty                   (úloha labonetta-bank-sync)
--   po 60 min   jedna kontrola + e-mail podniku         (úloha labonetta-bank-sync)
--   do 3 dnů    banka každé 2 hodiny                    (TATO úloha)
--   potom       jen denní ranní kontrola (Vercel cron)
--
-- Když nic nečeká, úloha web ani banku nevolá.

select cron.schedule(
  'labonetta-bank-sync-2h',
  '7 */2 * * *',
  $$
  select net.http_get(
    url := 'https://voucher.labonetta.cz/api/bank-sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'labonetta_cron_secret')
    ),
    timeout_milliseconds := 30000
  )
  where exists (
    select 1 from public.vouchers
    where status = 'pending_qr'
      and created_at > now() - interval '3 days'
  );
  $$
);

-- Kontrola:
--   select jobname, schedule, active from cron.job;
-- Vypnutí:
--   select cron.unschedule('labonetta-bank-sync-2h');
