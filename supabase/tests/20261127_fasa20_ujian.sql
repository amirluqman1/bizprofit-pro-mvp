-- Ujian Fasa 20: jumlah gaji dikira oleh database + hanya owner/admin bayar (semua dibatalkan)
-- Hasil keluar sebagai ralat "HASIL UJIAN".
-- Syarikat A: owner, admin outlet 1, admin outlet 2, manager outlet 1, staff outlet 1. Syarikat B: owner.
do $$
declare res text := ''; gagal int := 0; n int; v numeric; v2 numeric; tx bigint; c record; s text;
  uO uuid := gen_random_uuid(); uAd uuid := gen_random_uuid(); uAd2 uuid := gen_random_uuid();
  uM uuid := gen_random_uuid(); uS uuid := gen_random_uuid(); uB uuid := gen_random_uuid();
  bizA uuid; bizB uuid; out1 uuid; out2 uuid; outB uuid;
  eH uuid; eM uuid; eW uuid; eT uuid; eO2 uuid; eB uuid; pH uuid; pM uuid; pW uuid; pO2 uuid; pB uuid;
begin
  begin
    -- ===== Data ujian (sebagai postgres) =====
    insert into auth.users (id, email, aud, role) values
      (uO, 'uji-f20-owner@example.com', 'authenticated', 'authenticated'), (uAd, 'uji-f20-admin@example.com', 'authenticated', 'authenticated'),
      (uAd2, 'uji-f20-admin2@example.com', 'authenticated', 'authenticated'), (uM, 'uji-f20-mgr@example.com', 'authenticated', 'authenticated'),
      (uS, 'uji-f20-staff@example.com', 'authenticated', 'authenticated'), (uB, 'uji-f20-b@example.com', 'authenticated', 'authenticated');
    insert into public.businesses (name, plan, trial_ends_at) values ('UJI F20 A', 'business', null) returning id into bizA;
    insert into public.businesses (name, plan, trial_ends_at) values ('UJI F20 B', 'business', null) returning id into bizB;
    insert into public.outlets (business_id, name) values (bizA, 'UJI F20 A1') returning id into out1;
    insert into public.outlets (business_id, name) values (bizA, 'UJI F20 A2') returning id into out2;
    insert into public.outlets (business_id, name) values (bizB, 'UJI F20 B1') returning id into outB;
    insert into public.categories (business_id, key, name, type, counts_in_profit) values
      (bizA, 'OUT06', 'Staff Wages', 'Out', true), (bizB, 'OUT06', 'Staff Wages', 'Out', true);
    insert into public.payment_methods (business_id, name) values (bizA, 'Tunai'), (bizB, 'Tunai');
    insert into public.staff_profiles (user_id, business_id, outlet_id, role) values
      (uO, bizA, out1, 'owner'), (uAd, bizA, out1, 'admin'), (uAd2, bizA, out2, 'admin'),
      (uM, bizA, out1, 'manager'), (uS, bizA, out1, 'staff'), (uB, bizB, outB, 'owner');
    insert into public.employees (business_id, outlet_id, name, pay_type, rate, ot_rate) values (bizA, out1, 'UJI Harian', 'harian', 80, 10) returning id into eH;
    insert into public.employees (business_id, outlet_id, name, pay_type, rate, absent_rule, absent_workdays) values (bizA, out1, 'UJI Bulanan', 'bulanan', 2000, 'sehari', 26) returning id into eM;
    insert into public.employees (business_id, outlet_id, name, pay_type, rate, absent_rule, absent_amount) values (bizA, out1, 'UJI Mingguan', 'mingguan', 350, 'tetap', 40) returning id into eW;
    insert into public.employees (business_id, outlet_id, name, pay_type, rate) values (bizA, out1, 'UJI Bundar', 'harian', 80.01) returning id into eT;
    insert into public.employees (business_id, outlet_id, name, pay_type, rate) values (bizA, out2, 'UJI Outlet 2', 'harian', 70) returning id into eO2;
    insert into public.employees (business_id, outlet_id, name, pay_type, rate) values (bizB, outB, 'UJI Pekerja B', 'bulanan', 1500) returning id into eB;
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);   -- marked_by (trigger)
    insert into public.attendance (business_id, employee_id, work_date, status, ot_hours, marked_by) values
      (bizA, eH, '2026-11-01', 'hadir', 1.25, uO), (bizA, eH, '2026-11-02', 'hadir', 0.5, uO), (bizA, eH, '2026-11-03', 'hadir', 0, uO),
      (bizA, eH, '2026-11-04', 'separuh', 0, uO), (bizA, eH, '2026-11-05', 'tidak_hadir', 0, uO), (bizA, eH, '2026-11-06', 'cuti', 0, uO),
      (bizA, eH, '2026-11-08', 'hadir', 0, uO),
      (bizA, eM, '2026-11-10', 'tidak_hadir', 0, uO),
      (bizA, eW, '2026-11-03', 'tidak_hadir', 0, uO), (bizA, eW, '2026-11-04', 'tidak_hadir', 0, uO), (bizA, eW, '2026-11-05', 'separuh', 0, uO),
      (bizA, eT, '2026-11-01', 'separuh', 0, uO),
      (bizA, eO2, '2026-11-01', 'hadir', 0, uO);

    -- ===== Kiraan database (sebagai owner A) =====
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select * into c from public.payroll_calc(eM, '2026-11-01', '2026-11-30');
    res := res || format(E'Bulanan 1–30 Nov (kitaran penuh): asas %s sen, potong tak hadir %s (jangka 200000, 7692)\n', c.base_sen, c.absent_full_sen);
    if c.base_sen <> 200000 or c.absent_full_sen <> 7692 then gagal := gagal + 1; end if;
    select * into c from public.payroll_calc(eM, '2026-11-15', '2026-12-14');
    res := res || format(E'Bulanan 15 Nov – 14 Dis (kitaran penuh): %s (jangka 200000)\n', c.base_sen); if c.base_sen <> 200000 then gagal := gagal + 1; end if;
    select * into c from public.payroll_calc(eM, '2026-11-01', '2026-11-07');
    res := res || format(E'Bulanan 7 hari Nov: %s (jangka 46667 = 2000×7/30)\n', c.base_sen); if c.base_sen <> 46667 then gagal := gagal + 1; end if;
    select * into c from public.payroll_calc(eM, '2026-11-25', '2026-12-05');
    res := res || format(E'Bulanan 25 Nov – 5 Dis: %s (jangka 72258 = 2000×(6/30+5/31))\n', c.base_sen); if c.base_sen <> 72258 then gagal := gagal + 1; end if;
    select * into c from public.payroll_calc(eH, '2026-11-01', '2026-11-07');
    res := res || format(E'Harian 1–7 Nov: hari %s, asas %s, OT %s jam = %s sen, hari terbuka %s (jangka 3.5, 28000, 1.75, 1750, 7)\n', c.days_worked, c.base_sen, c.ot_hours, c.ot_sen, c.open_days);
    if c.days_worked <> 3.5 or c.base_sen <> 28000 or c.ot_hours <> 1.75 or c.ot_sen <> 1750 or c.open_days <> 7 then gagal := gagal + 1; end if;
    select * into c from public.payroll_calc(eW, '2026-11-01', '2026-11-30');
    res := res || format(E'Mingguan 30 hari: asas %s, tak hadir %s hari = %s sen (jangka 150150 = 4.29×350, 2.5, 10000)\n', c.base_sen, c.absent_days, c.absent_full_sen);
    if c.base_sen <> 150150 or c.absent_days <> 2.5 or c.absent_full_sen <> 10000 then gagal := gagal + 1; end if;
    select * into c from public.payroll_calc(eT, '2026-11-01', '2026-11-01');
    res := res || format(E'Bundar separuh sen (0.5 × RM80.01): %s (jangka 4001)\n', c.base_sen); if c.base_sen <> 4001 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Manager: sediakan draf sahaja =====
    perform set_config('request.jwt.claims', json_build_object('sub', uM, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, ot_hours, ot_rate, base_amount, ot_amount, open_days)
      values (eH, '2026-11-01', '2026-11-07', 'harian', 80, 3.5, 1.75, 10, 280, 17.50, 7) returning id into pH;
    res := res || E'Manager simpan draf: OK\n';
    begin perform public.pay_payroll(pH, 'Tunai', 297.50);
      res := res || E'Manager bayar gaji: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Manager bayar gaji: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.give_advance(eH, 50, 'Tunai');
      res := res || E'Manager beri advance: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Manager beri advance: ditolak (betul) — %s\n', sqlerrm); end;
    -- Manager cuba naikkan gaji asas dalam draf (database terima draf, tapi tak boleh dibayar).
    update public.payroll set base_amount = 999 where id = pH;
    reset role;

    -- ===== Staff =====
    perform set_config('request.jwt.claims', json_build_object('sub', uS, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.pay_payroll(pH, 'Tunai', 297.50);
      res := res || E'Staff bayar gaji: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Staff bayar gaji: ditolak (betul) — %s\n', sqlerrm); end;
    reset role;

    -- ===== Admin outlet 2: pekerja outlet 1 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uAd2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.pay_payroll(pH, 'Tunai', 297.50);
      res := res || E'Admin outlet 2 bayar gaji outlet 1: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Admin outlet 2 bayar gaji outlet 1: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.give_advance(eH, 50, 'Tunai');
      res := res || E'Admin outlet 2 advance pekerja outlet 1: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Admin outlet 2 advance pekerja outlet 1: ditolak (betul) — %s\n', sqlerrm); end;
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, base_amount, open_days)
      values (eO2, '2026-11-01', '2026-11-01', 'harian', 70, 1, 70, 1) returning id into pO2;
    tx := public.pay_payroll(pO2, 'Tunai', 70);
    res := res || format(E'Admin outlet 2 bayar pekerja outlet sendiri: transaksi %s (jangka ada)\n', coalesce(tx::text, 'TIADA')); if tx is null then gagal := gagal + 1; end if;
    reset role;

    -- ===== Owner: database semak angka =====
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.pay_payroll(pH, 'Tunai', 297.50);
      res := res || E'Bayar slip asas diubah (RM999): DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Bayar slip asas diubah (RM999): ditolak (betul) — %s\n', sqlerrm); end;
    update public.payroll set base_amount = 280 where id = pH;
    begin perform public.pay_payroll(pH, 'Tunai', 500);
      res := res || E'Jumlah dipapar salah (RM500): DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Jumlah dipapar salah (RM500): ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.pay_payroll(pH, 'Tunai');
      res := res || E'Fungsi lama (2 parameter): DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Fungsi lama (2 parameter): ditolak (betul) — %s\n', sqlerrm); end;
    update public.payroll set allowance = 50 where id = pH;
    begin perform public.pay_payroll(pH, 'Tunai', 347.50);
      res := res || E'Elaun tanpa nota: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Elaun tanpa nota: ditolak (betul) — %s\n', sqlerrm); end;
    update public.payroll set note = '  ' where id = pH;
    begin perform public.pay_payroll(pH, 'Tunai', 347.50);
      res := res || E'Elaun dengan nota kosong: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Elaun dengan nota kosong: ditolak (betul) — %s\n', sqlerrm); end;
    update public.payroll set note = 'Bonus kerja lebih masa' where id = pH;
    tx := public.pay_payroll(pH, 'Tunai', 347.50);
    select amount into v from public.transactions where id = tx;
    res := res || format(E'Bayar betul (280 + OT 17.50 + elaun 50): Staff Wages %s (jangka 347.50)\n', v); if v is distinct from 347.50 then gagal := gagal + 1; end if;

    -- Hari 1–7 sudah dibayar: kiraan 1–30 Nov hanya kira hari lain (8 Nov hadir sahaja).
    select * into c from public.payroll_calc(eH, '2026-11-01', '2026-11-30');
    res := res || format(E'Harian 1–30 Nov selepas 1–7 dibayar: hari terbuka %s, asas %s (jangka 23, 8000)\n', c.open_days, c.base_sen);
    if c.open_days <> 23 or c.base_sen <> 8000 then gagal := gagal + 1; end if;

    -- Kehadiran berubah selepas draf disimpan → ditolak.
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, base_amount, absent_days, absent_deduction, open_days)
      values (eW, '2026-11-01', '2026-11-30', 'mingguan', 350, 0.5, 1501.50, 2.5, 100, 30) returning id into pW;
    insert into public.attendance (employee_id, work_date, status) values (eW, '2026-11-20', 'tidak_hadir');
    begin perform public.pay_payroll(pW, 'Tunai', 1401.50);
      res := res || E'Kehadiran diubah selepas draf: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Kehadiran diubah selepas draf: ditolak (betul) — %s\n', sqlerrm); end;
    -- Potongan tidak hadir dikurangkan secara manual dalam draf → ditolak.
    update public.payroll set absent_days = 3.5, absent_deduction = 0 where id = pW;
    begin perform public.pay_payroll(pW, 'Tunai', 1501.50);
      res := res || E'Potongan tak hadir dibuang dalam draf: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Potongan tak hadir dibuang dalam draf: ditolak (betul) — %s\n', sqlerrm); end;
    update public.payroll set absent_deduction = 140 where id = pW;
    tx := public.pay_payroll(pW, 'Tunai', 1361.50);
    select amount into v from public.transactions where id = tx;
    res := res || format(E'Mingguan dibayar (1501.50 − 3.5 hari × 40): %s (jangka 1361.50)\n', v); if v is distinct from 1361.50 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Admin outlet 1: advance + gaji bulanan =====
    perform set_config('request.jwt.claims', json_build_object('sub', uAd, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.give_advance(eM, 100, 'Tunai');
    res := res || E'Admin beri advance pekerja outlet sendiri: OK\n';
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, base_amount, absent_days, absent_deduction, open_days)
      values (eM, '2026-11-01', '2026-11-30', 'bulanan', 2000, 0, 2000, 1, 76.92, 30) returning id into pM;
    reset role;
    -- Advance baru diberi oleh owner selepas admin buka halaman (admin masih papar 1823.08).
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.give_advance(eM, 20, 'Tunai');
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', uAd, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.pay_payroll(pM, 'Tunai', 1823.08);
      res := res || E'Advance baru selepas halaman dibuka: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Advance baru selepas halaman dibuka: ditolak (betul) — %s\n', sqlerrm); end;
    tx := public.pay_payroll(pM, 'Tunai', 1803.08);
    select amount into v from public.transactions where id = tx;
    select advance_deduction into v2 from public.payroll where id = pM;
    res := res || format(E'Admin bayar bulanan (2000 − 76.92 − advance 120): %s, advance %s (jangka 1803.08, 120)\n', v, v2);
    if v is distinct from 1803.08 or v2 is distinct from 120 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Syarikat B: pengasingan =====
    perform set_config('request.jwt.claims', json_build_object('sub', uB, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.payroll where business_id = bizA;
    res := res || format(E'Owner B nampak slip A: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin perform public.payroll_calc(eM, '2026-11-01', '2026-11-30');
      res := res || E'Owner B kira gaji pekerja A: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner B kira gaji pekerja A: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.give_advance(eM, 10, 'Tunai');
      res := res || E'Owner B advance pekerja A: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner B advance pekerja A: ditolak (betul) — %s\n', sqlerrm); end;
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, base_amount, open_days)
      values (eB, '2026-11-01', '2026-11-30', 'bulanan', 1500, 1500, 30) returning id into pB;
    tx := public.pay_payroll(pB, 'Tunai', 1500);
    res := res || format(E'Owner B bayar pekerja sendiri: transaksi %s (jangka ada)\n', coalesce(tx::text, 'TIADA')); if tx is null then gagal := gagal + 1; end if;
    reset role;

    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 20 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
