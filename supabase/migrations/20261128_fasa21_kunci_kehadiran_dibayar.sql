-- =====================================================================
-- BizProfit Pro · Fasa 21: Kehadiran hari yang gajinya sudah dibayar dikunci + log perubahan
--
-- Masalah sebelum ini:
--   Selepas gaji dibayar, kehadiran hari-hari itu masih boleh diubah/dipadam oleh sesiapa yang
--   boleh urus pekerja. Duit tak berubah (slip simpan angka sendiri), tetapi rekod kehadiran
--   jadi tak sepadan dengan slip, dan tiada jejak siapa ubah atau kenapa.
--   (Semasa migration ditulis: 56 daripada 128 hari dibayar sudah diubah selepas bayar,
--   kebanyakannya dari insiden tanda pukal 27 Nov. Data lama TIDAK diubah oleh migration ini.)
--
-- Apa berubah (keputusan pengguna 28 Nov):
--   1. Hari "dibayar" = ada baris dalam payroll_days (Fasa 18) untuk pekerja + tarikh itu.
--   2. Trigger pada attendance (tambah / ubah / padam) untuk hari dibayar:
--        - manager / staff: DITOLAK.
--        - owner (semua outlet) / admin (outlet pekerja itu): dibenarkan HANYA melalui fungsi
--          change_paid_attendance(), yang wajib ada sebab. Setiap perubahan direkod dalam
--          attendance_audit (siapa, bila, peranan, data lama → baru, sebab).
--        - Ubah yang tak mengubah apa-apa (status, OT, nota sama) dibenarkan tanpa sebab.
--   3. attendance_audit: log kekal. Owner/admin outlet itu boleh baca; tiada siapa boleh
--      tambah/ubah/padam terus (hanya trigger).
--   4. Slip yang sudah dibayar TIDAK berubah bila kehadiran diubah. OT terlupa dibayar sebagai
--      elaun + sebab dalam slip seterusnya (app papar tip ini).
--   Untuk betulkan slip sepenuhnya (cara sedia ada): padam rekod gaji di Rekod → slip dibuka
--   semula jadi draf, hari dilepaskan (tidak lagi dikunci) → betulkan kehadiran → bayar semula.
--
-- Siapa boleh buat apa (kehadiran):
--   Hari belum dibayar: tiada perubahan (owner/admin/manager ikut policy "urus kehadiran").
--   Hari dibayar: owner / admin outlet sendiri dengan sebab; manager & staff tidak boleh.
--   Log: owner (semua outlet) / admin (outlet sendiri) baca sahaja. Syarikat lain: tiada akses.
--
-- Kes tepi:
--   - Hari dibayar tanpa rekod kehadiran (tak ditanda): menambah tanda juga perlu sebab.
--   - Padam pekerja tidak terjejas: pekerja yang ada slip gaji memang tak boleh dipadam (FK).
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Log perubahan kehadiran hari dibayar -------------------------------------------------
create table public.attendance_audit (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id),
  outlet_id uuid not null,
  employee_id uuid not null,
  work_date date not null,
  action text not null check (action in ('tambah', 'ubah', 'padam')),
  old_data jsonb,
  new_data jsonb,
  reason text not null check (length(trim(reason)) > 0),
  changed_by uuid,
  changed_by_email text,
  changed_by_role text,
  changed_at timestamptz not null default now()
);
create index idx_attendance_audit_day on public.attendance_audit (business_id, employee_id, work_date);
alter table public.attendance_audit enable row level security;
revoke all on public.attendance_audit from anon, authenticated;
grant select on public.attendance_audit to authenticated;
create policy tenant_isolation on public.attendance_audit as restrictive for all to authenticated
  using (business_id = (select public.current_business_id()))
  with check (business_id = (select public.current_business_id()));
create policy "owner admin baca log kehadiran" on public.attendance_audit for select to authenticated
  using ((select public.can_admin_outlet(attendance_audit.outlet_id)));

