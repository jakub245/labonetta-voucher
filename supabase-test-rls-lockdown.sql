-- SUCHÝ TEST uzavření RLS – NIC SE NEULOŽÍ.
-- Celý test je jeden blok DO: provede stejné změny jako supabase-migration-rls-lockdown.sql,
-- vyzkouší přístup pod rolemi anon / authenticated / service_role / postgres (cron)
-- a na konci záměrně vyhodí chybu s výsledky -> Postgres vše vrátí zpět.
-- Výsledek se zobrazí jako „chyba“ v SQL Editoru, to je v pořádku.
--
-- Očekávaný výsledek: anon a authenticated = ZAKÁZÁNO u všeho,
--                     service_role a postgres = OK.

do $test$
declare
  t   record;
  n   bigint;
  res text;
  rep text := '';
begin
  -- === 1) Stejné změny jako ostrá migrace ===
  drop policy if exists "allow anon insert"     on public.vouchers;
  drop policy if exists "allow anon select own" on public.vouchers;
  drop policy if exists "allow insert"          on public.vouchers;
  drop policy if exists "allow update"          on public.vouchers;
  drop policy if exists bank_files_select        on public.bank_files;
  drop policy if exists bank_files_insert        on public.bank_files;
  drop policy if exists bank_files_update        on public.bank_files;
  drop policy if exists bank_sync_state_select   on public.bank_sync_state;
  drop policy if exists bank_sync_state_insert   on public.bank_sync_state;
  drop policy if exists bank_sync_state_update   on public.bank_sync_state;
  drop policy if exists bank_transactions_select on public.bank_transactions;
  drop policy if exists bank_transactions_insert on public.bank_transactions;
  drop policy if exists bank_transactions_update on public.bank_transactions;
  revoke all on table public.vouchers, public.bank_files, public.bank_sync_state, public.bank_transactions
    from anon, authenticated;
  revoke all on sequence public.bank_files_id_seq, public.bank_transactions_id_seq
    from anon, authenticated;
  revoke execute on function public.bank_sync_try_lock(text, int) from public, anon, authenticated;
  grant  execute on function public.bank_sync_try_lock(text, int) to service_role;
  alter function public.bank_sync_try_lock(text, int) set search_path = public, pg_temp;
  alter function public.update_updated_at()           set search_path = '';

  -- === 2) Zkoušky pod jednotlivými rolemi (DML s "where false" nic nemění) ===
  for t in
    select r.role, q.label, q.sql
    from (values (1,'anon'), (2,'authenticated'), (3,'service_role'), (4,'postgres')) as r(o, role)
    cross join (values
      (1, 'cist vouchers',            'select count(*) from public.vouchers'),
      (2, 'vlozit voucher',           'insert into public.vouchers (status) select status from public.vouchers where false'),
      (3, 'upravit voucher',          'update public.vouchers set status = status where false'),
      (4, 'cist bank_transactions',   'select count(*) from public.bank_transactions'),
      (5, 'vlozit bank_transactions', 'insert into public.bank_transactions (bank_tx_id, result) select ''x'', ''x'' where false'),
      (6, 'upravit bank_sync_state',  'update public.bank_sync_state set last_error = last_error where false'),
      (7, 'cist bank_files',          'select count(*) from public.bank_files'),
      (8, 'zamek bank_sync_try_lock', 'select count(*) from public.bank_sync_try_lock(''__test_neexistuje__'', 0)')
    ) as q(o, label, sql)
    where r.role <> 'postgres' or q.o in (1, 4)   -- cron (postgres) jen čte
    order by r.o, q.o
  loop
    begin
      perform set_config('role', t.role, true);
      if t.sql like 'select%' then
        execute t.sql into n;
        res := 'OK (' || n || ' radku)';
      else
        execute t.sql;
        res := 'OK';
      end if;
      perform set_config('role', 'none', true);
    exception when others then
      res := 'ZAKAZANO (' || sqlerrm || ')';
    end;
    rep := rep || rpad(t.role, 14) || rpad(t.label, 26) || res || E'\n';
  end loop;

  -- === 3) Konec: vyhodit výsledky jako chybu -> vše se vrátí zpět ===
  raise exception E'SUCHY TEST - nic se neulozilo, vse vraceno zpet\n\n%', rep;
end
$test$;
