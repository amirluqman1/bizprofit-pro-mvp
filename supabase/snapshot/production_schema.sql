-- =====================================================================
-- BizProfit Pro · Snapshot struktur database production
--
-- Diambil dari production pada 2026-11-25 (baca sahaja: katalog Postgres,
-- TIADA data pelanggan). Fail ini = keadaan SEBENAR database selepas Fasa 13,
-- termasuk perubahan lama yang dibuat terus di Supabase dan tiada dalam
-- supabase/migrations/ (policy inventori, log stok, trigger inventori, dll).
--
-- Guna untuk: bina projek STAGING dari kosong (projek Supabase baru).
--   1. Jalankan fail ini sekali.
--   2. Jalankan staging_seed.sql (data palsu + akaun ujian).
-- JANGAN jalankan di production (semua objek sudah wujud di sana).
--
-- Bila ada migration baru (Fasa 14 dst.), apply migration itu ke staging
-- seperti biasa; kemas kini snapshot ini sekali-sekala supaya kekal tepat.
-- =====================================================================
begin;

set local check_function_bodies = off;   -- fungsi SQL dicipta sebelum table

-- ---------------------------------------------------------------------
-- 1. Fungsi
-- ---------------------------------------------------------------------
create or replace function public.current_business_id() returns uuid
language sql stable security definer set search_path to '' as $$
  select business_id from public.staff_profiles where user_id = (select auth.uid())
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.staff_profiles where user_id = (select auth.uid()) and role = 'owner');
$$;

create or replace function public.can_admin_outlet(p_outlet uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and (sp.role = 'owner' or (sp.role = 'admin' and sp.outlet_id = p_outlet))
  )
$$;

create or replace function public.can_keyin_outlet(p_outlet uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.staff_profiles sp
    join public.outlets o on o.id = p_outlet and o.business_id = sp.business_id
    where sp.user_id = (select auth.uid())
      and (sp.role = 'owner' or sp.outlet_id = p_outlet)
  )
$$;

create or replace function public.can_manage_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1
    from public.employees e
    join public.staff_profiles sp on sp.user_id = (select auth.uid()) and sp.business_id = e.business_id
    where e.id = p_employee
      and (sp.role = 'owner'
           or (sp.role = 'admin' and sp.outlet_id = e.outlet_id)
           or (sp.role = 'manager' and sp.outlet_id = e.outlet_id and not e.is_manager))
  )
$$;

create or replace function public.plan_limits(p_plan text) returns table(max_outlets integer, max_staff integer)
language sql immutable set search_path to '' as $$
  select case p_plan when 'business' then 10 else 1 end,
         case p_plan when 'free' then 2 when 'pro' then 10 else null end   -- null = tanpa had
$$;

create or replace function public.plan_of(p_business uuid) returns text
language sql stable security definer set search_path to '' as $$
  select case
      when b.plan <> 'free' and (b.plan_until is null or b.plan_until > now()) then b.plan
      when b.trial_ends_at > now() then 'pro'
      else 'free' end
  from public.businesses b where b.id = p_business
$$;

create or replace function public.current_plan() returns text
language sql stable security definer set search_path to '' as $$
  select coalesce(public.plan_of(public.current_business_id()), 'free')
$$;

create or replace function public.advance_balance(p_employee uuid) returns numeric
language sql stable set search_path to '' as $$
  select coalesce((select sum(amount) from public.salary_advances where employee_id = p_employee), 0)
       - coalesce((select sum(advance_deduction) from public.payroll where employee_id = p_employee and status = 'dibayar'), 0)
$$;

create or replace function public.receipt_in_use(p_path text) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.transactions t where t.receipt_path = p_path)
$$;

create or replace function public.attendance_touch() returns trigger
language plpgsql set search_path to '' as $$
begin
  new.marked_by := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;

create or replace function public.give_advance(p_employee uuid, p_amount numeric, p_payment_method text, p_note text default null::text) returns uuid
language plpgsql security definer set search_path to '' as $$
declare
  emp public.employees;
  tx bigint;
  adv uuid;
begin
  if public.current_plan() = 'free' then raise exception 'Advance gaji ialah ciri pakej Pro. Naik taraf untuk guna.'; end if;
  if not public.can_manage_employee(p_employee) then raise exception 'Tiada akses untuk pekerja ini'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Jumlah advance mesti lebih dari RM 0'; end if;
  select * into emp from public.employees where id = p_employee;
  if not emp.active then raise exception 'Pekerja ini tidak aktif'; end if;

  insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method, outlet_id, created_by)
  values (emp.business_id, (now() at time zone 'Asia/Kuala_Lumpur')::date, 'Out', 'Staff Wages', round(p_amount, 2),
          'Advance gaji ' || emp.name || coalesce(' · ' || nullif(trim(p_note), ''), ''), p_payment_method, emp.outlet_id, auth.uid())
  returning id into tx;

  insert into public.salary_advances (business_id, employee_id, amount, payment_method, note, transaction_id, created_by)
  values (emp.business_id, p_employee, round(p_amount, 2), p_payment_method, nullif(trim(p_note), ''), tx, auth.uid())
  returning id into adv;
  return adv;
end $$;

create or replace function public.ingredient_costs_fill() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  select i.outlet_id into new.outlet_id from public.inventory_items i
    where i.id = new.inventory_item_id and i.business_id = new.business_id;
  if new.outlet_id is null then raise exception 'Stock item not found'; end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;

