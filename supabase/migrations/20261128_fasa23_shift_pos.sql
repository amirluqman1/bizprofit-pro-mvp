-- =====================================================================
-- BizProfit Pro · Fasa 23: Shift POS (buka/tutup kedai, duit laci, cash in/out, ringkasan)
--
-- Keputusan pengguna (28 Nov):
--   - Wajib buka shift sebelum order boleh DIBAYAR (dikunci di database).
--   - Cash out (ambil duit dari laci) terus jadi belanja di Rekod: transaksi 'Out', kategori dipilih,
--     kaedah bayar tunai. Cash in (masukkan duit ke laci, cth. duit pecah) tidak jadi transaksi.
--   - Tutup shift: kiraan "buta". Staf masukkan duit dikira DAHULU; jumlah jangkaan hanya dipulangkan
--     selepas shift ditutup. Semasa shift dibuka, jangkaan hanya dipapar kepada owner/admin.
--   - Semua staf POS outlet itu boleh buka, tutup dan buat cash in/out (wajib sebab). Semua direkod siapa & bila.
--
-- Apa berubah:
--   1. pos_shifts: satu shift dibuka pada satu masa bagi setiap outlet (semua tablet outlet itu kongsi).
--      Simpan modal laci, siapa/bila buka & tutup, dan GAMBARAN akhir semasa tutup (jualan tunai,
--      pulangan tunai, cash in/out, jangkaan, dikira, beza). Gambaran akhir tidak berubah selepas tutup.
--   2. pos_shift_moves: setiap cash in / cash out (jumlah, sebab, kategori, transaksi Rekod). Tidak boleh diubah/dipadam.
--   3. pos_orders.shift_id (shift semasa order dibayar) dan void_shift_id (shift semasa order dibayar itu dibatal),
--      diisi oleh trigger. Order dibayar tanpa shift dibuka: DITOLAK.
--   4. Jangkaan tunai dalam laci = modal + jualan tunai (dibayar dalam shift ini)
--        − pulangan tunai (order tunai yang dibatal dalam shift ini) + cash in − cash out.
--      Tunai = kaedah bayar yang namanya mengandungi "tunai" atau "cash" (sama dengan POS).
--   5. Fungsi (semua dikunci ikut can_keyin_outlet):
--        pos_open_shift(outlet, modal)                         → id shift
--        pos_cash_move(shift, 'masuk'|'keluar', jumlah, sebab, kategori) → id pergerakan
--        pos_shift_summary(shift)                              → ringkasan (jangkaan: owner/admin / selepas tutup)
--        pos_close_shift(shift, dikira, nota)                  → ringkasan akhir termasuk beza
--
-- Siapa boleh buat apa:
--   Owner (semua outlet) / admin / manager / staff outlet itu: buka, tutup, cash in/out, baca shift.
--   Tiada siapa boleh tambah/ubah/padam terus table shift (hanya melalui fungsi). Syarikat lain: tiada akses.
--
-- Kes tepi:
--   - Order dibayar dalam shift A, dibatal dalam shift B: A kekal (gambaran akhir), B tolak pulangan tunai.
--   - Order dibatal bila tiada shift dibuka (cth. owner dari rumah): tiada pulangan dikira dalam mana-mana laci.
--   - Bil terbuka boleh dibawa ke shift seterusnya; ia dikira dalam shift semasa ia DIBAYAR.
--   - Transaksi cash out dipadam di Rekod: duit tetap dikira keluar dari laci (pergerakan kekal).
--     Untuk betulkan duit laci, buat cash in "Pembetulan".
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Shift -----------------------------------------------------------------------------
create table public.pos_shifts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  outlet_id uuid not null,
  opened_at timestamptz not null default now(),
  opened_by uuid not null references auth.users(id),
  opening_float numeric(12,2) not null check (opening_float >= 0),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  cash_sales numeric(12,2),
  cash_refunds numeric(12,2),
  cash_in numeric(12,2),
  cash_out numeric(12,2),
  expected_cash numeric(12,2),
  counted_cash numeric(12,2) check (counted_cash >= 0),
  difference numeric(12,2),
  sales_total numeric(12,2),
  orders_count int,
  close_note text check (length(close_note) <= 200),
  constraint pos_shifts_outlet_fk foreign key (business_id, outlet_id) references public.outlets(business_id, id),
  constraint pos_shifts_closed_check check ((closed_at is null) = (counted_cash is null))
);
create unique index pos_shifts_one_open on public.pos_shifts (outlet_id) where closed_at is null;
create index idx_pos_shifts_outlet on public.pos_shifts (outlet_id, opened_at desc);

