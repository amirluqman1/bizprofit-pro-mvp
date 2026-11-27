-- =====================================================================
-- BizProfit Pro · Fasa 18: Potongan tidak hadir + satu hari tak boleh dibayar dua kali
--
-- BAHAGIAN A: Peraturan potongan tidak hadir (gaji mingguan & bulanan)
-- Apa berubah:
--   1. Setiap pekerja (gaji mingguan/bulanan) ada peraturan bila tidak hadir:
--        'penuh'  : bayar penuh, tiada potongan automatik (sama seperti sebelum ini)
--        'sehari' : potong gaji sehari setiap hari tidak hadir.
--                   Gaji sehari = gaji ÷ absent_workdays (hari bekerja sebulan/seminggu,
--                   cth. 26 untuk bulanan, 6 untuk mingguan). Pemilik pilih nombornya.
--        'tetap'  : potong RM tetap setiap hari tidak hadir (absent_amount), cth. kedai
--                   yang potong lebih dari gaji sehari.
--      Upah harian tidak terlibat: hari tidak hadir memang tidak dibayar.
--   2. Slip gaji simpan bilangan hari tidak hadir (absent_days) dan jumlah potongan
--      (absent_deduction) secara berasingan, supaya slip jelas dan boleh disemak.
--      net_amount dikira semula: asas + OT + elaun − potongan − potongan tidak hadir − advance.
--   3. pay_payroll(): gaji kasar ambil kira potongan tidak hadir sebelum tolak advance.
--
-- Kiraan (dibuat di app, sama dengan kiraan elaun/potongan sedia ada):
--   Tidak hadir = 1 hari, separuh hari = 0.5 hari. Cuti dan hari tidak ditanda
--   TIDAK dipotong. Hari yang sudah dibayar dalam slip lain tidak dikira lagi.
--   Potongan tidak boleh menjadikan gaji kasar negatif (dihadkan kepada asas + OT + elaun − potongan).
--
-- BAHAGIAN B: Satu hari kerja tidak boleh dibayar dua kali (dikunci di database)
--   Sebelum ini hanya app yang elak bayar dua kali. Sekarang:
--   4. Table payroll_days: setiap hari yang sudah dibayar untuk seorang pekerja (satu baris
--      sehari). Kunci utama (employee_id, work_date): hari yang sama TIDAK boleh masuk dua kali,
--      walaupun dua orang tekan Bayar serentak dari dua phone.
--   5. payroll.open_days: bilangan hari dalam tempoh yang app anggap belum dibayar semasa kira
--      slip. Semasa bayar, database kira semula; kalau tak sama (ada hari dibayar oleh slip lain
--      selepas app kira), bayaran ditolak dan pengguna perlu muat semula. NULL = semua hari
--      dalam tempoh mesti belum dibayar (app versi lama).
--   6. Slip hanya boleh jadi 'dibayar' melalui pay_payroll() (sebelum ini UPDATE terus
--      status = 'dibayar' dibenarkan oleh policy, tanpa transaksi Staff Wages).
--   7. Padam transaksi gaji (Fasa 9) buka semula slip sebagai draf: hari-harinya dilepaskan.
--   Slip dibayar sedia ada diisi ke payroll_days ikut turutan bayar (data production: tiada
--   slip dibayar yang bertindih semasa migration ditulis).
--   Nota: jumlah ringgit slip masih dikira di app; yang dikunci di sini ialah HARI.
--
-- Siapa boleh buat apa:
--   payroll_days: baca ikut can_manage_employee() + tenant_isolation; tiada siapa boleh
--   tambah/ubah/padam terus (hanya melalui trigger semasa bayar / buka semula).
--   Selain itu tiada policy baru. Kolum baru pada employees ikut policy "urus pekerja"
--   (owner/admin semua; manager outlet sendiri & bukan peringkat pengurus).
--   Kolum baru pada payroll ikut policy gaji sedia ada (tambah/ubah draf sahaja,
--   perlu Pro/Business). Slip dibayar kekal dikunci.
--
-- Kes tepi:
--   - Pekerja sedia ada mendapat 'penuh' (tiada perubahan pada gaji mereka).
--   - Slip sedia ada mendapat absent_days = 0, absent_deduction = 0: net_amount tidak berubah.
--   - Padam transaksi gaji (Fasa 9) buka semula slip sebagai draf; potongan tidak hadir
--     dikira semula oleh app bila draf disimpan semula.
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Peraturan pada pekerja ----------------------------------------------
alter table public.employees
  add column absent_rule text not null default 'penuh' check (absent_rule in ('penuh', 'sehari', 'tetap')),
  add column absent_workdays smallint check (absent_workdays between 1 and 31),
  add column absent_amount numeric(12,2) check (absent_amount >= 0);
