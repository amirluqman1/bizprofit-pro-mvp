-- =====================================================================
-- BizProfit Pro · Fasa 19: POS (ambil order, bil terbuka, bayar, resit)
--
-- Apa berubah:
--   1. pos_settings (satu baris seoutlet): nombor order On/Off, nombor meja On/Off,
--      slip dapur On/Off, tulisan atas & bawah resit. Default semua Off.
--   2. menu_items: tambah category (tab di POS), available (Ada/Habis), sort_order.
--      Staff outlet kini boleh BACA menu outlet sendiri (untuk POS). Ubah menu kekal owner/admin.
--   3. pos_orders: satu order = satu bil. Status: terbuka -> dibayar, atau batal.
--      ID boleh dijana di tablet (asas untuk offline kemudian; simpan semula tak berganda).
--      Nombor order harian (#1, #2...) diberi oleh database jika Tetapan POS hidupkan.
--   4. pos_order_items: nama & harga DISALIN dari menu oleh database semasa tambah item
--      (tablet tak boleh hantar harga sendiri). Item dibuang dari bil terbuka tidak dipadam:
--      direkod siapa & bila (removed_at/removed_by).
--   5. pos_pay_order(): database kira jumlah dari item, semak duit diterima, kira baki,
--      rekod transaksi "Jualan POS" (kategori dicipta automatik), kunci order.
--      Dipanggil dua kali (cth. internet tersangkut) -> pulangkan hasil sama, tiada transaksi kedua.
--   6. pos_void_order(): batal order. Order dibayar ATAU bil terbuka yang ada item: owner/admin
--      sahaja, wajib ada sebab. Bil terbuka kosong: staff outlet boleh batal.
--      Order dibayar: transaksinya dipadam melalui trigger audit sedia ada (direkod dalam log audit).
--   7. Transaksi jualan POS tidak boleh dipadam atau diubah jumlah/jenis/kategori/outlet/kaedah
--      bayar di Rekod; mesti batal melalui POS. Keterangan masih boleh diubah.
--
-- Siapa boleh buat apa:
--   - Staff/manager/admin outlet: buat order & tambah/ubah/buang item bil terbuka outlet sendiri,
--     bayar order outlet sendiri. Staff/manager nampak bil terbuka + order hari ini outlet sendiri;
--     owner/admin nampak semua order outlet mereka.
--   - Owner/admin: Tetapan POS, batal order dibayar / bil berisi.
--   - Syarikat lain: tiada akses langsung (tenant_isolation).
--   - Status, jumlah, bayaran tidak boleh diubah terus (tiada kebenaran kolum); hanya melalui fungsi.
--
-- Kes tepi:
--   - Harga menu ditukar selepas order: item bil terbuka kekal harga semasa ditambah.
--   - Menu "Habis" (available = false) tak boleh ditambah ke bil.
--   - Bayar order tanpa item / jumlah RM 0: ditolak.
--   - Tunai: duit diterima mesti >= jumlah. Bukan tunai: duit diterima boleh kosong.
--   - Had pakej untuk POS belum dikuatkuasa (keputusan pengguna: tunggu SaaS lengkap).
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Tetapan POS ------------------------------------------------------------
create table public.pos_settings (
  outlet_id uuid primary key,
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  order_numbers boolean not null default false,
  table_numbers boolean not null default false,
  kitchen_slip boolean not null default false,
  receipt_header text check (length(receipt_header) <= 300),
  receipt_footer text check (length(receipt_footer) <= 300),
  updated_at timestamptz not null default now(),
  constraint pos_settings_outlet_fk foreign key (business_id, outlet_id) references public.outlets (business_id, id)
);
alter table public.pos_settings enable row level security;
revoke all on public.pos_settings from anon, authenticated;
grant select, insert, update on public.pos_settings to authenticated;
create policy tenant_isolation on public.pos_settings as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy "baca tetapan pos outlet" on public.pos_settings for select to authenticated
  using ((select public.can_keyin_outlet(outlet_id)));
create policy "owner admin urus tetapan pos" on public.pos_settings for insert to authenticated
  with check ((select public.can_admin_outlet(outlet_id)));
create policy "owner admin ubah tetapan pos" on public.pos_settings for update to authenticated
  using ((select public.can_admin_outlet(outlet_id))) with check ((select public.can_admin_outlet(outlet_id)));

-- 2. Menu untuk POS -----------------------------------------------------------
alter table public.menu_items
  add column category text check (length(category) <= 40),
  add column available boolean not null default true,
  add column sort_order integer not null default 0;
create policy "pos baca menu outlet" on public.menu_items for select to authenticated
  using ((select public.can_keyin_outlet(outlet_id)));

-- 3. Order --------------------------------------------------------------------
create table public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  outlet_id uuid not null,
  order_date date not null default ((now() at time zone 'Asia/Kuala_Lumpur')::date),
  order_no integer check (order_no > 0),
  order_type text not null default 'makan_sini' check (order_type in ('makan_sini', 'bungkus')),
  table_no text check (length(table_no) <= 20),
  label text check (length(label) <= 40),
  status text not null default 'terbuka' check (status in ('terbuka', 'dibayar', 'batal')),
  total numeric(12,2) not null default 0 check (total >= 0),
  payment_method text,
  cash_received numeric(12,2) check (cash_received >= 0),
  change_amount numeric(12,2) check (change_amount >= 0),
  transaction_id bigint references public.transactions(id) on delete set null,
  void_transaction_id bigint,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references auth.users(id),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text check (length(void_reason) <= 200),
  constraint pos_orders_business_id_key unique (business_id, id),
  constraint pos_orders_outlet_fk foreign key (business_id, outlet_id) references public.outlets (business_id, id),
  constraint pos_orders_no_key unique (outlet_id, order_date, order_no)
);
create index idx_pos_orders_outlet_date on public.pos_orders (outlet_id, order_date);
create index idx_pos_orders_open on public.pos_orders (outlet_id) where status = 'terbuka';
create index idx_pos_orders_tx on public.pos_orders (transaction_id);

