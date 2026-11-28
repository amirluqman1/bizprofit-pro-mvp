-- =====================================================================
-- BizProfit Pro · Fasa 20: Jumlah gaji dikira oleh database + hanya owner/admin bayar
--
-- Masalah sebelum ini (Fasa 18 kunci HARI sahaja):
--   Jumlah ringgit slip (gaji asas, OT, potongan tidak hadir) dikira di phone dan database
--   terima apa sahaja yang dihantar. Manager (atau app versi lama / phone yang diubah) boleh
--   simpan slip dengan jumlah sendiri dan bayar.
--
-- Apa berubah:
--   1. payroll_calc(pekerja, dari, hingga): database kira sendiri daripada profil pekerja +
--      kehadiran, untuk hari yang BELUM dibayar (payroll_days):
--        - harian  : hari bekerja × kadar (separuh hari = 0.5)
--        - mingguan: minggu × kadar, minggu = hari belum dibayar ÷ 7 (dibundar 2 tempat perpuluhan)
--        - bulanan : satu kitaran bulan penuh = gaji penuh (pro-rata ikut hari belum dibayar ÷
--                    hari dalam kitaran); tempoh lain = setiap hari bernilai gaji ÷ hari bulan itu
--        - OT      : jam OT × kadar OT
--        - tidak hadir (mingguan/bulanan): 'sehari' = gaji ÷ hari bekerja (default 6 / 26) sehari,
--                    'tetap' = RM tetap sehari, 'penuh' = tiada potongan. Separuh hari = separuh.
--      Semua dikira dalam SEN (integer) dan dibundar sekali sahaja di hujung, separuh ke atas.
--      app/js/pages/pekerja.js guna kiraan yang SAMA (mesti selari, sampai ke sen).
--      Kadar ialah kadar SEMASA dalam profil pekerja (sama seperti app sebelum ini).
--   2. pay_payroll(slip, kaedah, jumlah_dipapar) menggantikan versi 2 parameter:
--        - Hanya owner (semua outlet) atau admin (outlet sendiri) boleh bayar.
--        - Database kira semula; kalau mana-mana angka dalam slip (kadar, hari, OT, asas,
--          potongan tidak hadir, hari belum dibayar) tak sama dengan kiraan database, bayaran
--          DITOLAK: "angka gaji sudah berubah, muat semula". Begitu juga kalau jumlah bersih
--          akhir (selepas advance) tak sama dengan jumlah yang dipapar kepada pembayar.
--          Maksudnya orang yang tekan Bayar sentiasa nampak angka sebenar sebelum duit keluar.
--        - Elaun atau potongan manual > RM0 WAJIB ada nota (sebab), disimpan dalam payroll.note.
--      Versi lama pay_payroll(uuid, text) kekal wujud tetapi hanya pulangkan mesej
--      "versi app lama, muat semula" (app dalam cache tak boleh bayar tanpa semakan).
--   3. give_advance(): hanya owner/admin (sebelum ini manager pun boleh).
--
-- Siapa boleh buat apa (gaji):
--   owner  : sediakan draf + bayar + advance, semua outlet.
--   admin  : sediakan draf + bayar + advance, outlet sendiri (termasuk pekerja peringkat pengurus).
--   manager: sediakan / simpan draf sahaja (pekerja bukan peringkat pengurus, outlet sendiri).
--            Tak boleh bayar, tak boleh beri advance.
--   staff  : tiada akses (tiada perubahan).
--   Syarikat lain: tiada akses (tenant_isolation + RLS, tiada perubahan).
--
-- Kes tepi:
--   - Slip yang SUDAH dibayar tidak disentuh (angka lama kekal walaupun cara kira berbeza).
--   - Draf sedia ada: app kira semula dan simpan semula sebelum bayar, jadi tak perlu dibaiki.
--   - Kiraan baru sama dengan app lama kecuali kes bundar 1 sen yang dulu dikira dengan float.
--   - Kehadiran diubah selepas draf disimpan: bayaran ditolak sehingga halaman dimuat semula.
--   - Advance baru diberi selepas halaman dibuka: jumlah bersih berubah → ditolak, muat semula.
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Siapa boleh bayar gaji / beri advance: owner, atau admin outlet pekerja itu ----------
create function public.can_pay_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.employees e
    join public.staff_profiles sp on sp.user_id = (select auth.uid()) and sp.business_id = e.business_id
    where e.id = p_employee
      and (sp.role = 'owner' or (sp.role = 'admin' and sp.outlet_id = e.outlet_id))
  )
$$;
revoke execute on function public.can_pay_employee(uuid) from public, anon;
grant execute on function public.can_pay_employee(uuid) to authenticated;

