-- Ujian Fasa 24: hari mula minggu (semua dibatalkan; hasil keluar sebagai ralat "HASIL UJIAN")
do $$
declare res text := ''; gagal int := 0; n int; v int;
  o uuid; biz uuid; adm uuid; adm_outlet uuid; mgr uuid; st uuid; outlet1 uuid; outlet_lain uuid; biz2 uuid; outlet_biz2 uuid;
begin
  select user_id, business_id into o, biz from public.staff_profiles where role = 'owner' limit 1;
  select user_id, outlet_id into adm, adm_outlet from public.staff_profiles where business_id = biz and role = 'admin' limit 1;
  select user_id into mgr from public.staff_profiles where business_id = biz and role = 'manager' limit 1;
  select user_id, outlet_id into st, outlet1 from public.staff_profiles where business_id = biz and role = 'staff' limit 1;
  select id into outlet_lain from public.outlets where business_id = biz and id is distinct from adm_outlet limit 1;
  select id into biz2 from public.businesses where id <> biz limit 1;
  select id into outlet_biz2 from public.outlets where business_id = biz2 limit 1;
  begin
    -- Lalai: semua outlet sedia ada Isnin (1)
    select count(*) into n from public.outlets where week_start <> 1;
    res := res || format(E'Outlet bukan lalai Isnin sebelum ujian: %s (jangka 0 pada pelancaran)\n', n);

    -- Owner: boleh ubah outlet sendiri
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    update public.outlets set week_start = 5 where id = coalesce(adm_outlet, outlet_lain);
    get diagnostics n = row_count;
    res := res || format(E'Owner ubah hari mula minggu (outlet sendiri): %s baris (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    -- Nilai tidak sah ditolak
    begin update public.outlets set week_start = 7 where id = coalesce(adm_outlet, outlet_lain);
      res := res || E'Nilai 7: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Nilai 7: ditolak (betul)\n'; end;
    begin update public.outlets set week_start = -1 where id = coalesce(adm_outlet, outlet_lain);
      res := res || E'Nilai -1: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Nilai -1: ditolak (betul)\n'; end;
    begin update public.outlets set week_start = null where id = coalesce(adm_outlet, outlet_lain);
      res := res || E'Nilai kosong: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Nilai kosong: ditolak (betul)\n'; end;
    reset role;

    -- Admin: boleh ubah outlet sendiri, tak boleh outlet lain
    if adm is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', adm)::text, true);
      set local role authenticated;
      update public.outlets set week_start = 6 where id = adm_outlet;
      get diagnostics n = row_count;
      res := res || format(E'Admin ubah outlet sendiri: %s baris (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
      if outlet_lain is not null and outlet_lain <> adm_outlet then
        update public.outlets set week_start = 6 where id = outlet_lain;
        get diagnostics n = row_count;
        res := res || format(E'Admin ubah outlet lain: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
      else
        res := res || E'Admin ubah outlet lain: DILANGKAU (hanya satu outlet)\n';
      end if;
      reset role;
    else
      res := res || E'Admin: DILANGKAU (tiada admin)\n';
    end if;

    -- Manager & staff: tak boleh ubah
    if mgr is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', mgr)::text, true);
      set local role authenticated;
      begin update public.outlets set week_start = 2 where business_id = biz;
        get diagnostics n = row_count;
        res := res || format(E'Manager ubah: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
      exception when others then res := res || E'Manager ubah: ditolak (betul)\n'; end;
      reset role;
    else
      res := res || E'Manager: DILANGKAU (tiada manager)\n';
    end if;
    if st is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', st)::text, true);
      set local role authenticated;
      begin update public.outlets set week_start = 2 where business_id = biz;
        get diagnostics n = row_count;
        res := res || format(E'Staff ubah: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
      exception when others then res := res || E'Staff ubah: ditolak (betul)\n'; end;
      reset role;
    else
      res := res || E'Staff: DILANGKAU (tiada staff)\n';
    end if;

    -- Pengasingan syarikat: owner tak boleh ubah outlet syarikat lain
    if outlet_biz2 is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
      set local role authenticated;
      update public.outlets set week_start = 3 where id = outlet_biz2;
      get diagnostics n = row_count;
      res := res || format(E'Owner ubah outlet syarikat lain: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
      reset role;
      select week_start into v from public.outlets where id = outlet_biz2;
      res := res || format(E'Outlet syarikat lain kekal: %s (jangka tidak 3)\n', v); if v = 3 then gagal:=gagal+1; end if;
    else
      res := res || E'Pengasingan syarikat: DILANGKAU (tiada syarikat kedua)\n';
    end if;

    raise exception 'ROLLBACK_UJIAN';
  exception when others then
    if sqlerrm <> 'ROLLBACK_UJIAN' then
      res := res || format(E'RALAT TAK DIJANGKA: %s\n', sqlerrm); gagal := gagal + 1;
    end if;
  end;
  raise exception E'HASIL UJIAN (% gagal)\n%', gagal, res;
end $$;
