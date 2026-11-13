-- =====================================================================
-- BizProfit Pro · Fasa 6: Nama syarikat ikut outlet
-- Setiap outlet boleh berdaftar di bawah syarikat (Sdn Bhd / enterprise)
-- sendiri. Slip gaji guna nama syarikat outlet pekerja; jika kosong,
-- guna nama perniagaan utama.
-- Owner sahaja boleh ubah, dan hanya dua kolum ini.
-- =====================================================================
begin;
alter table public.outlets add column if not exists company_name text;
alter table public.outlets add column if not exists company_reg_no text;

create policy "owner kemas kini outlet" on public.outlets
  for update to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

revoke update on public.outlets from authenticated;
grant update (company_name, company_reg_no) on public.outlets to authenticated;
commit;
