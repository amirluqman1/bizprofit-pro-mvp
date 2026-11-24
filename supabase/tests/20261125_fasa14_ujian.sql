-- Ujian Fasa 14: status off, elaun/potongan tetap, ansuran advance (semua dibatalkan)
-- Hasil keluar sebagai mesej ralat "HASIL UJIAN".
do $$
declare res text := ''; gagal int := 0; n numeric; o uuid; biz uuid; outl uuid; emp uuid; a1 uuid; a2 uuid; pr uuid; pr2 uuid; ok boolean;
begin
  select user_id, business_id into o, biz from public.staff_profiles where role = 'owner' limit 1;
  select id into outl from public.outlets where business_id = biz limit 1;
  update public.businesses set plan = 'pro', plan_until = null where id = biz;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.employees (business_id, outlet_id, name, pay_type, rate, ot_rate, default_allowance, allowance_note, default_deduction, deduction_note)
    values (biz, outl, 'UJI Fasa14', 'bulanan', 1500, 0, 100, 'Elaun makan', 150, 'Sewa asrama') returning id into emp;
  res := res || E'Simpan pekerja dengan elaun/potongan tetap: OK\n';

  insert into public.attendance (business_id, employee_id, work_date, status, ot_hours) values (biz, emp, current_date, 'off', 0);
  res := res || E'Tanda status off: OK (jangka OK)\n';
  begin
    insert into public.attendance (business_id, employee_id, work_date, status, ot_hours) values (biz, emp, current_date - 1, 'rehat', 0);
    res := res || E'Status tak sah diterima: BERJAYA (jangka GAGAL)\n'; gagal := gagal + 1;
  exception when check_violation then res := res || E'Status tak sah ditolak: GAGAL (jangka GAGAL)\n';
  end;

  -- Tanpa ansuran: tolak penuh (macam dulu)
  perform public.give_advance(emp, 100, (select name from public.payment_methods where business_id = biz limit 1), null, null);
  n := public.advance_due(emp);
  res := res || format(E'Tanpa ansuran, perlu ditolak: %s (jangka 100)\n', n); if n <> 100 then gagal := gagal + 1; end if;

  -- Advance RM600 dengan ansuran RM200 setiap gaji (baki jadi 700)
  perform public.give_advance(emp, 600, (select name from public.payment_methods where business_id = biz limit 1), 'UJI', 200);
  select advance_installment into n from public.employees where id = emp;
  res := res || format(E'Ansuran pekerja disimpan: %s (jangka 200.00)\n', n); if n is distinct from 200 then gagal := gagal + 1; end if;
  n := public.advance_due(emp);
  res := res || format(E'Perlu ditolak gaji 1: %s (jangka 200)\n', n); if n <> 200 then gagal := gagal + 1; end if;

  -- Bayar gaji 1: gross 1500 + 100 - 150 = 1450 → tolak 200
  insert into public.payroll (business_id, employee_id, period_start, period_end, pay_type, rate, days_worked, ot_hours, ot_rate,
                              base_amount, ot_amount, allowance, deduction, allowance_note, deduction_note)
    values (biz, emp, current_date - 30, current_date - 1, 'bulanan', 1500, 26, 0, 0, 1500, 0, 100, 150, 'Elaun makan', 'Sewa asrama') returning id into pr;
  perform public.pay_payroll(pr, (select name from public.payment_methods where business_id = biz limit 1));
  select advance_deduction into n from public.payroll where id = pr;
  res := res || format(E'Gaji 1 tolak advance: %s (jangka 200.00)\n', n); if n <> 200 then gagal := gagal + 1; end if;
  select net_amount into n from public.payroll where id = pr;
  res := res || format(E'Gaji 1 bersih: %s (jangka 1250.00)\n', n); if n <> 1250 then gagal := gagal + 1; end if;
  n := public.advance_balance(emp);
  res := res || format(E'Baki advance selepas gaji 1: %s (jangka 500)\n', n); if n <> 500 then gagal := gagal + 1; end if;

  -- Gaji kecil RM120: potongan dihadkan kepada gaji kasar
  insert into public.payroll (business_id, employee_id, period_start, period_end, pay_type, rate, days_worked, ot_hours, ot_rate,
                              base_amount, ot_amount, allowance, deduction)
    values (biz, emp, current_date, current_date, 'bulanan', 1500, 1, 0, 0, 120, 0, 0, 0) returning id into pr2;
  perform public.pay_payroll(pr2, (select name from public.payment_methods where business_id = biz limit 1));
  select advance_deduction into n from public.payroll where id = pr2;
  res := res || format(E'Gaji kecil RM120 tolak advance: %s (jangka 120.00)\n', n); if n <> 120 then gagal := gagal + 1; end if;

  -- Baki 380 < ansuran? tidak; tukar ansuran ke 500 → perlu ditolak = baki 380
  update public.employees set advance_installment = 500 where id = emp;
  n := public.advance_due(emp);
  res := res || format(E'Ansuran lebih dari baki, perlu ditolak: %s (jangka 380)\n', n); if n <> 380 then gagal := gagal + 1; end if;

  begin
    perform public.give_advance(emp, 100, (select name from public.payment_methods where business_id = biz limit 1), null, 0);
    res := res || E'Ansuran RM0 diterima: BERJAYA (jangka GAGAL)\n'; gagal := gagal + 1;
  exception when raise_exception then res := res || E'Ansuran RM0 ditolak: GAGAL (jangka GAGAL)\n';
  end;

  reset role;
  raise exception E'HASIL UJIAN (% gagal)\n%', gagal, res;
end $$;