-- Kaunter nombor order harian (hanya trigger menulis).
create table public.pos_counters (
  outlet_id uuid not null references public.outlets(id),
  day date not null,
  last_no integer not null,
  primary key (outlet_id, day)
);
alter table public.pos_counters enable row level security;
revoke all on public.pos_counters from anon, authenticated;

alter table public.pos_orders enable row level security;
revoke all on public.pos_orders from anon, authenticated;
grant select on public.pos_orders to authenticated;
grant insert (id, outlet_id, order_type, table_no, label) on public.pos_orders to authenticated;
grant update (order_type, table_no, label) on public.pos_orders to authenticated;
create policy tenant_isolation on public.pos_orders as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy "baca order pos" on public.pos_orders for select to authenticated
  using ((select public.can_admin_outlet(outlet_id))
         or ((select public.can_keyin_outlet(outlet_id))
             and (status = 'terbuka' or order_date = (now() at time zone 'Asia/Kuala_Lumpur')::date)));
create policy "buat order pos" on public.pos_orders for insert to authenticated
  with check ((select public.can_keyin_outlet(outlet_id)));
create policy "ubah bil terbuka" on public.pos_orders for update to authenticated
  using (status = 'terbuka' and (select public.can_keyin_outlet(outlet_id)))
  with check (status = 'terbuka' and (select public.can_keyin_outlet(outlet_id)));

-- Order baru: tetapkan pencipta, tarikh KL, nombor order harian (jika dihidupkan).
create function public.pos_orders_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare on_no boolean;
begin
  new.created_by := (select auth.uid());
  new.order_date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  new.status := 'terbuka';
  select s.order_numbers into on_no from public.pos_settings s where s.outlet_id = new.outlet_id;
  if coalesce(on_no, false) then
    insert into public.pos_counters as c (outlet_id, day, last_no) values (new.outlet_id, new.order_date, 1)
    on conflict (outlet_id, day) do update set last_no = c.last_no + 1
    returning last_no into new.order_no;
  end if;
  return new;
end $$;
revoke execute on function public.pos_orders_before_insert() from public, anon, authenticated;
create trigger trg_pos_orders_before_insert before insert on public.pos_orders
  for each row execute function public.pos_orders_before_insert();

-- 4. Item order ---------------------------------------------------------------
create table public.pos_order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  order_id uuid not null,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  qty integer not null check (qty between 1 and 999),
  line_total numeric(12,2) generated always as (unit_price * qty) stored,
  note text check (length(note) <= 100),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  constraint pos_order_items_order_fk foreign key (business_id, order_id) references public.pos_orders (business_id, id)
);
create index idx_pos_order_items_order on public.pos_order_items (order_id);
alter table public.pos_order_items enable row level security;
revoke all on public.pos_order_items from anon, authenticated;
grant select on public.pos_order_items to authenticated;
grant insert (id, order_id, menu_item_id, qty, note) on public.pos_order_items to authenticated;
grant update (qty, note, removed_at) on public.pos_order_items to authenticated;
create policy tenant_isolation on public.pos_order_items as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy "baca item order" on public.pos_order_items for select to authenticated
  using (exists (select 1 from public.pos_orders o where o.id = order_id));