create or replace function public.inventory_audit_v1() returns trigger
language plpgsql security definer set search_path to '' as $$
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

create or replace function public.inventory_validate_v1() returns trigger
language plpgsql set search_path to '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Login diperlukan untuk mengubah stok'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.current_qty < 0 or new.min_qty < 0 or new.target_qty < 0 then
    raise exception 'Kuantiti tidak boleh negatif'; end if;
  if tg_op = 'UPDATE' then
    if new.outlet_id is distinct from old.outlet_id then
      raise exception 'Outlet barang tidak boleh diubah'; end if;
    if not (select public.can_admin_outlet(new.outlet_id))
       and (new.name is distinct from old.name or new.unit is distinct from old.unit
            or new.target_qty is distinct from old.target_qty
            or new.min_qty is distinct from old.min_qty
            or new.category is distinct from old.category) then
      raise exception 'Hanya owner atau admin boleh ubah nama, unit, kategori atau patut ada'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.menu_ingredients_fill() returns trigger
language plpgsql security definer set search_path to '' as $$
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

create or replace function public.menu_items_guard() returns trigger
language plpgsql set search_path to '' as $$
begin
  if tg_op = 'UPDATE' and new.outlet_id is distinct from old.outlet_id then
    raise exception 'A menu cannot be moved to another outlet'; end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;

create or replace function public.outlets_plan_limit() returns trigger
language plpgsql security definer set search_path to '' as $$
declare lim int; n int; p text;
begin
  p := public.plan_of(new.business_id);
  select max_outlets into lim from public.plan_limits(p);
  select count(*) into n from public.outlets where business_id = new.business_id;
  if n >= lim then
    raise exception 'Had outlet pakej % ialah %. Naik taraf pakej untuk tambah outlet.', initcap(p), lim
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.pay_payroll(p_payroll uuid, p_payment_method text) returns bigint
language plpgsql set search_path to '' as $$
declare
  r public.payroll;
  emp public.employees;
  tx bigint;
  gross numeric;
  adv numeric;
begin
  select * into r from public.payroll where id = p_payroll for update;
  if not found then raise exception 'Slip gaji tidak dijumpai'; end if;
  if r.status <> 'draf' then raise exception 'Gaji ini sudah dibayar'; end if;
  select * into emp from public.employees where id = r.employee_id;

  gross := greatest(r.base_amount + r.ot_amount + r.allowance - r.deduction, 0);
  adv := least(greatest(public.advance_balance(r.employee_id), 0), gross);
  update public.payroll set advance_deduction = adv where id = p_payroll returning * into r;
  if r.net_amount <= 0 and adv <= 0 then raise exception 'Jumlah gaji RM 0, tiada apa untuk dibayar'; end if;

  if r.net_amount > 0 then
    insert into public.transactions (transaction_date, type, category, amount, description, payment_method, outlet_id)
    values ((now() at time zone 'Asia/Kuala_Lumpur')::date, 'Out', 'Staff Wages', r.net_amount,
            format('Gaji %s (%s – %s)', emp.name, to_char(r.period_start, 'DD/MM'), to_char(r.period_end, 'DD/MM/YYYY')),
            p_payment_method, emp.outlet_id)
    returning id into tx;
  end if;

  update public.payroll set status = 'dibayar', paid_at = now(), transaction_id = tx where id = p_payroll;
  return tx;
end $$;

create or replace function public.save_menu(p_id uuid, p_outlet uuid, p_name text, p_price numeric, p_portions numeric, p_lines jsonb) returns uuid
language plpgsql set search_path to '' as $$
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

create or replace function public.staff_plan_limit() returns trigger
language plpgsql security definer set search_path to '' as $$
declare lim int; n int; p text;
begin
  if new.role = 'owner' then return new; end if;
  if tg_op = 'UPDATE' and old.role <> 'owner' and old.business_id = new.business_id then return new; end if;
  p := public.plan_of(new.business_id);
  select max_staff into lim from public.plan_limits(p);
  if lim is null then return new; end if;
  select count(*) into n from public.staff_profiles
    where business_id = new.business_id and role <> 'owner' and user_id <> new.user_id;
  if n >= lim then
    raise exception 'Had akaun staff pakej % ialah %. Naik taraf pakej untuk tambah akaun.', initcap(p), lim
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.transactions_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  pay_id uuid;
  adv_id uuid;
  adv_emp uuid;
  v_note text;
  v_email text;
  v_role text;
