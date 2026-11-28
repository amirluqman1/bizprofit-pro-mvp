-- =====================================================================
-- BizProfit Pro · Fasa 24: Hari mula minggu (setiap outlet)
-- Sebelum ini minggu di app dikunci Isnin–Ahad. Kedai yang bayar gaji
-- mingguan pada hari lain (contoh Jumaat) tersalah kira. Sekarang setiap
-- outlet pilih hari mula minggu: 0 = Ahad, 1 = Isnin (lalai), ... 6 = Sabtu
-- (sama dengan getUTCDay() di JavaScript).
--
-- Apa berubah:
--   * Kolum baru outlets.week_start (smallint, lalai 1, hanya 0–6).
--   * Owner (semua outlet) dan admin (outlet sendiri) boleh ubah. Polisi
--     "owner kemas kini outlet" (Fasa 6/9) sudah menyekat ikut outlet dan
--     syarikat; di sini hanya tambah kebenaran kolum.
--   * Manager/staff TIDAK boleh ubah (tiada polisi untuk mereka).
--
-- Tiada kesan pada kiraan gaji: DB kira ikut hari yang app hantar
-- (payroll_calc / payroll_days). Satu hari tetap tak boleh dibayar dua kali
-- walaupun sempadan minggu bertukar. Slip lama tidak berubah.
-- Semua outlet sedia ada kekal Isnin–Ahad (lalai 1).
-- =====================================================================
begin;

alter table public.outlets
  add column if not exists week_start smallint not null default 1;

alter table public.outlets
  drop constraint if exists outlets_week_start_check;
alter table public.outlets
  add constraint outlets_week_start_check check (week_start between 0 and 6);

-- Kebenaran kolum (tambahan kepada company_name, company_reg_no dari Fasa 6)
grant update (week_start) on public.outlets to authenticated;

commit;