-- 2. Kiraan gaji oleh database (sen, integer) ----------------------------------------------
-- Security invoker: hanya baca pekerja/kehadiran yang pemanggil memang boleh baca (RLS).
create function public.payroll_calc(p_employee uuid, p_from date, p_to date)
returns table (pay_type text, rate numeric, ot_rate numeric, open_days int, days_worked numeric,
               ot_hours numeric, base_sen bigint, ot_sen bigint, absent_days numeric, absent_full_sen bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare
  e public.employees;
  rate_s bigint; otr_s bigint;
  jumlah int := p_to - p_from + 1;
  kitaran boolean;
  n_open int; h_kerja int; ot100 bigint; h_absen int; bahagian bigint;
  hari_kerja int; peraturan text;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Tempoh gaji tidak sah'; end if;
  select * into e from public.employees x where x.id = p_employee;
  if not found then raise exception 'Pekerja tidak dijumpai'; end if;
  rate_s := round(e.rate * 100);
  otr_s := round(e.ot_rate * 100);

  -- Hari dalam tempoh yang belum dibayar dalam slip lain.
  -- bahagian = jumlah (377580 ÷ hari bulan) bagi setiap hari terbuka; 377580 = KSK(28,29,30,31),
  -- supaya pro-rata bulanan dikira tepat tanpa pecahan.
  select count(*), coalesce(sum(377580 / extract(day from (date_trunc('month', g) + interval '1 month - 1 day'))::int), 0)
    into n_open, bahagian
  from generate_series(p_from, p_to, interval '1 day') g
  where not exists (select 1 from public.payroll_days x where x.employee_id = p_employee and x.work_date = g::date);

  -- Kehadiran pada hari terbuka, dalam unit separuh hari (hadir = 2, separuh = 1) dan jam OT × 100.
  select coalesce(sum(case a.status when 'hadir' then 2 when 'separuh' then 1 else 0 end), 0),
         coalesce(sum(round(a.ot_hours * 100)), 0),
         coalesce(sum(case a.status when 'tidak_hadir' then 2 when 'separuh' then 1 else 0 end), 0)
    into h_kerja, ot100, h_absen
  from public.attendance a
  where a.employee_id = p_employee and a.work_date between p_from and p_to
    and not exists (select 1 from public.payroll_days x where x.employee_id = p_employee and x.work_date = a.work_date);

  -- Satu kitaran bulan penuh? (1–30 Nov, atau 15 Nov – 14 Dis) — sama dengan isMonthCycle() di app.
  kitaran := case when extract(day from p_from) = 1
    then p_to = (date_trunc('month', p_from) + interval '1 month - 1 day')::date
    else p_to = (date_trunc('month', p_from) + interval '1 month')::date
               + (least(extract(day from p_from)::int - 1,
                        extract(day from (date_trunc('month', p_from) + interval '2 month - 1 day'))::int) - 1)
    end;

  pay_type := e.pay_type; rate := e.rate; ot_rate := e.ot_rate; open_days := n_open;
  days_worked := round(h_kerja / 2.0, 1);
  ot_hours := round(ot100 / 100.0, 2);
  base_sen := case e.pay_type
    when 'harian' then round(h_kerja * rate_s / 2.0)
    when 'mingguan' then round(round(n_open * 100 / 7.0) * rate_s / 100.0)
    else case when kitaran then round(rate_s * n_open / jumlah::numeric)
              else round(rate_s * bahagian / 377580.0) end
  end;
  ot_sen := round(ot100 * otr_s / 100.0);

  peraturan := case when e.pay_type = 'harian' then 'penuh' else e.absent_rule end;
  hari_kerja := coalesce(e.absent_workdays, case e.pay_type when 'mingguan' then 6 else 26 end);
  absent_days := case when peraturan = 'penuh' then 0 else round(h_absen / 2.0, 1) end;
  absent_full_sen := case peraturan
    when 'sehari' then round(h_absen * rate_s / (2.0 * hari_kerja))
    when 'tetap' then round(h_absen * round(e.absent_amount * 100) / 2.0)
    else 0 end;
  return next;
end $$;
revoke execute on function public.payroll_calc(uuid, date, date) from public, anon;
grant execute on function public.payroll_calc(uuid, date, date) to authenticated;

-- 3. Bayar gaji: owner/admin sahaja, database semak semua angka ------------------------------
drop function public.pay_payroll(uuid, text);

create function public.pay_payroll(p_payroll uuid, p_payment_method text, p_expected_net numeric)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  r public.payroll;
  emp public.employees;
  c record;
  tx bigint;
  sen_kasar bigint;
  sen_absen bigint;
  gross numeric;
  adv numeric;
  berubah text := 'Angka gaji sudah berubah sejak dikira (%s). Muat semula halaman Gaji dan semak semula sebelum bayar.';
begin
  select * into r from public.payroll where id = p_payroll for update;
  if not found then raise exception 'Slip gaji tidak dijumpai'; end if;
  if r.status <> 'draf' then raise exception 'Gaji ini sudah dibayar'; end if;
  if not public.can_pay_employee(r.employee_id) then
    raise exception 'Hanya owner atau admin boleh bayar gaji. Manager boleh simpan draf untuk dibayar oleh owner/admin.';
  end if;
  select * into emp from public.employees where id = r.employee_id;

  -- Kiraan database mesti sama dengan angka dalam slip (yang dipapar kepada pembayar).
  select * into c from public.payroll_calc(r.employee_id, r.period_start, r.period_end);
  if c.open_days = 0 then raise exception 'Semua hari dalam tempoh ini sudah dibayar. Muat semula halaman Gaji.'; end if;
  if c.pay_type <> r.pay_type or c.rate <> r.rate or c.ot_rate <> r.ot_rate then
    raise exception using message = format(berubah, 'jenis atau kadar gaji');
  end if;
  if r.open_days is distinct from c.open_days then raise exception using message = format(berubah, 'hari belum dibayar'); end if;
  if c.days_worked <> r.days_worked or c.ot_hours <> r.ot_hours or c.absent_days <> r.absent_days then
    raise exception using message = format(berubah, 'kehadiran atau OT');
  end if;
  if c.base_sen <> round(r.base_amount * 100) or c.ot_sen <> round(r.ot_amount * 100) then
    raise exception using message = format(berubah, 'gaji asas atau OT');
  end if;
  -- Potongan tidak hadir tidak boleh jadikan gaji negatif (sama dengan recalc() di app).
  sen_kasar := c.base_sen + c.ot_sen + round(r.allowance * 100) - round(r.deduction * 100);
  sen_absen := least(c.absent_full_sen, greatest(sen_kasar, 0));
  if sen_absen <> round(r.absent_deduction * 100) then raise exception using message = format(berubah, 'potongan tidak hadir'); end if;

  if (r.allowance > 0 or r.deduction > 0) and nullif(trim(coalesce(r.note, '')), '') is null then
    raise exception 'Tulis sebab elaun atau potongan sebelum bayar.';
  end if;

  gross := greatest(r.base_amount + r.ot_amount + r.allowance - r.deduction - r.absent_deduction, 0);
  adv := least(greatest(public.advance_balance(r.employee_id), 0), gross);
  update public.payroll set advance_deduction = adv where id = p_payroll returning * into r;
  if p_expected_net is null or r.net_amount <> p_expected_net then
    raise exception 'Jumlah gaji berubah: RM % (dipapar RM %), mungkin ada advance baru. Muat semula halaman Gaji.',
      to_char(r.net_amount, 'FM999999990.00'), coalesce(to_char(p_expected_net, 'FM999999990.00'), '-');
  end if;
  if r.net_amount <= 0 and adv <= 0 then raise exception 'Jumlah gaji RM 0, tiada apa untuk dibayar'; end if;

  if r.net_amount > 0 then
    insert into public.transactions (transaction_date, type, category, amount, description, payment_method, outlet_id)
    values ((now() at time zone 'Asia/Kuala_Lumpur')::date, 'Out', 'Staff Wages', r.net_amount,
            format('Gaji %s (%s – %s)', emp.name, to_char(r.period_start, 'DD/MM'), to_char(r.period_end, 'DD/MM/YYYY')),
            p_payment_method, emp.outlet_id)
    returning id into tx;
  end if;

  perform set_config('bizprofit.bayar', p_payroll::text, true);   -- izin trigger: bayaran melalui fungsi ini
  update public.payroll set status = 'dibayar', paid_at = now(), transaction_id = tx where id = p_payroll;
  perform set_config('bizprofit.bayar', '', true);
  return tx;   -- null jika gaji ditampung sepenuhnya oleh advance
end $$;
revoke execute on function public.pay_payroll(uuid, text, numeric) from public, anon;
grant execute on function public.pay_payroll(uuid, text, numeric) to authenticated;

-- Versi lama (app dalam cache): tak boleh bayar tanpa semakan baru.
create function public.pay_payroll(p_payroll uuid, p_payment_method text)
returns bigint language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Versi app lama. Tutup dan buka semula app (atau muat semula halaman) sebelum bayar gaji.';
end $$;
revoke execute on function public.pay_payroll(uuid, text) from public, anon;
grant execute on function public.pay_payroll(uuid, text) to authenticated;

-- 4. Advance: owner/admin sahaja ---------------------------------------------------------------
create or replace function public.give_advance(p_employee uuid, p_amount numeric, p_payment_method text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  emp public.employees;
  tx bigint;
  adv uuid;
begin
  if public.current_plan() = 'free' then raise exception 'Advance gaji ialah ciri pakej Pro. Naik taraf untuk guna.'; end if;
  if not public.can_pay_employee(p_employee) then raise exception 'Hanya owner atau admin boleh beri advance gaji.'; end if;
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
end $$;

commit;
