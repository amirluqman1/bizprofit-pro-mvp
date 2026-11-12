-- =====================================================================
-- BizProfit Pro · Fasa 3: Penanda kategori "Jualan" untuk halaman Utama
-- Tiada data dipadam. Ringkasan harian dapat kolum baru "sales".
-- =====================================================================
begin;

-- Kategori mana dikira "Jualan" (setiap syarikat tentukan sendiri)
alter table public.categories add column is_sales boolean not null default false;
update public.categories set is_sales = true
 where type = 'In' and name in ('Shop Sales', 'Orders & Catering', 'Wholesale / Frozen Roti');

-- Jualan = duit masuk dari kategori jualan sahaja (tak termasuk Other Income, duit owner, pinjaman)
create or replace view public.daily_summary with (security_invoker = true) as
 select t.outlet_id, o.name as outlet_name, t.transaction_date,
    coalesce(sum(t.amount) filter (where t.type = 'In'  and c.counts_in_profit), 0::numeric) as money_in,
    coalesce(sum(t.amount) filter (where t.type = 'Out' and c.counts_in_profit), 0::numeric) as money_out,
    coalesce(sum(t.amount) filter (where t.type = 'In'  and c.counts_in_profit), 0::numeric)
  - coalesce(sum(t.amount) filter (where t.type = 'Out' and c.counts_in_profit), 0::numeric) as profit,
    count(*) as bil_transaksi,
    coalesce(sum(t.amount) filter (where t.type = 'In' and c.is_sales), 0::numeric) as sales
   from public.transactions t
   join public.categories c on c.business_id = t.business_id and c.name = t.category and c.type = t.type
   join public.outlets o on o.business_id = t.business_id and o.id = t.outlet_id
  where exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid()) and sp.role in ('owner', 'manager')
  )
  group by t.outlet_id, o.name, t.transaction_date;

commit;
