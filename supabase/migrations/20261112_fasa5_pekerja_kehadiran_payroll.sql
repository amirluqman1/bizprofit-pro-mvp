-- =====================================================================
-- BizProfit Pro · Fasa 5: Pekerja, Kehadiran, Payroll
--   Owner   : semua pekerja syarikat
--   Manager : pekerja outlet sendiri yang BUKAN peringkat manager
--   Staff   : tiada akses
-- Slip gaji yang sudah dibayar dikunci; bayaran masuk sebagai "Staff Wages".
-- =====================================================================
begin;

-- 1. Pekerja (tidak semestinya ada akaun app)
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  outlet_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  position text,
  phone text,
  pay_type text not null check (pay_type in ('harian', 'bulanan')),
  rate numeric(12,2) not null check (rate >= 0),          -- RM sehari (harian) atau RM sebulan (bulanan)
  ot_rate numeric(12,2) not null default 0 check (ot_rate >= 0),   -- RM sejam
  is_manager boolean not null default false,               -- gaji hanya owner nampak
  user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint employees_business_id_key unique (business_id, id),
  constraint employees_outlet_fk foreign key (business_id, outlet_id) references public.outlets (business_id, id)
);
create index idx_employees_business_outlet on public.employees (business_id, outlet_id);

-- 2. Kehadiran: satu rekod sehari setiap pekerja
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  employee_id uuid not null,
  work_date date not null,
  status text not null check (status in ('hadir', 'separuh', 'cuti', 'tidak_hadir')),
  ot_hours numeric(5,2) not null default 0 check (ot_hours >= 0 and ot_hours <= 24),
  note text,
  marked_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint attendance_employee_day_key unique (employee_id, work_date),
  constraint attendance_employee_fk foreign key (business_id, employee_id) references public.employees (business_id, id) on delete cascade
);
create index idx_attendance_business_date on public.attendance (business_id, work_date);

-- 3. Slip gaji
create table public.payroll (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  employee_id uuid not null,
  period_start date not null,
  period_end date not null,
  pay_type text not null check (pay_type in ('harian', 'bulanan')),
  rate numeric(12,2) not null check (rate >= 0),
  days_worked numeric(6,1) not null default 0 check (days_worked >= 0),
  ot_hours numeric(7,2) not null default 0 check (ot_hours >= 0),
  ot_rate numeric(12,2) not null default 0 check (ot_rate >= 0),
  base_amount numeric(12,2) not null check (base_amount >= 0),
  ot_amount numeric(12,2) not null default 0 check (ot_amount >= 0),
  allowance numeric(12,2) not null default 0 check (allowance >= 0),
  deduction numeric(12,2) not null default 0 check (deduction >= 0),
  net_amount numeric(12,2) generated always as (greatest(base_amount + ot_amount + allowance - deduction, 0)) stored,
  status text not null default 'draf' check (status in ('draf', 'dibayar')),
  paid_at timestamptz,
  transaction_id bigint references public.transactions(id),
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint payroll_period_check check (period_end >= period_start),
  constraint payroll_employee_period_key unique (employee_id, period_start, period_end),
  constraint payroll_employee_fk foreign key (business_id, employee_id) references public.employees (business_id, id)
);

-- 4. Siapa boleh urus pekerja ini? (owner; atau manager outlet sama & pekerja bukan peringkat manager)
create function public.can_manage_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.employees e
    join public.staff_profiles sp on sp.user_id = (select auth.uid()) and sp.business_id = e.business_id
    where e.id = p_employee
      and (sp.role = 'owner'
           or (sp.role = 'manager' and sp.outlet_id = e.outlet_id and not e.is_manager))
  )
$$;
revoke execute on function public.can_manage_employee(uuid) from public, anon;
grant execute on function public.can_manage_employee(uuid) to authenticated;

-- 5. Kebenaran
alter table public.employees  enable row level security;
alter table public.attendance enable row level security;
alter table public.payroll    enable row level security;
revoke all on public.employees, public.attendance, public.payroll from anon;
grant select, insert, update on public.employees to authenticated;
grant select, insert, update, delete on public.attendance to authenticated;
grant select, insert, update, delete on public.payroll to authenticated;

create policy tenant_isolation on public.employees  as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.attendance as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy tenant_isolation on public.payroll    as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));

-- Pekerja: owner semua; manager outlet sendiri & bukan peringkat manager (juga untuk tambah/ubah)
create policy "urus pekerja" on public.employees for all to authenticated
  using (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())
    and (sp.role = 'owner' or (sp.role = 'manager' and sp.outlet_id = employees.outlet_id and not employees.is_manager))))
  with check (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())
    and (sp.role = 'owner' or (sp.role = 'manager' and sp.outlet_id = employees.outlet_id and not employees.is_manager))));

create policy "urus kehadiran" on public.attendance for all to authenticated
  using ((select public.can_manage_employee(employee_id)))
  with check ((select public.can_manage_employee(employee_id)));

create policy "baca gaji" on public.payroll for select to authenticated
  using ((select public.can_manage_employee(employee_id)));
create policy "tambah gaji" on public.payroll for insert to authenticated
  with check ((select public.can_manage_employee(employee_id)) and status = 'draf');
create policy "ubah gaji draf sahaja" on public.payroll for update to authenticated
  using ((select public.can_manage_employee(employee_id)) and status = 'draf')
  with check ((select public.can_manage_employee(employee_id)));
create policy "padam gaji draf sahaja" on public.payroll for delete to authenticated
  using ((select public.can_manage_employee(employee_id)) and status = 'draf');

-- 6. Kehadiran: catat siapa & bila (tidak boleh dipalsukan)
create function public.attendance_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.marked_by := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;
create trigger trg_attendance_touch before insert or update on public.attendance
  for each row execute function public.attendance_touch();

-- 7. Bayar gaji: masukkan transaksi "Staff Wages" dan kunci slip, dalam satu langkah
create function public.pay_payroll(p_payroll uuid, p_payment_method text)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  r public.payroll;
  emp public.employees;
  tx bigint;
begin
  select * into r from public.payroll where id = p_payroll for update;
  if not found then raise exception 'Slip gaji tidak dijumpai'; end if;
  if r.status <> 'draf' then raise exception 'Gaji ini sudah dibayar'; end if;
  if r.net_amount <= 0 then raise exception 'Jumlah gaji RM 0, tiada apa untuk dibayar'; end if;
  select * into emp from public.employees where id = r.employee_id;

  insert into public.transactions (transaction_date, type, category, amount, description, payment_method, outlet_id)
  values ((now() at time zone 'Asia/Kuala_Lumpur')::date, 'Out', 'Staff Wages', r.net_amount,
          format('Gaji %s (%s – %s)', emp.name, to_char(r.period_start, 'DD/MM'), to_char(r.period_end, 'DD/MM/YYYY')),
          p_payment_method, emp.outlet_id)
  returning id into tx;

  update public.payroll set status = 'dibayar', paid_at = now(), transaction_id = tx where id = p_payroll;
  return tx;
end $$;
revoke execute on function public.pay_payroll(uuid, text) from public, anon;
grant execute on function public.pay_payroll(uuid, text) to authenticated;

commit;
