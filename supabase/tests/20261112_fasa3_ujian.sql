-- Ujian Fasa 3 (dibatalkan di hujung)
do $$
declare res text := ''; gagal int := 0; v numeric; n int; o uuid; amir uuid; stf uuid; lubok uuid; pay text;
  hari date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  select id into amir from public.outlets where name = 'Amir Food Industry Services';
  select id into lubok from public.outlets where name = 'Lubok Sarapan';
  select user_id into o from public.staff_profiles where role = 'owner' limit 1;
  select user_id into stf from public.staff_profiles where role = 'manager' and outlet_id = lubok;
  select name into pay from public.payment_methods limit 1;
  select count(*) into n from public.categories where is_sales;
  res := res || format(E'Kategori jualan ditanda: %s (jangka 3)\n', n); if n<>3 then gagal:=gagal+1; end if;
  begin
    insert into public.transactions (business_id, transaction_date, type, category, amount, payment_method, outlet_id, created_by)
    select business_id, hari, ty, cat, amt, pay, amir, o from public.outlets, (values
      ('In','Shop Sales',100::numeric), ('In','Other Income',40::numeric), ('In','Owner Money Added',500::numeric), ('Out','Ingredients',30::numeric)) x(ty,cat,amt)
    where id = amir;
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    select sales into v from public.daily_summary where outlet_id = amir and transaction_date = hari;
    res := res || format(E'Owner Jualan: %s (jangka 100, tanpa Other Income & duit owner)\n', v); if v<>100 then gagal:=gagal+1; end if;
    select profit into v from public.daily_summary where outlet_id = amir and transaction_date = hari;
    res := res || format(E'Owner Profit: %s (jangka 110 = 100+40-30)\n', v); if v<>110 then gagal:=gagal+1; end if;
    reset role;
    update public.staff_profiles set role = 'staff' where user_id = stf;
    perform set_config('request.jwt.claims', json_build_object('sub', stf)::text, true);
    set local role authenticated;
    select count(*) into n from public.daily_summary;
    res := res || format(E'Staff nampak ringkasan: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;
    raise exception 'UNDO_UJIAN';
  exception when raise_exception then if sqlerrm <> 'UNDO_UJIAN' then raise; end if;
  end;
  raise exception E'\n===== HASIL UJIAN FASA 3 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
