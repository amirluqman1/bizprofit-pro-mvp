do $$
declare res text := ''; gagal int := 0; o uuid; mI uuid; amir uuid; intan uuid; lubok uuid; pay text;
  hari date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  select id into amir from public.outlets where name = 'Amir Food Industry Services';
  select id into intan from public.outlets where name = 'Restoran 3 Intan';
  select id into lubok from public.outlets where name = 'Lubok Sarapan';
  select user_id into o from public.staff_profiles where role = 'owner' limit 1;
  select user_id into mI from public.staff_profiles where role = 'manager' and outlet_id = intan;
  select name into pay from public.payment_methods limit 1;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    begin insert into public.transactions (transaction_date,type,category,amount,payment_method,outlet_id) values (hari,'In','Shop Sales',10,pay,intan);
      res := res || E'Owner key in ke Restoran 3 Intan: OK\n';
    exception when others then res := res || 'Owner key in ke outlet lain: GAGAL '||sqlerrm||E'\n'; gagal:=gagal+1; end;
    begin insert into public.transactions (transaction_date,type,category,amount,payment_method,outlet_id,created_by) values (hari,'In','Shop Sales',10,pay,intan,mI);
      res := res || E'Owner key in atas nama orang lain: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Owner key in atas nama orang lain: ditolak (betul)\n'; end;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', mI)::text, true);
    set local role authenticated;
    begin insert into public.transactions (transaction_date,type,category,amount,payment_method,outlet_id) values (hari,'In','Shop Sales',10,pay,lubok);
      res := res || E'Manager Intan key in ke Lubok: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager Intan key in ke Lubok: ditolak (betul)\n'; end;
    begin insert into public.transactions (transaction_date,type,category,amount,payment_method,outlet_id) values (hari,'In','Shop Sales',10,pay,intan);
      res := res || E'Manager Intan key in outlet sendiri: OK\n';
    exception when others then res := res || 'Manager outlet sendiri: GAGAL '||sqlerrm||E'\n'; gagal:=gagal+1; end;
    reset role;
    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if; end;
  raise exception E'\n===== HASIL UJIAN FASA 4 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
