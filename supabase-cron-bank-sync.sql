-- Automatická kontrola plateb na pozadí (každé 2 minuty), nezávisle na tom,
-- jestli má někdo otevřený web nebo admin.
--
-- Vercel na tarifu Hobby spouští vlastní cron jen 1× denně, proto volání
-- obstarává Supabase (pg_cron + pg_net) — zdarma, bez další služby.
--
-- Spustit v Supabase → SQL Editor AŽ PO NASAZENÍ nové verze webu.
-- Místo VLOZ_CRON_SECRET vložte hodnotu CRON_SECRET z Vercelu (bez mezer).
--
-- Limit ČSOB: 30 volání / 20 min. Tady 10 volání / 20 min; server navíc sám
-- hlídá, aby se banka nevolala častěji než 1× za minutu.

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
  );
  $$
);

-- Kontrola, že úloha běží (po pár minutách):
--   select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'labonetta-bank-sync')
--   order by start_time desc limit 5;
--   select status_code, created from net._http_response order by created desc limit 5;
--
-- Vypnutí:
--   select cron.unschedule('labonetta-bank-sync');
