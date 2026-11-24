-- =====================================================================
-- BizProfit Pro · Fasa 14: Pekerja lebih fleksibel
--
--   1. Status kehadiran baru "off" (hari rehat): tidak dikira hadir, tidak
--      dikira ponteng.
--   2. Elaun & potongan TETAP dalam profil pekerja (contoh elaun makan RM100,
--      potong sewa asrama RM150). Diisi automatik dalam slip gaji baru; masih
--      boleh diubah pada slip. Nota (label) disimpan pada slip juga.
--   3. Advance boleh dibayar balik secara ANSURAN: tetapan setiap pekerja
--      (contoh potong RM200 setiap kali gaji sampai semua advance habis).
--      Kosong = semua baki ditolak pada gaji seterusnya (macam dulu).
--
-- Data sedia ada tidak berubah: semua pekerja kekal "tolak penuh".
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Status "off" -----------------------------------------------------------
alter table public.attendance drop constraint attendance_status_check;
alter table public.attendance add constraint attendance_status_check
  check (status in ('hadir', 'separuh', 'cuti', 'tidak_hadir', 'off'));

-- 2. Elaun & potongan tetap ---------------------------------------------------
alter table public.employees
  add column default_allowance numeric(12,2) not null default 0 check (default_allowance >= 0),
  add column allowance_note text check (char_length(allowance_note) <= 60),
  add column default_deduction numeric(12,2) not null default 0 check (default_deduction >= 0),
  add column deduction_note text check (char_length(deduction_note) <= 60);

alter table public.payroll
  add column allowance_note text check (char_length(allowance_note) <= 60),
  add column deduction_note text check (char_length(deduction_note) <= 60);

-- 3. Ansuran advance (per pekerja) --------------------------------------------
alter table public.employees
  add column advance_installment numeric(12,2) check (advance_installment is null or advance_installment > 0);

-- Jumlah advance yang patut ditolak pada gaji seterusnya: semua baki, atau
-- ansuran pekerja itu jika ditetapkan (mana yang lebih kecil).
create function public.advance_due(p_employee uuid)
returns numeric language sql stable set search_path = '' as $$
  select case when e.advance_installment is null then greatest(public.advance_balance(p_employee), 0)
              else least(greatest(public.advance_balance(p_employee), 0), e.advance_installment) end
  from public.employees e where e.id = p_employee
$$;
revoke execute on function public.advance_due(uuid) from public, anon;
grant execute on function public.advance_due(uuid) to authenticated;

-- Bayar gaji: tolak advance ikut ansuran (dulu: semua baki sekali gus).
create or replace function public.pay_payroll(p_payroll uuid, p_payment_method text)
returns bigint language plpgsql set search_path = '' as $function$
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
  adv := least(greatest(public.advance_due(r.employee_id), 0), gross);
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
end $function$;

-- Beri advance: juga tetapkan ansuran pekerja (null = tolak penuh pada gaji seterusnya).
drop function public.give_advance(uuid, numeric, text, text);
create function public.give_advance(p_employee uuid, p_amount numeric, p_payment_method text,
                                    p_note text default null, p_installment numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  emp public.employees;
  tx bigint;
  adv uuid;
begin
  if public.current_plan() = 'free' then raise exception 'Advance gaji ialah ciri pakej Pro. Naik taraf untuk guna.'; end if;
  if not public.can_manage_employee(p_employee) then raise exception 'Tiada akses untuk pekerja ini'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Jumlah advance mesti lebih dari RM 0'; end if;
  if p_installment is not null and p_installment <= 0 then raise exception 'Ansuran mesti lebih dari RM 0'; end if;
  select * into emp from public.employees where id = p_employee;
  if not emp.active then raise exception 'Pekerja ini tidak aktif'; end if;

  insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method, outlet_id, created_by)
  values (emp.business_id, (now() at time zone 'Asia/Kuala_Lumpur')::date, 'Out', 'Staff Wages', round(p_amount, 2),
          'Advance gaji ' || emp.name || coalesce(' · ' || nullif(trim(p_note), ''), ''), p_payment_method, emp.outlet_id, auth.uid())
  returning id into tx;

  insert into public.salary_advances (business_id, employee_id, amount, payment_method, note, transaction_id, created_by)
  values (emp.business_id, p_employee, round(p_amount, 2), p_payment_method, nullif(trim(p_note), ''), tx, auth.uid())
  returning id into adv;
  update public.employees set advance_installment = round(p_installment, 2) where id = p_employee;
  return adv;
end $function$;
revoke execute on function public.give_advance(uuid, numeric, text, text, numeric) from public, anon;
grant execute on function public.give_advance(uuid, numeric, text, text, numeric) to authenticated;

commit;
