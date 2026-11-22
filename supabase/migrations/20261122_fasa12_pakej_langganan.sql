-- =====================================================================
-- BizProfit Pro · Fasa 12: Pakej langganan (freemium)
--
--   Percuma   : 1 outlet, 2 akaun staff (selain owner). Ciri harian percuma.
--   Pro       : RM15/bulan. 1 outlet, 10 akaun staff. Food cost, gaji & slip gaji.
--   Business  : RM80/bulan. Sampai 10 outlet, akaun staff tanpa had.
--   Syarikat baru: trial Pro 14 hari, kemudian turun ke Percuma secara automatik.
--
-- Prinsip: data TIDAK dipadam atau disorok bila turun pakej. Rekod gaji, menu
-- dan harga bahan lama masih boleh dibaca; cuma tambah/ubah/padam yang dikunci.
--
-- Hanya pengendali (SQL / service role) boleh tukar pakej. Pengguna app hanya
-- boleh BACA pakej syarikat sendiri (tiada grant UPDATE pada businesses).
--
-- Syarikat sedia ada diletak pada pakej Business tanpa tarikh tamat supaya
-- tiada apa yang terkunci.
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Kolum pakej pada syarikat ------------------------------------------
alter table public.businesses
  add column plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  add column plan_until timestamptz,                                   -- null = tiada tarikh tamat
  add column trial_ends_at timestamptz default (now() + interval '14 days');

update public.businesses set plan = 'business', plan_until = null, trial_ends_at = null;

-- 2. Pakej berkuat kuasa -----------------------------------------------------
-- Pakej berbayar yang belum tamat > trial Pro yang masih aktif > Percuma.
create function public.plan_of(p_business uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when b.plan <> 'free' and (b.plan_until is null or b.plan_until > now()) then b.plan
    when b.trial_ends_at > now() then 'pro'
    else 'free' end
  from public.businesses b where b.id = p_business
$$;
revoke execute on function public.plan_of(uuid) from public, anon, authenticated;

create function public.current_plan()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(public.plan_of(public.current_business_id()), 'free')
$$;
revoke execute on function public.current_plan() from public, anon;
grant execute on function public.current_plan() to authenticated;

-- Had setiap pakej (satu tempat sahaja; app baca dari sini juga).
create function public.plan_limits(p_plan text)
returns table (max_outlets int, max_staff int) language sql immutable set search_path = '' as $$
  select case p_plan when 'business' then 10 else 1 end,
         case p_plan when 'free' then 2 when 'pro' then 10 else null end   -- null = tanpa had
$$;
revoke execute on function public.plan_limits(text) from public, anon;
grant execute on function public.plan_limits(text) to authenticated;

-- 3. Had outlet -------------------------------------------------------------
create function public.outlets_plan_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lim int; n int; p text;
begin
  p := public.plan_of(new.business_id);
  select max_outlets into lim from public.plan_limits(p);
  select count(*) into n from public.outlets where business_id = new.business_id;
  if n >= lim then
    raise exception 'Had outlet pakej % ialah %. Naik taraf pakej untuk tambah outlet.', initcap(p), lim
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_outlets_plan_limit before insert on public.outlets
  for each row execute function public.outlets_plan_limit();

-- 4. Had akaun staff (owner tidak dikira) -----------------------------------
create function public.staff_plan_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lim int; n int; p text;
begin
  if new.role = 'owner' then return new; end if;
  if tg_op = 'UPDATE' and old.role <> 'owner' and old.business_id = new.business_id then return new; end if;
  p := public.plan_of(new.business_id);
  select max_staff into lim from public.plan_limits(p);
  if lim is null then return new; end if;
  select count(*) into n from public.staff_profiles
   where business_id = new.business_id and role <> 'owner' and user_id <> new.user_id;
  if n >= lim then
    raise exception 'Had akaun staff pakej % ialah %. Naik taraf pakej untuk tambah akaun.', initcap(p), lim
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_staff_plan_limit before insert or update of role, business_id on public.staff_profiles
  for each row execute function public.staff_plan_limit();

-- 5. Ciri Pro: food cost & gaji ----------------------------------------------
-- Policy RESTRICTIVE: tambah/ubah/padam perlukan Pro atau Business. Baca kekal dibenarkan.
do $$
declare t text;
begin
  foreach t in array array['ingredient_costs', 'menu_items', 'menu_ingredients', 'payroll'] loop
    execute format($f$create policy "pakej pro: tambah" on public.%I as restrictive for insert to authenticated
                      with check ((select public.current_plan()) <> 'free')$f$, t);
    execute format($f$create policy "pakej pro: ubah" on public.%I as restrictive for update to authenticated
                      using ((select public.current_plan()) <> 'free') with check ((select public.current_plan()) <> 'free')$f$, t);
    execute format($f$create policy "pakej pro: padam" on public.%I as restrictive for delete to authenticated
                      using ((select public.current_plan()) <> 'free')$f$, t);
  end loop;
end $$;

-- Advance gaji melalui fungsi SECURITY DEFINER (tak tertakluk RLS): semak pakej di dalam.
create or replace function public.give_advance(p_employee uuid, p_amount numeric, p_payment_method text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  emp public.employees;
  tx bigint;
  adv uuid;
begin
  if public.current_plan() = 'free' then raise exception 'Advance gaji ialah ciri pakej Pro. Naik taraf untuk guna.'; end if;
  if not public.can_manage_employee(p_employee) then raise exception 'Tiada akses untuk pekerja ini'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Jumlah advance mesti lebih dari RM 0'; end if;
  select * into emp from public.employees where id = p_employee;
  if not emp.active then raise exception 'Pekerja ini tidak aktif'; end if;

  insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method, outlet_id, created_by)
  values (emp.business_id, (now() at time zone 'Asia/Kuala_Lumpur')::date, 'Out', 'Staff Wages', round(p_amount, 2),
          'Advance gaji ' || emp.name || coalesce(' · ' || nullif(trim(p_note), ''), ''), p_payment_method, emp.outlet_id, auth.uid())
  returning id into tx;

  insert into public.salary_advances (business_id, employee_id, amount, payment_method, note, transaction_id, created_by)
  values (emp.business_id, p_employee, round(p_amount, 2), p_payment_method, nullif(trim(p_note), ''), tx, auth.uid())
  returning id into adv;
  return adv;
end $function$;

-- Analisa food cost harian: Pro ke atas sahaja (data asal transaksi tidak disentuh).
create or replace view public.daily_food_cost with (security_invoker = true) as
 select t.outlet_id, t.transaction_date, sum(t.amount) as ingredients
   from public.transactions t
   join public.categories c on c.business_id = t.business_id and c.name = t.category and c.type = t.type
  where t.type = 'Out' and c.key = 'OUT01'
    and exists (select 1 from public.staff_profiles sp
                where sp.user_id = (select auth.uid()) and sp.role in ('owner', 'admin'))
    and (select public.current_plan()) <> 'free'
  group by t.outlet_id, t.transaction_date;

commit;
