-- Ujian Fasa 13: Gambar resit (semua dibatalkan)
-- Hasil keluar sebagai mesej ralat "HASIL UJIAN".
do $$
declare res text := ''; gagal int := 0; n int; ok boolean;
  o uuid; m uuid; biz uuid; mOutlet uuid; other uuid; tx bigint; txO bigint;
  pM text; pO text; pX text;
begin
  select user_id, business_id into o, biz from public.staff_profiles where role = 'owner' limit 1;
  select user_id, outlet_id into m, mOutlet from public.staff_profiles where role in ('manager', 'admin', 'staff') and user_id <> o limit 1;
  select id into other from public.outlets where business_id = biz and id <> mOutlet limit 1;
  pM := biz || '/' || mOutlet || '/uji-m.jpg';
  pO := biz || '/' || coalesce(other, mOutlet) || '/uji-o.jpg';
  pX := gen_random_uuid() || '/' || mOutlet || '/uji-x.jpg';   -- syarikat lain
  update public.businesses set plan = 'pro', plan_until = null where id = biz;

  -- ===== Pengguna outlet (bukan owner) =====
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into storage.objects (bucket_id, name, owner_id) values ('receipts', pM, m::text);
  res := res || E'Muat naik resit outlet sendiri: OK (jangka OK)\n';

  if other is not null then
    begin
      insert into storage.objects (bucket_id, name, owner_id) values ('receipts', biz || '/' || other || '/uji-lain.jpg', m::text);
      res := res || E'Muat naik ke outlet lain: BERJAYA (jangka GAGAL)\n'; gagal := gagal + 1;
    exception when insufficient_privilege then res := res || E'Muat naik ke outlet lain: GAGAL (jangka GAGAL)\n';
    end;
  end if;

  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('receipts', pX, m::text);
    res := res || E'Muat naik ke folder syarikat lain: BERJAYA (jangka GAGAL)\n'; gagal := gagal + 1;
  exception when insufficient_privilege then res := res || E'Muat naik ke folder syarikat lain: GAGAL (jangka GAGAL)\n';
  end;

  select count(*) into n from storage.objects where bucket_id = 'receipts' and name = pM;
  res := res || format(E'Nampak resit sebelum dipautkan: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;

  insert into public.transactions (transaction_date, type, category, amount, description, payment_method, outlet_id, created_by, receipt_path)
    values (current_date, 'Out', (select name from public.categories where type = 'Out' and business_id = biz limit 1), 5, 'UJI resit',
            (select name from public.payment_methods where business_id = biz limit 1), mOutlet, m, pM)
    returning id into tx;
  res := res || E'Simpan transaksi dengan resit: OK (jangka OK)\n';

  select count(*) into n from storage.objects where bucket_id = 'receipts' and name = pM;
  res := res || format(E'Nampak resit transaksi sendiri: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;

  begin
    insert into public.transactions (transaction_date, type, category, amount, description, payment_method, outlet_id, created_by, receipt_path)
      values (current_date, 'Out', (select name from public.categories where type = 'Out' and business_id = biz limit 1), 5, 'UJI resit X',
              (select name from public.payment_methods where business_id = biz limit 1), mOutlet, m, pX);
    res := res || E'Transaksi tunjuk ke resit syarikat lain: BERJAYA (jangka GAGAL)\n'; gagal := gagal + 1;
  exception when raise_exception then res := res || E'Transaksi tunjuk ke resit syarikat lain: GAGAL (jangka GAGAL)\n';
  end;

  select public.receipt_in_use(pM) into ok;
  res := res || format(E'receipt_in_use: %s (jangka true)\n', ok); if not ok then gagal := gagal + 1; end if;

  -- ===== Owner: resit transaksi owner tak nampak kepada pengguna outlet =====
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id) values ('receipts', pO, o::text);
  insert into public.transactions (transaction_date, type, category, amount, description, payment_method, outlet_id, created_by, receipt_path)
    values (current_date, 'Out', (select name from public.categories where type = 'Out' and business_id = biz limit 1), 7, 'UJI resit owner',
            (select name from public.payment_methods where business_id = biz limit 1), coalesce(other, mOutlet), o, pO)
    returning id into txO;
  select count(*) into n from storage.objects where bucket_id = 'receipts' and name in (pM, pO);
  res := res || format(E'Owner nampak kedua-dua resit: %s (jangka 2)\n', n); if n <> 2 then gagal := gagal + 1; end if;
  update public.transactions set receipt_path = null where id = txO;
  res := res || E'Owner buang resit dari transaksi: OK (jangka OK)\n';

  reset role;
  update public.transactions set receipt_path = pO where id = txO;
  if other is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from storage.objects where bucket_id = 'receipts' and name = pO;
    res := res || format(E'Pengguna outlet nampak resit outlet lain: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    reset role;
  end if;

  -- ===== Pakej Percuma =====
  reset role;
  update public.businesses set plan = 'free', plan_until = null, trial_ends_at = null where id = biz;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('receipts', biz || '/' || mOutlet || '/uji-free.jpg', m::text);
    res := res || E'Percuma: muat naik resit: BERJAYA (jangka GAGAL)\n'; gagal := gagal + 1;
  exception when insufficient_privilege then res := res || E'Percuma: muat naik resit: GAGAL (jangka GAGAL)\n';
  end;
  select count(*) into n from storage.objects where bucket_id = 'receipts' and name = pM;
  res := res || format(E'Percuma: resit lama masih boleh dilihat: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;

  reset role;
  raise exception E'HASIL UJIAN (% gagal)\n%', gagal, res;
end $$;