begin
  select id into pay_id from public.payroll where transaction_id = old.id;
  select id, employee_id into adv_id, adv_emp from public.salary_advances where transaction_id = old.id;
  select u.email into v_email from auth.users u where u.id = (select auth.uid());
  select sp.role into v_role from public.staff_profiles sp where sp.user_id = (select auth.uid());
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at or new.business_id is distinct from old.business_id then
      raise exception 'Maklumat asal transaksi (pencipta, masa dicipta) tidak boleh diubah';
    end if;
    if (pay_id is not null or adv_id is not null)
       and (new.amount is distinct from old.amount or new.type is distinct from old.type
            or new.category is distinct from old.category or new.outlet_id is distinct from old.outlet_id) then
      raise exception 'Ini rekod gaji/advance: jumlah, jenis, kategori dan outlet tidak boleh diubah. Padam rekod ini, kemudian bayar semula dari Pekerja.';
    end if;
    if row(new.*) is not distinct from row(old.*) then return new; end if;
    insert into public.transaction_audit (business_id, outlet_id, transaction_id, action, old_data, new_data, changed_by, changed_by_email, changed_by_role)
    values (old.business_id, old.outlet_id, old.id, 'ubah', to_jsonb(old), to_jsonb(new), (select auth.uid()), v_email, v_role);
    return new;
  end if;
  if pay_id is not null then
    update public.payroll
      set status = 'draf', paid_at = null, transaction_id = null, advance_deduction = 0
      where id = pay_id;
    v_note := 'Slip gaji dibuka semula (draf)';
  end if;
  if adv_id is not null then
    delete from public.salary_advances where id = adv_id;
    if public.advance_balance(adv_emp) < 0 then
      raise exception 'Advance ini sudah ditolak dalam gaji yang dibayar. Padam rekod gaji tersebut dahulu.';
    end if;
    v_note := 'Advance dibatalkan';
  end if;
  insert into public.transaction_audit (business_id, outlet_id, transaction_id, action, old_data, note, changed_by, changed_by_email, changed_by_role)
  values (old.business_id, old.outlet_id, old.id, 'padam', to_jsonb(old), v_note, (select auth.uid()), v_email, v_role);
  return old;
end $$;

create or replace function public.transactions_receipt_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.receipt_path is null then return new; end if;
  if tg_op = 'UPDATE' and new.receipt_path is not distinct from old.receipt_path then return new; end if;
  if public.current_plan() = 'free' then
    raise exception 'Gambar resit ialah ciri pakej Pro. Naik taraf untuk guna.';
  end if;
  if new.receipt_path not like new.business_id::text || '/%' then
    raise exception 'Laluan gambar resit tidak sah';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Table (ikut urutan kebergantungan)
-- ---------------------------------------------------------------------
create table public.businesses (
  id uuid not null default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  plan text not null default 'free',
  plan_until timestamptz,
  trial_ends_at timestamptz default (now() + '30 days'::interval)
);

create table public.outlets (
  id uuid not null default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  business_id uuid not null default public.current_business_id(),
  company_name text,
  company_reg_no text
);

create table public.staff_profiles (
  user_id uuid not null,
  outlet_id uuid not null,
  role text not null default 'staff',
  created_at timestamptz not null default now(),
  business_id uuid not null default public.current_business_id()
);

create table public.categories (
  key text not null,
  name text not null,
  type text not null,
  counts_in_profit boolean not null,
  created_at timestamptz not null default now(),
  business_id uuid not null default public.current_business_id(),
  is_sales boolean not null default false
);

create table public.payment_methods (
  name text not null,
  business_id uuid not null default public.current_business_id()
);

create table public.transactions (
  id bigint generated by default as identity,
  created_at timestamptz not null default now(),
  transaction_date date not null,
  type text not null,
  category text not null,
  amount numeric not null,
  description text,
  payment_method text not null,
  reference_no text,
  created_by uuid not null default auth.uid(),
  outlet_id uuid not null,
  business_id uuid not null default public.current_business_id(),
  receipt_path text
);

create table public.transaction_audit (
  id bigint generated always as identity,
  business_id uuid not null,
  outlet_id uuid not null,
  transaction_id bigint not null,
  action text not null,
  old_data jsonb not null,
  new_data jsonb,
  note text,
  changed_by uuid,
  changed_by_email text,
  changed_by_role text,
  changed_at timestamptz not null default now()
);

