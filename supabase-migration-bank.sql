-- Párování QR plateb z ČSOB Business Connectoru
-- Spustit jednou v Supabase → SQL Editor → New query → Run.
-- Skript je bezpečné spustit opakovaně (vše je "if not exists" / "or replace").

-- 1) Objednávka si pamatuje, kterou bankovní platbou byla zaplacena
alter table vouchers
  add column if not exists bank_tx_id text;

-- 2) Stav synchronizace (jeden řádek na podnik)
create table if not exists bank_sync_state (
  id                    text primary key,
  prev_query_timestamp  text,          -- QueryTimestamp z poslední odpovědi banky, posílá se zpět beze změny
  last_run_at           timestamptz,
  last_success_at       timestamptz,
  last_error            text,
  locked_until          timestamptz
);
insert into bank_sync_state (id) values ('labonetta') on conflict (id) do nothing;

-- 3) Stažené soubory avíz (aby se žádný nezpracoval dvakrát)
create table if not exists bank_files (
  id               bigserial primary key,
  file_name        text not null,
  file_type        text not null,
  bank_created_at  text not null,
  status           text not null,      -- processing | done | unparsed | error
  error            text,
  processed_at     timestamptz,
  created_at       timestamptz not null default now(),
  unique (file_name, file_type, bank_created_at)
);

-- 4) Příchozí platby, které souvisí s vouchery (ostatní platby se neukládají)
create table if not exists bank_transactions (
  id               bigserial primary key,
  bank_tx_id       text not null unique,
  file_name        text,
  booked_on        date,
  amount           numeric(12,2),
  currency         text,
  vs               text,
  counter_account  text,
  counter_name     text,
  message          text,
  order_vs         text,
  expected_amount  numeric(12,2),
  result           text not null,      -- paid | amount_mismatch | already_paid | order_cancelled | unknown_vs | email_failed | processing
  needs_review     boolean not null default false,
  error            text,
  resolved_at      timestamptz,
  resolved_note    text,
  created_at       timestamptz not null default now()
);
create index if not exists bank_transactions_review_idx
  on bank_transactions (created_at desc) where needs_review and resolved_at is null;

-- 5) Atomický zámek: vrátí řádek stavu jen tomu, kdo zámek získal
create or replace function bank_sync_try_lock(p_id text, p_min_interval_sec int)
returns setof bank_sync_state
language sql
as $$
  update bank_sync_state
     set locked_until = now() + interval '120 seconds',
         last_run_at  = now()
   where id = p_id
     and (locked_until is null or locked_until < now())
     and (p_min_interval_sec <= 0
          or last_run_at is null
          or last_run_at < now() - make_interval(secs => p_min_interval_sec))
  returning *;
$$;

-- 6) Přístupová práva
-- Klíč, kterým web přistupuje k databázi, se řídí pravidly RLS (proto mu
-- nefungovalo mazání voucherů). Nové tabulky mu proto výslovně povolíme
-- číst, vkládat a upravovat. Mazání záměrně ne.
alter table bank_sync_state   enable row level security;
alter table bank_files        enable row level security;
alter table bank_transactions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['bank_sync_state', 'bank_files', 'bank_transactions'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for select to anon, authenticated using (true)', t || '_select', t);
    execute format('create policy %I on %I for insert to anon, authenticated with check (true)', t || '_insert', t);
    execute format('create policy %I on %I for update to anon, authenticated using (true) with check (true)', t || '_update', t);
  end loop;
end $$;

grant execute on function bank_sync_try_lock(text, int) to anon, authenticated, service_role;

-- Kontrola: musí vrátit jeden řádek 'labonetta'
select id, last_run_at, last_success_at from bank_sync_state;
