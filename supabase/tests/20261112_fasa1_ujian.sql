-- Ujian Fasa 1. Semua perubahan ujian DIBATALKAN di hujung (rollback).
do $$
declare
  res text := ''; gagal int := 0; n int; v numeric;
  o uuid; mA uuid; mI uuid; stf uuid;
  amir uuid; lubok uuid; intan uuid; pay text;
  hari date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  select id into amir  from public.outlets where name = 'Amir Food Industry Services';
  select id into lubok from public.outlets where name = 'Lubok Sarapan';
  select id into intan from public.outlets where name = 'Restoran 3 Intan';
  select user_id into o   from public.staff_profiles where role = 'owner' limit 1;
  select user_id into mA  from public.staff_profiles where role = 'manager' and outlet_id = amir;
  select user_id into mI  from public.staff_profiles where role = 'manager' and outlet_id = intan;
  select user_id into stf from public.staff_profiles where role = 'manager' and outlet_id = lubok;
  select name into pay from public.payment_methods limit 1;

  begin  -- ===== blok ujian, dibatalkan di hujung =====
    update public.staff_profiles set role = 'staff' where user_id = stf;  -- manager Lubok jadi staff sementara

    -- Data ujian (dimasukkan terus, kemudian dibatalkan)
    insert into public.transactions (business_id, transaction_date, type, category, amount, payment_method, outlet_id, created_by, created_at)
    select b, d, ty, cat, amt, pay, ou, cb, ca from (values
      ((select business_id from public.outlets where id = lubok), hari,     'In',  'Shop Sales',  50::numeric, lubok, stf, now()),                       -- staff, hari ini
      ((select business_id from public.outlets where id = lubok), hari - 1, 'Out', 'Ingredients', 20::numeric, lubok, stf, now() - interval '1 day'),  -- staff, semalam
      ((select business_id from public.outlets where id = intan), hari,     'In',  'Shop Sales', 100::numeric, intan, mI,  now()),                       -- manager Intan
      ((select business_id from public.outlets where id = amir),  hari,     'In',  'Shop Sales', 200::numeric, amir,  o,   now()),                       -- owner di Amir Food
      ((select business_id from public.outlets where id = lubok), hari,     'In',  'Shop Sales',  70::numeric, lubok, o,   now())                        -- owner di Lubok (outlet staff)
    ) as x(b, d, ty, cat, amt, ou, cb, ca);

    -- ---------- STAFF Lubok ----------
    perform set_config('request.jwt.claims', json_build_object('sub', stf)::text, true);
    set local role authenticated;
    select count(*) into n from public.transactions;
    res := res || format(E'Staff nampak transaksi: %s (jangka 1, hanya miliknya hari ini)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.daily_summary;
    res := res || format(E'Staff nampak ringkasan/profit: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin
      insert into public.transactions (transaction_date, type, category, amount, payment_method, outlet_id, description)
      values (hari, 'In', 'Shop Sales', 10, pay, lubok, 'ujian staff');
      res := res || E'Staff key in transaksi: OK\n';
    exception when others then res := res || 'Staff key in: GAGAL ' || sqlerrm || E'\n'; gagal:=gagal+1; end;
    select count(*) into n from public.transactions;
    res := res || format(E'Staff nampak selepas key in: %s (jangka 2)\n', n); if n<>2 then gagal:=gagal+1; end if;
    begin
      insert into public.transactions (transaction_date, type, category, amount, payment_method, outlet_id)
      values (hari, 'In', 'Shop Sales', 10, pay, intan);
      res := res || E'Staff key in ke outlet lain: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Staff key in ke outlet lain: ditolak (betul)\n'; end;
    reset role;

    -- ---------- MANAGER 3 Intan ----------
    perform set_config('request.jwt.claims', json_build_object('sub', mI)::text, true);
    set local role authenticated;
    select count(*) into n from public.transactions;
    res := res || format(E'Manager Intan nampak transaksi: %s (jangka 1, outlet sendiri)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select coalesce(sum(profit),0) into v from public.daily_summary;
    res := res || format(E'Manager Intan nampak profit: %s (jangka 100)\n', v); if v<>100 then gagal:=gagal+1; end if;
    reset role;

    -- ---------- MANAGER Amir Food ----------
    perform set_config('request.jwt.claims', json_build_object('sub', mA)::text, true);
    set local role authenticated;
    select count(*) into n from public.transactions;
    res := res || format(E'Manager Amir Food nampak transaksi: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select coalesce(sum(profit),0) into v from public.daily_summary;
    res := res || format(E'Manager Amir Food nampak profit: %s (jangka 200)\n', v); if v<>200 then gagal:=gagal+1; end if;
    reset role;

    -- ---------- OWNER ----------
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    select count(*) into n from public.transactions;
    res := res || format(E'Owner nampak transaksi: %s (jangka 6)\n', n); if n<>6 then gagal:=gagal+1; end if;
    select coalesce(sum(profit),0) into v from public.daily_summary where transaction_date = hari;
    res := res || format(E'Owner profit hari ini semua outlet: %s (jangka 430)\n', v); if v<>430 then gagal:=gagal+1; end if;
    select coalesce(sum(profit),0) into v from public.daily_summary where transaction_date = hari - 1;
    res := res || format(E'Owner profit semalam: %s (jangka -20)\n', v); if v<>-20 then gagal:=gagal+1; end if;
    reset role;

    raise exception 'UNDO_UJIAN';
  exception when raise_exception then
    if sqlerrm <> 'UNDO_UJIAN' then raise; end if;
  end;

  raise exception E'\n===== HASIL UJIAN FASA 1 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