create policy "tambah item bil terbuka" on public.pos_order_items for insert to authenticated
  with check (exists (select 1 from public.pos_orders o where o.id = order_id and o.status = 'terbuka'
                      and (select public.can_keyin_outlet(o.outlet_id))));
create policy "ubah item bil terbuka" on public.pos_order_items for update to authenticated
  using (removed_at is null and exists (select 1 from public.pos_orders o where o.id = order_id and o.status = 'terbuka'
                      and (select public.can_keyin_outlet(o.outlet_id))))
  with check (exists (select 1 from public.pos_orders o where o.id = order_id and o.status = 'terbuka'
                      and (select public.can_keyin_outlet(o.outlet_id))));

-- Tambah item: salin nama & harga dari menu outlet yang sama (harga dari tablet diabaikan).
create function public.pos_items_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.menu_items; o public.pos_orders;
begin
  if tg_op = 'INSERT' then
    select * into o from public.pos_orders where id = new.order_id;
    select * into m from public.menu_items where id = new.menu_item_id;
    if m.id is null or o.id is null or m.outlet_id <> o.outlet_id or m.business_id <> o.business_id then
      raise exception 'Menu tidak dijumpai untuk outlet ini';
    end if;
    if not m.available then raise exception 'Menu "%" sedang habis', m.name; end if;
    new.business_id := o.business_id;
    new.name := m.name;
    new.unit_price := m.selling_price;
    new.created_by := (select auth.uid());
    new.removed_at := null; new.removed_by := null;
  else
    if old.removed_at is not null then raise exception 'Item ini sudah dibuang'; end if;
    if new.removed_at is not null then
      new.removed_at := now();
      new.removed_by := (select auth.uid());
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.pos_items_before_write() from public, anon, authenticated;
create trigger trg_pos_items_before_write before insert or update on public.pos_order_items
  for each row execute function public.pos_items_before_write();

-- 5. Bayar ----------------------------------------------------------------------
create function public.pos_pay_order(p_order uuid, p_payment_method text, p_cash_received numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.pos_orders;
  v_total numeric;
  v_change numeric;
  tx bigint;
  v_desc text;
begin
  select * into o from public.pos_orders where id = p_order for update;
  if o.id is null or o.business_id is distinct from public.current_business_id() then
    raise exception 'Order tidak dijumpai';
  end if;
  if not public.can_keyin_outlet(o.outlet_id) then raise exception 'Tiada akses untuk outlet ini'; end if;
  -- Dipanggil semula selepas berjaya: pulangkan hasil yang sama.
  if o.status = 'dibayar' then
    return jsonb_build_object('transaction_id', o.transaction_id, 'total', o.total, 'change', o.change_amount,
                              'order_no', o.order_no, 'already_paid', true);
  end if;
  if o.status <> 'terbuka' then raise exception 'Order ini sudah dibatalkan'; end if;
  if not exists (select 1 from public.payment_methods where business_id = o.business_id and name = p_payment_method) then
    raise exception 'Kaedah bayaran tidak sah';
  end if;
  select coalesce(sum(line_total), 0) into v_total from public.pos_order_items where order_id = o.id and removed_at is null;
  if v_total <= 0 then raise exception 'Bil kosong atau RM 0, tiada apa untuk dibayar'; end if;
  if p_cash_received is not null then
    if p_cash_received < v_total then raise exception 'Duit diterima kurang daripada jumlah'; end if;
    v_change := p_cash_received - v_total;
  end if;

  insert into public.categories (business_id, key, name, type, counts_in_profit, is_sales)
  values (o.business_id, 'INPOS', 'Jualan POS', 'In', true, true)
  on conflict do nothing;

  v_desc := 'POS' || coalesce(' #' || o.order_no, '') || coalesce(' · Meja ' || nullif(trim(o.table_no), ''), '')
            || coalesce(' · ' || nullif(trim(o.label), ''), '')
            || case o.order_type when 'bungkus' then ' · Bungkus' else ' · Makan sini' end;
  insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method,
                                   reference_no, outlet_id, created_by)
  values (o.business_id, (now() at time zone 'Asia/Kuala_Lumpur')::date, 'In', 'Jualan POS', v_total, v_desc,
          p_payment_method, 'POS-' || left(o.id::text, 8), o.outlet_id, (select auth.uid()))
  returning id into tx;

  update public.pos_orders
     set status = 'dibayar', total = v_total, payment_method = p_payment_method,
         cash_received = p_cash_received, change_amount = v_change, transaction_id = tx,
         paid_at = now(), paid_by = (select auth.uid())
   where id = o.id;
  return jsonb_build_object('transaction_id', tx, 'total', v_total, 'change', v_change, 'order_no', o.order_no,
                            'already_paid', false);
