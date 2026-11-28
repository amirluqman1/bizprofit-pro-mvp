-- =====================================================================
-- BizProfit Pro · Fasa 22: Kategori menu POS (warna + susunan) dan susun menu dari POS
--
-- Masalah sebelum ini:
--   Menu hanya boleh ditambah di BizProfit dan susunan diubah dengan menaip nombor satu-satu.
--   Kategori hanya teks dalam menu_items.category: tiada warna, tiada susunan sendiri, dan
--   tukar nama kategori perlu ubah setiap menu.
--
-- Apa berubah (keputusan pengguna 28 Nov):
--   1. Table menu_categories (satu baris setiap kategori setiap outlet): nama, warna (#rrggbb),
--      susunan. Diisi daripada kategori sedia ada (susunan ikut abjad).
--   2. menu_items.category kekal sebagai teks (Food Cost, laporan dan app lama tidak terjejas).
--      Trigger memastikan setiap kategori yang digunakan menu wujud dalam menu_categories
--      (dicipta automatik di hujung susunan, tanpa warna).
--   3. Menu baru (sort_order 0) diletakkan di hujung kategorinya secara automatik.
--   4. Fungsi (owner/admin outlet itu sahaja, ikut RLS sedia ada):
--        reorder_menu(outlet, [id menu ikut susunan])          : susun menu (satu langkah, atomik)
--        reorder_menu_categories(outlet, [nama ikut susunan])  : susun kategori
--        rename_menu_category(outlet, nama lama, nama baru)    : tukar nama; semua menu ikut
--   5. Kategori yang masih ada menu tidak boleh dipadam.
--
-- Siapa boleh buat apa:
--   Baca kategori: sesiapa yang boleh guna POS outlet itu (can_keyin_outlet), sama dengan menu.
--   Tambah / ubah / padam / susun kategori dan susun menu: owner (semua outlet), admin (outlet sendiri),
--   pakej Pro ke atas (sama dengan menu_items, Fasa 12). Manager & staff: baca sahaja.
--   Syarikat lain: tiada akses (tenant_isolation).
--
-- Kes tepi:
--   - Menu dipadam: order lama kekal (pos_order_items simpan nama & harga; menu_item_id jadi null).
--     Menu yang digunakan sebagai lauk dalam resepi menu lain tidak boleh dipadam (FK sedia ada).
--   - Tukar nama ke kategori yang sudah wujud: ditolak (elak cantum tanpa sengaja).
--   - Turun ke pakej Free: kategori & susunan kekal, cuma tak boleh diubah (prinsip Fasa 12).
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Kategori ----------------------------------------------------------------------------
create table public.menu_categories (
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  outlet_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 40 and name = btrim(name)),
  color text check (color ~ '^#[0-9a-f]{6}$'),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (outlet_id, name),
  foreign key (business_id, outlet_id) references public.outlets(business_id, id)
);
alter table public.menu_categories enable row level security;
revoke all on public.menu_categories from anon, authenticated;
grant select, insert, update, delete on public.menu_categories to authenticated;
create policy tenant_isolation on public.menu_categories as restrictive for all to authenticated
  using (business_id = (select public.current_business_id()))
  with check (business_id = (select public.current_business_id()));
create policy "pos baca kategori" on public.menu_categories for select to authenticated
  using ((select public.can_keyin_outlet(menu_categories.outlet_id)));
create policy "owner admin urus kategori" on public.menu_categories for all to authenticated
  using ((select public.can_admin_outlet(menu_categories.outlet_id)))
  with check ((select public.can_admin_outlet(menu_categories.outlet_id)));
create policy "pakej pro: tambah" on public.menu_categories as restrictive for insert to authenticated
  with check ((select public.current_plan()) <> 'free');
create policy "pakej pro: ubah" on public.menu_categories as restrictive for update to authenticated
  using ((select public.current_plan()) <> 'free') with check ((select public.current_plan()) <> 'free');
create policy "pakej pro: padam" on public.menu_categories as restrictive for delete to authenticated
  using ((select public.current_plan()) <> 'free');

-- Kategori sedia ada (nama dibersihkan), susunan ikut abjad.
update public.menu_items set category = nullif(btrim(category), '') where category is distinct from nullif(btrim(category), '');
insert into public.menu_categories (business_id, outlet_id, name, sort_order)
select business_id, outlet_id, category, row_number() over (partition by outlet_id order by lower(category))
from (select distinct business_id, outlet_id, category from public.menu_items where category is not null) c;