create table public.employees (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null default public.current_business_id(),
  outlet_id uuid not null,
  name text not null,
  position text,
  phone text,
  pay_type text not null,
  rate numeric(12,2) not null,
  ot_rate numeric(12,2) not null default 0,
  is_manager boolean not null default false,
  user_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null default public.current_business_id(),
  employee_id uuid not null,
  work_date date not null,
  status text not null,
  ot_hours numeric(5,2) not null default 0,
  note text,
  marked_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.payroll (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null default public.current_business_id(),
  employee_id uuid not null,
  period_start date not null,
  period_end date not null,
  pay_type text not null,
  rate numeric(12,2) not null,
  days_worked numeric(6,1) not null default 0,
  ot_hours numeric(7,2) not null default 0,
  ot_rate numeric(12,2) not null default 0,
  base_amount numeric(12,2) not null,
  ot_amount numeric(12,2) not null default 0,
  allowance numeric(12,2) not null default 0,
  deduction numeric(12,2) not null default 0,
  status text not null default 'draf',
  paid_at timestamptz,
  transaction_id bigint,
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  advance_deduction numeric(12,2) not null default 0,
  net_amount numeric(12,2) generated always as (greatest(base_amount + ot_amount + allowance - deduction - advance_deduction, 0)) stored
);

create table public.salary_advances (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null default public.current_business_id(),
  employee_id uuid not null,
  amount numeric(12,2) not null,
  advance_date date not null default ((now() at time zone 'Asia/Kuala_Lumpur'))::date,
  payment_method text,
  note text,
  transaction_id bigint,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid not null default gen_random_uuid(),
  outlet_id uuid not null,
  name text not null,
  unit text not null default 'pcs',
  current_qty numeric(12,2) not null default 0,
  min_qty numeric(12,2) not null default 0,
  target_qty numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  business_id uuid not null default public.current_business_id(),
  created_at timestamptz not null default now(),
  category text
);

create table public.inventory_stock_logs (
  id uuid not null default gen_random_uuid(),
  inventory_item_id uuid not null,
  outlet_id uuid not null,
  previous_qty numeric not null,
  new_qty numeric not null,
  change_qty numeric generated always as (new_qty - previous_qty) stored,
  change_type text not null,
  note text,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  business_id uuid not null default public.current_business_id()
);

create table public.ingredient_costs (
  inventory_item_id uuid not null,
  business_id uuid not null default public.current_business_id(),
  outlet_id uuid not null,
  unit_price numeric(12,4) not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.menu_items (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null default public.current_business_id(),
  outlet_id uuid not null,
  name text not null,
  selling_price numeric(12,2) not null default 0,
  portions numeric(12,3) not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_ingredients (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null default public.current_business_id(),
  menu_item_id uuid not null,
  inventory_item_id uuid,
  outlet_id uuid not null,
  qty numeric(12,4) not null,
  sub_menu_id uuid
);

-- ---------------------------------------------------------------------
-- 3. Kunci utama, unik & semakan
-- ---------------------------------------------------------------------
alter table public.businesses add constraint businesses_pkey primary key (id);
alter table public.businesses add constraint businesses_name_check check (length(trim(both from name)) > 0);
alter table public.businesses add constraint businesses_plan_check check (plan = any (array['free', 'pro', 'business']));

alter table public.outlets add constraint outlets_pkey primary key (id);
alter table public.outlets add constraint outlets_business_id_key unique (business_id, id);
alter table public.outlets add constraint outlets_business_name_key unique (business_id, name);

alter table public.staff_profiles add constraint staff_profiles_pkey primary key (user_id);
alter table public.staff_profiles add constraint staff_profiles_role_check check (role = any (array['staff', 'manager', 'admin', 'owner']));

alter table public.categories add constraint categories_pkey primary key (business_id, key);
alter table public.categories add constraint categories_business_name_key unique (business_id, name);
alter table public.categories add constraint categories_business_name_type_key unique (business_id, name, type);
alter table public.categories add constraint categories_type_check check (type = any (array['In', 'Out']));

alter table public.payment_methods add constraint payment_methods_pkey primary key (business_id, name);

alter table public.transactions add constraint transactions_pkey primary key (id);
alter table public.transactions add constraint transactions_amount_positive check (amount > 0);

alter table public.transaction_audit add constraint transaction_audit_pkey primary key (id);
alter table public.transaction_audit add constraint transaction_audit_action_check check (action = any (array['ubah', 'padam']));

alter table public.employees add constraint employees_pkey primary key (id);
alter table public.employees add constraint employees_business_id_key unique (business_id, id);
alter table public.employees add constraint employees_name_check check (length(trim(both from name)) > 0);
alter table public.employees add constraint employees_ot_rate_check check (ot_rate >= 0);
alter table public.employees add constraint employees_rate_check check (rate >= 0);
alter table public.employees add constraint employees_pay_type_check check (pay_type = any (array['harian', 'mingguan', 'bulanan']));

alter table public.attendance add constraint attendance_pkey primary key (id);
alter table public.attendance add constraint attendance_employee_day_key unique (employee_id, work_date);
alter table public.attendance add constraint attendance_ot_hours_check check (ot_hours >= 0 and ot_hours <= 24);
alter table public.attendance add constraint attendance_status_check check (status = any (array['hadir', 'separuh', 'cuti', 'tidak_hadir']));

alter table public.payroll add constraint payroll_pkey primary key (id);
alter table public.payroll add constraint payroll_employee_period_key unique (employee_id, period_start, period_end);
alter table public.payroll add constraint payroll_advance_deduction_check check (advance_deduction >= 0);
alter table public.payroll add constraint payroll_allowance_check check (allowance >= 0);
alter table public.payroll add constraint payroll_base_amount_check check (base_amount >= 0);
alter table public.payroll add constraint payroll_days_worked_check check (days_worked >= 0);
alter table public.payroll add constraint payroll_deduction_check check (deduction >= 0);
alter table public.payroll add constraint payroll_ot_amount_check check (ot_amount >= 0);
alter table public.payroll add constraint payroll_ot_hours_check check (ot_hours >= 0);
alter table public.payroll add constraint payroll_ot_rate_check check (ot_rate >= 0);
alter table public.payroll add constraint payroll_rate_check check (rate >= 0);
alter table public.payroll add constraint payroll_period_check check (period_end >= period_start);
alter table public.payroll add constraint payroll_pay_type_check check (pay_type = any (array['harian', 'mingguan', 'bulanan']));
alter table public.payroll add constraint payroll_status_check check (status = any (array['draf', 'dibayar']));

alter table public.salary_advances add constraint salary_advances_pkey primary key (id);
alter table public.salary_advances add constraint salary_advances_amount_check check (amount > 0);

alter table public.inventory_items add constraint inventory_items_pkey primary key (id);
alter table public.inventory_items add constraint inventory_items_business_id_key unique (business_id, id);
alter table public.inventory_items add constraint inventory_unique_item unique (outlet_id, name);
alter table public.inventory_items add constraint inventory_name_not_blank check (length(trim(both from name)) > 0);
alter table public.inventory_items add constraint inventory_qty_nonnegative check (current_qty >= 0 and min_qty >= 0 and target_qty >= 0);
alter table public.inventory_items add constraint inventory_target_valid check (target_qty >= min_qty);

alter table public.inventory_stock_logs add constraint inventory_stock_logs_pkey primary key (id);
alter table public.inventory_stock_logs add constraint inventory_stock_logs_change_type_check check (change_type = any (array['stock_in', 'physical_count', 'adjustment']));
alter table public.inventory_stock_logs add constraint inventory_stock_logs_new_qty_check check (new_qty >= 0);
alter table public.inventory_stock_logs add constraint inventory_stock_logs_previous_qty_check check (previous_qty >= 0);

alter table public.ingredient_costs add constraint ingredient_costs_pkey primary key (inventory_item_id);
alter table public.ingredient_costs add constraint ingredient_costs_unit_price_check check (unit_price >= 0);

alter table public.menu_items add constraint menu_items_pkey primary key (id);
alter table public.menu_items add constraint menu_items_business_id_key unique (business_id, id);
alter table public.menu_items add constraint menu_items_unique_name unique (outlet_id, name);
alter table public.menu_items add constraint menu_items_name_check check (length(btrim(name)) >= 1 and length(btrim(name)) <= 120);
alter table public.menu_items add constraint menu_items_portions_check check (portions > 0);
alter table public.menu_items add constraint menu_items_selling_price_check check (selling_price >= 0);

alter table public.menu_ingredients add constraint menu_ingredients_pkey primary key (id);
alter table public.menu_ingredients add constraint menu_ingredients_unique unique (menu_item_id, inventory_item_id);
alter table public.menu_ingredients add constraint menu_ingredients_unique_sub unique (menu_item_id, sub_menu_id);
alter table public.menu_ingredients add constraint menu_ingredients_one_source check ((inventory_item_id is null) <> (sub_menu_id is null));
alter table public.menu_ingredients add constraint menu_ingredients_qty_check check (qty > 0);

-- ---------------------------------------------------------------------
-- 4. Kunci asing
-- ---------------------------------------------------------------------
alter table public.outlets add constraint outlets_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.staff_profiles add constraint staff_profiles_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.staff_profiles add constraint staff_profiles_outlet_id_fkey foreign key (business_id, outlet_id) references public.outlets(business_id, id);
alter table public.staff_profiles add constraint staff_profiles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.categories add constraint categories_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.payment_methods add constraint payment_methods_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.transactions add constraint transactions_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.transactions add constraint transactions_category_type_fk foreign key (business_id, category, type) references public.categories(business_id, name, type);
alter table public.transactions add constraint transactions_outlet_fk foreign key (business_id, outlet_id) references public.outlets(business_id, id);
alter table public.transactions add constraint transactions_payment_method_fk foreign key (business_id, payment_method) references public.payment_methods(business_id, name);
alter table public.transactions add constraint transactions_staff_fk foreign key (created_by) references auth.users(id);

alter table public.transaction_audit add constraint transaction_audit_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.employees add constraint employees_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.employees add constraint employees_outlet_fk foreign key (business_id, outlet_id) references public.outlets(business_id, id);
alter table public.employees add constraint employees_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

alter table public.attendance add constraint attendance_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.attendance add constraint attendance_employee_fk foreign key (business_id, employee_id) references public.employees(business_id, id) on delete cascade;
alter table public.attendance add constraint attendance_marked_by_fkey foreign key (marked_by) references auth.users(id);

alter table public.payroll add constraint payroll_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.payroll add constraint payroll_created_by_fkey foreign key (created_by) references auth.users(id);
alter table public.payroll add constraint payroll_employee_fk foreign key (business_id, employee_id) references public.employees(business_id, id);
alter table public.payroll add constraint payroll_transaction_id_fkey foreign key (transaction_id) references public.transactions(id);

alter table public.salary_advances add constraint salary_advances_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.salary_advances add constraint salary_advances_created_by_fkey foreign key (created_by) references auth.users(id);
alter table public.salary_advances add constraint salary_advances_employee_fk foreign key (business_id, employee_id) references public.employees(business_id, id);
alter table public.salary_advances add constraint salary_advances_transaction_id_fkey foreign key (transaction_id) references public.transactions(id);

alter table public.inventory_items add constraint inventory_items_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.inventory_items add constraint inventory_items_outlet_id_fkey foreign key (business_id, outlet_id) references public.outlets(business_id, id);

alter table public.inventory_stock_logs add constraint inventory_stock_logs_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.inventory_stock_logs add constraint inventory_stock_logs_changed_by_fkey foreign key (changed_by) references auth.users(id) on delete restrict;
alter table public.inventory_stock_logs add constraint inventory_stock_logs_inventory_item_id_fke foreign key (business_id, inventory_item_id) references public.inventory_items(business_id, id) on delete restrict;
alter table public.inventory_stock_logs add constraint inventory_stock_logs_outlet_id_fkey foreign key (business_id, outlet_id) references public.outlets(business_id, id) on delete restrict;

alter table public.ingredient_costs add constraint ingredient_costs_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.ingredient_costs add constraint ingredient_costs_item_fk foreign key (business_id, inventory_item_id) references public.inventory_items(business_id, id) on delete cascade;

alter table public.menu_items add constraint menu_items_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.menu_items add constraint menu_items_outlet_fk foreign key (business_id, outlet_id) references public.outlets(business_id, id);

alter table public.menu_ingredients add constraint menu_ingredients_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.menu_ingredients add constraint menu_ingredients_item_fk foreign key (business_id, inventory_item_id) references public.inventory_items(business_id, id) on delete cascade;
alter table public.menu_ingredients add constraint menu_ingredients_menu_fk foreign key (business_id, menu_item_id) references public.menu_items(business_id, id) on delete cascade;
alter table public.menu_ingredients add constraint menu_ingredients_sub_fk foreign key (business_id, sub_menu_id) references public.menu_items(business_id, id) on delete restrict;

-- ---------------------------------------------------------------------
-- 5. Index
-- ---------------------------------------------------------------------
create index idx_attendance_business_date on public.attendance using btree (business_id, work_date);
create index idx_employees_business_outlet on public.employees using btree (business_id, outlet_id);
create index idx_ingredient_costs_outlet on public.ingredient_costs using btree (business_id, outlet_id);
create index idx_inventory_items_outlet on public.inventory_items using btree (outlet_id);
create index idx_inventory_logs_item on public.inventory_stock_logs using btree (inventory_item_id);
create index idx_inventory_logs_outlet_date on public.inventory_stock_logs using btree (outlet_id, created_at desc);
create index idx_menu_ingredients_item on public.menu_ingredients using btree (business_id, inventory_item_id);
create index idx_menu_ingredients_menu on public.menu_ingredients using btree (menu_item_id);
create index idx_menu_ingredients_sub on public.menu_ingredients using btree (business_id, sub_menu_id);
create index idx_menu_items_outlet on public.menu_items using btree (business_id, outlet_id);
create index idx_salary_advances_employee on public.salary_advances using btree (employee_id);
create index idx_staff_profiles_business on public.staff_profiles using btree (business_id);
create index idx_transaction_audit_outlet on public.transaction_audit using btree (business_id, outlet_id, changed_at desc);
create index idx_transactions_business_date on public.transactions using btree (business_id, transaction_date);
create index idx_transactions_receipt_path on public.transactions using btree (receipt_path) where receipt_path is not null;
create unique index inventory_items_outlet_name_uniq on public.inventory_items using btree (outlet_id, lower(trim(both from name)));

-- ---------------------------------------------------------------------
-- 6. View (security_invoker: RLS pengguna yang login tetap terpakai)
-- ---------------------------------------------------------------------
create view public.daily_summary with (security_invoker = true) as
select t.outlet_id,
       o.name as outlet_name,
       t.transaction_date,
       coalesce(sum(t.amount) filter (where t.type = 'In' and c.counts_in_profit), 0) as money_in,
       coalesce(sum(t.amount) filter (where t.type = 'Out' and c.counts_in_profit), 0) as money_out,
       coalesce(sum(t.amount) filter (where t.type = 'In' and c.counts_in_profit), 0)
         - coalesce(sum(t.amount) filter (where t.type = 'Out' and c.counts_in_profit), 0) as profit,
       count(*) as bil_transaksi,
       coalesce(sum(t.amount) filter (where t.type = 'In' and c.is_sales), 0) as sales
from public.transactions t
join public.categories c on c.business_id = t.business_id and c.name = t.category and c.type = t.type
join public.outlets o on o.business_id = t.business_id and o.id = t.outlet_id
where exists (select 1 from public.staff_profiles sp
              where sp.user_id = (select auth.uid()) and sp.role = any (array['owner', 'admin', 'manager']))
group by t.outlet_id, o.name, t.transaction_date;

create view public.daily_food_cost with (security_invoker = true) as
select t.outlet_id,
       t.transaction_date,
       sum(t.amount) as ingredients
from public.transactions t
join public.categories c on c.business_id = t.business_id and c.name = t.category and c.type = t.type
where t.type = 'Out' and c.key = 'OUT01'
  and exists (select 1 from public.staff_profiles sp
              where sp.user_id = (select auth.uid()) and sp.role = any (array['owner', 'admin']))
  and (select public.current_plan()) <> 'free'
group by t.outlet_id, t.transaction_date;

-- ---------------------------------------------------------------------
-- 7. Trigger
-- ---------------------------------------------------------------------
create trigger trg_attendance_touch before insert or update on public.attendance for each row execute function public.attendance_touch();
create trigger trg_ingredient_costs_fill before insert or update on public.ingredient_costs for each row execute function public.ingredient_costs_fill();
create trigger trg_inventory_audit_v1 after insert or update on public.inventory_items for each row execute function public.inventory_audit_v1();
create trigger trg_inventory_validate_v1 before insert or delete or update on public.inventory_items for each row execute function public.inventory_validate_v1();
create trigger trg_menu_ingredients_fill before insert or update on public.menu_ingredients for each row execute function public.menu_ingredients_fill();
create trigger trg_menu_items_guard before insert or update on public.menu_items for each row execute function public.menu_items_guard();
create trigger trg_outlets_plan_limit before insert on public.outlets for each row execute function public.outlets_plan_limit();
create trigger trg_staff_plan_limit before insert or update of role, business_id on public.staff_profiles for each row execute function public.staff_plan_limit();
create trigger trg_transactions_guard before delete or update on public.transactions for each row execute function public.transactions_guard();
create trigger trg_transactions_receipt_guard before insert or update of receipt_path on public.transactions for each row execute function public.transactions_receipt_guard();

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
alter table public.attendance enable row level security;
alter table public.businesses enable row level security;
alter table public.categories enable row level security;
alter table public.employees enable row level security;
alter table public.ingredient_costs enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_stock_logs enable row level security;
alter table public.menu_ingredients enable row level security;
alter table public.menu_items enable row level security;
alter table public.outlets enable row level security;
alter table public.payment_methods enable row level security;
alter table public.payroll enable row level security;
alter table public.salary_advances enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.transaction_audit enable row level security;
alter table public.transactions enable row level security;

-- Pengasingan syarikat (RESTRICTIVE: wajib lulus sebagai tambahan policy lain)
do $$
declare t text;
begin
  foreach t in array array['attendance','categories','employees','ingredient_costs','inventory_items',
    'inventory_stock_logs','menu_ingredients','menu_items','outlets','payment_methods','payroll',
    'salary_advances','staff_profiles','transaction_audit','transactions'] loop
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated
      using (business_id = (select public.current_business_id()))
      with check (business_id = (select public.current_business_id()))', t);
  end loop;
end $$;

-- Pakej Pro (RESTRICTIVE: tambah/ubah/padam disekat untuk pakej Free)
do $$
declare t text;
begin
  foreach t in array array['ingredient_costs','menu_ingredients','menu_items','payroll'] loop
    execute format('create policy "pakej pro: tambah" on public.%I as restrictive for insert to authenticated
      with check ((select public.current_plan()) <> ''free'')', t);
    execute format('create policy "pakej pro: ubah" on public.%I as restrictive for update to authenticated
      using ((select public.current_plan()) <> ''free'') with check ((select public.current_plan()) <> ''free'')', t);
    execute format('create policy "pakej pro: padam" on public.%I as restrictive for delete to authenticated
      using ((select public.current_plan()) <> ''free'')', t);
  end loop;
end $$;

-- attendance
create policy "urus kehadiran" on public.attendance as permissive for all to authenticated
  using ((select public.can_manage_employee(attendance.employee_id)))
  with check ((select public.can_manage_employee(attendance.employee_id)));

-- businesses
create policy "baca syarikat sendiri" on public.businesses as permissive for select to authenticated
  using (id = (select public.current_business_id()));

-- categories & payment_methods
create policy "login baca kategori" on public.categories as permissive for select to authenticated using (true);
create policy "login baca payment method" on public.payment_methods as permissive for select to authenticated using (true);

-- employees
create policy "urus pekerja" on public.employees as permissive for all to authenticated
  using (exists (select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and (sp.role = 'owner'
           or (sp.role = 'admin' and sp.outlet_id = employees.outlet_id)
           or (sp.role = 'manager' and sp.outlet_id = employees.outlet_id and not employees.is_manager))))
  with check (exists (select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and (sp.role = 'owner'
           or (sp.role = 'admin' and sp.outlet_id = employees.outlet_id)
           or (sp.role = 'manager' and sp.outlet_id = employees.outlet_id and not employees.is_manager))));

-- ingredient_costs, menu_items, menu_ingredients
create policy "owner admin urus harga bahan" on public.ingredient_costs as permissive for all to authenticated
  using ((select public.can_admin_outlet(ingredient_costs.outlet_id)))
  with check ((select public.can_admin_outlet(ingredient_costs.outlet_id)));
create policy "owner admin urus menu" on public.menu_items as permissive for all to authenticated
  using ((select public.can_admin_outlet(menu_items.outlet_id)))
  with check ((select public.can_admin_outlet(menu_items.outlet_id)));
create policy "owner admin urus resipi" on public.menu_ingredients as permissive for all to authenticated
  using ((select public.can_admin_outlet(menu_ingredients.outlet_id)))
  with check ((select public.can_admin_outlet(menu_ingredients.outlet_id)));

-- inventory_items
create policy inventory_admin_delete on public.inventory_items as permissive for delete to authenticated
  using ((select public.can_admin_outlet(inventory_items.outlet_id)));
create policy inventory_outlet_insert on public.inventory_items as permissive for insert to authenticated
  with check (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid()) and sp.outlet_id = inventory_items.outlet_id));
create policy inventory_outlet_read on public.inventory_items as permissive for select to authenticated
  using (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid()) and sp.outlet_id = inventory_items.outlet_id));
create policy inventory_outlet_update on public.inventory_items as permissive for update to authenticated
  using (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid()) and sp.outlet_id = inventory_items.outlet_id))
  with check (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid()) and sp.outlet_id = inventory_items.outlet_id));
