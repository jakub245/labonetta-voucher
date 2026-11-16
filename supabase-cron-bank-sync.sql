-- Automatická kontrola plateb na pozadí — JEN když nějaká objednávka čeká na zaplacení.
--
-- Supabase se každé 2 minuty podívá, jestli existuje nezaplacená QR objednávka
-- z posledních 3 dnů (jeden drobný dotaz do tabulky vouchers). Když žádná není,
-- nic dalšího se neděje: web ani banka se nevolají. Když je, zavolá web
-- (/api/bank-sync), ten stáhne avíza z ČSOB a spáruje platby. Jakmile se objednávka
-- zaplatí (nebo ji v adminu smažete), kontroly samy přestanou.
--
-- Pozdní platby (starší objednávky, víkendové převody) dál zachytí denní kontrola
-- Vercelu v 6:00, která běží vždy.
--
-- Vercel na tarifu Hobby spouští vlastní cron jen 1× denně, proto častější
-- kontrolu obstarává Supabase (pg_cron + pg_net) — zdarma, bez další služby.
--
-- Spustit v Supabase → SQL Editor. Místo VLOZ_CRON_SECRET vložte hodnotu
-- CRON_SECRET z Vercelu (bez mezer).
--
-- Limit ČSOB: 30 volání / 20 min. Tady nejvýš 10 volání / 20 min; server navíc
-- sám hlídá, aby se banka nevolala častěji než 1× za minutu.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Tajný klíč uložený ve Vaultu (není vidět v definici cron úlohy)
select vault.create_secret('VLOZ_CRON_SECRET', 'labonetta_cron_secret', 'CRON_SECRET pro /api/bank-sync');

select cron.schedule(
  'labonetta-bank-sync',
  '*/2 * * * *',
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

-- Úklid logu spuštění (jinak by tabulka cron.job_run_details pořád rostla)
select cron.schedule(
  'labonetta-cron-log-cleanup',
  '30 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);

-- Kontrola, že úloha běží (po pár minutách):
--   select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'labonetta-bank-sync')
--   order by start_time desc limit 5;
--   -- Volání webu (jen když čekala nějaká objednávka):
--   select status_code, created from net._http_response order by created desc limit 5;
--
-- Vypnutí:
--   select cron.unschedule('labonetta-bank-sync');
--   select cron.unschedule('labonetta-cron-log-cleanup');
