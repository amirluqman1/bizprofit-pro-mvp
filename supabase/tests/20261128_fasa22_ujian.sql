-- Ujian Fasa 22: kategori menu POS (warna, susunan) + susun menu (semua dibatalkan)
-- Hasil keluar sebagai ralat "HASIL UJIAN".
-- Syarikat A: owner, admin outlet 1, admin outlet 2, manager outlet 1, staff outlet 1. Syarikat B: owner.
do $$
declare res text := ''; gagal int := 0; n int; s text;
  uO uuid := gen_random_uuid(); uAd uuid := gen_random_uuid(); uAd2 uuid := gen_random_uuid();
  uM uuid := gen_random_uuid(); uS uuid := gen_random_uuid(); uB uuid := gen_random_uuid();
  bizA uuid; bizB uuid; out1 uuid; out2 uuid; outB uuid;
  mNasi uuid; mMee uuid; mTeh uuid; mMilo uuid; mLauk uuid; mB uuid; oPos uuid := gen_random_uuid();
begin
  begin
    -- ===== Data ujian (sebagai postgres) =====
    insert into auth.users (id, email, aud, role) values
      (uO, 'uji-f22-owner@example.com', 'authenticated', 'authenticated'), (uAd, 'uji-f22-admin@example.com', 'authenticated', 'authenticated'),
      (uAd2, 'uji-f22-admin2@example.com', 'authenticated', 'authenticated'), (uM, 'uji-f22-mgr@example.com', 'authenticated', 'authenticated'),
      (uS, 'uji-f22-staff@example.com', 'authenticated', 'authenticated'), (uB, 'uji-f22-b@example.com', 'authenticated', 'authenticated');
    insert into public.businesses (name, plan, trial_ends_at) values ('UJI F22 A', 'business', null) returning id into bizA;
    insert into public.businesses (name, plan, trial_ends_at) values ('UJI F22 B', 'business', null) returning id into bizB;
    insert into public.outlets (business_id, name) values (bizA, 'UJI F22 A1') returning id into out1;
    insert into public.outlets (business_id, name) values (bizA, 'UJI F22 A2') returning id into out2;
    insert into public.outlets (business_id, name) values (bizB, 'UJI F22 B1') returning id into outB;
    insert into public.staff_profiles (user_id, business_id, outlet_id, role) values
      (uO, bizA, out1, 'owner'), (uAd, bizA, out1, 'admin'), (uAd2, bizA, out2, 'admin'),
      (uM, bizA, out1, 'manager'), (uS, bizA, out1, 'staff'), (uB, bizB, outB, 'owner');

    -- ===== Owner: menu baru → kategori dicipta automatik, menu di hujung kategori =====
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.menu_items (outlet_id, name, selling_price, category) values (out1, 'Nasi Lemak', 8, ' Makanan ') returning id into mNasi;
    insert into public.menu_items (outlet_id, name, selling_price, category) values (out1, 'Mee Goreng', 7, 'Makanan') returning id into mMee;
    insert into public.menu_items (outlet_id, name, selling_price, category) values (out1, 'Teh Tarik', 2.5, 'Minuman') returning id into mTeh;
    insert into public.menu_items (outlet_id, name, selling_price, category) values (out1, 'Milo', 3, 'Minuman') returning id into mMilo;
    insert into public.menu_items (outlet_id, name, selling_price) values (out1, 'Sambal (lauk)', 0) returning id into mLauk;
    select string_agg(name || '#' || sort_order, ', ' order by sort_order) into s from public.menu_categories where outlet_id = out1;
    res := res || format(E'Kategori dicipta automatik: %s (jangka Makanan#1, Minuman#2)\n', s); if s is distinct from 'Makanan#1, Minuman#2' then gagal := gagal + 1; end if;
    select string_agg(name || '#' || sort_order, ', ' order by category, sort_order) into s from public.menu_items where outlet_id = out1 and category is not null;
    res := res || format(E'Menu baru di hujung kategori: %s (jangka Nasi Lemak#1, Mee Goreng#2, Teh Tarik#1, Milo#2)\n', s);
    if s is distinct from 'Nasi Lemak#1, Mee Goreng#2, Teh Tarik#1, Milo#2' then gagal := gagal + 1; end if;

    -- Susun menu & kategori
    perform public.reorder_menu(out1, array[mMilo, mTeh]);
    select string_agg(name, ', ' order by sort_order) into s from public.menu_items where outlet_id = out1 and category = 'Minuman';
    res := res || format(E'Owner susun menu: %s (jangka Milo, Teh Tarik)\n', s); if s is distinct from 'Milo, Teh Tarik' then gagal := gagal + 1; end if;
    perform public.reorder_menu_categories(out1, array['Minuman', 'Makanan']);
    select string_agg(name, ', ' order by sort_order) into s from public.menu_categories where outlet_id = out1;
    res := res || format(E'Owner susun kategori: %s (jangka Minuman, Makanan)\n', s); if s is distinct from 'Minuman, Makanan' then gagal := gagal + 1; end if;

    -- Warna
    update public.menu_categories set color = '#2f9e6b' where outlet_id = out1 and name = 'Makanan';
    get diagnostics n = row_count;
    res := res || format(E'Owner tetapkan warna: %s baris (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    begin update public.menu_categories set color = 'merah' where outlet_id = out1 and name = 'Makanan';
      res := res || E'Warna tak sah: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Warna tak sah: ditolak (betul) — %s\n', sqlerrm); end;

    -- Kategori baru kosong + tukar nama
    insert into public.menu_categories (outlet_id, name, color, sort_order) values (out1, 'Pencuci Mulut', '#e0a030', 3);
    res := res || E'Owner tambah kategori kosong: OK\n';
    perform public.rename_menu_category(out1, 'Minuman', 'Air');
    select count(*) into n from public.menu_items where outlet_id = out1 and category = 'Air';
    select string_agg(name || '#' || sort_order, ', ' order by sort_order) into s from public.menu_categories where outlet_id = out1;
    res := res || format(E'Tukar nama Minuman → Air: %s menu ikut, kategori %s (jangka 2, Air#1, Makanan#2, Pencuci Mulut#3)\n', n, s);
    if n <> 2 or s is distinct from 'Air#1, Makanan#2, Pencuci Mulut#3' then gagal := gagal + 1; end if;
    begin perform public.rename_menu_category(out1, 'Air', 'Makanan');
      res := res || E'Tukar nama ke kategori sedia ada: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Tukar nama ke kategori sedia ada: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.rename_menu_category(out1, 'Air', '   ');
      res := res || E'Tukar nama kosong: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Tukar nama kosong: ditolak (betul) — %s\n', sqlerrm); end;

    -- Padam kategori
    begin delete from public.menu_categories where outlet_id = out1 and name = 'Makanan';
      res := res || E'Padam kategori yang ada menu: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Padam kategori yang ada menu: ditolak (betul) — %s\n', sqlerrm); end;
    delete from public.menu_categories where outlet_id = out1 and name = 'Pencuci Mulut';
    get diagnostics n = row_count;
    res := res || format(E'Padam kategori kosong: %s baris (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;

    -- Padam menu: lauk dalam resepi lain tak boleh; menu biasa boleh, order lama kekal
    insert into public.menu_ingredients (menu_item_id, outlet_id, sub_menu_id, qty) values (mNasi, out1, mLauk, 1);
    begin delete from public.menu_items where id = mLauk;
      res := res || E'Padam lauk yang digunakan resepi: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Padam lauk yang digunakan resepi: ditolak (betul) — %s\n', sqlerrm); end;
    insert into public.pos_orders (id, outlet_id) values (oPos, out1);
    insert into public.pos_order_items (order_id, menu_item_id, qty) values (oPos, mMee, 1);
    delete from public.menu_items where id = mMee;
    get diagnostics n = row_count;
    res := res || format(E'Owner padam menu: %s baris (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    reset role;
    select count(*) into n from public.pos_order_items where order_id = oPos and name = 'Mee Goreng' and menu_item_id is null;
    res := res || format(E'Order lama selepas menu dipadam: %s baris kekal (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;

    -- ===== Admin outlet 1 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uAd, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.reorder_menu(out1, array[mTeh, mMilo]);
    res := res || E'Admin outlet 1 susun menu: OK\n';
    reset role;

    -- ===== Manager & staff: baca sahaja =====
    perform set_config('request.jwt.claims', json_build_object('sub', uM, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.menu_categories where outlet_id = out1;
    res := res || format(E'Manager baca kategori: %s (jangka 2)\n', n); if n <> 2 then gagal := gagal + 1; end if;
    begin perform public.reorder_menu(out1, array[mMilo, mTeh]);
      res := res || E'Manager susun menu: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Manager susun menu: ditolak (betul) — %s\n', sqlerrm); end;
    update public.menu_categories set color = '#000000' where outlet_id = out1;
    get diagnostics n = row_count;
    res := res || format(E'Manager ubah warna: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', uS, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.menu_categories where outlet_id = out1;
    res := res || format(E'Staff baca kategori (untuk POS): %s (jangka 2)\n', n); if n <> 2 then gagal := gagal + 1; end if;
    begin perform public.reorder_menu_categories(out1, array['Makanan', 'Air']);
      res := res || E'Staff susun kategori: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Staff susun kategori: ditolak (betul) — %s\n', sqlerrm); end;
    begin perform public.rename_menu_category(out1, 'Air', 'Minum');
      res := res || E'Staff tukar nama kategori: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Staff tukar nama kategori: ditolak (betul) — %s\n', sqlerrm); end;
    begin insert into public.menu_categories (outlet_id, name) values (out1, 'Staff Punya');
      res := res || E'Staff tambah kategori: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Staff tambah kategori: ditolak (betul) — %s\n', sqlerrm); end;
    reset role;

    -- ===== Admin outlet 2 =====
    perform set_config('request.jwt.claims', json_build_object('sub', uAd2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.menu_categories where outlet_id = out1;
    res := res || format(E'Admin outlet 2 nampak kategori outlet 1: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin perform public.reorder_menu(out1, array[mMilo, mTeh]);
      res := res || E'Admin outlet 2 susun menu outlet 1: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Admin outlet 2 susun menu outlet 1: ditolak (betul) — %s\n', sqlerrm); end;
    reset role;

    -- ===== Pakej Free: baca boleh, ubah tidak =====
    update public.businesses set plan = 'free', trial_ends_at = null where id = bizA;
    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.menu_categories where outlet_id = out1;
    res := res || format(E'Owner Free baca kategori: %s (jangka 2)\n', n); if n <> 2 then gagal := gagal + 1; end if;
    begin perform public.reorder_menu_categories(out1, array['Makanan', 'Air']);
      res := res || E'Owner Free susun kategori: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner Free susun kategori: ditolak (betul) — %s\n', sqlerrm); end;
    reset role;
    update public.businesses set plan = 'business' where id = bizA;

    -- ===== Syarikat B =====
    perform set_config('request.jwt.claims', json_build_object('sub', uB, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.menu_categories;
    res := res || format(E'Owner B nampak kategori A: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    begin perform public.rename_menu_category(out1, 'Air', 'Jahat');
      res := res || E'Owner B tukar nama kategori A: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner B tukar nama kategori A: ditolak (betul) — %s\n', sqlerrm); end;
    begin insert into public.menu_categories (business_id, outlet_id, name) values (bizA, out1, 'Jahat');
      res := res || E'Owner B tambah kategori ke outlet A: DITERIMA (SALAH)\n'; gagal := gagal + 1;
    exception when others then res := res || format(E'Owner B tambah kategori ke outlet A: ditolak (betul) — %s\n', sqlerrm); end;
    insert into public.menu_items (outlet_id, name, selling_price, category) values (outB, 'Menu B', 5, 'Makanan') returning id into mB;
    select count(*) into n from public.menu_categories where outlet_id = outB;
    res := res || format(E'Owner B menu sendiri cipta kategori sendiri: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    reset role;

    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 22 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
