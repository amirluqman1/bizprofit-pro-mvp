-- =====================================================================
-- BizProfit Pro · Fasa 0: Asas SaaS (multi-syarikat)
-- Semua data diikat kepada satu "syarikat" (businesses).
-- Pengguna hanya nampak data syarikat sendiri (policy RESTRICTIVE).
-- Tiada perubahan pada apa yang pengguna nampak sekarang.
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Table syarikat ----------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
alter table public.businesses enable row level security;
revoke all on public.businesses from anon, authenticated;
grant select on public.businesses to authenticated;

-- 2. Kolum business_id pada setiap table --------------------------------
alter table public.outlets              add column business_id uuid references public.businesses(id);
alter table public.staff_profiles       add column business_id uuid references public.businesses(id);
alter table public.categories           add column business_id uuid references public.businesses(id);
alter table public.payment_methods      add column business_id uuid references public.businesses(id);
alter table public.transactions         add column business_id uuid references public.businesses(id);
alter table public.inventory_items      add column business_id uuid references public.businesses(id);
alter table public.inventory_stock_logs add column business_id uuid references public.businesses(id);

-- 3. Cipta syarikat pertama dan ikat semua data sedia ada kepadanya -----
-- Trigger inventori perlukan login, jadi dimatikan sekejap untuk isian ini sahaja.
alter table public.inventory_items disable trigger trg_inventory_validate_v1;
alter table public.inventory_items disable trigger trg_inventory_audit_v1;
do $$
declare b uuid;
begin
  insert into public.businesses (name) values ('Perniagaan Utama') returning id into b;
  update public.outlets              set business_id = b;
  update public.staff_profiles       set business_id = b;
  update public.categories           set business_id = b;
  update public.payment_methods      set business_id = b;
  update public.transactions         set business_id = b;
  update public.inventory_items      set business_id = b;
  update public.inventory_stock_logs set business_id = b;
end $$;
alter table public.inventory_items enable trigger trg_inventory_validate_v1;
alter table public.inventory_items enable trigger trg_inventory_audit_v1;

-- 4. Fungsi: syarikat pengguna yang sedang login ------------------------
create function public.current_business_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select business_id from public.staff_profiles where user_id = (select auth.uid())
$$;
revoke execute on function public.current_business_id() from public, anon;
grant execute on function public.current_business_id() to authenticated;

-- 5. Wajib ada syarikat; app tak perlu hantar, diisi automatik ----------
alter table public.outlets              alter column business_id set not null, alter column business_id set default public.current_business_id();
alter table public.staff_profiles       alter column business_id set not null, alter column business_id set default public.current_business_id();
alter table public.categories           alter column business_id set not null, alter column business_id set default public.current_business_id();
alter table public.payment_methods      alter column business_id set not null, alter column business_id set default public.current_business_id();
alter table public.transactions         alter column business_id set not null, alter column business_id set default public.current_business_id();
alter table public.inventory_items      alter column business_id set not null, alter column business_id set default public.current_business_id();
alter table public.inventory_stock_logs alter column business_id set not null, alter column business_id set default public.current_business_id();

-- 6. Keunikan ikut syarikat (nama outlet/kategori boleh sama antara syarikat)
alter table public.transactions drop constraint transactions_category_type_fk;
alter table public.transactions drop constraint transactions_payment_method_fk;
alter table public.transactions drop constraint transactions_outlet_fk;
alter table public.staff_profiles drop constraint staff_profiles_outlet_id_fkey;
alter table public.inventory_items drop constraint inventory_items_outlet_id_fkey;
alter table public.inventory_stock_logs drop constraint inventory_stock_logs_outlet_id_fkey;
alter table public.inventory_stock_logs drop constraint inventory_stock_logs_inventory_item_id_fkey;

alter table public.outlets drop constraint outlets_name_key;
alter table public.outlets add constraint outlets_business_name_key unique (business_id, name);
alter table public.outlets add constraint outlets_business_id_key unique (business_id, id);

