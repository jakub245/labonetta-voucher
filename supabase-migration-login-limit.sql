-- Limit chybných pokusů o přihlášení do administrace (lib/auth.js)
-- Spustit v Supabase → SQL Editor (jednou). Provedeno 25. 11. 2026.
--
-- Do tabulky se zapisuje jen IP adresa a čas chybného pokusu. Po 10 chybách z jedné IP
-- za 15 minut server další pokusy z ní odmítá. Záznamy starší 24 hodin maže lib/auth.js.
-- Přístup jen pro service_role (web); anon/authenticated nemají žádná práva.

create table if not exists public.admin_login_failures (
  id          bigserial primary key,
  ip          text not null,
  created_at  timestamptz not null default now()
);

create index if not exists admin_login_failures_ip_idx
  on public.admin_login_failures (ip, created_at desc);

alter table public.admin_login_failures enable row level security;

revoke all on table public.admin_login_failures from anon, authenticated;
revoke all on sequence public.admin_login_failures_id_seq from anon, authenticated;

-- Kontrola: has_table_privilege('anon', 'public.admin_login_failures', 'SELECT') musí být false
select has_table_privilege('anon', 'public.admin_login_failures', 'SELECT') as anon_muze_cist;
