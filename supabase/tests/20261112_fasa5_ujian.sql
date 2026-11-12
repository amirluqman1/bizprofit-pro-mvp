-- Ujian Fasa 5 (semua dibatalkan di hujung)
do $$
declare
  res text := ''; gagal int := 0; n int; v numeric; tx bigint;
  o uuid; mL uuid; mI uuid; mA uuid; lubok uuid; intan uuid; amir uuid;
  eStaff uuid; eMgr uuid; eIntan uuid; pr uuid; prMgr uuid; pay text;
  hari date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  procedure_dummy int;
begin
  select id into lubok from public.outlets where name = 'Lubok Sarapan';
  select id into intan from public.outlets where name = 'Restoran 3 Intan';
  select id into amir  from public.outlets where name = 'Amir Food Industry Services';
  select user_id into o  from public.staff_profiles where role = 'owner' limit 1;
  select user_id into mL from public.staff_profiles where role = 'manager' and outlet_id = lubok;
  select user_id into mI from public.staff_profiles where role = 'manager' and outlet_id = intan;
  select user_id into mA from public.staff_profiles where role = 'manager' and outlet_id = amir;
  select name into pay from public.payment_methods limit 1;

  begin
    insert into public.categories (business_id, key, name, type, counts_in_profit)
      select business_id, 'OUT06', 'Staff Wages', 'Out', true from public.outlets where id = lubok
      on conflict do nothing;
    update public.staff_profiles set role = 'staff' where user_id = mA;   -- manager Amir jadi staff sementara

    -- ---------- OWNER ----------
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    insert into public.employees (outlet_id, name, pay_type, rate, ot_rate) values (lubok, 'Ali', 'harian', 60, 8) returning id into eStaff;
    insert into public.employees (outlet_id, name, pay_type, rate, is_manager) values (lubok, 'Pengurus Lubok', 'bulanan', 2500, true) returning id into eMgr;
    insert into public.employees (outlet_id, name, pay_type, rate) values (intan, 'Siti', 'harian', 55) returning id into eIntan;
    select count(*) into n from public.employees; res := res || format(E'Owner nampak pekerja: %s (jangka 3)\n', n); if n<>3 then gagal:=gagal+1; end if;
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, base_amount) values (eMgr, hari - 30, hari, 'bulanan', 2500, 2500) returning id into prMgr;
    reset role;

    -- ---------- MANAGER Lubok ----------
    perform set_config('request.jwt.claims', json_build_object('sub', mL)::text, true);
    set local role authenticated;
    select count(*) into n from public.employees; res := res || format(E'Manager Lubok nampak pekerja: %s (jangka 1, bukan pengurus)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.payroll; res := res || format(E'Manager Lubok nampak gaji pengurus: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin insert into public.employees (outlet_id, name, pay_type, rate) values (lubok, 'Abu', 'harian', 50); res := res || E'Manager tambah pekerja outlet sendiri: OK\n';
    exception when others then res := res || 'Manager tambah pekerja: GAGAL '||sqlerrm||E'\n'; gagal:=gagal+1; end;
    begin insert into public.employees (outlet_id, name, pay_type, rate) values (intan, 'Curi', 'harian', 50); res := res || E'Manager tambah ke outlet lain: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager tambah ke outlet lain: ditolak (betul)\n'; end;
    begin insert into public.employees (outlet_id, name, pay_type, rate, is_manager) values (lubok, 'Diri', 'bulanan', 9999, true); res := res || E'Manager cipta peringkat manager: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager cipta peringkat manager: ditolak (betul)\n'; end;
    begin update public.employees set is_manager = true where id = eStaff; res := res || E'Manager naikkan ke peringkat manager: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager naikkan ke peringkat manager: ditolak (betul)\n'; end;
    update public.employees set rate = 9000 where id = eMgr; get diagnostics n = row_count;
    res := res || format(E'Manager ubah gaji pengurus: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin insert into public.attendance (employee_id, work_date, status, ot_hours) values (eStaff, hari, 'hadir', 2);
      insert into public.attendance (employee_id, work_date, status) values (eStaff, hari - 1, 'separuh');
      res := res || E'Manager tanda kehadiran: OK\n';
    exception when others then res := res || 'Manager tanda kehadiran: GAGAL '||sqlerrm||E'\n'; gagal:=gagal+1; end;
    begin insert into public.attendance (employee_id, work_date, status) values (eStaff, hari, 'cuti'); res := res || E'Dua rekod sehari: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Dua rekod hari sama: ditolak (betul)\n'; end;
    begin insert into public.attendance (employee_id, work_date, status) values (eMgr, hari, 'hadir'); res := res || E'Manager tanda pengurus: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager tanda kehadiran pengurus: ditolak (betul)\n'; end;
    select count(*) into n from public.attendance where marked_by = mL; res := res || format(E'Kehadiran dicatat atas nama manager: %s (jangka 2)\n', n); if n<>2 then gagal:=gagal+1; end if;
    -- Payroll: 1.5 hari x 60 + 2 jam OT x 8 + elaun 10 - potongan 5 = 111
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, ot_hours, ot_rate, base_amount, ot_amount, allowance, deduction)
      values (eStaff, hari - 6, hari, 'harian', 60, 1.5, 2, 8, 90, 16, 10, 5) returning id into pr;
    select net_amount into v from public.payroll where id = pr; res := res || format(E'Gaji bersih dikira: %s (jangka 111.00)\n', v); if v<>111 then gagal:=gagal+1; end if;
    begin insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, base_amount, status) values (eStaff, hari - 40, hari - 31, 'harian', 60, 100, 'dibayar');
      res := res || E'Cipta slip terus "dibayar": DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Cipta slip terus "dibayar": ditolak (betul)\n'; end;
    tx := public.pay_payroll(pr, pay);
    select count(*) into n from public.transactions where id = tx and category = 'Staff Wages' and amount = 111 and type = 'Out' and outlet_id = lubok;
    res := res || format(E'Bayar -> transaksi Staff Wages RM111 di Lubok: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.payroll where id = pr and status = 'dibayar' and transaction_id = tx; res := res || format(E'Slip ditanda dibayar: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    update public.payroll set allowance = 999 where id = pr; get diagnostics n = row_count;
    res := res || format(E'Ubah slip selepas dibayar: %s baris (jangka 0, dikunci)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin perform public.pay_payroll(pr, pay); res := res || E'Bayar dua kali: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Bayar dua kali: ditolak (betul)\n'; end;
    reset role;

    -- ---------- MANAGER Intan ----------
    perform set_config('request.jwt.claims', json_build_object('sub', mI)::text, true);
    set local role authenticated;
    select count(*) into n from public.employees; res := res || format(E'Manager Intan nampak pekerja: %s (jangka 1, Siti)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.attendance; res := res || format(E'Manager Intan nampak kehadiran Lubok: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin insert into public.attendance (employee_id, work_date, status) values (eStaff, hari - 2, 'hadir'); res := res || E'Manager Intan tanda pekerja Lubok: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager Intan tanda pekerja Lubok: ditolak (betul)\n'; end;
    reset role;

    -- ---------- STAFF ----------
    perform set_config('request.jwt.claims', json_build_object('sub', mA)::text, true);
    set local role authenticated;
    select count(*) into n from public.employees; res := res || format(E'Staff nampak pekerja: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    select count(*) into n from public.payroll;   res := res || format(E'Staff nampak gaji: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin insert into public.employees (outlet_id, name, pay_type, rate) values (amir, 'X', 'harian', 1); res := res || E'Staff tambah pekerja: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Staff tambah pekerja: ditolak (betul)\n'; end;
    reset role;

    -- ---------- OWNER: nampak gaji pengurus ----------
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    select count(*) into n from public.payroll; res := res || format(E'Owner nampak semua slip: %s (jangka 2)\n', n); if n<>2 then gagal:=gagal+1; end if;
    reset role;

    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 5 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