create table public.pos_shift_moves (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  shift_id uuid not null references public.pos_shifts(id),
  outlet_id uuid not null,
  kind text not null check (kind in ('masuk', 'keluar')),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null check (length(btrim(reason)) between 1 and 200),
  category text,
  transaction_id bigint references public.transactions(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index idx_pos_shift_moves_shift on public.pos_shift_moves (shift_id);

alter table public.pos_shifts enable row level security;
alter table public.pos_shift_moves enable row level security;
revoke all on public.pos_shifts, public.pos_shift_moves from anon, authenticated;
grant select on public.pos_shifts, public.pos_shift_moves to authenticated;
create policy tenant_isolation on public.pos_shifts as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.pos_shift_moves as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy "baca shift outlet" on public.pos_shifts for select to authenticated
  using ((select public.can_keyin_outlet(outlet_id)));
create policy "baca pergerakan laci outlet" on public.pos_shift_moves for select to authenticated
  using ((select public.can_keyin_outlet(outlet_id)));

-- 2. Order terikat kepada shift ---------------------------------------------------------
alter table public.pos_orders
  add column shift_id uuid references public.pos_shifts(id),
  add column void_shift_id uuid references public.pos_shifts(id);
create index idx_pos_orders_shift on public.pos_orders (shift_id);
create index idx_pos_orders_void_shift on public.pos_orders (void_shift_id);

create function public.pos_orders_shift_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  if old.status = 'terbuka' and new.status = 'dibayar' then
    select id into s from public.pos_shifts where outlet_id = new.outlet_id and closed_at is null;
    if s is null then raise exception 'Shift belum dibuka. Buka shift (kira duit modal laci) sebelum terima bayaran.'; end if;
    new.shift_id := s;
  elsif old.status = 'dibayar' and new.status = 'batal' then
    select id into s from public.pos_shifts where outlet_id = new.outlet_id and closed_at is null;
    new.void_shift_id := s;   -- null jika tiada shift dibuka
  end if;
  return new;
end $$;
revoke execute on function public.pos_orders_shift_guard() from public, anon, authenticated;
create trigger trg_pos_orders_shift before update of status on public.pos_orders
  for each row execute function public.pos_orders_shift_guard();

-- 3. Pengiraan (dalaman) ---------------------------------------------------------------
create function public.pos_is_cash(p_method text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p_method ~* '(tunai|cash)', false) $$;

create function public.pos_shift_figures(p_shift uuid)
returns table (cash_sales numeric, cash_refunds numeric, cash_in numeric, cash_out numeric,
               expected_cash numeric, sales_total numeric, orders_count int, voided_count int, by_method jsonb)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.pos_shifts where id = p_shift),
  paid as (select o.* from public.pos_orders o where o.shift_id = p_shift and o.paid_at is not null),
  live as (select * from paid where status = 'dibayar'),
  refunds as (select o.* from public.pos_orders o where o.void_shift_id = p_shift and o.paid_at is not null)
  select
    coalesce((select sum(total) from paid where public.pos_is_cash(payment_method)), 0),
    coalesce((select sum(total) from refunds where public.pos_is_cash(payment_method)), 0),
    coalesce((select sum(amount) from public.pos_shift_moves where shift_id = p_shift and kind = 'masuk'), 0),
    coalesce((select sum(amount) from public.pos_shift_moves where shift_id = p_shift and kind = 'keluar'), 0),
    (select s.opening_float from s)
      + coalesce((select sum(total) from paid where public.pos_is_cash(payment_method)), 0)
      - coalesce((select sum(total) from refunds where public.pos_is_cash(payment_method)), 0)
      + coalesce((select sum(amount) from public.pos_shift_moves where shift_id = p_shift and kind = 'masuk'), 0)
      - coalesce((select sum(amount) from public.pos_shift_moves where shift_id = p_shift and kind = 'keluar'), 0),
    coalesce((select sum(total) from live), 0),
    (select count(*)::int from live),
    (select count(*)::int from paid where status = 'batal'),
    coalesce((select jsonb_object_agg(payment_method, amt) from
              (select payment_method, sum(total) amt from live group by payment_method) m), '{}'::jsonb)
$$;
revoke execute on function public.pos_shift_figures(uuid) from public, anon, authenticated;

-- 4. Buka shift --------------------------------------------------------------------------
create function public.pos_open_shift(p_outlet uuid, p_float numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare biz uuid; v_id uuid;
begin
  if not public.can_keyin_outlet(p_outlet) then raise exception 'Tiada akses untuk outlet ini'; end if;
  if p_float is null or p_float < 0 then raise exception 'Masukkan duit modal dalam laci (RM 0 atau lebih).'; end if;
  select business_id into biz from public.outlets where id = p_outlet;
  begin
    insert into public.pos_shifts (business_id, outlet_id, opened_by, opening_float)
    values (biz, p_outlet, (select auth.uid()), round(p_float, 2)) returning id into v_id;
  exception when unique_violation then
    raise exception 'Shift sudah dibuka untuk outlet ini (mungkin dari tablet lain). Muat semula.';
  end;
  return v_id;
end $$;

-- 5. Cash in / cash out ------------------------------------------------------------------
create function public.pos_cash_move(p_shift uuid, p_kind text, p_amount numeric, p_reason text, p_category text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.pos_shifts; v_method text; tx bigint; v_id uuid;
begin
  select * into s from public.pos_shifts where id = p_shift for update;
  if s.id is null or s.business_id is distinct from public.current_business_id() or not public.can_keyin_outlet(s.outlet_id) then
    raise exception 'Shift tidak dijumpai';
  end if;
  if s.closed_at is not null then raise exception 'Shift ini sudah ditutup.'; end if;
  if p_kind not in ('masuk', 'keluar') then raise exception 'Jenis pergerakan tidak sah'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Jumlah mesti lebih dari RM 0'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Tulis sebab.'; end if;

  if p_kind = 'keluar' then
    if not exists (select 1 from public.categories c where c.business_id = s.business_id and c.name = p_category and c.type = 'Out') then
      raise exception 'Pilih kategori belanja untuk cash out.';
    end if;
    select name into v_method from public.payment_methods
     where business_id = s.business_id and public.pos_is_cash(name) order by name limit 1;
    if v_method is null then raise exception 'Tiada kaedah bayaran "Tunai" dalam syarikat ini. Tambah di BizProfit dahulu.'; end if;
    insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method,
                                     reference_no, outlet_id, created_by)
    values (s.business_id, (now() at time zone 'Asia/Kuala_Lumpur')::date, 'Out', p_category, round(p_amount, 2),
            'Cash out laci POS · ' || btrim(p_reason), v_method, 'SHIFT-' || left(s.id::text, 8), s.outlet_id, (select auth.uid()))
    returning id into tx;
  end if;

  insert into public.pos_shift_moves (business_id, shift_id, outlet_id, kind, amount, reason, category, transaction_id, created_by)
  values (s.business_id, s.id, s.outlet_id, p_kind, round(p_amount, 2), btrim(p_reason),
          case when p_kind = 'keluar' then p_category end, tx, (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

-- 6. Ringkasan --------------------------------------------------------------------------
-- Jangkaan tunai dipulangkan hanya kepada owner/admin semasa shift dibuka (kiraan buta untuk staf).
create function public.pos_shift_summary(p_shift uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.pos_shifts; f record; show_expected boolean;
begin
  select * into s from public.pos_shifts where id = p_shift;
  if s.id is null or s.business_id is distinct from public.current_business_id() or not public.can_keyin_outlet(s.outlet_id) then
    raise exception 'Shift tidak dijumpai';
  end if;
  show_expected := s.closed_at is not null or public.can_admin_outlet(s.outlet_id);
  if s.closed_at is not null then
    return jsonb_build_object('id', s.id, 'open', false, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
      'opening_float', s.opening_float, 'cash_sales', s.cash_sales, 'cash_refunds', s.cash_refunds,
      'cash_in', s.cash_in, 'cash_out', s.cash_out, 'expected_cash', s.expected_cash, 'counted_cash', s.counted_cash,
      'difference', s.difference, 'sales_total', s.sales_total, 'orders_count', s.orders_count, 'note', s.close_note,
      'opened_by', (select email from auth.users where id = s.opened_by), 'closed_by', (select email from auth.users where id = s.closed_by),
      'by_method', (select by_method from public.pos_shift_figures(s.id)), 'show_expected', true);
  end if;
  select * into f from public.pos_shift_figures(s.id);
  return jsonb_build_object('id', s.id, 'open', true, 'opened_at', s.opened_at, 'opening_float', s.opening_float,
    'cash_sales', f.cash_sales, 'cash_refunds', f.cash_refunds, 'cash_in', f.cash_in, 'cash_out', f.cash_out,
    'expected_cash', case when show_expected then f.expected_cash end, 'sales_total', f.sales_total,
    'orders_count', f.orders_count, 'voided_count', f.voided_count, 'by_method', f.by_method,
    'open_bills', (select count(*) from public.pos_orders o where o.outlet_id = s.outlet_id and o.status = 'terbuka'),
    'opened_by', (select email from auth.users where id = s.opened_by), 'show_expected', show_expected);
end $$;

-- 7. Tutup shift ------------------------------------------------------------------------
create function public.pos_close_shift(p_shift uuid, p_counted numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.pos_shifts; f record;
begin
  select * into s from public.pos_shifts where id = p_shift for update;
  if s.id is null or s.business_id is distinct from public.current_business_id() or not public.can_keyin_outlet(s.outlet_id) then
    raise exception 'Shift tidak dijumpai';
  end if;
  if s.closed_at is not null then raise exception 'Shift ini sudah ditutup.'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Masukkan jumlah duit yang dikira dalam laci.'; end if;
  select * into f from public.pos_shift_figures(s.id);
  update public.pos_shifts set
    closed_at = now(), closed_by = (select auth.uid()),
    cash_sales = f.cash_sales, cash_refunds = f.cash_refunds, cash_in = f.cash_in, cash_out = f.cash_out,
    expected_cash = f.expected_cash, counted_cash = round(p_counted, 2), difference = round(p_counted, 2) - f.expected_cash,
    sales_total = f.sales_total, orders_count = f.orders_count, close_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = s.id;
  return public.pos_shift_summary(s.id);
end $$;

revoke execute on function public.pos_is_cash(text) from public, anon;
grant execute on function public.pos_is_cash(text) to authenticated;
revoke execute on function public.pos_open_shift(uuid, numeric) from public, anon;
revoke execute on function public.pos_cash_move(uuid, text, numeric, text, text) from public, anon;
revoke execute on function public.pos_shift_summary(uuid) from public, anon;
revoke execute on function public.pos_close_shift(uuid, numeric, text) from public, anon;
grant execute on function public.pos_open_shift(uuid, numeric) to authenticated;
grant execute on function public.pos_cash_move(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.pos_shift_summary(uuid) to authenticated;
grant execute on function public.pos_close_shift(uuid, numeric, text) to authenticated;

commit;
