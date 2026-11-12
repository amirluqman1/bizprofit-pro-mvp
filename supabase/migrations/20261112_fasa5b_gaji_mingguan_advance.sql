-- =====================================================================
-- BizProfit Pro · Fasa 5b: Gaji mingguan + Advance (gaji awal)
-- Advance direkod sebagai "Staff Wages" semasa diberi, dan ditolak
-- automatik semasa bayar gaji (baki lebihan dibawa ke gaji seterusnya).
-- Table gaji masih kosong semasa migration ini ditulis.
-- =====================================================================
begin;

-- 1. Jenis gaji: tambah 'mingguan'
alter table public.employees drop constraint employees_pay_type_check;
alter table public.employees add constraint employees_pay_type_check check (pay_type in ('harian', 'mingguan', 'bulanan'));
alter table public.payroll drop constraint payroll_pay_type_check;
alter table public.payroll add constraint payroll_pay_type_check check (pay_type in ('harian', 'mingguan', 'bulanan'));

-- 2. Slip gaji: kolum tolak advance; jumlah bersih dikira semula
alter table public.payroll drop column net_amount;
alter table public.payroll add column advance_deduction numeric(12,2) not null default 0 check (advance_deduction >= 0);
alter table public.payroll add column net_amount numeric(12,2)
  generated always as (greatest(base_amount + ot_amount + allowance - deduction - advance_deduction, 0)) stored;

-- 3. Advance (tidak boleh diubah/dipadam selepas diberi)
create table public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  employee_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  advance_date date not null default ((now() at time zone 'Asia/Kuala_Lumpur')::date),
  payment_method text,
  note text,
  transaction_id bigint references public.transactions(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint salary_advances_employee_fk foreign key (business_id, employee_id) references public.employees (business_id, id)
);
create index idx_salary_advances_employee on public.salary_advances (employee_id);
alter table public.salary_advances enable row level security;
revoke all on public.salary_advances from anon, authenticated;
grant select on public.salary_advances to authenticated;      -- tambah hanya melalui give_advance()
create policy tenant_isolation on public.salary_advances as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy "baca advance" on public.salary_advances for select to authenticated
  using ((select public.can_manage_employee(employee_id)));

-- 4. Baki advance belum ditolak = semua advance − yang sudah ditolak dalam gaji dibayar
create function public.advance_balance(p_employee uuid)
returns numeric language sql stable security invoker set search_path = '' as $$
  select coalesce((select sum(amount) from public.salary_advances where employee_id = p_employee), 0)
       - coalesce((select sum(advance_deduction) from public.payroll where employee_id = p_employee and status = 'dibayar'), 0)
$$;
revoke execute on function public.advance_balance(uuid) from public, anon;
grant execute on function public.advance_balance(uuid) to authenticated;

-- 5. Beri advance: rekod "Staff Wages" + advance dalam satu langkah
create function public.give_advance(p_employee uuid, p_amount numeric, p_payment_method text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  emp public.employees;
  tx bigint;
  adv uuid;
begin
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
revoke execute on function public.give_advance(uuid, numeric, text, text) from public, anon;
grant execute on function public.give_advance(uuid, numeric, text, text) to authenticated;

-- 6. Bayar gaji: tolak baki advance secara automatik
create or replace function public.pay_payroll(p_payroll uuid, p_payment_method text)
returns bigint language plpgsql security invoker set search_path = '' as $$
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
  return tx;   -- null jika gaji ditampung sepenuhnya oleh advance
end $$;

commit;
