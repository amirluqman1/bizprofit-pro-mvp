-- Ujian Fasa 18: Peraturan potongan tidak hadir (semua dibatalkan)
-- Hasil keluar sebagai mesej ralat "HASIL UJIAN".
do $$
declare res text := ''; gagal int := 0; n int; v numeric; v2 numeric; tx bigint;
  o uuid; biz uuid; ol uuid; m uuid; pay text; e uuid; eMgr uuid; p1 uuid;
  bB uuid; outB uuid; eB uuid;
  hari date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  select user_id, business_id into o, biz from public.staff_profiles where role = 'owner' limit 1;
  select id into ol from public.outlets where business_id = biz order by name limit 1;
  select name into pay from public.payment_methods where business_id = biz limit 1;

  -- Slip sedia ada: net_amount tidak berubah (potongan tidak hadir = 0).
  select count(*) into n from public.payroll
   where absent_deduction <> 0 or absent_days <> 0
      or net_amount <> greatest(base_amount + ot_amount + allowance - deduction - advance_deduction, 0);
  res := res || format(E'Slip sedia ada berubah: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
  select count(*) into n from public.employees where absent_rule <> 'penuh';
  res := res || format(E'Pekerja sedia ada bukan "penuh": %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;

  begin
    -- Sediakan data (sebagai postgres): pakej Business, kategori gaji, seorang manager outlet ol.
    update public.businesses set plan = 'business', plan_until = null, trial_ends_at = null where id = biz;
    insert into public.categories (business_id, key, name, type, counts_in_profit)
      values (biz, 'OUT06', 'Staff Wages', 'Out', true) on conflict do nothing;
    select user_id into m from public.staff_profiles where business_id = biz and role <> 'owner' limit 1;
    if m is not null then update public.staff_profiles set role = 'manager', outlet_id = ol where user_id = m; end if;

    -- Syarikat B dengan seorang pekerja.
    insert into public.businesses (name) values ('Syarikat Ujian F18') returning id into bB;
    insert into public.outlets (business_id, name) values (bB, 'Outlet B F18') returning id into outB;
    insert into public.employees (business_id, outlet_id, name, pay_type, rate) values (bB, outB, 'Pekerja B', 'bulanan', 1500) returning id into eB;

    -- ===== Owner =====
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.employees (outlet_id, name, pay_type, rate, absent_rule, absent_workdays)
      values (ol, 'UJI F18 Bulanan', 'bulanan', 2600, 'sehari', 26) returning id into e;
    res := res || E'Owner tambah pekerja "potong sehari ÷ 26": OK\n';
    begin
      insert into public.employees (outlet_id, name, pay_type, rate, absent_rule) values (ol, 'UJI F18 X', 'bulanan', 2000, 'sehari');
      res := res || E'"sehari" tanpa hari bekerja: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when check_violation then res := res || E'"sehari" tanpa hari bekerja: ditolak (betul)\n'; end;
    begin
      insert into public.employees (outlet_id, name, pay_type, rate, absent_rule) values (ol, 'UJI F18 Y', 'bulanan', 2000, 'tetap');
      res := res || E'"tetap" tanpa jumlah: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when check_violation then res := res || E'"tetap" tanpa jumlah: ditolak (betul)\n'; end;
    begin
      insert into public.employees (outlet_id, name, pay_type, rate, absent_rule) values (ol, 'UJI F18 Z', 'bulanan', 2000, 'lain');
      res := res || E'Peraturan tak sah: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when check_violation then res := res || E'Peraturan tak sah: ditolak (betul)\n'; end;
    insert into public.employees (outlet_id, name, pay_type, rate, is_manager) values (ol, 'UJI F18 Pengurus', 'bulanan', 4000, true) returning id into eMgr;

    -- Gaji 2600, 2 hari tidak hadir × 100 = potong 200, advance 300 → bersih 2100.
    perform public.give_advance(e, 300, pay);
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, base_amount, absent_days, absent_deduction)
      values (e, hari - 29, hari, 'bulanan', 2600, 24, 2600, 2, 200) returning id into p1;
    select net_amount into v from public.payroll where id = p1;
    res := res || format(E'Draf: bersih sebelum advance %s (jangka 2400)\n', v); if v <> 2400 then gagal := gagal + 1; end if;
    tx := public.pay_payroll(p1, pay);
    select advance_deduction, net_amount into v, v2 from public.payroll where id = p1;
    res := res || format(E'Bayar: advance %s, bersih %s (jangka 300, 2100)\n', v, v2); if v <> 300 or v2 <> 2100 then gagal := gagal + 1; end if;
    select amount into v from public.transactions where id = tx;
    res := res || format(E'Transaksi Staff Wages: %s (jangka 2100)\n', v); if v is distinct from 2100 then gagal := gagal + 1; end if;
    begin
      update public.payroll set absent_deduction = 0 where id = p1;
      get diagnostics n = row_count;
      res := res || format(E'Ubah potongan slip dibayar: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    exception when others then res := res || E'Ubah potongan slip dibayar: ditolak (betul)\n'; end;

    -- Advance melebihi gaji selepas potongan: advance dihadkan kepada gaji kasar.
    perform public.give_advance(e, 5000, pay);
    insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, days_worked, base_amount, absent_days, absent_deduction)
      values (e, hari + 1, hari + 30, 'bulanan', 2600, 20, 2600, 6, 600) returning id into p1;
    tx := public.pay_payroll(p1, pay);
    select advance_deduction, net_amount into v, v2 from public.payroll where id = p1;
    res := res || format(E'Advance > gaji: advance %s, bersih %s (jangka 2000, 0)\n', v, v2); if v <> 2000 or v2 <> 0 then gagal := gagal + 1; end if;

    -- Pengasingan syarikat
    update public.employees set absent_rule = 'tetap', absent_amount = 1 where id = eB;
    get diagnostics n = row_count;
    res := res || format(E'Owner ubah peraturan pekerja syarikat B: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    select count(*) into n from public.employees where id = eB;
    res := res || format(E'Owner nampak pekerja syarikat B: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Manager =====
    if m is null then
      res := res || E'Manager: DILANGKAU (tiada akaun bukan owner dalam syarikat)\n';
    else
      perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.employees set absent_rule = 'tetap', absent_amount = 120 where id = e;
      get diagnostics n = row_count;
      res := res || format(E'Manager ubah peraturan pekerja outlet sendiri: %s baris (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
      update public.employees set absent_rule = 'penuh' where id = eMgr;
      get diagnostics n = row_count;
      res := res || format(E'Manager ubah peraturan pekerja peringkat pengurus: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
      update public.employees set absent_rule = 'penuh' where id = eB;
      get diagnostics n = row_count;
      res := res || format(E'Manager ubah peraturan pekerja syarikat B: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
      reset role;
    end if;

    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 18 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
