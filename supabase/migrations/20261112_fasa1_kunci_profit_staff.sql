-- =====================================================================
-- BizProfit Pro · Fasa 1: Kunci profit daripada staff
--   Owner   : semua transaksi & ringkasan (dalam syarikat sendiri)
--   Manager : transaksi & ringkasan outlet sendiri sahaja
--   Staff   : boleh key in; nampak transaksi yang DIA SENDIRI masukkan
--             HARI INI sahaja (waktu Malaysia); tiada ringkasan/profit
-- Satu transaksi: kalau gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Policy baca outlet sendiri: kini untuk MANAGER sahaja
alter policy "baca transaksi outlet sendiri" on public.transactions
  rename to "manager baca transaksi outlet sendiri";
alter policy "manager baca transaksi outlet sendiri" on public.transactions
  using (exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and sp.role = 'manager'
      and sp.outlet_id = transactions.outlet_id
  ));

-- 2. Staff (dan sesiapa): transaksi yang dia sendiri masukkan hari ini
create policy "baca transaksi sendiri hari ini" on public.transactions
  for select to authenticated
  using (
    created_by = (select auth.uid())
    and (created_at at time zone 'Asia/Kuala_Lumpur')::date
        = (now() at time zone 'Asia/Kuala_Lumpur')::date
  );

-- 3. Ringkasan untung: kosong untuk staff walaupun ada transaksi sendiri
create or replace view public.daily_summary with (security_invoker = true) as
 select t.outlet_id, o.name as outlet_name, t.transaction_date,
    coalesce(sum(t.amount) filter (where t.type = 'In'  and c.counts_in_profit), 0::numeric) as money_in,
    coalesce(sum(t.amount) filter (where t.type = 'Out' and c.counts_in_profit), 0::numeric) as money_out,
    coalesce(sum(t.amount) filter (where t.type = 'In'  and c.counts_in_profit), 0::numeric)
  - coalesce(sum(t.amount) filter (where t.type = 'Out' and c.counts_in_profit), 0::numeric) as profit,
    count(*) as bil_transaksi
   from public.transactions t
   join public.categories c on c.business_id = t.business_id and c.name = t.category and c.type = t.type
   join public.outlets o on o.business_id = t.business_id and o.id = t.outlet_id
  where exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid()) and sp.role in ('owner', 'manager')
  )
  group by t.outlet_id, o.name, t.transaction_date;

commit;
