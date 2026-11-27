-- Ujian Fasa 19: POS (semua dibatalkan; hasil keluar sebagai ralat "HASIL UJIAN")
-- Syarikat A (owner, admin outlet 1, staff outlet 1, staff outlet 2) dan syarikat B (owner).
do $$
declare res text := ''; gagal int := 0; n int; v numeric; s text; j jsonb; j2 jsonb; tx bigint;
  uO uuid := gen_random_uuid(); uAd uuid := gen_random_uuid(); uS1 uuid := gen_random_uuid();
  uS2 uuid := gen_random_uuid(); uB uuid := gen_random_uuid();
  bizA uuid; bizB uuid; out1 uuid; out2 uuid; outB uuid; pay text; tunai text;
  mNasi uuid; mTeh uuid; mHabis uuid; mOut2 uuid; mB uuid;
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid(); o4 uuid := gen_random_uuid();
  o5 uuid := gen_random_uuid(); oB uuid := gen_random_uuid(); i1 uuid; i2 uuid;
begin
  begin
    insert into auth.users (id, email, aud, role) values
      (uO, 'uji-f19-owner@example.com', 'authenticated', 'authenticated'), (uAd, 'uji-f19-admin@example.com', 'authenticated', 'authenticated'),
      (uS1, 'uji-f19-s1@example.com', 'authenticated', 'authenticated'), (uS2, 'uji-f19-s2@example.com', 'authenticated', 'authenticated'),
      (uB, 'uji-f19-b@example.com', 'authenticated', 'authenticated');

    -- Syarikat A + outlet kedua, syarikat B
    perform set_config('request.jwt.claims', json_build_object('sub', uO)::text, true);
    set local role authenticated;
    bizA := public.setup_business('UJI F19 Kedai A', 'UJI A Outlet 1');
    select id into out1 from public.outlets where business_id = bizA;
    reset role;
    update public.businesses set plan = 'business', plan_until = null, trial_ends_at = null where id = bizA;   -- 2 outlet perlu Business
    perform set_config('request.jwt.claims', json_build_object('sub', uO)::text, true);
    set local role authenticated;
    insert into public.outlets (name) values ('UJI A Outlet 2') returning id into out2;
    select name into pay from public.payment_methods where business_id = bizA order by (name ilike '%tunai%' or name ilike '%cash%') limit 1;
    select name into tunai from public.payment_methods where business_id = bizA and (name ilike '%tunai%' or name ilike '%cash%') limit 1;
    insert into public.menu_items (outlet_id, name, selling_price, category) values (out1, 'Nasi Lemak', 8.50, 'Makanan') returning id into mNasi;
    insert into public.menu_items (outlet_id, name, selling_price, category) values (out1, 'Teh Tarik', 2.50, 'Minuman') returning id into mTeh;
    insert into public.menu_items (outlet_id, name, selling_price, available) values (out1, 'Roti Habis', 1.00, false) returning id into mHabis;
    insert into public.menu_items (outlet_id, name, selling_price) values (out2, 'Mee Outlet 2', 6.00) returning id into mOut2;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', uB)::text, true);
    set local role authenticated;
    bizB := public.setup_business('UJI F19 Kedai B', 'UJI B Outlet');
    select id into outB from public.outlets where business_id = bizB;
    insert into public.menu_items (outlet_id, name, selling_price) values (outB, 'Menu B', 5.00) returning id into mB;
    insert into public.pos_orders (id, outlet_id) values (oB, outB);
    insert into public.pos_order_items (order_id, menu_item_id, qty) values (oB, mB, 1);
    reset role;
    insert into public.staff_profiles (user_id, business_id, outlet_id, role) values
      (uAd, bizA, out1, 'admin'), (uS1, bizA, out1, 'staff'), (uS2, bizA, out2, 'staff');

    -- ===== Owner: tetapan POS =====
    perform set_config('request.jwt.claims', json_build_object('sub', uO)::text, true);
    set local role authenticated;
    insert into public.pos_settings (outlet_id, order_numbers, receipt_footer) values (out1, true, 'Terima kasih');
    res := res || E'Owner simpan tetapan POS: OK\n';
    reset role;

    -- ===== Staff outlet 1 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uS1)::text, true);
    set local role authenticated;
    begin update public.pos_settings set table_numbers = true where outlet_id = out1; get diagnostics n = row_count;
      res := res || format(E'Staff ubah tetapan POS: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    exception when others then res := res || E'Staff ubah tetapan POS: ditolak (betul)\n'; end;
    select count(*) into n from public.pos_settings where outlet_id = out1;
    res := res || format(E'Staff baca tetapan POS outlet sendiri: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    select count(*) into n from public.menu_items;
    res := res || format(E'Staff nampak menu: %s (jangka 3, outlet sendiri sahaja)\n', n); if n <> 3 then gagal := gagal + 1; end if;
    begin update public.menu_items set selling_price = 0.10 where id = mNasi; get diagnostics n = row_count;
      res := res || format(E'Staff ubah harga menu: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    exception when others then res := res || E'Staff ubah harga menu: ditolak (betul)\n'; end;

    -- Order 1: bayar dulu (bungkus), tunai
    insert into public.pos_orders (id, outlet_id, order_type) values (o1, out1, 'bungkus');
    insert into public.pos_order_items (order_id, menu_item_id, qty, note) values (o1, mNasi, 2, 'kurang pedas') returning id into i1;
    insert into public.pos_order_items (order_id, menu_item_id, qty) values (o1, mTeh, 1);
    select unit_price, name into v, s from public.pos_order_items where id = i1;
    res := res || format(E'Harga & nama disalin dari menu: %s %s (jangka 8.50 Nasi Lemak)\n', v, s); if v <> 8.50 or s <> 'Nasi Lemak' then gagal := gagal + 1; end if;
    begin insert into public.pos_order_items (order_id, menu_item_id, qty, unit_price) values (o1, mTeh, 1, 0.01);
      res := res || E'Staff hantar harga sendiri: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Staff hantar harga sendiri: ditolak (betul)\n'; end;
    begin insert into public.pos_order_items (order_id, menu_item_id, qty) values (o1, mHabis, 1);
      res := res || E'Tambah menu Habis: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Tambah menu Habis: ditolak (betul)\n'; end;
    begin insert into public.pos_order_items (order_id, menu_item_id, qty) values (o1, mOut2, 1);
      res := res || E'Tambah menu outlet lain: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Tambah menu outlet lain: ditolak (betul)\n'; end;
    select order_no into n from public.pos_orders where id = o1;
    res := res || format(E'Nombor order pertama: %s (jangka 1)\n', n); if n is distinct from 1 then gagal := gagal + 1; end if;
    begin j := public.pos_pay_order(o1, tunai, 10.00);
      res := res || E'Tunai kurang dari jumlah 19.50: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Tunai kurang dari jumlah: ditolak (betul)\n'; end;
    begin j := public.pos_pay_order(o1, 'Kaedah Palsu', null);
      res := res || E'Kaedah bayar palsu: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Kaedah bayar palsu: ditolak (betul)\n'; end;
    j := public.pos_pay_order(o1, tunai, 50.00);
    res := res || format(E'Bayar: jumlah %s, baki %s (jangka 19.50, 30.50)\n', j->>'total', j->>'change');
    if (j->>'total')::numeric <> 19.50 or (j->>'change')::numeric <> 30.50 then gagal := gagal + 1; end if;
    tx := (j->>'transaction_id')::bigint;
    select count(*) into n from public.transactions where id = tx and type = 'In' and category = 'Jualan POS' and amount = 19.50 and outlet_id = out1 and created_by = uS1;
    res := res || format(E'Transaksi Jualan POS dicipta: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    j2 := public.pos_pay_order(o1, tunai, 50.00);
    select count(*) into n from public.transactions where reference_no = 'POS-' || left(o1::text, 8);
    res := res || format(E'Bayar dua kali: transaksi %s, already_paid %s (jangka 1, true)\n', n, j2->>'already_paid');
    if n <> 1 or (j2->>'already_paid') <> 'true' or (j2->>'transaction_id')::bigint <> tx then gagal := gagal + 1; end if;
    update public.pos_orders set label = 'ubah selepas bayar' where id = o1; get diagnostics n = row_count;
    res := res || format(E'Ubah order dibayar: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin insert into public.pos_order_items (order_id, menu_item_id, qty) values (o1, mTeh, 1);
      res := res || E'Tambah item ke order dibayar: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Tambah item ke order dibayar: ditolak (betul)\n'; end;
    begin update public.pos_orders set status = 'dibayar' where id = o2;
      res := res || E'Ubah status terus: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Ubah status terus: ditolak (betul)\n'; end;
    begin perform public.pos_void_order(o1, 'cuba');
      res := res || E'Staff batal order dibayar: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Staff batal order dibayar: ditolak (betul)\n'; end;

    -- Order 2: bil terbuka (makan sini), tambah item kemudian, buang satu item
    insert into public.pos_orders (id, outlet_id, label) values (o2, out1, 'Abang baju merah');
    insert into public.pos_order_items (order_id, menu_item_id, qty) values (o2, mNasi, 1);
    insert into public.pos_order_items (order_id, menu_item_id, qty) values (o2, mTeh, 2) returning id into i2;
    update public.pos_order_items set removed_at = now() where id = i2;
    select count(*) into n from public.pos_order_items where id = i2 and removed_by = uS1 and removed_at is not null;
    res := res || format(E'Buang item bil terbuka direkod (siapa & bila): %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    begin update public.pos_order_items set removed_at = null where id = i2; get diagnostics n = row_count;
      res := res || format(E'Batalkan buang item: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    exception when others then res := res || E'Batalkan buang item: ditolak (betul)\n'; end;
    select order_no into n from public.pos_orders where id = o2;
    res := res || format(E'Nombor order kedua: %s (jangka 2)\n', n); if n is distinct from 2 then gagal := gagal + 1; end if;
    begin perform public.pos_void_order(o2, 'pelanggan lari');
      res := res || E'Staff batal bil terbuka berisi: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Staff batal bil terbuka berisi: ditolak (betul)\n'; end;
    j := public.pos_pay_order(o2, pay, null);
    res := res || format(E'Bayar bil terbuka (item dibuang tak dikira): %s (jangka 8.50)\n', j->>'total'); if (j->>'total')::numeric <> 8.50 then gagal := gagal + 1; end if;

    -- Order 3: bil kosong, staff boleh batal sendiri
    insert into public.pos_orders (id, outlet_id) values (o3, out1);
    begin j := public.pos_pay_order(o3, pay, null);
      res := res || E'Bayar bil kosong: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Bayar bil kosong: ditolak (betul)\n'; end;
    perform public.pos_void_order(o3, null);
    select count(*) into n from public.pos_orders where id = o3 and status = 'batal' and voided_by = uS1;
    res := res || format(E'Staff batal bil kosong: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    perform public.pos_set_available(mHabis, true);
    select count(*) into n from public.menu_items where id = mHabis and available;
    res := res || format(E'Staff tanda menu Ada: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    select count(*) into n from public.pos_orders where outlet_id = outB;
    res := res || format(E'Staff nampak order syarikat B: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin j := public.pos_pay_order(oB, pay, null);
      res := res || E'Staff bayar order syarikat B: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Staff bayar order syarikat B: ditolak (betul)\n'; end;
    reset role;

    -- ===== Staff outlet 2 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uS2)::text, true);
    set local role authenticated;
    select count(*) into n from public.pos_orders where outlet_id = out1;
    res := res || format(E'Staff outlet 2 nampak order outlet 1: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin insert into public.pos_orders (id, outlet_id) values (o4, out1);
      res := res || E'Staff outlet 2 buat order di outlet 1: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Staff outlet 2 buat order di outlet 1: ditolak (betul)\n'; end;
    insert into public.pos_orders (id, outlet_id) values (o5, out2);
    select order_no into n from public.pos_orders where id = o5;
    res := res || format(E'Outlet 2 (nombor order Off): %s (jangka kosong)\n', coalesce(n::text, 'kosong')); if n is not null then gagal := gagal + 1; end if;
    reset role;

    -- ===== Admin outlet 1 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uAd)::text, true);
    set local role authenticated;
    begin delete from public.transactions where id = tx;
      res := res || E'Padam jualan POS di Rekod: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Padam jualan POS di Rekod: ditolak (betul)\n'; end;
    begin update public.transactions set amount = 1 where id = tx;
      res := res || E'Ubah jumlah jualan POS di Rekod: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Ubah jumlah jualan POS di Rekod: ditolak (betul)\n'; end;
    update public.transactions set description = 'nota admin' where id = tx; get diagnostics n = row_count;
    res := res || format(E'Ubah keterangan jualan POS: %s baris (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    begin perform public.pos_void_order(o1, '  ');
      res := res || E'Admin batal tanpa sebab: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Admin batal tanpa sebab: ditolak (betul)\n'; end;
    perform public.pos_void_order(o1, 'Salah tekan');
    select count(*) into n from public.pos_orders where id = o1 and status = 'batal' and void_transaction_id = tx and transaction_id is null and voided_by = uAd;
    res := res || format(E'Admin batal order dibayar: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    reset role;
    select count(*) into n from public.transactions where id = tx;
    res := res || format(E'Transaksi jualan dipadam: tinggal %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    select count(*) into n from public.transaction_audit where transaction_id = tx;
    res := res || format(E'Log audit merekod pemadaman: %s (jangka >= 1)\n', n); if n < 1 then gagal := gagal + 1; end if;

    -- ===== Owner syarikat B =====
    perform set_config('request.jwt.claims', json_build_object('sub', uB)::text, true);
    set local role authenticated;
    select count(*) into n from public.pos_orders;
    res := res || format(E'Owner B nampak order: %s (jangka 1, order sendiri sahaja)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    select count(*) into n from public.pos_order_items where order_id = o2;
    res := res || format(E'Owner B nampak item order A: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin perform public.pos_void_order(o2, 'jahat');
      res := res || E'Owner B batal order A: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || E'Owner B batal order A: ditolak (betul)\n'; end;
    select count(*) into n from public.pos_settings;
    res := res || format(E'Owner B nampak tetapan POS A: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    reset role;

    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 19 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