-- 2. Kunci hari dibayar --------------------------------------------------------------------
create function public.attendance_paid_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  emp uuid := case when tg_op = 'DELETE' then old.employee_id else new.employee_id end;
  hari date := case when tg_op = 'DELETE' then old.work_date else new.work_date end;
  dibayar boolean;
  sebab text;
  e public.employees;
  v_email text;
  v_role text;
begin
  select exists (
    select 1 from public.payroll_days d
    where (d.employee_id = emp and d.work_date = hari)
       or (tg_op = 'UPDATE' and d.employee_id = old.employee_id and d.work_date = old.work_date)
  ) into dibayar;
  if not dibayar then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Upsert ke atas baris sedia ada: Postgres cetuskan trigger INSERT dahulu, kemudian UPDATE.
  -- Biar bahagian UPDATE yang semak & rekod (elak log berganda / tolak upsert data sama).
  if tg_op = 'INSERT' and exists (select 1 from public.attendance a where a.employee_id = emp and a.work_date = hari) then
    return new;
  end if;

  -- Ubah tanpa beza sebenar (cth. upsert data yang sama) tak perlu sebab.
  if tg_op = 'UPDATE' and new.employee_id = old.employee_id and new.work_date = old.work_date
     and new.status = old.status and new.ot_hours = old.ot_hours and new.note is not distinct from old.note then
    return new;
  end if;

  if not public.can_pay_employee(emp) then
    raise exception 'Gaji untuk % sudah dibayar. Hanya owner atau admin boleh ubah kehadiran hari ini.', to_char(hari, 'DD/MM/YYYY');
  end if;
  sebab := nullif(trim(coalesce(current_setting('bizprofit.sebab_kehadiran', true), '')), '');
  if sebab is null then
    raise exception 'Gaji untuk % sudah dibayar. Tulis sebab untuk ubah kehadiran hari ini.', to_char(hari, 'DD/MM/YYYY');
  end if;

  select * into e from public.employees where id = emp;
  select u.email into v_email from auth.users u where u.id = (select auth.uid());
  select sp.role into v_role from public.staff_profiles sp where sp.user_id = (select auth.uid());
  insert into public.attendance_audit (business_id, outlet_id, employee_id, work_date, action, old_data, new_data, reason,
                                       changed_by, changed_by_email, changed_by_role)
  values (e.business_id, e.outlet_id, emp, hari,
          case tg_op when 'INSERT' then 'tambah' when 'UPDATE' then 'ubah' else 'padam' end,
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end,
          sebab, (select auth.uid()), v_email, v_role);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.attendance_paid_guard() from public, anon, authenticated;
create trigger trg_attendance_paid_guard before insert or update or delete on public.attendance
  for each row execute function public.attendance_paid_guard();

-- 3. Satu-satunya cara ubah kehadiran hari dibayar (owner/admin, wajib sebab) ---------------
-- p_status null = padam tanda. Security invoker: RLS "urus kehadiran" + trigger di atas terpakai.
create function public.change_paid_attendance(p_employee uuid, p_date date, p_status text, p_ot numeric, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Tulis sebab untuk ubah kehadiran hari yang gajinya sudah dibayar.';
  end if;
  perform set_config('bizprofit.sebab_kehadiran', trim(p_reason), true);
  if p_status is null then
    delete from public.attendance where employee_id = p_employee and work_date = p_date;
  else
    update public.attendance set status = p_status, ot_hours = coalesce(p_ot, 0)
     where employee_id = p_employee and work_date = p_date;
    if not found then
      insert into public.attendance (employee_id, work_date, status, ot_hours) values (p_employee, p_date, p_status, coalesce(p_ot, 0));
    end if;
  end if;
  perform set_config('bizprofit.sebab_kehadiran', '', true);
end $$;
revoke execute on function public.change_paid_attendance(uuid, date, text, numeric, text) from public, anon;
grant execute on function public.change_paid_attendance(uuid, date, text, numeric, text) to authenticated;

commit;