alter table public.categories drop constraint categories_name_type_key;
alter table public.categories drop constraint categories_name_key;
alter table public.categories drop constraint categories_pkey;
alter table public.categories add constraint categories_pkey primary key (business_id, key);
alter table public.categories add constraint categories_business_name_key unique (business_id, name);
alter table public.categories add constraint categories_business_name_type_key unique (business_id, name, type);

alter table public.payment_methods drop constraint payment_methods_pkey;
alter table public.payment_methods add constraint payment_methods_pkey primary key (business_id, name);

alter table public.inventory_items add constraint inventory_items_business_id_key unique (business_id, id);

-- Pautan mesti dalam syarikat yang sama (tak boleh rujuk outlet/kategori syarikat lain)
alter table public.transactions add constraint transactions_category_type_fk
  foreign key (business_id, category, type) references public.categories (business_id, name, type);
alter table public.transactions add constraint transactions_payment_method_fk
  foreign key (business_id, payment_method) references public.payment_methods (business_id, name);
alter table public.transactions add constraint transactions_outlet_fk
  foreign key (business_id, outlet_id) references public.outlets (business_id, id);
alter table public.staff_profiles add constraint staff_profiles_outlet_id_fkey
  foreign key (business_id, outlet_id) references public.outlets (business_id, id);
alter table public.inventory_items add constraint inventory_items_outlet_id_fkey
  foreign key (business_id, outlet_id) references public.outlets (business_id, id);
alter table public.inventory_stock_logs add constraint inventory_stock_logs_outlet_id_fkey
  foreign key (business_id, outlet_id) references public.outlets (business_id, id) on delete restrict;
alter table public.inventory_stock_logs add constraint inventory_stock_logs_inventory_item_id_fkey
  foreign key (business_id, inventory_item_id) references public.inventory_items (business_id, id) on delete restrict;

create index idx_transactions_business_date on public.transactions (business_id, transaction_date);
create index idx_staff_profiles_business on public.staff_profiles (business_id);

-- 7. Pengasingan syarikat: policy RESTRICTIVE (digabung DAN dengan semua policy sedia ada)
create policy tenant_isolation on public.outlets              as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.staff_profiles       as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.categories           as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.payment_methods      as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.transactions         as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.inventory_items      as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.inventory_stock_logs as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy "baca syarikat sendiri" on public.businesses for select to authenticated
  using (id = (select public.current_business_id()));

-- 8. Log audit inventori bawa syarikat barang -----------------------------
create or replace function public.inventory_audit_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.inventory_stock_logs (business_id, inventory_item_id, outlet_id, previous_qty, new_qty, change_type, note, changed_by)
    values (new.business_id, new.id, new.outlet_id, 0, new.current_qty, 'stock_in', 'Stok permulaan', (select auth.uid()));
  elsif tg_op = 'UPDATE' then
    if new.current_qty is distinct from old.current_qty then
      insert into public.inventory_stock_logs (business_id, inventory_item_id, outlet_id, previous_qty, new_qty, change_type, note, changed_by)
      values (new.business_id, new.id, new.outlet_id, old.current_qty, new.current_qty, 'adjustment', 'Perubahan stok', (select auth.uid()));
    end if;
  end if;
  return null;
end $$;

-- 9. Ringkasan harian: kategori dipadankan dalam syarikat yang sama -------
create or replace view public.daily_summary with (security_invoker = true) as
 select t.outlet_id, o.name as outlet_name, t.transaction_date,
    coalesce(sum(t.amount) filter (where t.type = 'In'  and c.counts_in_profit), 0::numeric) as money_in,
    coalesce(sum(t.amount) filter (where t.type = 'Out' and c.counts_in_profit), 0::numeric) as money_out,
    coalesce(sum(t.amount) filter (where t.type = 'In'  and c.counts_in_profit), 0::numeric)
  - coalesce(sum(t.amount) filter (where t.type = 'Out' and c.counts_in_profit), 0::numeric) as profit,
    count(*) as bil_transaksi
   from public.transactions t
   join public.categories c on c.business_id = t.business_id and c.name = t.category and c.type = t.type
   join public.outlets o on o.business_id = t.business_id and o.id = t.outlet_id
  group by t.outlet_id, o.name, t.transaction_date;

commit;
