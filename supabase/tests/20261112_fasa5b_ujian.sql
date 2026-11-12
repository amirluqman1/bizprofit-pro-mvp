-- Ujian Fasa 5b (semua dibatalkan)
do $$
declare res text := ''; gagal int := 0; n int; v numeric; tx bigint;
  o uuid; mL uuid; mI uuid; mA uuid; lubok uuid; intan uuid; e uuid; eW uuid; p1 uuid; p2 uuid; pay text;
  hari date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  select id into lubok from public.outlets where name = 'Lubok Sarapan';
  select id into intan from public.outlets where name = 'Restoran 3 Intan';
  select user_id into o  from public.staff_profiles where role = 'owner' limit 1;
  select user_id into mL from public.staff_profiles where role = 'manager' and outlet_id = lubok;
  select user_id into mI from public.staff_profiles where role = 'manager' and outlet_id = intan;
  select user_id into mA from public.staff_profiles where role = 'manager' and outlet_id <> lubok and outlet_id <> intan;
  select name into pay from public.payment_methods limit 1;
  begin
    insert into public.categories (business_id, key, name, type, counts_in_profit)
      select business_id, 'OUT06', 'Staff Wages', 'Out', true from public.outlets where id = lubok on conflict do nothing;
    update public.staff_profiles set role = 'staff' where user_id = mA;

    perform set_config('request.jwt.claims', json_build_object('sub', mL)::text, true);
    set local role authenticated;
    insert into public.employees (outlet_id, name, pay_type, rate) values (lubok, 'Ali', 'harian', 60) returning id into e;
    begin insert into public.employees (outlet_id, name, pay_type, rate) values (lubok, 'Wan', 'mingguan', 350) returning id into eW;
      res := res || E'Pekerja gaji mingguan: OK\n';
    exception when others then res := res || 'Pekerja mingguan: GAGAL '||sqlerrm||E'\n'; gagal:=gagal+1; end;
    perform public.give_advance(e, 100, pay, 'Duit sewa');
    select count(*) into n from public.transactions where category = 'Staff Wages' and amount = 100 and outlet_id = lubok and description like 'Advance gaji Ali%';
    res := res || format(E'Advance RM100 -> transaksi Staff Wages: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    v := public.advance_balance(e); res := res || format(E'Baki advance: %s (jangka 100)\n', v); if v<>100 then gagal:=gagal+1; end if;
    begin insert into public.salary_advances (employee_id, amount) values (e, 50); res := res || E'Tambah advance terus (tanpa transaksi): DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Tambah advance terus (tanpa transaksi): ditolak (betul)\n'; end;
    begin perform public.give_advance(e, 0, pay); res := res || E'Advance RM0: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Advance RM0: ditolak (betul)\n'; end;
    -- Gaji kasar 300 -> tolak advance 100 -> bayar 200
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, base_amount) values (e, hari - 6, hari, 'harian', 60, 5, 300) returning id into p1;
    tx := public.pay_payroll(p1, pay);
    select advance_deduction, net_amount into v, n from public.payroll where id = p1;
    res := res || format(E'Gaji 300 tolak advance: tolak %s, bersih %s (jangka 100, 200)\n', v, n); if v<>100 or n<>200 then gagal:=gagal+1; end if;
    select count(*) into n from public.transactions where id = tx and amount = 200; res := res || format(E'Transaksi gaji RM200: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    v := public.advance_balance(e); res := res || format(E'Baki advance selepas gaji: %s (jangka 0)\n', v); if v<>0 then gagal:=gagal+1; end if;
    -- Advance 500 > gaji 300: gaji jadi 0, baki 200 dibawa
    perform public.give_advance(e, 500, pay);
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, base_amount) values (e, hari + 1, hari + 7, 'harian', 60, 5, 300) returning id into p2;
    tx := public.pay_payroll(p2, pay);
    select net_amount into n from public.payroll where id = p2;
    res := res || format(E'Advance 500 > gaji 300: bersih %s, transaksi %s (jangka 0, tiada)\n', n, coalesce(tx::text, 'tiada')); if n<>0 or tx is not null then gagal:=gagal+1; end if;
    select count(*) into n from public.payroll where id = p2 and status = 'dibayar'; res := res || format(E'Slip tetap ditanda dibayar: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    v := public.advance_balance(e); res := res || format(E'Baki advance dibawa: %s (jangka 200)\n', v); if v<>200 then gagal:=gagal+1; end if;
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', mI)::text, true);
    set local role authenticated;
    begin perform public.give_advance(e, 10, pay); res := res || E'Manager Intan beri advance pekerja Lubok: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager Intan beri advance pekerja Lubok: ditolak (betul)\n'; end;
    select count(*) into n from public.salary_advances; res := res || format(E'Manager Intan nampak advance Lubok: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', mA)::text, true);
    set local role authenticated;
    begin perform public.give_advance(e, 10, pay); res := res || E'Staff beri advance: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Staff beri advance: ditolak (betul)\n'; end;
    reset role;
    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 5b (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