alter table public.employees add constraint employees_absent_rule_check check (
  (absent_rule <> 'sehari' or absent_workdays is not null)
  and (absent_rule <> 'tetap' or absent_amount is not null)
);

-- 2. Slip gaji: hari & potongan tidak hadir ---------------------------------
alter table public.payroll
  add column absent_days numeric(6,1) not null default 0 check (absent_days >= 0),
  add column absent_deduction numeric(12,2) not null default 0 check (absent_deduction >= 0);
alter table public.payroll drop column net_amount;
alter table public.payroll add column net_amount numeric(12,2)
  generated always as (greatest(base_amount + ot_amount + allowance - deduction - absent_deduction - advance_deduction, 0)) stored;

-- 3. Hari dibayar (BAHAGIAN B) ------------------------------------------------
alter table public.payroll add column open_days smallint check (open_days >= 0);

create table public.payroll_days (
  business_id uuid not null references public.businesses(id),
  employee_id uuid not null,
  work_date date not null,
  payroll_id uuid not null references public.payroll(id) on delete cascade,
  primary key (employee_id, work_date),
  constraint payroll_days_employee_fk foreign key (business_id, employee_id) references public.employees (business_id, id)
);
create index idx_payroll_days_payroll on public.payroll_days (payroll_id);
alter table public.payroll_days enable row level security;
revoke all on public.payroll_days from anon, authenticated;
grant select on public.payroll_days to authenticated;
create policy tenant_isolation on public.payroll_days as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy "baca hari dibayar" on public.payroll_days for select to authenticated
  using ((select public.can_manage_employee(employee_id)));

-- Isi slip dibayar sedia ada, ikut turutan bayar (hari yang dah diambil slip lebih awal dilangkau).
insert into public.payroll_days (business_id, employee_id, work_date, payroll_id)
select p.business_id, p.employee_id, d::date, p.id
from public.payroll p
cross join lateral generate_series(p.period_start, p.period_end, interval '1 day') d
where p.status = 'dibayar'
order by p.paid_at, p.created_at
on conflict do nothing;

-- Trigger: kunci hari semasa slip jadi 'dibayar'; lepaskan bila dibuka semula sebagai draf.
create function public.payroll_days_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  jumlah int := new.period_end - new.period_start + 1;
  terbuka int;
begin
  if old.status = 'draf' and new.status = 'dibayar' then
    if coalesce(current_setting('bizprofit.bayar', true), '') <> new.id::text then
      raise exception 'Slip gaji hanya boleh dibayar melalui butang Bayar';
    end if;
    select count(*) into terbuka
    from generate_series(new.period_start, new.period_end, interval '1 day') d
    where not exists (select 1 from public.payroll_days x where x.employee_id = new.employee_id and x.work_date = d::date);
    if terbuka = 0 or terbuka <> coalesce(new.open_days, jumlah) then
      raise exception 'Sebahagian hari dalam tempoh ini sudah dibayar dalam slip lain. Muat semula halaman Gaji dan cuba lagi.';
    end if;
    begin
      insert into public.payroll_days (business_id, employee_id, work_date, payroll_id)
      select new.business_id, new.employee_id, d::date, new.id
      from generate_series(new.period_start, new.period_end, interval '1 day') d
      where not exists (select 1 from public.payroll_days x where x.employee_id = new.employee_id and x.work_date = d::date);
    exception when unique_violation then
      raise exception 'Sebahagian hari dalam tempoh ini baru sahaja dibayar dari peranti lain. Muat semula halaman Gaji.';
    end;
  elsif old.status = 'dibayar' and new.status = 'draf' then
    delete from public.payroll_days where payroll_id = old.id;
  end if;
  return new;
end $$;
revoke execute on function public.payroll_days_sync() from public, anon, authenticated;
create trigger trg_payroll_days after update of status on public.payroll
  for each row execute function public.payroll_days_sync();

-- 4. Bayar gaji: tolak potongan tidak hadir sebelum advance ----------------
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

  gross := greatest(r.base_amount + r.ot_amount + r.allowance - r.deduction - r.absent_deduction, 0);
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

  perform set_config('bizprofit.bayar', p_payroll::text, true);   -- izin trigger: bayaran melalui fungsi ini
  update public.payroll set status = 'dibayar', paid_at = now(), transaction_id = tx where id = p_payroll;
  perform set_config('bizprofit.bayar', '', true);
  return tx;   -- null jika gaji ditampung sepenuhnya oleh advance
end $$;
revoke execute on function public.pay_payroll(uuid, text) from public, anon;
grant execute on function public.pay_payroll(uuid, text) to authenticated;

commit;