create policy inventory_owner_delete on public.inventory_items as permissive for delete to authenticated using ((select public.is_owner()));
create policy inventory_owner_insert on public.inventory_items as permissive for insert to authenticated with check ((select public.is_owner()));
create policy inventory_owner_update on public.inventory_items as permissive for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy inventory_read_access on public.inventory_items as permissive for select to authenticated
  using (exists (select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and (sp.role = 'owner' or (sp.role = any (array['manager', 'admin']) and sp.outlet_id = inventory_items.outlet_id))));

-- inventory_stock_logs
create policy inventory_logs_read_access on public.inventory_stock_logs as permissive for select to authenticated
  using (exists (select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and (sp.role = 'owner' or (sp.role = any (array['manager', 'admin']) and sp.outlet_id = inventory_stock_logs.outlet_id))));

-- outlets
create policy "baca outlet sendiri" on public.outlets as permissive for select to authenticated
  using (id in (select staff_profiles.outlet_id from public.staff_profiles where staff_profiles.user_id = (select auth.uid())));
create policy "owner baca semua outlet" on public.outlets as permissive for select to authenticated using ((select public.is_owner()));
create policy "owner kemas kini outlet" on public.outlets as permissive for update to authenticated
  using ((select public.can_admin_outlet(outlets.id))) with check ((select public.can_admin_outlet(outlets.id)));