end $$;
revoke execute on function public.pos_pay_order(uuid, text, numeric) from public, anon;
grant execute on function public.pos_pay_order(uuid, text, numeric) to authenticated;

-- 6. Batal ----------------------------------------------------------------------
create function public.pos_void_order(p_order uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.pos_orders;
  has_items boolean;
begin
  select * into o from public.pos_orders where id = p_order for update;
  if o.id is null or o.business_id is distinct from public.current_business_id() then
    raise exception 'Order tidak dijumpai';
  end if;
  if o.status = 'batal' then raise exception 'Order ini sudah dibatalkan'; end if;
  select exists (select 1 from public.pos_order_items where order_id = o.id and removed_at is null) into has_items;

  if o.status = 'dibayar' or has_items then
    if not public.can_admin_outlet(o.outlet_id) then
      raise exception 'Hanya owner atau admin boleh batal order yang ada item atau sudah dibayar';
    end if;
    if nullif(trim(p_reason), '') is null then raise exception 'Nyatakan sebab batal'; end if;
  elsif not public.can_keyin_outlet(o.outlet_id) then
    raise exception 'Tiada akses untuk outlet ini';
  end if;

  update public.pos_orders
     set status = 'batal', voided_at = now(), voided_by = (select auth.uid()),
         void_reason = nullif(trim(p_reason), ''), void_transaction_id = transaction_id, transaction_id = null
   where id = o.id;
  if o.transaction_id is not null then
    -- Trigger audit sedia ada (Fasa 9) merekod transaksi yang dipadam.
    perform set_config('bizprofit.pos_batal', o.transaction_id::text, true);
    delete from public.transactions where id = o.transaction_id;
    perform set_config('bizprofit.pos_batal', '', true);
  end if;
end $$;
revoke execute on function public.pos_void_order(uuid, text) from public, anon;
grant execute on function public.pos_void_order(uuid, text) to authenticated;

-- 7. Lindungi transaksi jualan POS di Rekod --------------------------------------
create function public.pos_transactions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.pos_orders where transaction_id = old.id) then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('bizprofit.pos_batal', true), '') <> old.id::text then
      raise exception 'Ini jualan POS. Batalkan order melalui POS (owner/admin).';
    end if;
    return old;
  end if;
  if new.amount is distinct from old.amount or new.type is distinct from old.type
     or new.category is distinct from old.category or new.outlet_id is distinct from old.outlet_id
     or new.payment_method is distinct from old.payment_method or new.transaction_date is distinct from old.transaction_date then
    raise exception 'Ini jualan POS: jumlah, jenis, kategori, outlet, tarikh dan kaedah bayar tidak boleh diubah di Rekod.';
  end if;
  return new;
end $$;
revoke execute on function public.pos_transactions_guard() from public, anon, authenticated;
create trigger trg_pos_transactions_guard before update or delete on public.transactions
  for each row execute function public.pos_transactions_guard();

-- 8. Staff tandakan menu Ada/Habis (tanpa boleh ubah harga/nama) -----------------
create function public.pos_set_available(p_menu uuid, p_available boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.menu_items;
begin
  select * into m from public.menu_items where id = p_menu;
  if m.id is null or m.business_id is distinct from public.current_business_id() or not public.can_keyin_outlet(m.outlet_id) then
    raise exception 'Menu tidak dijumpai';
  end if;
  update public.menu_items set available = coalesce(p_available, true), updated_at = now() where id = p_menu;
end $$;
revoke execute on function public.pos_set_available(uuid, boolean) from public, anon;
grant execute on function public.pos_set_available(uuid, boolean) to authenticated;

commit;
