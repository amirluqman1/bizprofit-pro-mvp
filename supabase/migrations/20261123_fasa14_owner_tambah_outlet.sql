-- =====================================================================
-- BizProfit Pro · Fasa 14: Owner boleh tambah outlet dari app
-- Hanya OWNER, hanya dalam syarikat sendiri (policy tenant_isolation sedia ada),
-- nama tidak kosong. Had bilangan outlet ikut pakej sudah dikunci oleh
-- trigger trg_outlets_plan_limit (Fasa 12).
-- =====================================================================
begin;

create policy "owner tambah outlet" on public.outlets for insert to authenticated
  with check ((select public.is_owner()) and length(btrim(name)) between 1 and 80);

commit;
