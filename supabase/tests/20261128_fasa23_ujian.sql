-- Ujian Fasa 23: shift POS (semua dibatalkan; hasil keluar sebagai ralat "HASIL UJIAN")
-- Syarikat A: owner, admin outlet 1, staff outlet 1, staff outlet 2. Syarikat B: owner.
do $$
declare res text := ''; gagal int := 0; n int; v numeric; s text; j jsonb; tx bigint;
  uO uuid := gen_random_uuid(); uAd uuid := gen_random_uuid(); uS1 uuid := gen_random_uuid();
  uS2 uuid := gen_random_uuid(); uB uuid := gen_random_uuid();
  bizA uuid; bizB uuid; out1 uuid; out2 uuid; outB uuid; mNasi uuid; sh1 uuid; sh2 uuid; mv uuid;
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid(); o4 uuid := gen_random_uuid();
  o5 uuid := gen_random_uuid();
begin
  begin
    -- ===== Data ujian (sebagai postgres) =====
    insert into auth.users (id, email, aud, role) values
      (uO, 'uji-f23-owner@example.com', 'authenticated', 'authenticated'), (uAd, 'uji-f23-admin@example.com', 'authenticated', 'authenticated'),
      (uS1, 'uji-f23-s1@example.com', 'authenticated', 'authenticated'), (uS2, 'uji-f23-s2@example.com', 'authenticated', 'authenticated'),
      (uB, 'uji-f23-b@example.com', 'authenticated', 'authenticated');
    insert into public.businesses (name, plan, trial_ends_at) values ('UJI F23 A', 'business', null) returning id into bizA;
    insert into public.businesses (name, plan, trial_ends_at) values ('UJI F23 B', 'business', null) returning id into bizB;
    insert into public.outlets (business_id, name) values (bizA, 'UJI F23 A1') returning id into out1;
    insert into public.outlets (business_id, name) values (bizA, 'UJI F23 A2') returning id into out2;
    insert into public.outlets (business_id, name) values (bizB, 'UJI F23 B1') returning id into outB;
    insert into public.categories (business_id, key, name, type, counts_in_profit) values
      (bizA, 'OUT01', 'Bahan Mentah', 'Out', true), (bizB, 'OUT01', 'Bahan Mentah', 'Out', true);
    insert into public.payment_methods (business_id, name) values (bizA, 'Tunai'), (bizA, 'QR'), (bizB, 'Tunai');
    insert into public.staff_profiles (user_id, business_id, outlet_id, role) values
      (uO, bizA, out1, 'owner'), (uAd, bizA, out1, 'admin'), (uS1, bizA, out1, 'staff'), (uS2, bizA, out2, 'staff'), (uB, bizB, outB, 'owner');
    insert into public.menu_items (business_id, outlet_id, name, selling_price) values (bizA, out1, 'Nasi Lemak', 10) returning id into mNasi;

    -- ===== Staff outlet 1: tiada shift → tak boleh bayar =====
    perform set_config('request.jwt.claims', json_build_object('sub', uS1, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.pos_orders (id, outlet_id) values (o1, out1);
    insert into public.pos_order_items (order_id, menu_item_id, qty) values (o1, mNasi, 1);
    begin perform public.pos_pay_order(o1, 'Tunai', 20);
      res := res || E'Bayar tanpa shift: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Bayar tanpa shift: ditolak (betul) — %s\n', sqlerrm); end;
    select count(*) into n from public.transactions where outlet_id = out1;
    res := res || format(E'Transaksi selepas bayar ditolak: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;

    -- Buka shift
    sh1 := public.pos_open_shift(out1, 200);
    res := res || E'Staff buka shift modal RM200: OK\n';
    begin perform public.pos_open_shift(out1, 50);
      res := res || E'Buka shift kedua serentak: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Buka shift kedua serentak: ditolak (betul) — %s\n', sqlerrm); end;

    -- Jualan: o1 tunai RM10, o2 QR RM20, o3 tunai RM10 (akan dibatal dalam shift 2)
    perform public.pos_pay_order(o1, 'Tunai', 20);
    insert into public.pos_orders (id, outlet_id) values (o2, out1);
    insert into public.pos_order_items (order_id, menu_item_id, qty) values (o2, mNasi, 2);
    perform public.pos_pay_order(o2, 'QR');
    insert into public.pos_orders (id, outlet_id) values (o3, out1);
    insert into public.pos_order_items (order_id, menu_item_id, qty) values (o3, mNasi, 1);
    perform public.pos_pay_order(o3, 'Tunai', 10);
    select count(*) into n from public.pos_orders where shift_id = sh1;
    res := res || format(E'Order terikat kepada shift: %s (jangka 3)\n', n); if n <> 3 then gagal := gagal + 1; end if;
    begin update public.pos_orders set shift_id = null where id = o1;
      res := res || E'Staff ubah shift_id order: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Staff ubah shift_id order: ditolak (betul) — %s\n', sqlerrm); end;

    -- Cash out / in
    mv := public.pos_cash_move(sh1, 'keluar', 30, 'Beli ais', 'Bahan Mentah');
    select t.type || ' ' || t.category || ' ' || t.amount || ' ' || t.payment_method into s
      from public.pos_shift_moves m join public.transactions t on t.id = m.transaction_id where m.id = mv;
    res := res || format(E'Cash out RM30 jadi belanja di Rekod: %s (jangka Out Bahan Mentah 30.00 Tunai)\n', s);
    if s is distinct from 'Out Bahan Mentah 30.00 Tunai' then gagal := gagal + 1; end if;
    begin perform public.pos_cash_move(sh1, 'keluar', 5, 'Tiada kategori', null);
      res := res || E'Cash out tanpa kategori: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Cash out tanpa kategori: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.pos_cash_move(sh1, 'keluar', 5, '  ', 'Bahan Mentah');
      res := res || E'Cash out tanpa sebab: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Cash out tanpa sebab: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.pos_cash_move(sh1, 'keluar', 0, 'Kosong', 'Bahan Mentah');
      res := res || E'Cash out RM0: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Cash out RM0: ditolak (betul) — %s\n', sqlerrm); end;
    mv := public.pos_cash_move(sh1, 'masuk', 50, 'Duit pecah dari owner');
    select count(*) into n from public.pos_shift_moves where id = mv and transaction_id is null;
    res := res || format(E'Cash in RM50 bukan transaksi: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    begin delete from public.pos_shift_moves where id = mv;
      res := res || E'Staff padam pergerakan laci: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Staff padam pergerakan laci: ditolak (betul) — %s\n', sqlerrm); end;

    -- Ringkasan: staff tak nampak jangkaan (kiraan buta)
    j := public.pos_shift_summary(sh1);
    res := res || format(E'Ringkasan staff: jualan %s, %s order, jangkaan %s (jangka 40.00, 3, null)\n', j->>'sales_total', j->>'orders_count', coalesce(j->>'expected_cash', 'null'));
    if (j->>'sales_total')::numeric <> 40 or (j->>'orders_count')::int <> 3 or j->>'expected_cash' is not null then gagal := gagal + 1; end if;
    select expected_cash into v from public.pos_shifts where id = sh1;
    res := res || format(E'Jangkaan dalam table semasa shift dibuka: %s (jangka null)\n', coalesce(v::text, 'null')); if v is not null then gagal := gagal + 1; end if;
    reset role;

    -- ===== Admin: nampak jangkaan; owner batal order tunai o1 dalam shift sama =====
    perform set_config('request.jwt.claims', json_build_object('sub', uAd, 'role', 'authenticated')::text, true);
    set local role authenticated;
    j := public.pos_shift_summary(sh1);
    res := res || format(E'Ringkasan admin: jangkaan %s (jangka 240.00 = 200 + 20 tunai − 30 + 50)\n', j->>'expected_cash');
    if (j->>'expected_cash')::numeric is distinct from 240 then gagal := gagal + 1; end if;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.pos_void_order(o1, 'Pelanggan batal');
    j := public.pos_shift_summary(sh1);
    res := res || format(E'Selepas batal order tunai: jangkaan %s, jualan %s, %s by_method (jangka 230.00, 30.00)\n', j->>'expected_cash', j->>'sales_total', j->'by_method');
    if (j->>'expected_cash')::numeric <> 230 or (j->>'sales_total')::numeric <> 30 then gagal := gagal + 1; end if;
    begin insert into public.pos_shifts (business_id, outlet_id, opened_by, opening_float) values (bizA, out1, uO, 0);
      res := res || E'Owner tambah shift terus: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner tambah shift terus: ditolak (betul) — %s\n', sqlerrm); end;
    begin update public.pos_shifts set opening_float = 999 where id = sh1;
      res := res || E'Owner ubah modal shift terus: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner ubah modal shift terus: ditolak (betul) — %s\n', sqlerrm); end;
    reset role;

    -- ===== Staff tutup shift: kira RM225 → kurang RM5 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uS1, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.pos_orders (id, outlet_id) values (o4, out1);   -- bil terbuka dibawa ke shift seterusnya
    insert into public.pos_order_items (order_id, menu_item_id, qty) values (o4, mNasi, 1);
    begin perform public.pos_close_shift(sh1, -1);
      res := res || E'Tutup dengan kiraan negatif: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Tutup dengan kiraan negatif: ditolak (betul) — %s\n', sqlerrm); end;
    j := public.pos_close_shift(sh1, 225, 'Kurang sikit');
    res := res || format(E'Tutup shift: jangkaan %s, dikira %s, beza %s (jangka 230.00, 225.00, -5.00)\n', j->>'expected_cash', j->>'counted_cash', j->>'difference');
    if (j->>'expected_cash')::numeric <> 230 or (j->>'counted_cash')::numeric <> 225 or (j->>'difference')::numeric <> -5 then gagal := gagal + 1; end if;
    begin perform public.pos_cash_move(sh1, 'masuk', 10, 'Lewat');
      res := res || E'Cash in selepas tutup: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Cash in selepas tutup: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.pos_close_shift(sh1, 225);
      res := res || E'Tutup shift dua kali: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Tutup shift dua kali: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.pos_pay_order(o4, 'Tunai', 10);
      res := res || E'Bayar selepas shift ditutup: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Bayar selepas shift ditutup: ditolak (betul) — %s\n', sqlerrm); end;
    reset role;

    -- ===== Shift 2 (admin): bil terbuka dibayar, order o3 dari shift 1 dibatal =====
    perform set_config('request.jwt.claims', json_build_object('sub', uAd, 'role', 'authenticated')::text, true);
    set local role authenticated;
    sh2 := public.pos_open_shift(out1, 100);
    perform public.pos_pay_order(o4, 'Tunai', 10);
    perform public.pos_void_order(o3, 'Silap caj semalam');
    j := public.pos_shift_summary(sh2);
    res := res || format(E'Shift 2: jangkaan %s (jangka 100.00 = 100 + 10 bil terbuka − 10 pulangan o3)\n', j->>'expected_cash');
    if (j->>'expected_cash')::numeric <> 100 then gagal := gagal + 1; end if;
    j := public.pos_shift_summary(sh1);
    res := res || format(E'Shift 1 selepas o3 dibatal kemudian: jangkaan %s, beza %s (jangka kekal 230.00, -5.00)\n', j->>'expected_cash', j->>'difference');
    if (j->>'expected_cash')::numeric <> 230 or (j->>'difference')::numeric <> -5 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Staff outlet 2 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uS2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.pos_shifts where outlet_id = out1;
    res := res || format(E'Staff outlet 2 nampak shift outlet 1: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin perform public.pos_shift_summary(sh2);
      res := res || E'Staff outlet 2 baca ringkasan outlet 1: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Staff outlet 2 baca ringkasan outlet 1: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.pos_cash_move(sh2, 'keluar', 10, 'Curi', 'Bahan Mentah');
      res := res || E'Staff outlet 2 cash out outlet 1: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Staff outlet 2 cash out outlet 1: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.pos_open_shift(out1, 0);
      res := res || E'Staff outlet 2 buka shift outlet 1: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Staff outlet 2 buka shift outlet 1: ditolak (betul) — %s\n', sqlerrm); end;
    sh1 := public.pos_open_shift(out2, 0);
    res := res || E'Staff outlet 2 buka shift outlet sendiri: OK\n';
    reset role;

    -- ===== Syarikat B =====
    perform set_config('request.jwt.claims', json_build_object('sub', uB, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.pos_shifts;
    res := res || format(E'Owner B nampak shift A: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    select count(*) into n from public.pos_shift_moves;
    res := res || format(E'Owner B nampak pergerakan laci A: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin perform public.pos_close_shift(sh2, 0);
      res := res || E'Owner B tutup shift A: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner B tutup shift A: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.pos_cash_move(sh2, 'masuk', 1, 'x');
      res := res || E'Owner B cash in shift A: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner B cash in shift A: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.pos_open_shift(out1, 0);
      res := res || E'Owner B buka shift outlet A: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner B buka shift outlet A: ditolak (betul) — %s\n', sqlerrm); end;
    perform public.pos_open_shift(outB, 80);
    res := res || E'Owner B buka shift outlet sendiri: OK\n';
    reset role;

    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 23 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
