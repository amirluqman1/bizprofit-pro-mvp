-- =====================================================================
-- BizProfit Pro · Fasa 11: Lauk / menu lain sebagai bahan resipi
--   Contoh: "Nasi Lemak Paru" = bahan stok (beras, santan...) + 1 × menu "Paru".
--   Kos "Paru" dikira dari resipinya sendiri, jadi bila harga bahan Paru
--   berubah, semua menu yang guna Paru ikut berubah.
--   Satu baris resipi = SAMA ADA barang stok ATAU menu lain (qty = bilangan pinggan/porsi).
--   Menu tidak boleh guna dirinya sendiri, termasuk secara berpusing (A→B→A).
--   Menu yang sedang digunakan dalam menu lain tidak boleh dipadam.
-- =====================================================================
begin;

alter table public.menu_ingredients alter column inventory_item_id drop not null;
alter table public.menu_ingredients add column sub_menu_id uuid;
alter table public.menu_ingredients add constraint menu_ingredients_sub_fk
  foreign key (business_id, sub_menu_id) references public.menu_items (business_id, id) on delete restrict;
alter table public.menu_ingredients add constraint menu_ingredients_one_source
  check ((inventory_item_id is null) <> (sub_menu_id is null));
alter table public.menu_ingredients add constraint menu_ingredients_unique_sub unique (menu_item_id, sub_menu_id);
create index idx_menu_ingredients_sub on public.menu_ingredients (business_id, sub_menu_id);

create or replace function public.menu_ingredients_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_src_outlet uuid; v_loop boolean;
begin
  select m.outlet_id into new.outlet_id from public.menu_items m
    where m.id = new.menu_item_id and m.business_id = new.business_id;
  if new.outlet_id is null then raise exception 'Menu not found'; end if;

  if new.inventory_item_id is not null then
    select i.outlet_id into v_src_outlet from public.inventory_items i
      where i.id = new.inventory_item_id and i.business_id = new.business_id;
  else
    if new.sub_menu_id = new.menu_item_id then raise exception 'A menu cannot include itself'; end if;
    select m.outlet_id into v_src_outlet from public.menu_items m
      where m.id = new.sub_menu_id and m.business_id = new.business_id;
    -- Pusingan: adakah sub-menu (atau sub-menu di bawahnya) sudah guna menu ini?
    with recursive down(id) as (
      select new.sub_menu_id
      union
      select mi.sub_menu_id from public.menu_ingredients mi join down d on mi.menu_item_id = d.id
      where mi.sub_menu_id is not null
    )
    select exists (select 1 from down where id = new.menu_item_id) into v_loop;
    if v_loop then raise exception 'These menus would include each other in a loop'; end if;
  end if;
  if v_src_outlet is null then raise exception 'Ingredient not found'; end if;
  if v_src_outlet <> new.outlet_id then
    raise exception 'Ingredients must come from the same outlet as the menu'; end if;
  return new;
end $$;
revoke execute on function public.menu_ingredients_fill() from public, anon, authenticated;

--    p_lines: [{"item": "<inventory_item_id>", "qty": 0.15}, {"menu": "<menu_item_id>", "qty": 1}, ...]
create or replace function public.save_menu(p_id uuid, p_outlet uuid, p_name text, p_price numeric, p_portions numeric, p_lines jsonb)
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
  insert into public.menu_ingredients (menu_item_id, inventory_item_id, sub_menu_id, qty)
    select v_id, nullif(l->>'item', '')::uuid, nullif(l->>'menu', '')::uuid, (l->>'qty')::numeric
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;
  return v_id;
end $$;

commit;
