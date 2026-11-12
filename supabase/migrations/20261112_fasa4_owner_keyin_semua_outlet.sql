-- =====================================================================
-- BizProfit Pro · Fasa 4: Owner boleh key in transaksi untuk mana-mana outlet
-- (Sebelum ini owner hanya boleh key in untuk outlet dalam profilnya.)
-- Pengasingan syarikat (tenant_isolation) kekal: hanya outlet syarikat sendiri.
-- =====================================================================
begin;
create policy "owner tambah transaksi semua outlet" on public.transactions
  for insert to authenticated
  with check (created_by = (select auth.uid()) and (select public.is_owner()));
commit;
