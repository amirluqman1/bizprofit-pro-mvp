-- =====================================================================
-- BizProfit Pro · Fasa 8: Kategori barang stok
-- Untuk senarai beli WhatsApp dikumpul ikut kategori
-- (Barang Kering, Barang Plastik, Barang Air, Barang Basah, Lain-lain).
-- Kategori dikunci macam nama/unit: hanya owner boleh ubah selepas disimpan.
-- =====================================================================
alter table public.inventory_items add column if not exists category text;

create or replace function public.inventory_validate_v1()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Login diperlukan untuk mengubah stok'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.current_qty < 0 or new.min_qty < 0 or new.target_qty < 0 then
    raise exception 'Kuantiti tidak boleh negatif'; end if;
  if tg_op = 'UPDATE' then
    if new.outlet_id is distinct from old.outlet_id then
      raise exception 'Outlet barang tidak boleh diubah'; end if;
    if not (select public.is_owner())
       and (new.name is distinct from old.name or new.unit is distinct from old.unit
            or new.target_qty is distinct from old.target_qty
            or new.min_qty is distinct from old.min_qty
            or new.category is distinct from old.category) then
      raise exception 'Hanya owner boleh ubah nama, unit, kategori atau patut ada'; end if;
  end if;
  new.updated_at := now();
  return new;
end $function$;
