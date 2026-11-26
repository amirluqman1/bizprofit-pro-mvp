-- =====================================================================
-- BizProfit Pro · Fasa 18: Peraturan potongan tidak hadir (gaji mingguan & bulanan)
--
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
-- Siapa boleh buat apa:
--   Tiada policy baru. Kolum baru pada employees ikut policy "urus pekerja"
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

-- 3. Bayar gaji: tolak potongan tidak hadir sebelum advance ----------------
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

  update public.payroll set status = 'dibayar', paid_at = now(), transaction_id = tx where id = p_payroll;
  return tx;   -- null jika gaji ditampung sepenuhnya oleh advance
end $$;
revoke execute on function public.pay_payroll(uuid, text) from public, anon;
grant execute on function public.pay_payroll(uuid, text) to authenticated;

commit;
