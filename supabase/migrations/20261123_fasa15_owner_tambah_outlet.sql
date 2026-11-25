-- =====================================================================
-- BizProfit Pro · Fasa 15: Owner boleh tambah outlet dari app
-- Hanya OWNER, hanya dalam syarikat sendiri (policy tenant_isolation sedia ada),
-- nama tidak kosong. Had bilangan outlet ikut pakej sudah dikunci oleh
-- trigger trg_outlets_plan_limit (Fasa 12).
-- Sudah dijalankan di production pada 23 Nov 2026 (asalnya dinamakan fasa14 dalam PR #25;
-- nombor 14 dikhaskan untuk draf off day / elaun / advance ansuran).
-- =====================================================================
begin;

create policy "owner tambah outlet" on public.outlets for insert to authenticated
  with check ((select public.is_owner()) and length(btrim(name)) between 1 and 80);

commit;
