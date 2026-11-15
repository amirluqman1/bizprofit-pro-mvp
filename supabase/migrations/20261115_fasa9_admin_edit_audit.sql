-- =====================================================================
-- BizProfit Pro · Fasa 9: Peranan Admin, edit/padam transaksi, log audit
--   Owner : boleh ubah & padam transaksi semua outlet
--   Admin : macam owner, tetapi untuk OUTLET SENDIRI sahaja
--           (transaksi, laporan, pekerja termasuk peringkat pengurus,
--            stok penuh, syarikat outlet, log audit)
--   Manager / Staff : tiada perubahan, tidak boleh ubah/padam transaksi
-- Setiap ubah/padam transaksi direkod dalam transaction_audit
-- (hanya owner & admin outlet itu boleh baca; tiada siapa boleh ubah log).
-- Padam rekod gaji -> slip gaji dibuka semula (draf).
-- Padam rekod advance -> advance dibatalkan.
-- Satu transaksi: kalau gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Peranan baru ----------------------------------------------------------
alter table public.staff_profiles drop constraint staff_profiles_role_check;
alter table public.staff_profiles add constraint staff_profiles_role_check
  check (role in ('staff', 'manager', 'admin', 'owner'));

-- Owner (semua outlet) atau admin outlet ini
create function public.can_admin_outlet(p_outlet uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and (sp.role = 'owner' or (sp.role = 'admin' and sp.outlet_id = p_outlet))
  )
$$;
revoke execute on function public.can_admin_outlet(uuid) from public, anon;
grant execute on function public.can_admin_outlet(uuid) to authenticated;

-- 2. Transaksi: baca, ubah, padam -----------------------------------------
alter policy "manager baca transaksi outlet sendiri" on public.transactions
  using (exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and sp.role in ('manager', 'admin')
      and sp.outlet_id = transactions.outlet_id
  ));

create policy "owner admin ubah transaksi" on public.transactions
  for update to authenticated
  using ((select public.can_admin_outlet(outlet_id)))
  with check ((select public.can_admin_outlet(outlet_id)));

create policy "owner admin padam transaksi" on public.transactions
  for delete to authenticated
  using ((select public.can_admin_outlet(outlet_id)));

-- 3. Log audit -------------------------------------------------------------
create table public.transaction_audit (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id),
  outlet_id uuid not null,
  transaction_id bigint not null,
  action text not null check (action in ('ubah', 'padam')),
  old_data jsonb not null,
  new_data jsonb,
  note text,
  changed_by uuid,               -- tiada FK: log kekal walaupun akaun dipadam
  changed_by_email text,
  changed_by_role text,
  changed_at timestamptz not null default now()
);
create index idx_transaction_audit_outlet on public.transaction_audit (business_id, outlet_id, changed_at desc);
alter table public.transaction_audit enable row level security;
revoke all on public.transaction_audit from anon, authenticated;
grant select on public.transaction_audit to authenticated;     -- ditulis oleh trigger sahaja
create policy tenant_isolation on public.transaction_audit as restrictive for all to authenticated
  using (business_id = (select public.current_business_id())) with check (business_id = (select public.current_business_id()));
create policy "owner admin baca log audit" on public.transaction_audit
  for select to authenticated
  using ((select public.can_admin_outlet(outlet_id)));

-- 4. Kawalan ubah/padam + tulis log ---------------------------------------
create function public.transactions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  pay_id uuid;
  adv_id uuid;
  adv_emp uuid;
  v_note text;
  v_email text;
  v_role text;
