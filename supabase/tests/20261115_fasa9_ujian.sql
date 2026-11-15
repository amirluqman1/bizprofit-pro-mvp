-- Ujian Fasa 9: Admin, edit/padam transaksi, log audit (semua dibatalkan)
do $$
declare res text := ''; gagal int := 0; n int; v text;
  o uuid; aL uuid; aA uuid; mI uuid; st uuid; lubok uuid; intan uuid; amir uuid;
  txL bigint; txI bigint; txG bigint; txG2 bigint; slip uuid;
begin
  select id into lubok from public.outlets where name = 'Lubok Sarapan';
  select id into intan from public.outlets where name = 'Restoran 3 Intan';
  select id into amir  from public.outlets where name = 'Amir Food Industry Services';
  select user_id into o from public.staff_profiles where role = 'owner' limit 1;
  select user_id into aL from public.staff_profiles where outlet_id = lubok and role in ('manager', 'admin') limit 1;
  select user_id into aA from public.staff_profiles where outlet_id = amir and role in ('manager', 'admin') and user_id <> o limit 1;
  select user_id into mI from public.staff_profiles where outlet_id = intan and role in ('manager', 'admin') limit 1;
  begin
    update public.staff_profiles set role = 'admin' where user_id in (aL, aA);
    update public.staff_profiles set role = 'manager' where user_id = mI;
    insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method, outlet_id, created_by)
      select business_id, current_date, 'Out', (select name from public.categories where type = 'Out' and name <> 'Staff Wages' limit 1), 10, 'UJI Lubok',
             (select name from public.payment_methods limit 1), lubok, o from public.outlets where id = lubok returning id into txL;
    insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method, outlet_id, created_by)
      select business_id, current_date, 'Out', (select name from public.categories where type = 'Out' and name <> 'Staff Wages' limit 1), 20, 'UJI Intan',
             (select name from public.payment_methods limit 1), intan, o from public.outlets where id = intan returning id into txI;
    select transaction_id, id into txG, slip from public.payroll where transaction_id is not null and status = 'dibayar'
      and employee_id in (select id from public.employees where outlet_id = lubok) limit 1;
    select transaction_id into txG2 from public.payroll where transaction_id is not null and transaction_id <> txG
      and employee_id in (select id from public.employees where outlet_id = lubok) limit 1;

    -- ===== Admin Lubok =====
    perform set_config('request.jwt.claims', json_build_object('sub', aL)::text, true);
    set local role authenticated;
    select count(*) into n from public.transactions where outlet_id = intan;
    res := res || format(E'Admin Lubok nampak transaksi Intan: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    select count(*) into n from public.transactions where id = txL;
    res := res || format(E'Admin Lubok nampak transaksi Lubok: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    update public.transactions set description = 'UJI Lubok (dibetulkan)' where id = txL;
    get diagnostics n = row_count;
    res := res || format(E'Admin Lubok ubah transaksi Lubok: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    update public.transactions set description = 'cuba' where id = txI;
    get diagnostics n = row_count;
    res := res || format(E'Admin Lubok ubah transaksi Intan: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    delete from public.transactions where id = txI;
    get diagnostics n = row_count;
    res := res || format(E'Admin Lubok padam transaksi Intan: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin update public.transactions set outlet_id = intan where id = txL;
      res := res || E'Admin Lubok pindah transaksi ke Intan: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Admin Lubok pindah transaksi ke Intan: ditolak (betul)\n'; end;
    begin update public.transactions set created_by = aL where id = txL;
      res := res || E'Ubah pencipta transaksi: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Ubah pencipta transaksi: ditolak (betul)\n'; end;
    begin update public.transactions set amount = 1 where id = txG2;
      res := res || E'Ubah jumlah rekod gaji: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Ubah jumlah rekod gaji: ditolak (betul)\n'; end;
    delete from public.transactions where id = txG;
    get diagnostics n = row_count;
    res := res || format(E'Admin Lubok padam rekod gaji: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select status into v from public.payroll where id = slip;
    res := res || format(E'Slip gaji selepas rekod dipadam: %s (jangka draf)\n', v); if v<>'draf' then gagal:=gagal+1; end if;
    select count(*) into n from public.transaction_audit where transaction_id in (txL, txG);
    res := res || format(E'Admin Lubok nampak log audit: %s (jangka 2)\n', n); if n<>2 then gagal:=gagal+1; end if;
    select note into v from public.transaction_audit where transaction_id = txG;
    res := res || format(E'Nota log padam gaji: %s\n', v); if v is null then gagal:=gagal+1; end if;
    begin insert into public.transaction_audit (business_id, outlet_id, transaction_id, action, old_data) values (public.current_business_id(), lubok, 1, 'padam', '{}');
      res := res || E'Tulis log audit sendiri: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Tulis log audit sendiri: ditolak (betul)\n'; end;
    begin delete from public.transaction_audit; get diagnostics n = row_count;
      res := res || format(E'Padam log audit: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    exception when others then res := res || E'Padam log audit: ditolak (betul)\n'; end;
    select count(*) into n from public.daily_summary;
    res := res || format(E'Admin Lubok nampak ringkasan profit: %s baris (jangka >0)\n', n); if n=0 then gagal:=gagal+1; end if;
    select count(*) into n from public.employees where outlet_id = lubok;
    res := res || format(E'Admin Lubok nampak pekerja Lubok: %s (jangka >0)\n', n); if n=0 then gagal:=gagal+1; end if;
    select count(*) into n from public.employees where outlet_id <> lubok;
    res := res || format(E'Admin Lubok nampak pekerja outlet lain: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;

    -- ===== Admin Amir: tak nampak log Lubok =====
    perform set_config('request.jwt.claims', json_build_object('sub', aA)::text, true);
    set local role authenticated;
    select count(*) into n from public.transaction_audit;
    res := res || format(E'Admin Amir nampak log Lubok: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;

    -- ===== Manager Intan: tak boleh ubah/padam, tak nampak log =====
    perform set_config('request.jwt.claims', json_build_object('sub', mI)::text, true);
    set local role authenticated;
    update public.transactions set description = 'cuba' where id = txI;
    get diagnostics n = row_count;
    res := res || format(E'Manager ubah transaksi outlet sendiri: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    delete from public.transactions where id = txI;
    get diagnostics n = row_count;
    res := res || format(E'Manager padam transaksi outlet sendiri: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    select count(*) into n from public.transaction_audit;
    res := res || format(E'Manager nampak log audit: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;

    -- ===== Staff: tak boleh ubah/padam =====
    update public.staff_profiles set role = 'staff', outlet_id = intan where user_id = mI;
    perform set_config('request.jwt.claims', json_build_object('sub', mI)::text, true);
    set local role authenticated;
    delete from public.transactions where id = txI;
    get diagnostics n = row_count;
    res := res || format(E'Staff padam transaksi: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    select count(*) into n from public.employees;
    res := res || format(E'Staff nampak pekerja/gaji: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;

    -- ===== Owner: semua outlet =====
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    delete from public.transactions where id = txI;
    get diagnostics n = row_count;
    res := res || format(E'Owner padam transaksi Intan: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.transaction_audit where transaction_id in (txL, txG, txI);
    res := res || format(E'Owner nampak semua log: %s (jangka 3)\n', n); if n<>3 then gagal:=gagal+1; end if;
    reset role;
    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 9 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