create policy "owner tambah outlet" on public.outlets as permissive for insert to authenticated
  with check ((select public.is_owner()) and length(btrim(name)) >= 1 and length(btrim(name)) <= 80);

-- payroll
create policy "baca gaji" on public.payroll as permissive for select to authenticated
  using ((select public.can_manage_employee(payroll.employee_id)));
create policy "tambah gaji" on public.payroll as permissive for insert to authenticated
  with check ((select public.can_manage_employee(payroll.employee_id)) and status = 'draf');
create policy "ubah gaji draf sahaja" on public.payroll as permissive for update to authenticated
  using ((select public.can_manage_employee(payroll.employee_id)) and status = 'draf')
  with check ((select public.can_manage_employee(payroll.employee_id)));
create policy "padam gaji draf sahaja" on public.payroll as permissive for delete to authenticated
  using ((select public.can_manage_employee(payroll.employee_id)) and status = 'draf');

-- salary_advances
create policy "baca advance" on public.salary_advances as permissive for select to authenticated
  using ((select public.can_manage_employee(salary_advances.employee_id)));

-- staff_profiles
create policy "admin baca profile outlet" on public.staff_profiles as permissive for select to authenticated
  using ((select public.can_admin_outlet(staff_profiles.outlet_id)));
create policy "baca profile sendiri" on public.staff_profiles as permissive for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owner baca semua profile" on public.staff_profiles as permissive for select to authenticated
  using ((select public.is_owner()));