begin
  select id into pay_id from public.payroll where transaction_id = old.id;
  select id, employee_id into adv_id, adv_emp from public.salary_advances where transaction_id = old.id;
  select u.email into v_email from auth.users u where u.id = (select auth.uid());
  select sp.role into v_role from public.staff_profiles sp where sp.user_id = (select auth.uid());

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at or new.business_id is distinct from old.business_id then
      raise exception 'Maklumat asal transaksi (pencipta, masa dicipta) tidak boleh diubah';
    end if;
    if (pay_id is not null or adv_id is not null)
       and (new.amount is distinct from old.amount or new.type is distinct from old.type
            or new.category is distinct from old.category or new.outlet_id is distinct from old.outlet_id) then
      raise exception 'Ini rekod gaji/advance: jumlah, jenis, kategori dan outlet tidak boleh diubah. Padam rekod ini, kemudian bayar semula dari Pekerja.';
    end if;
    if row(new.*) is not distinct from row(old.*) then return new; end if;
    insert into public.transaction_audit (business_id, outlet_id, transaction_id, action, old_data, new_data, changed_by, changed_by_email, changed_by_role)
    values (old.business_id, old.outlet_id, old.id, 'ubah', to_jsonb(old), to_jsonb(new), (select auth.uid()), v_email, v_role);
    return new;
  end if;

  -- DELETE
  if pay_id is not null then
    update public.payroll
      set status = 'draf', paid_at = null, transaction_id = null, advance_deduction = 0
      where id = pay_id;
    v_note := 'Slip gaji dibuka semula (draf)';
  end if;
  if adv_id is not null then
    delete from public.salary_advances where id = adv_id;
    if public.advance_balance(adv_emp) < 0 then
      raise exception 'Advance ini sudah ditolak dalam gaji yang dibayar. Padam rekod gaji tersebut dahulu.';
    end if;
    v_note := 'Advance dibatalkan';
  end if;
  insert into public.transaction_audit (business_id, outlet_id, transaction_id, action, old_data, note, changed_by, changed_by_email, changed_by_role)
  values (old.business_id, old.outlet_id, old.id, 'padam', to_jsonb(old), v_note, (select auth.uid()), v_email, v_role);
  return old;
end $$;
revoke execute on function public.transactions_guard() from public, anon, authenticated;

create trigger trg_transactions_guard before update or delete on public.transactions
  for each row execute function public.transactions_guard();

-- 5. Ringkasan untung: admin juga --------------------------------------------
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
    where sp.user_id = (select auth.uid()) and sp.role in ('owner', 'admin', 'manager')
  )
  group by t.outlet_id, o.name, t.transaction_date;

-- 6. Pekerja & gaji: admin urus SEMUA pekerja outlet sendiri ---------------
create or replace function public.can_manage_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.employees e
    join public.staff_profiles sp on sp.user_id = (select auth.uid()) and sp.business_id = e.business_id
    where e.id = p_employee
      and (sp.role = 'owner'
           or (sp.role = 'admin' and sp.outlet_id = e.outlet_id)
           or (sp.role = 'manager' and sp.outlet_id = e.outlet_id and not e.is_manager))
  )
$$;

alter policy "urus pekerja" on public.employees
  using (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())
    and (sp.role = 'owner'
         or (sp.role = 'admin' and sp.outlet_id = employees.outlet_id)
         or (sp.role = 'manager' and sp.outlet_id = employees.outlet_id and not employees.is_manager))))
  with check (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())
    and (sp.role = 'owner'
         or (sp.role = 'admin' and sp.outlet_id = employees.outlet_id)
         or (sp.role = 'manager' and sp.outlet_id = employees.outlet_id and not employees.is_manager))));

-- 7. Stok: admin macam owner untuk outlet sendiri ---------------------------
alter policy inventory_read_access on public.inventory_items
  using (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())
    and (sp.role = 'owner' or (sp.role in ('manager', 'admin') and sp.outlet_id = inventory_items.outlet_id))));
alter policy inventory_logs_read_access on public.inventory_stock_logs
  using (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())
    and (sp.role = 'owner' or (sp.role in ('manager', 'admin') and sp.outlet_id = inventory_stock_logs.outlet_id))));
create policy inventory_admin_delete on public.inventory_items for delete to authenticated
  using ((select public.can_admin_outlet(outlet_id)));

create or replace function public.inventory_validate_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Login diperlukan untuk mengubah stok'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.current_qty < 0 or new.min_qty < 0 or new.target_qty < 0 then
    raise exception 'Kuantiti tidak boleh negatif'; end if;
  if tg_op = 'UPDATE' then
    if new.outlet_id is distinct from old.outlet_id then
      raise exception 'Outlet barang tidak boleh diubah'; end if;
    if not (select public.can_admin_outlet(new.outlet_id))
       and (new.name is distinct from old.name or new.unit is distinct from old.unit
            or new.target_qty is distinct from old.target_qty
            or new.min_qty is distinct from old.min_qty
            or new.category is distinct from old.category) then
      raise exception 'Hanya owner atau admin boleh ubah nama, unit, kategori atau patut ada'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 8. Syarikat outlet: admin boleh ubah outlet sendiri ------------------------
alter policy "owner kemas kini outlet" on public.outlets
  using ((select public.can_admin_outlet(id)))
  with check ((select public.can_admin_outlet(id)));

-- 9. Profil: admin nampak peranan ahli outlet sendiri (untuk sejarah stok/log)
create policy "admin baca profile outlet" on public.staff_profiles
  for select to authenticated
  using ((select public.can_admin_outlet(outlet_id)));

commit;
