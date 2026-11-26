-- Ujian Fasa 17: Daftar sendiri & jemput staf (semua dibatalkan; hasil keluar sebagai ralat "HASIL UJIAN")
do $$
declare res text := ''; gagal int := 0; n int; s text;
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid(); e uuid := gen_random_uuid();
  o uuid; obiz uuid; biz uuid; outl uuid; outl2 uuid; tok text; tok2 text; tokA text; tokOld text;
  as_user text := 'perform set_config(''request.jwt.claims'', json_build_object(''sub'', %L)::text, true)';
begin
  select user_id, business_id into o, obiz from public.staff_profiles where role = 'owner' limit 1;
  begin
    -- Pengguna ujian (akaun log masuk sahaja, tiada profil)
    insert into auth.users (id, email, aud, role) values
      (a, 'uji-f17-a@example.com', 'authenticated', 'authenticated'), (b, 'uji-f17-b@example.com', 'authenticated', 'authenticated'),
      (c, 'uji-f17-c@example.com', 'authenticated', 'authenticated'), (d, 'uji-f17-d@example.com', 'authenticated', 'authenticated'),
      (e, 'uji-f17-e@example.com', 'authenticated', 'authenticated');

    -- ===== 1. Daftar sendiri =====
    perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
    set local role authenticated;
    biz := public.setup_business('  UJI Kedai Baru  ', 'UJI Outlet Satu');
    select count(*) into n from public.staff_profiles where user_id = a and role = 'owner' and business_id = biz;
    res := res || format(E'Daftar: A jadi owner syarikat baru: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select name into s from public.businesses where id = biz;
    res := res || format(E'Nama syarikat dikemas: "%s" (jangka "UJI Kedai Baru")\n', s); if s<>'UJI Kedai Baru' then gagal:=gagal+1; end if;
    select count(*) into n from public.categories where business_id = biz;
    res := res || format(E'Kategori asal: %s (jangka 26)\n', n); if n<>26 then gagal:=gagal+1; end if;
    select count(*) into n from public.payment_methods where business_id = biz;
    res := res || format(E'Kaedah bayaran asal: %s (jangka 6)\n', n); if n<>6 then gagal:=gagal+1; end if;
    s := public.current_plan();
    res := res || format(E'Pakej syarikat baru: %s (jangka pro, trial)\n', s); if s<>'pro' then gagal:=gagal+1; end if;
    select count(*) into n from public.transactions;
    res := res || format(E'A nampak transaksi syarikat lain: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin perform public.setup_business('UJI Kedua', 'UJI X');
      res := res || E'A daftar syarikat kedua: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'A daftar syarikat kedua: ditolak (betul)\n'; end;
    select id into outl from public.outlets where business_id = biz;

    -- ===== 2. Jemputan oleh owner A =====
    insert into public.staff_invites (outlet_id, role, label) values (outl, 'staff', 'UJI Ali') returning token into tok;
    insert into public.staff_invites (outlet_id, role) values (outl, 'admin') returning token into tok2;
    res := res || E'Owner cipta jemputan staff & admin: ok\n';
    begin insert into public.staff_invites (outlet_id, role) values (outl, 'owner');
      res := res || E'Jemputan role owner: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Jemputan role owner: ditolak (betul)\n'; end;
    begin insert into public.staff_invites (outlet_id, role, expires_at) values (outl, 'staff', now() + interval '1 year');
      res := res || E'Jemputan tempoh 1 tahun: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Jemputan tempoh 1 tahun: ditolak (betul)\n'; end;
    reset role;

    -- Owner syarikat lain tak boleh jemput ke outlet A / nampak jemputan A
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    begin insert into public.staff_invites (business_id, outlet_id, role) values (biz, outl, 'staff');
      res := res || E'Owner lain jemput ke syarikat A: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Owner lain jemput ke syarikat A: ditolak (betul)\n'; end;
    select count(*) into n from public.staff_invites where business_id = biz;
    res := res || format(E'Owner lain nampak jemputan A: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;

    -- invite_info tanpa login
    set local role anon;
    select count(*) into n from public.invite_info(tok) where business = 'UJI Kedai Baru' and role = 'staff' and valid;
    res := res || format(E'invite_info tanpa login: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.invite_info('salah');
    res := res || format(E'invite_info token salah: %s baris (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;

    -- ===== 3. Terima jemputan =====
    perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
    set local role authenticated;
    s := public.accept_invite(tok);
    select count(*) into n from public.staff_profiles where user_id = b and role = 'staff' and business_id = biz and outlet_id = outl;
    res := res || format(E'B terima jemputan -> staff syarikat A: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    begin perform public.setup_business('UJI Curi', 'UJI Y');
      res := res || E'B (sudah ahli) daftar syarikat sendiri: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'B (sudah ahli) daftar syarikat sendiri: ditolak (betul)\n'; end;
    begin insert into public.staff_invites (outlet_id, role) values (outl, 'staff');
      res := res || E'Staff B cipta jemputan: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Staff B cipta jemputan: ditolak (betul)\n'; end;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', c)::text, true);
    set local role authenticated;
    begin perform public.accept_invite(tok);
      res := res || E'C guna semula token yang sama: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'C guna semula token yang sama: ditolak (betul)\n'; end;
    reset role;

    -- D terima jemputan admin
    perform set_config('request.jwt.claims', json_build_object('sub', d)::text, true);
    set local role authenticated;
    perform public.accept_invite(tok2);
    select count(*) into n from public.staff_profiles where user_id = d and role = 'admin';
    res := res || format(E'D terima jemputan admin: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    begin insert into public.staff_invites (outlet_id, role) values (outl, 'admin');
      res := res || E'Admin D jemput admin lain: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Admin D jemput admin lain: ditolak (betul)\n'; end;
    insert into public.staff_invites (outlet_id, role) values (outl, 'manager') returning token into tokA;
    res := res || E'Admin D jemput manager outlet sendiri: ok\n';
    begin perform public.remove_member(a);
      res := res || E'Admin D buang owner: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Admin D buang owner: ditolak (betul)\n'; end;
    reset role;

    -- ===== 4. Had pakej (Percuma: 2 akaun staf) =====
    update public.businesses set plan = 'free', plan_until = null, trial_ends_at = null where id = biz;
    perform set_config('request.jwt.claims', json_build_object('sub', c)::text, true);
    set local role authenticated;
    begin perform public.accept_invite(tokA);
      res := res || E'Percuma: akaun staf ke-3: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || format(E'Percuma: akaun staf ke-3: ditolak (betul) — "%s"\n', sqlerrm); end;
    reset role;

    -- ===== 5. Jemputan tamat tempoh =====
    insert into public.staff_invites (business_id, outlet_id, role, created_by, expires_at) values (biz, outl, 'staff', a, now() - interval '1 minute') returning token into tokOld;
    perform set_config('request.jwt.claims', json_build_object('sub', e)::text, true);
    set local role authenticated;
    begin perform public.accept_invite(tokOld);
      res := res || E'Jemputan tamat tempoh: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Jemputan tamat tempoh: ditolak (betul)\n'; end;
    reset role;

    -- ===== 6. Senarai & buang ahli =====
    perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
    set local role authenticated;
    select count(*) into n from public.list_members() where email like 'uji-f17-%';
    res := res || format(E'Owner A senarai ahli (dengan e-mel): %s (jangka 3)\n', n); if n<>3 then gagal:=gagal+1; end if;
    begin perform public.remove_member(a);
      res := res || E'Owner buang diri sendiri: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Owner buang diri sendiri: ditolak (betul)\n'; end;
    perform public.remove_member(b);
    select count(*) into n from public.staff_profiles where user_id = b;
    res := res || format(E'Owner buang staff B: profil tinggal %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    select count(*) into n from public.list_members() where email like 'uji-f17-%';
    res := res || format(E'Owner lain nampak ahli syarikat A: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin perform public.remove_member(d);
      res := res || E'Owner lain buang admin syarikat A: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Owner lain buang admin syarikat A: ditolak (betul)\n'; end;
    reset role;

    raise exception 'ROLLBACK_UJIAN';
  exception when others then
    if sqlerrm <> 'ROLLBACK_UJIAN' then
      res := res || format(E'RALAT TAK DIJANGKA: %s\n', sqlerrm); gagal := gagal + 1;
    end if;
  end;
  raise exception E'HASIL UJIAN (% gagal)\n%', gagal, res;
end $$;