-- Kategori yang masih ada menu tidak boleh dipadam.
create function public.menu_categories_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.menu_items m where m.outlet_id = old.outlet_id and m.category = old.name) then
    raise exception 'Kategori "%" masih ada menu. Pindahkan atau padam menu itu dahulu.', old.name;
  end if;
  return old;
end $$;
revoke execute on function public.menu_categories_guard() from public, anon, authenticated;
create trigger trg_menu_categories_guard before delete on public.menu_categories
  for each row execute function public.menu_categories_guard();

-- 2. Menu: bersihkan kategori, menu baru di hujung kategori ------------------------------
create or replace function public.menu_items_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.outlet_id is distinct from old.outlet_id then
    raise exception 'A menu cannot be moved to another outlet';
  end if;
  new.name := btrim(new.name);
  new.category := nullif(btrim(new.category), '');
  if tg_op = 'INSERT' and new.sort_order = 0 then
    select coalesce(max(m.sort_order), 0) + 1 into new.sort_order
    from public.menu_items m where m.outlet_id = new.outlet_id and m.category is not distinct from new.category;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Setiap kategori yang digunakan menu wujud dalam menu_categories.
create function public.menu_items_category_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.category is not null then
    insert into public.menu_categories (business_id, outlet_id, name, sort_order)
    select new.business_id, new.outlet_id, new.category,
           coalesce((select max(c.sort_order) from public.menu_categories c where c.outlet_id = new.outlet_id), 0) + 1
    on conflict (outlet_id, name) do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.menu_items_category_sync() from public, anon, authenticated;
create trigger trg_menu_items_category_sync after insert or update of category on public.menu_items
  for each row execute function public.menu_items_category_sync();

-- 3. Susun menu / kategori, tukar nama kategori ------------------------------------------
-- Security invoker: RLS menu_items / menu_categories terpakai (owner/admin, Pro ke atas).
create function public.reorder_menu(p_outlet uuid, p_ids uuid[])
returns int language plpgsql security invoker set search_path = '' as $$
declare n int;
begin
  update public.menu_items m set sort_order = x.ord
  from unnest(p_ids) with ordinality as x(id, ord)
  where m.id = x.id and m.outlet_id = p_outlet;
  get diagnostics n = row_count;
  if n <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'Tiada akses untuk susun menu outlet ini (hanya owner atau admin, pakej Pro).';
  end if;
  return n;
end $$;

create function public.reorder_menu_categories(p_outlet uuid, p_names text[])
returns int language plpgsql security invoker set search_path = '' as $$
declare n int;
begin
  update public.menu_categories c set sort_order = x.ord
  from unnest(p_names) with ordinality as x(name, ord)
  where c.outlet_id = p_outlet and c.name = x.name;
  get diagnostics n = row_count;
  if n <> coalesce(array_length(p_names, 1), 0) then
    raise exception 'Tiada akses untuk susun kategori outlet ini (hanya owner atau admin, pakej Pro).';
  end if;
  return n;
end $$;

create function public.rename_menu_category(p_outlet uuid, p_old text, p_new text)
returns void language plpgsql security invoker set search_path = '' as $$
declare baru text := btrim(coalesce(p_new, ''));
begin
  if baru = '' or length(baru) > 40 then raise exception 'Nama kategori mesti 1 hingga 40 aksara.'; end if;
  if baru = p_old then return; end if;
  if exists (select 1 from public.menu_categories where outlet_id = p_outlet and name = baru) then
    raise exception 'Kategori "%" sudah wujud.', baru;
  end if;
  update public.menu_categories set name = baru where outlet_id = p_outlet and name = p_old;
  if not found then raise exception 'Kategori tidak dijumpai atau tiada akses (hanya owner atau admin).'; end if;
  update public.menu_items set category = baru where outlet_id = p_outlet and category = p_old;
end $$;

revoke execute on function public.reorder_menu(uuid, uuid[]) from public, anon;
revoke execute on function public.reorder_menu_categories(uuid, text[]) from public, anon;
revoke execute on function public.rename_menu_category(uuid, text, text) from public, anon;
grant execute on function public.reorder_menu(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_menu_categories(uuid, text[]) to authenticated;
grant execute on function public.rename_menu_category(uuid, text, text) to authenticated;

commit;
