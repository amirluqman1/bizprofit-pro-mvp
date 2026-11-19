-- =====================================================================
-- BizProfit Pro · Fasa 10: Food cost
--   1. Harga bahan seunit (ikut barang stok)      -> ingredient_costs
--   2. Menu + resipi (bahan dari stok outlet)     -> menu_items, menu_ingredients
--   3. Simpan menu + resipi sekali gus            -> save_menu()
--   4. Belian bahan harian (kategori Ingredients) -> daily_food_cost
-- Hanya OWNER (semua outlet) dan ADMIN (outlet sendiri) boleh baca/ubah.
-- Harga diletak dalam jadual berasingan, bukan dalam inventory_items,
-- kerana staff boleh baca semua kolum inventory_items.
-- =====================================================================
begin;

-- 1. Harga bahan -----------------------------------------------------------
create table public.ingredient_costs (
  inventory_item_id uuid primary key,
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  outlet_id uuid not null,                       -- diisi trigger dari barang stok
  unit_price numeric(12,4) not null check (unit_price >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint ingredient_costs_item_fk foreign key (business_id, inventory_item_id)
    references public.inventory_items (business_id, id) on delete cascade
);
create index idx_ingredient_costs_outlet on public.ingredient_costs (business_id, outlet_id);

-- 2. Menu & resipi ---------------------------------------------------------
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  outlet_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  portions numeric(12,3) not null default 1 check (portions > 0),   -- 1 resipi = berapa pinggan
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_items_business_id_key unique (business_id, id),
  constraint menu_items_outlet_fk foreign key (business_id, outlet_id) references public.outlets (business_id, id),
  constraint menu_items_unique_name unique (outlet_id, name)
);
create index idx_menu_items_outlet on public.menu_items (business_id, outlet_id);

create table public.menu_ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  menu_item_id uuid not null,
  inventory_item_id uuid not null,
  outlet_id uuid not null,                       -- diisi trigger dari menu
  qty numeric(12,4) not null check (qty > 0),    -- dalam unit barang stok
  constraint menu_ingredients_unique unique (menu_item_id, inventory_item_id),
  constraint menu_ingredients_menu_fk foreign key (business_id, menu_item_id)
    references public.menu_items (business_id, id) on delete cascade,
  constraint menu_ingredients_item_fk foreign key (business_id, inventory_item_id)
    references public.inventory_items (business_id, id) on delete cascade
);
create index idx_menu_ingredients_menu on public.menu_ingredients (menu_item_id);
create index idx_menu_ingredients_item on public.menu_ingredients (business_id, inventory_item_id);

-- 3. Trigger: isi outlet & pastikan bahan dari outlet yang sama ----------------
create function public.ingredient_costs_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select i.outlet_id into new.outlet_id from public.inventory_items i
    where i.id = new.inventory_item_id and i.business_id = new.business_id;
  if new.outlet_id is null then raise exception 'Stock item not found'; end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;
revoke execute on function public.ingredient_costs_fill() from public, anon, authenticated;
create trigger trg_ingredient_costs_fill before insert or update on public.ingredient_costs
  for each row execute function public.ingredient_costs_fill();

create function public.menu_items_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.outlet_id is distinct from old.outlet_id then
    raise exception 'A menu cannot be moved to another outlet'; end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.menu_items_guard() from public, anon, authenticated;
create trigger trg_menu_items_guard before insert or update on public.menu_items
  for each row execute function public.menu_items_guard();

create function public.menu_ingredients_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_item_outlet uuid;
begin
  select m.outlet_id into new.outlet_id from public.menu_items m
    where m.id = new.menu_item_id and m.business_id = new.business_id;
  select i.outlet_id into v_item_outlet from public.inventory_items i
    where i.id = new.inventory_item_id and i.business_id = new.business_id;
  if new.outlet_id is null or v_item_outlet is null then raise exception 'Menu or stock item not found'; end if;
  if v_item_outlet <> new.outlet_id then
    raise exception 'Ingredients must come from the same outlet''s stock as the menu'; end if;
  return new;
end $$;
revoke execute on function public.menu_ingredients_fill() from public, anon, authenticated;
create trigger trg_menu_ingredients_fill before insert or update on public.menu_ingredients
  for each row execute function public.menu_ingredients_fill();

-- 4. Akses: owner & admin outlet sahaja ---------------------------------------
alter table public.ingredient_costs enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_ingredients enable row level security;
revoke all on public.ingredient_costs, public.menu_items, public.menu_ingredients from anon, authenticated;
grant select, insert, update, delete on public.ingredient_costs, public.menu_items, public.menu_ingredients to authenticated;

create policy tenant_isolation on public.ingredient_costs as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.menu_items as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.menu_ingredients as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));

create policy "owner admin urus harga bahan" on public.ingredient_costs for all to authenticated
  using ((select public.can_admin_outlet(outlet_id))) with check ((select public.can_admin_outlet(outlet_id)));
create policy "owner admin urus menu" on public.menu_items for all to authenticated
  using ((select public.can_admin_outlet(outlet_id))) with check ((select public.can_admin_outlet(outlet_id)));
create policy "owner admin urus resipi" on public.menu_ingredients for all to authenticated
  using ((select public.can_admin_outlet(outlet_id))) with check ((select public.can_admin_outlet(outlet_id)));

-- 5. Simpan menu + resipi dalam satu transaksi (ikut RLS pengguna) ---------------
--    p_lines: [{"item": "<inventory_item_id>", "qty": 0.15}, ...]
create function public.save_menu(p_id uuid, p_outlet uuid, p_name text, p_price numeric, p_portions numeric, p_lines jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if p_id is null then
    if not (select public.can_admin_outlet(p_outlet)) then
      raise exception 'Only the owner or this outlet''s admin can manage food cost'; end if;
    insert into public.menu_items (outlet_id, name, selling_price, portions)
      values (p_outlet, p_name, p_price, p_portions) returning id into v_id;
  else
    update public.menu_items set name = p_name, selling_price = p_price, portions = p_portions
      where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Menu not found or no access'; end if;
    delete from public.menu_ingredients where menu_item_id = v_id;
  end if;
  insert into public.menu_ingredients (menu_item_id, inventory_item_id, qty)
    select v_id, (l->>'item')::uuid, (l->>'qty')::numeric
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;
  return v_id;
end $$;
revoke execute on function public.save_menu(uuid, uuid, text, numeric, numeric, jsonb) from public, anon;
grant execute on function public.save_menu(uuid, uuid, text, numeric, numeric, jsonb) to authenticated;

-- 6. Belian bahan (kategori OUT01 Ingredients) ikut hari & outlet --------------
create view public.daily_food_cost with (security_invoker = true) as
 select t.outlet_id, t.transaction_date, sum(t.amount) as ingredients
   from public.transactions t
   join public.categories c on c.business_id = t.business_id and c.name = t.category and c.type = t.type
  where t.type = 'Out' and c.key = 'OUT01'
    and exists (select 1 from public.staff_profiles sp
                where sp.user_id = (select auth.uid()) and sp.role in ('owner', 'admin'))
  group by t.outlet_id, t.transaction_date;
revoke all on public.daily_food_cost from anon;
grant select on public.daily_food_cost to authenticated;

commit;
