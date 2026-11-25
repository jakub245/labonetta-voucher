-- Uzavření tabulek voucheru a banky pro veřejné role (anon, authenticated)
-- Spustit v Supabase → SQL Editor AŽ POTÉ, co web na Vercelu používá tajný klíč
-- (SUPABASE_SERVICE_KEY = sb_secret_…, role service_role). Ověření předem:
-- supabase-test-rls-lockdown.sql (suchý test, nic neuloží) a kontrola v pg_stat_statements,
-- že dotazy webu běží pod rolí service_role, ne anon.
--
-- Co se mění:
--   * smažou se politiky RLS, které pouštěly anon/authenticated k vouchers a bank_*
--   * anon/authenticated ztratí i tabulková oprávnění (druhá vrstva; tabulky zmizí i z GraphQL)
--   * RLS zůstává zapnuté; service_role má BYPASSRLS, cron běží jako postgres (také BYPASSRLS)
--   * funkce bez nastaveného search_path dostanou pevný search_path (Security Advisor)
--
-- Vrácení zpět: supabase-migration-bank.sql (část 6) + původní politiky vouchers – viz konec souboru.

begin;

-- 1) vouchers: pryč politiky pro anon/authenticated
drop policy if exists "allow anon insert"     on public.vouchers;
drop policy if exists "allow anon select own" on public.vouchers;
drop policy if exists "allow insert"          on public.vouchers;
drop policy if exists "allow update"          on public.vouchers;
-- "allow service full access" (jen service_role) zůstává

-- 2) bank_*: pryč politiky pro anon/authenticated
drop policy if exists bank_files_select        on public.bank_files;
drop policy if exists bank_files_insert        on public.bank_files;
drop policy if exists bank_files_update        on public.bank_files;
drop policy if exists bank_sync_state_select   on public.bank_sync_state;
drop policy if exists bank_sync_state_insert   on public.bank_sync_state;
drop policy if exists bank_sync_state_update   on public.bank_sync_state;
drop policy if exists bank_transactions_select on public.bank_transactions;
drop policy if exists bank_transactions_insert on public.bank_transactions;
drop policy if exists bank_transactions_update on public.bank_transactions;

-- 3) RLS nechat zapnuté
alter table public.vouchers          enable row level security;
alter table public.bank_files        enable row level security;
alter table public.bank_sync_state   enable row level security;
alter table public.bank_transactions enable row level security;

-- 4) Tabulková oprávnění jen pro service_role
revoke all on table public.vouchers, public.bank_files, public.bank_sync_state, public.bank_transactions
  from anon, authenticated;
revoke all on sequence public.bank_files_id_seq, public.bank_transactions_id_seq
  from anon, authenticated;
revoke execute on function public.bank_sync_try_lock(text, int) from public, anon, authenticated;
grant  execute on function public.bank_sync_try_lock(text, int) to service_role;

-- 5) Pevný search_path (Security Advisor: function_search_path_mutable)
alter function public.bank_sync_try_lock(text, int) set search_path = public, pg_temp;
alter function public.update_updated_at()           set search_path = '';  -- jen NEW.updated_at = now()

commit;

-- Kontrola po spuštění (nesmí vrátit žádný řádek s anon/authenticated):
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public' and tablename in ('vouchers','bank_files','bank_sync_state','bank_transactions');
--
-- Nouzové vrácení (jen kdyby web po migraci nefungoval a nešlo hned přepnout klíč):
--   grant select, insert, update on public.vouchers, public.bank_files, public.bank_sync_state,
--     public.bank_transactions to anon;
--   grant usage on sequence public.bank_files_id_seq, public.bank_transactions_id_seq to anon;
--   grant execute on function public.bank_sync_try_lock(text, int) to anon;
--   create policy "allow anon select own" on public.vouchers for select to anon using (true);
--   create policy "allow anon insert" on public.vouchers for insert to anon with check (true);
--   create policy "allow update" on public.vouchers for update to anon, service_role using (true) with check (true);
--   a pro bank_* část 6 ze supabase-migration-bank.sql