-- transaction_audit
create policy "owner admin baca log audit" on public.transaction_audit as permissive for select to authenticated
  using ((select public.can_admin_outlet(transaction_audit.outlet_id)));

-- transactions
create policy "baca transaksi sendiri hari ini" on public.transactions as permissive for select to authenticated
  using (created_by = (select auth.uid())
         and (created_at at time zone 'Asia/Kuala_Lumpur')::date = (now() at time zone 'Asia/Kuala_Lumpur')::date);
create policy "manager baca transaksi outlet sendiri" on public.transactions as permissive for select to authenticated
  using (exists (select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid()) and sp.role = any (array['manager', 'admin']) and sp.outlet_id = transactions.outlet_id));
create policy "owner admin padam transaksi" on public.transactions as permissive for delete to authenticated
  using ((select public.can_admin_outlet(transactions.outlet_id)));
create policy "owner admin ubah transaksi" on public.transactions as permissive for update to authenticated
  using ((select public.can_admin_outlet(transactions.outlet_id))) with check ((select public.can_admin_outlet(transactions.outlet_id)));
create policy "owner baca semua transaksi" on public.transactions as permissive for select to authenticated using ((select public.is_owner()));
create policy "owner tambah transaksi semua outlet" on public.transactions as permissive for insert to authenticated
  with check (created_by = (select auth.uid()) and (select public.is_owner()));
