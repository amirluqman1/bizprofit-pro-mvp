-- Ujian Fasa 11: lauk/menu dalam menu (semua dibatalkan; hasil keluar sebagai ralat "HASIL UJIAN")
do $$
declare res text := ''; gagal int := 0; n int;
  o uuid; lubok uuid; intan uuid; itL uuid; ag uuid; nla uuid; nlb uuid; mi uuid;
begin
  select id into lubok from public.outlets where name = 'Lubok Sarapan';
  select id into intan from public.outlets where name = 'Restoran 3 Intan';
  select user_id into o from public.staff_profiles where role = 'owner' limit 1;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    insert into public.inventory_items (business_id, outlet_id, name, unit, current_qty, target_qty)
      select business_id, lubok, 'UJI Ayam F11', 'kg', 5, 10 from public.outlets where id = lubok returning id into itL;
    set local role authenticated;
    ag  := public.save_menu(null, lubok, 'UJI Ayam Goreng', 0, 10, json_build_array(json_build_object('item', itL, 'qty', 3))::jsonb);
    nla := public.save_menu(null, lubok, 'UJI NL Ayam', 8, 1, json_build_array(json_build_object('menu', ag, 'qty', 1))::jsonb);
    select count(*) into n from public.menu_ingredients where menu_item_id = nla and sub_menu_id = ag and inventory_item_id is null;
    res := res || format(E'Lauk masuk dalam menu: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    begin perform public.save_menu(ag, lubok, 'UJI Ayam Goreng', 0, 10, json_build_array(json_build_object('menu', nla, 'qty', 1))::jsonb);
      res := res || E'Pusingan A->B->A: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Pusingan A->B->A: ditolak (betul)\n'; end;
    begin perform public.save_menu(ag, lubok, 'UJI Ayam Goreng', 0, 10, json_build_array(json_build_object('menu', ag, 'qty', 1))::jsonb);
      res := res || E'Menu guna diri sendiri: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Menu guna diri sendiri: ditolak (betul)\n'; end;
    mi := public.save_menu(null, intan, 'UJI Menu Intan', 5, 1, '[]'::jsonb);
    begin perform public.save_menu(mi, intan, 'UJI Menu Intan', 5, 1, json_build_array(json_build_object('menu', ag, 'qty', 1))::jsonb);
      res := res || E'Lauk outlet lain: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Lauk outlet lain: ditolak (betul)\n'; end;
    begin insert into public.menu_ingredients (menu_item_id, inventory_item_id, sub_menu_id, qty) values (nla, itL, ag, 1);
      res := res || E'Baris stok + lauk serentak: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Baris stok + lauk serentak: ditolak (betul)\n'; end;
    begin delete from public.menu_items where id = ag;
      res := res || E'Padam lauk yang sedang diguna: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Padam lauk yang sedang diguna: ditolak (betul)\n'; end;
    delete from public.menu_items where id = nla;
    delete from public.menu_items where id = ag;
    get diagnostics n = row_count;
    res := res || format(E'Padam lauk selepas menu induk dipadam: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    nlb := public.save_menu(null, lubok, 'UJI NL Biasa', 5, 1, json_build_array(json_build_object('item', itL, 'qty', 0.1))::jsonb);
    select count(*) into n from public.menu_ingredients where menu_item_id = nlb;
    res := res || format(E'Resipi bahan stok biasa masih jalan: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    reset role;
  exception when others then
    if sqlerrm like 'HASIL UJIAN%' then raise; end if;
    res := res || 'RALAT TAK DIJANGKA: ' || sqlerrm || E'\n'; gagal := gagal + 1;
  end;
  raise exception E'HASIL UJIAN (% gagal)\n%', gagal, res;
end $$;
