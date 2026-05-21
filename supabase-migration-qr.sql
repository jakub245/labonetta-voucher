-- Spustit v Supabase SQL Editoru
-- Přidá variable_symbol pro QR platby

alter table vouchers
  add column if not exists variable_symbol text;

create index if not exists vouchers_variable_symbol_idx
  on vouchers (variable_symbol);