create policy "tambah transaksi outlet sendiri" on public.transactions as permissive for insert to authenticated
  with check (created_by = (select auth.uid())
              and outlet_id in (select staff_profiles.outlet_id from public.staff_profiles where staff_profiles.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------
-- 9. Kebenaran (sama seperti production)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete, references, trigger, truncate on
  public.attendance, public.categories, public.employees, public.inventory_items,
  public.payment_methods, public.payroll, public.staff_profiles, public.transactions,
  public.daily_summary, public.daily_food_cost to authenticated;
grant select, insert, update, delete on public.ingredient_costs, public.menu_ingredients, public.menu_items to authenticated;
grant select, insert, delete, references, trigger, truncate on public.outlets to authenticated;   -- UPDATE tiada (sama seperti production)
grant select on public.businesses, public.inventory_stock_logs, public.salary_advances, public.transaction_audit to authenticated;

-- anon: production masih ada grant ini (tiada kesan kerana semua policy "to authenticated"
-- dan RLS aktif). Dikekalkan supaya staging = production. Lihat nota di README snapshot.
grant select, insert, update, delete, references, trigger, truncate on
  public.categories, public.inventory_items, public.outlets, public.payment_methods,
  public.staff_profiles, public.transactions to anon;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.advance_balance(uuid), public.can_admin_outlet(uuid), public.can_keyin_outlet(uuid),
  public.can_manage_employee(uuid), public.current_business_id(), public.current_plan(),
  public.give_advance(uuid, numeric, text, text), public.is_owner(),
  public.pay_payroll(uuid, text), public.plan_limits(text), public.receipt_in_use(text),
  public.save_menu(uuid, uuid, text, numeric, numeric, jsonb) to authenticated;
grant execute on function public.attendance_touch(), public.outlets_plan_limit(), public.staff_plan_limit() to public;

-- ---------------------------------------------------------------------
-- 10. Storage: gambar resit (Fasa 13)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy "resit: muat naik" on storage.objects as permissive for insert to authenticated
  with check (bucket_id = 'receipts'
    and (storage.foldername(name))[1] = ((select public.current_business_id()))::text
    and (select public.can_keyin_outlet(((storage.foldername(objects.name))[2])::uuid))
    and (select public.current_plan()) <> 'free');
create policy "resit: padam" on storage.objects as permissive for delete to authenticated
  using (bucket_id = 'receipts'
    and (storage.foldername(name))[1] = ((select public.current_business_id()))::text
    and ((select public.can_admin_outlet(((storage.foldername(objects.name))[2])::uuid))
         or (owner_id = ((select auth.uid()))::text and not public.receipt_in_use(name))));
create policy "resit: tengok" on storage.objects as permissive for select to authenticated
  using (bucket_id = 'receipts'
    and (storage.foldername(name))[1] = ((select public.current_business_id()))::text
    and exists (select 1 from public.transactions t where t.receipt_path = objects.name));

commit;
