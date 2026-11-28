-- Ujian Fasa 21: kehadiran hari dibayar dikunci + log perubahan (semua dibatalkan)
-- Hasil keluar sebagai ralat "HASIL UJIAN".
-- Syarikat A: owner, admin outlet 1, admin outlet 2, manager outlet 1, staff outlet 1. Syarikat B: owner.
do $$
declare res text := ''; gagal int := 0; n int; v numeric; v2 numeric; tx bigint; c record; s text; j jsonb;
  uO uuid := gen_random_uuid(); uAd uuid := gen_random_uuid(); uAd2 uuid := gen_random_uuid();
  uM uuid := gen_random_uuid(); uS uuid := gen_random_uuid(); uB uuid := gen_random_uuid();
  bizA uuid; bizB uuid; out1 uuid; out2 uuid; outB uuid; eH uuid; eB uuid; pH uuid;
begin
  begin
    -- ===== Data ujian (sebagai postgres) =====
    insert into auth.users (id, email, aud, role) values
      (uO, 'uji-f21-owner@example.com', 'authenticated', 'authenticated'), (uAd, 'uji-f21-admin@example.com', 'authenticated', 'authenticated'),
      (uAd2, 'uji-f21-admin2@example.com', 'authenticated', 'authenticated'), (uM, 'uji-f21-mgr@example.com', 'authenticated', 'authenticated'),
      (uS, 'uji-f21-staff@example.com', 'authenticated', 'authenticated'), (uB, 'uji-f21-b@example.com', 'authenticated', 'authenticated');
    insert into public.businesses (name, plan, trial_ends_at) values ('UJI F21 A', 'business', null) returning id into bizA;
    insert into public.businesses (name, plan, trial_ends_at) values ('UJI F21 B', 'business', null) returning id into bizB;
    insert into public.outlets (business_id, name) values (bizA, 'UJI F21 A1') returning id into out1;
    insert into public.outlets (business_id, name) values (bizA, 'UJI F21 A2') returning id into out2;
    insert into public.outlets (business_id, name) values (bizB, 'UJI F21 B1') returning id into outB;
    insert into public.categories (business_id, key, name, type, counts_in_profit) values
      (bizA, 'OUT06', 'Staff Wages', 'Out', true), (bizB, 'OUT06', 'Staff Wages', 'Out', true);
    insert into public.payment_methods (business_id, name) values (bizA, 'Tunai'), (bizB, 'Tunai');
    insert into public.staff_profiles (user_id, business_id, outlet_id, role) values
      (uO, bizA, out1, 'owner'), (uAd, bizA, out1, 'admin'), (uAd2, bizA, out2, 'admin'),
      (uM, bizA, out1, 'manager'), (uS, bizA, out1, 'staff'), (uB, bizB, outB, 'owner');
    insert into public.employees (business_id, outlet_id, name, pay_type, rate, ot_rate) values (bizA, out1, 'UJI Harian', 'harian', 80, 10) returning id into eH;
    insert into public.employees (business_id, outlet_id, name, pay_type, rate) values (bizB, outB, 'UJI Pekerja B', 'harian', 50) returning id into eB;
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);   -- marked_by (trigger)
    insert into public.attendance (business_id, employee_id, work_date, status, ot_hours, marked_by) values
      (bizA, eH, '2026-11-01', 'hadir', 1, uO), (bizA, eH, '2026-11-03', 'hadir', 0, uO);

    -- ===== Owner bayar gaji 1–2 Nov (1 Nov hadir + OT 1 jam, 2 Nov tak ditanda) =====
    set local role authenticated;
    select * into c from public.payroll_calc(eH, '2026-11-01', '2026-11-02');
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, ot_hours, ot_rate, base_amount, ot_amount, open_days)
      values (eH, '2026-11-01', '2026-11-02', 'harian', c.rate, c.days_worked, c.ot_hours, c.ot_rate, c.base_sen / 100.0, c.ot_sen / 100.0, c.open_days) returning id into pH;
    tx := public.pay_payroll(pH, 'Tunai', (c.base_sen + c.ot_sen) / 100.0);
    select net_amount into v from public.payroll where id = pH;
    res := res || format(E'Gaji 1–2 Nov dibayar: %s (jangka 90.00)\n', v); if v is distinct from 90.00 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Manager =====
    perform set_config('request.jwt.claims', json_build_object('sub', uM, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin update public.attendance set status = 'tidak_hadir' where employee_id = eH and work_date = '2026-11-01';
      res := res || E'Manager ubah hari dibayar: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Manager ubah hari dibayar: ditolak (betul) — %s\n', sqlerrm); end;
    begin delete from public.attendance where employee_id = eH and work_date = '2026-11-01';
      get diagnostics n = row_count;
      if n > 0 then res := res || E'Manager padam hari dibayar: DITERIMA (SALAH)\n'; gagal := gagal + 1;
      else res := res || E'Manager padam hari dibayar: 0 baris (SALAH, jangka ralat)\n'; gagal := gagal + 1; end if;
    exception when others then res := res || format(E'Manager padam hari dibayar: ditolak (betul) — %s\n', sqlerrm); end;
    begin insert into public.attendance (employee_id, work_date, status) values (eH, '2026-11-02', 'hadir');
      res := res || E'Manager tanda hari dibayar yang kosong: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Manager tanda hari dibayar yang kosong: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.change_paid_attendance(eH, '2026-11-01', 'tidak_hadir', 0, 'cuba');
      res := res || E'Manager guna fungsi ubah hari dibayar: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Manager guna fungsi ubah hari dibayar: ditolak (betul) — %s\n', sqlerrm); end;
    update public.attendance set status = 'separuh' where employee_id = eH and work_date = '2026-11-03';
    get diagnostics n = row_count;
    res := res || format(E'Manager ubah hari BELUM dibayar: %s baris (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    insert into public.attendance (employee_id, work_date, status) values (eH, '2026-11-04', 'hadir');
    res := res || E'Manager tanda hari BELUM dibayar: OK\n';
    reset role;

    -- ===== Staff =====
    perform set_config('request.jwt.claims', json_build_object('sub', uS, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.change_paid_attendance(eH, '2026-11-01', 'tidak_hadir', 0, 'cuba');
      select count(*) into n from public.attendance where employee_id = eH and work_date = '2026-11-01' and status = 'tidak_hadir';
      if n > 0 then res := res || E'Staff ubah hari dibayar: DITERIMA (SALAH)\n'; gagal := gagal + 1;
      else res := res || E'Staff ubah hari dibayar: tiada kesan (betul)\n'; end if;
    exception when others then res := res || format(E'Staff ubah hari dibayar: ditolak (betul) — %s\n', sqlerrm); end;
    reset role;

    -- ===== Owner =====
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin update public.attendance set status = 'separuh' where employee_id = eH and work_date = '2026-11-01';
      res := res || E'Owner ubah terus tanpa sebab: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner ubah terus tanpa sebab: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.change_paid_attendance(eH, '2026-11-01', 'separuh', 1, '   ');
      res := res || E'Owner sebab kosong: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner sebab kosong: ditolak (betul) — %s\n', sqlerrm); end;
    perform public.change_paid_attendance(eH, '2026-11-01', 'separuh', 1, 'Balik awal, lupa tanda');
    select status into s from public.attendance where employee_id = eH and work_date = '2026-11-01';
    select count(*) into n from public.attendance_audit where employee_id = eH;
    select action || ' | ' || reason || ' | ' || (old_data->>'status') || ' → ' || (new_data->>'status') || ' | ' || changed_by_role || ' | ' || changed_by_email
      into s from public.attendance_audit where employee_id = eH order by id desc limit 1;
    res := res || format(E'Owner ubah dengan sebab: log %s baris — %s (jangka 1, ubah | … | hadir → separuh | owner)\n', n, s);
    if n <> 1 or s not like 'ubah | Balik awal, lupa tanda | hadir → separuh | owner | uji-f21-owner@example.com' then gagal := gagal + 1; end if;
    -- Upsert data yang sama (tiada beza): dibenarkan tanpa sebab, tiada log baru.
    insert into public.attendance (employee_id, work_date, status, ot_hours) values (eH, '2026-11-01', 'separuh', 1)
      on conflict (employee_id, work_date) do update set status = excluded.status, ot_hours = excluded.ot_hours;
    select count(*) into n from public.attendance_audit where employee_id = eH;
    res := res || format(E'Upsert data sama: log %s baris (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    -- Slip yang sudah dibayar tidak berubah.
    select net_amount, days_worked into v, v2 from public.payroll where id = pH;
    res := res || format(E'Slip dibayar selepas kehadiran diubah: %s, hari %s (jangka 90.00, 1.0)\n', v, v2); if v <> 90.00 or v2 <> 1.0 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Admin outlet 1 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uAd, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.change_paid_attendance(eH, '2026-11-02', 'hadir', 0, 'Dia datang, lupa tanda');
    perform public.change_paid_attendance(eH, '2026-11-01', null, 0, 'Salah orang');
    select string_agg(action, ',' order by id) into s from public.attendance_audit where employee_id = eH;
    res := res || format(E'Admin tambah + padam hari dibayar: log %s (jangka ubah,tambah,padam)\n', s); if s is distinct from 'ubah,tambah,padam' then gagal := gagal + 1; end if;
    select count(*) into n from public.attendance where employee_id = eH and work_date = '2026-11-01';
    res := res || format(E'Hari 1 Nov selepas dipadam admin: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    select count(*) into n from public.attendance_audit;
    res := res || format(E'Admin outlet 1 baca log: %s (jangka 3)\n', n); if n <> 3 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Admin outlet 2 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uAd2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.change_paid_attendance(eH, '2026-11-02', 'tidak_hadir', 0, 'cuba');
      select count(*) into n from public.attendance where employee_id = eH and work_date = '2026-11-02' and status = 'tidak_hadir';
      if n > 0 then res := res || E'Admin outlet 2 ubah pekerja outlet 1: DITERIMA (SALAH)\n'; gagal := gagal + 1;
      else res := res || E'Admin outlet 2 ubah pekerja outlet 1: tiada kesan (betul)\n'; end if;
    exception when others then res := res || format(E'Admin outlet 2 ubah pekerja outlet 1: ditolak (betul) — %s\n', sqlerrm); end;
    select count(*) into n from public.attendance_audit;
    res := res || format(E'Admin outlet 2 baca log outlet 1: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Log tidak boleh diubah / dipadam / ditambah =====
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.attendance_audit;
    res := res || format(E'Owner baca log: %s (jangka 3)\n', n); if n <> 3 then gagal := gagal + 1; end if;
    begin update public.attendance_audit set reason = 'ubah sejarah';
      res := res || E'Owner ubah log: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner ubah log: ditolak (betul) — %s\n', sqlerrm); end;
    begin delete from public.attendance_audit;
      res := res || E'Owner padam log: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner padam log: ditolak (betul) — %s\n', sqlerrm); end;
    begin insert into public.attendance_audit (business_id, outlet_id, employee_id, work_date, action, reason) values (bizA, out1, eH, '2026-11-09', 'ubah', 'palsu');
      res := res || E'Owner tambah log palsu: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner tambah log palsu: ditolak (betul) — %s\n', sqlerrm); end;

    -- ===== Buka semula slip (padam rekod gaji) → hari tidak lagi dikunci =====
    delete from public.transactions where id = tx;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', uM, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.attendance set status = 'tidak_hadir' where employee_id = eH and work_date = '2026-11-02';
    get diagnostics n = row_count;
    res := res || format(E'Selepas slip dibuka semula, manager ubah 2 Nov: %s baris (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Syarikat B =====
    perform set_config('request.jwt.claims', json_build_object('sub', uB, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.attendance_audit;
    res := res || format(E'Owner B baca log A: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin perform public.change_paid_attendance(eH, '2026-11-03', 'tidak_hadir', 0, 'jahat');
      select count(*) into n from public.attendance where employee_id = eH and work_date = '2026-11-03' and status = 'tidak_hadir';
      if n > 0 then res := res || E'Owner B ubah kehadiran A: DITERIMA (SALAH)\n'; gagal := gagal + 1;
      else res := res || E'Owner B ubah kehadiran A: tiada kesan (betul)\n'; end if;
    exception when others then res := res || format(E'Owner B ubah kehadiran A: ditolak (betul) — %s\n', sqlerrm); end;
    reset role;

    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 21 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
