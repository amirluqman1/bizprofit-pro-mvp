-- Ujian Fasa 12: Pakej langganan (semua dibatalkan; hasil keluar sebagai ralat "HASIL UJIAN")
do $$
declare res text := ''; gagal int := 0; n int; n0 int; p text;
  o uuid; biz uuid; outl uuid; item uuid; emp uuid; mi uuid;
begin
  select user_id, business_id into o, biz from public.staff_profiles where role = 'owner' limit 1;
  select id into outl from public.outlets where business_id = biz order by name limit 1;
  select id into emp from public.employees where business_id = biz and active limit 1;
  begin
    -- ===== Syarikat sedia ada: Business tanpa tamat =====
    select plan into p from public.businesses where id = biz;
    res := res || format(E'Syarikat sedia ada: %s (jangka business)\n', p); if p<>'business' then gagal:=gagal+1; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    p := public.current_plan();
    res := res || format(E'current_plan() owner: %s (jangka business)\n', p); if p<>'business' then gagal:=gagal+1; end if;
    begin update public.businesses set plan = 'business' where id = biz;
      res := res || E'Owner tukar pakej sendiri: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Owner tukar pakej sendiri: ditolak (betul)\n'; end;
    begin perform public.plan_of(biz);
      res := res || E'Pengguna panggil plan_of(): DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Pengguna panggil plan_of(): ditolak (betul)\n'; end;
    select count(*) into n0 from public.menu_items;
    reset role;

    -- Barang stok ujian (dicipta sebagai pengendali)
    insert into public.inventory_items (business_id, outlet_id, name, unit, current_qty, target_qty)
      values (biz, outl, 'UJI F12 Bahan', 'kg', 1, 2) returning id into item;

    -- ===== Trial: plan free, trial aktif -> pro =====
    update public.businesses set plan = 'free', plan_until = null, trial_ends_at = now() + interval '3 days' where id = biz;
    set local role authenticated;
    p := public.current_plan();
    res := res || format(E'Trial aktif: %s (jangka pro)\n', p); if p<>'pro' then gagal:=gagal+1; end if;
    reset role;

    -- ===== Percuma: trial tamat =====
    update public.businesses set trial_ends_at = now() - interval '1 day' where id = biz;
    set local role authenticated;
    p := public.current_plan();
    res := res || format(E'Trial tamat: %s (jangka free)\n', p); if p<>'free' then gagal:=gagal+1; end if;
    begin insert into public.ingredient_costs (inventory_item_id, unit_price) values (item, 5);
      res := res || E'Percuma: simpan harga bahan: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Percuma: simpan harga bahan: ditolak (betul)\n'; end;
    begin perform public.save_menu(null, outl, 'UJI F12 Menu', 5, 1, '[]'::jsonb);
      res := res || E'Percuma: cipta menu: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Percuma: cipta menu: ditolak (betul)\n'; end;
    update public.menu_items set selling_price = selling_price where true;
    get diagnostics n = row_count;
    res := res || format(E'Percuma: ubah menu lama: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    select count(*) into n from public.menu_items;
    res := res || format(E'Percuma: menu lama masih boleh dibaca: %s (jangka %s)\n', n, n0); if n<>n0 then gagal:=gagal+1; end if;
    select count(*) into n from public.daily_food_cost;
    res := res || format(E'Percuma: analisa food cost: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    if emp is not null then
      begin insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, base_amount, status)
              values (emp, '2000-01-01', '2000-01-31', 'bulanan', 1, 1, 'draf');
        res := res || E'Percuma: cipta slip gaji: DITERIMA (SALAH)\n'; gagal:=gagal+1;
      exception when others then res := res || E'Percuma: cipta slip gaji: ditolak (betul)\n'; end;
      begin perform public.give_advance(emp, 10, 'Cash', 'UJI F12');
        res := res || E'Percuma: beri advance: DITERIMA (SALAH)\n'; gagal:=gagal+1;
      exception when others then res := res || E'Percuma: beri advance: ditolak (betul)\n'; end;
    else
      res := res || E'(Tiada pekerja aktif: ujian gaji dilangkau)\n';
    end if;
    reset role;
    begin insert into public.outlets (business_id, name) values (biz, 'UJI F12 Outlet');
      res := res || E'Percuma: tambah outlet ke-2+: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Percuma: tambah outlet ke-2+: ditolak (betul)\n'; end;
    select count(*) into n from public.staff_profiles where business_id = biz and role <> 'owner';
    if n >= 2 then
      begin update public.staff_profiles set role = 'admin' where user_id = o;
        res := res || E'Percuma: tambah akaun staff melebihi had 2: DITERIMA (SALAH)\n'; gagal:=gagal+1;
      exception when others then res := res || E'Percuma: tambah akaun staff melebihi had 2: ditolak (betul)\n'; end;
    end if;

    -- ===== Pro berbayar =====
    update public.businesses set plan = 'pro', plan_until = now() + interval '30 days' where id = biz;
    set local role authenticated;
    p := public.current_plan();
    res := res || format(E'Pro aktif: %s (jangka pro)\n', p); if p<>'pro' then gagal:=gagal+1; end if;
    insert into public.ingredient_costs (inventory_item_id, unit_price) values (item, 5);
    get diagnostics n = row_count;
    res := res || format(E'Pro: simpan harga bahan: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    mi := public.save_menu(null, outl, 'UJI F12 Menu', 5, 1, json_build_array(json_build_object('item', item, 'qty', 1))::jsonb);
    res := res || format(E'Pro: cipta menu: %s\n', case when mi is null then 'GAGAL' else 'ok' end); if mi is null then gagal:=gagal+1; end if;
    if emp is not null then
      insert into public.payroll (employee_id, period_start, period_end, pay_type, rate, base_amount, status)
        values (emp, '2000-01-01', '2000-01-31', 'bulanan', 1, 1, 'draf');
      get diagnostics n = row_count;
      res := res || format(E'Pro: cipta slip gaji: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    end if;
    reset role;
    begin insert into public.outlets (business_id, name) values (biz, 'UJI F12 Outlet');
      res := res || E'Pro: tambah outlet ke-2+: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Pro: tambah outlet ke-2+: ditolak (betul)\n'; end;

    -- ===== Pro tamat tempoh -> Percuma =====
    update public.businesses set plan_until = now() - interval '1 day' where id = biz;
    set local role authenticated;
    p := public.current_plan();
    res := res || format(E'Pro tamat tempoh: %s (jangka free)\n', p); if p<>'free' then gagal:=gagal+1; end if;
    reset role;

    -- ===== Business =====
    update public.businesses set plan = 'business', plan_until = null where id = biz;
    select count(*) into n0 from public.outlets where business_id = biz;
    insert into public.outlets (business_id, name) values (biz, 'UJI F12 Outlet');
    res := res || format(E'Business: tambah outlet (%s -> %s): ok\n', n0, n0 + 1);
    select count(*) into n from public.plan_limits('business') where max_outlets = 10 and max_staff is null;
    res := res || format(E'Had Business 10 outlet, staff tanpa had: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;

    raise exception 'ROLLBACK_UJIAN';
  exception when others then
    if sqlerrm <> 'ROLLBACK_UJIAN' then
      res := res || format(E'RALAT TAK DIJANGKA: %s\n', sqlerrm); gagal := gagal + 1;
    end if;
  end;
  raise exception E'HASIL UJIAN (% gagal)\n%', gagal, res;
end $$;
