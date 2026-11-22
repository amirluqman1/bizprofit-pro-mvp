-- Ujian Fasa 14: Owner tambah outlet (semua dibatalkan; hasil keluar sebagai ralat "HASIL UJIAN")
do $$
declare res text := ''; gagal int := 0; n int; n0 int;
  o uuid; biz uuid; adm uuid; st uuid; newid uuid;
begin
  select user_id, business_id into o, biz from public.staff_profiles where role = 'owner' limit 1;
  select user_id into adm from public.staff_profiles where business_id = biz and role in ('admin', 'manager') limit 1;
  select user_id into st from public.staff_profiles where business_id = biz and role = 'staff' limit 1;
  select count(*) into n0 from public.outlets where business_id = biz;
  begin
    -- Owner, pakej Business: boleh tambah
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    insert into public.outlets (name) values ('UJI F14 Outlet') returning id into newid;
    select count(*) into n from public.outlets where id = newid and business_id = biz;
    res := res || format(E'Owner tambah outlet (syarikat sendiri): %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    begin insert into public.outlets (name) values ('   ');
      res := res || E'Owner tambah outlet nama kosong: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Owner tambah outlet nama kosong: ditolak (betul)\n'; end;
    begin insert into public.outlets (name) values ('UJI F14 Outlet');
      res := res || E'Owner tambah nama sama: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Owner tambah nama sama: ditolak (betul)\n'; end;
    reset role;

    -- Bukan owner: tak boleh
    if adm is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', adm)::text, true);
      set local role authenticated;
      begin insert into public.outlets (name) values ('UJI F14 Admin');
        res := res || E'Admin/manager tambah outlet: DITERIMA (SALAH)\n'; gagal:=gagal+1;
      exception when others then res := res || E'Admin/manager tambah outlet: ditolak (betul)\n'; end;
      reset role;
    end if;
    if st is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', st)::text, true);
      set local role authenticated;
      begin insert into public.outlets (name) values ('UJI F14 Staff');
        res := res || E'Staff tambah outlet: DITERIMA (SALAH)\n'; gagal:=gagal+1;
      exception when others then res := res || E'Staff tambah outlet: ditolak (betul)\n'; end;
      reset role;
    end if;

    -- Owner, pakej Percuma: had 1 outlet
    update public.businesses set plan = 'free', plan_until = null, trial_ends_at = null where id = biz;
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    begin insert into public.outlets (name) values ('UJI F14 Lebih Had');
      res := res || E'Percuma: owner tambah melebihi had: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || format(E'Percuma: owner tambah melebihi had: ditolak (betul) — "%s"\n', sqlerrm); end;
    reset role;

    raise exception 'ROLLBACK_UJIAN';
  exception when others then
    if sqlerrm <> 'ROLLBACK_UJIAN' then
      res := res || format(E'RALAT TAK DIJANGKA: %s\n', sqlerrm); gagal := gagal + 1;
    end if;
  end;
  raise exception E'HASIL UJIAN (% gagal)\n%', gagal, res;
end $$;
