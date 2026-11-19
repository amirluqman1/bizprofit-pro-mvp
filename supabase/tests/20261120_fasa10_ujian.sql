-- Ujian Fasa 10: Food cost (semua dibatalkan; hasil keluar sebagai ralat "HASIL UJIAN")
do $$
declare res text := ''; gagal int := 0; n int; v numeric;
  o uuid; aL uuid; mI uuid; st uuid; lubok uuid; intan uuid;
  itL uuid; itI uuid; menuL uuid; menuI uuid;
begin
  select id into lubok from public.outlets where name = 'Lubok Sarapan';
  select id into intan from public.outlets where name = 'Restoran 3 Intan';
  select user_id into o from public.staff_profiles where role = 'owner' limit 1;
  select user_id into aL from public.staff_profiles where outlet_id = lubok and role in ('manager', 'admin') limit 1;
  select user_id into mI from public.staff_profiles where outlet_id = intan and role in ('manager', 'admin') limit 1;
  select user_id into st from public.staff_profiles where role = 'staff' limit 1;
  begin
    update public.staff_profiles set role = 'admin' where user_id = aL;
    update public.staff_profiles set role = 'manager' where user_id = mI;

    -- ===== Owner: harga, menu, resipi =====
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    insert into public.inventory_items (business_id, outlet_id, name, unit, current_qty, target_qty)
      select business_id, lubok, 'UJI Ayam FC', 'kg', 5, 10 from public.outlets where id = lubok returning id into itL;
    insert into public.inventory_items (business_id, outlet_id, name, unit, current_qty, target_qty)
      select business_id, intan, 'UJI Beras FC', 'kg', 5, 10 from public.outlets where id = intan returning id into itI;
    set local role authenticated;
    insert into public.ingredient_costs (inventory_item_id, unit_price) values (itL, 9.5), (itI, 3.2);
    select count(*) into n from public.ingredient_costs where inventory_item_id in (itL, itI);
    res := res || format(E'Owner simpan harga 2 outlet: %s (jangka 2)\n', n); if n<>2 then gagal:=gagal+1; end if;
    menuL := public.save_menu(null, lubok, '  UJI Nasi Ayam  ', 8, 1, json_build_array(json_build_object('item', itL, 'qty', 0.2))::jsonb);
    menuI := public.save_menu(null, intan, 'UJI Nasi Putih', 2, 10, json_build_array(json_build_object('item', itI, 'qty', 1))::jsonb);
    select count(*) into n from public.menu_items where id in (menuL, menuI) and name in ('UJI Nasi Ayam', 'UJI Nasi Putih');
    res := res || format(E'Owner cipta menu 2 outlet (nama dikemas): %s (jangka 2)\n', n); if n<>2 then gagal:=gagal+1; end if;
    select sum(r.qty * c.unit_price) / m.portions into v from public.menu_ingredients r
      join public.ingredient_costs c on c.inventory_item_id = r.inventory_item_id
      join public.menu_items m on m.id = r.menu_item_id where m.id = menuL group by m.portions;
    res := res || format(E'Kos sepinggan Nasi Ayam: %s (jangka 1.9)\n', v); if v<>1.9 then gagal:=gagal+1; end if;
    -- simpan semula: resipi diganti, bukan ditambah
    perform public.save_menu(menuL, lubok, 'UJI Nasi Ayam', 9, 2, json_build_array(json_build_object('item', itL, 'qty', 0.5))::jsonb);
    select count(*) into n from public.menu_ingredients where menu_item_id = menuL;
    res := res || format(E'Simpan semula resipi, baris: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    begin perform public.save_menu(menuL, lubok, 'UJI Nasi Ayam', 9, 2, json_build_array(json_build_object('item', itI, 'qty', 1))::jsonb);
      res := res || E'Bahan outlet lain dalam resipi: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Bahan outlet lain dalam resipi: ditolak (betul)\n'; end;
    begin update public.menu_items set outlet_id = intan where id = menuL;
      res := res || E'Pindah menu ke outlet lain: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Pindah menu ke outlet lain: ditolak (betul)\n'; end;
    select count(*) into n from public.daily_food_cost;
    res := res || format(E'Owner boleh baca daily_food_cost: ya (%s baris)\n', n);
    reset role;

    -- ===== Admin Lubok =====
    perform set_config('request.jwt.claims', json_build_object('sub', aL)::text, true);
    set local role authenticated;
    select count(*) into n from public.menu_items where id in (menuL, menuI);
    res := res || format(E'Admin Lubok nampak menu: %s (jangka 1, Lubok sahaja)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.ingredient_costs where inventory_item_id in (itL, itI);
    res := res || format(E'Admin Lubok nampak harga: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    update public.ingredient_costs set unit_price = 10 where inventory_item_id = itI;
    get diagnostics n = row_count;
    res := res || format(E'Admin Lubok ubah harga Intan: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin perform public.save_menu(null, intan, 'UJI Curi', 1, 1, '[]'::jsonb);
      res := res || E'Admin Lubok cipta menu Intan: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Admin Lubok cipta menu Intan: ditolak (betul)\n'; end;
    begin perform public.save_menu(menuI, intan, 'UJI Curi', 1, 1, '[]'::jsonb);
      res := res || E'Admin Lubok ubah menu Intan: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Admin Lubok ubah menu Intan: ditolak (betul)\n'; end;
    reset role;

    -- ===== Manager Intan: tiada akses langsung =====
    perform set_config('request.jwt.claims', json_build_object('sub', mI)::text, true);
    set local role authenticated;
    select (select count(*) from public.menu_items) + (select count(*) from public.ingredient_costs)
         + (select count(*) from public.menu_ingredients) + (select count(*) from public.daily_food_cost) into n;
    res := res || format(E'Manager nampak data food cost: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin insert into public.ingredient_costs (inventory_item_id, unit_price) values (itI, 1);
      res := res || E'Manager simpan harga: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager simpan harga: ditolak (betul)\n'; end;
    reset role;

    -- ===== Staff =====
    if st is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', st)::text, true);
      set local role authenticated;
      select (select count(*) from public.menu_items) + (select count(*) from public.ingredient_costs) into n;
      res := res || format(E'Staff nampak data food cost: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
      reset role;
    else
      res := res || E'Staff: tiada akaun staff untuk diuji (langkau)\n';
    end if;

    -- ===== Padam barang stok -> harga & baris resipi ikut terpadam =====
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    delete from public.inventory_items where id = itL;
    select (select count(*) from public.ingredient_costs where inventory_item_id = itL)
         + (select count(*) from public.menu_ingredients where inventory_item_id = itL) into n;
    res := res || format(E'Padam barang stok, sisa harga/resipi: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
  exception when others then
    if sqlerrm like 'HASIL UJIAN%' then raise; end if;
    res := res || 'RALAT TAK DIJANGKA: ' || sqlerrm || E'\n'; gagal := gagal + 1;
  end;
  raise exception E'HASIL UJIAN (% gagal)\n%', gagal, res;
end $$;
