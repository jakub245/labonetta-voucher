-- Nezaplacené objednávky: upozornění po hodině + kratší hlídání banky.
-- Spustit v Supabase → SQL Editor (jednou). Navazuje na supabase-cron-bank-sync.sql.
--
-- Časování pro každou QR objednávku:
--   0–20 min   banka se kontroluje každé 2 minuty
--   po 60 min  pokud pořád nezaplaceno: ještě jedna kontrola banky a jeden e-mail
--              podniku (ADMIN_NOTIFY_EMAIL); objednávka se označí, už se znovu nehlásí
--   potom      jen denní ranní kontrola (Vercel cron), voucher se pošle sám, až platba dorazí

-- 1) Kdy jsme na nezaplacenou objednávku upozornili
alter table public.vouchers add column if not exists unpaid_notified_at timestamptz;

-- 2) Nové časování (přepíše existující úlohu se stejným názvem)
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
      and (
        created_at > now() - interval '20 minutes'
        or (unpaid_notified_at is null
            and created_at < now() - interval '60 minutes'
            and created_at > now() - interval '7 days')
      )
  );
  $$
);

-- Kontrola:
--   select jobname, schedule, active from cron.job;
