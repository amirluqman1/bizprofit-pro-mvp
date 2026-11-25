-- Ujian Fasa 16: Had sejarah transaksi pakej Percuma (semua dibatalkan)
-- Hasil keluar sebagai mesej ralat "HASIL UJIAN".
do $$
declare res text := ''; gagal int := 0; n int;
  o uuid; biz uuid; ol uuid; fl date; lama date; baru date;
  txLama bigint; txBaru bigint; bB uuid; outB uuid; txB bigint;
begin
  select user_id, business_id into o, biz from public.staff_profiles where role = 'owner' limit 1;
  select id into ol from public.outlets where business_id = biz limit 1;
  fl   := (date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur')) - interval '1 month')::date;
  lama := fl - 1;                                                  -- sehari sebelum had
  baru := (now() at time zone 'Asia/Kuala_Lumpur')::date;

  begin
    -- Sediakan data (sebagai postgres, tanpa RLS): satu transaksi lama, satu baru,
    -- dan syarikat B dengan transaksi sendiri.
    insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method, outlet_id, created_by)
    select biz, lama, type, category, 1, 'UJI F16 lama', payment_method, ol, o from public.transactions where business_id = biz limit 1
    returning id into txLama;
    insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method, outlet_id, created_by)
    select biz, baru, type, category, 1, 'UJI F16 baru', payment_method, ol, o from public.transactions where business_id = biz limit 1
    returning id into txBaru;
    insert into public.businesses (name) values ('Syarikat Ujian F16') returning id into bB;
    update public.businesses set plan = 'business', plan_until = null, trial_ends_at = null where id = bB;
    insert into public.outlets (business_id, name) values (bB, 'Outlet B F16') returning id into outB;
    insert into public.transactions (business_id, transaction_date, type, category, amount, description, payment_method, outlet_id)
    select bB, lama, type, category, 1, 'UJI F16 syarikat B', payment_method, outB from public.transactions where business_id = biz limit 1
    returning id into txB;

    -- ===== Owner, pakej Percuma =====
    update public.businesses set plan = 'free', plan_until = null, trial_ends_at = null where id = biz;
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    set local role authenticated;

    select count(*) into n from public.transactions where id = txLama;
    res := res || format(E'Percuma: baca transaksi sebelum %s: %s (jangka 0)\n', fl, n); if n <> 0 then gagal := gagal + 1; end if;
    select count(*) into n from public.transactions where id = txBaru;
    res := res || format(E'Percuma: baca transaksi hari ini: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    select count(*) into n from public.transactions where transaction_date < fl;
    res := res || format(E'Percuma: jumlah baris sebelum had yang nampak: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;

    begin
      insert into public.transactions (transaction_date, type, category, amount, description, payment_method, outlet_id, created_by)
      select lama, type, category, 1, 'UJI F16 tambah lama', payment_method, ol, o from public.transactions where id = txBaru;
      res := res || E'Percuma: tambah transaksi tarikh lama: BERJAYA (jangka GAGAL)\n'; gagal := gagal + 1;
    exception when insufficient_privilege then res := res || E'Percuma: tambah transaksi tarikh lama: GAGAL (jangka GAGAL)\n';
    end;

    insert into public.transactions (transaction_date, type, category, amount, description, payment_method, outlet_id, created_by)
    select fl, type, category, 1, 'UJI F16 tambah 1hb', payment_method, ol, o from public.transactions where id = txBaru;
    res := res || format(E'Percuma: tambah transaksi bertarikh %s (1hb bulan lepas): OK (jangka OK)\n', fl);

    begin
      update public.transactions set transaction_date = lama where id = txBaru;
      res := res || E'Percuma: ubah tarikh ke sebelum had: BERJAYA (jangka GAGAL)\n'; gagal := gagal + 1;
    exception when insufficient_privilege then res := res || E'Percuma: ubah tarikh ke sebelum had: GAGAL (jangka GAGAL)\n';
    end;

    update public.transactions set amount = 2 where id = txLama;
    get diagnostics n = row_count;
    res := res || format(E'Percuma: ubah transaksi lama: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    delete from public.transactions where id = txLama;
    get diagnostics n = row_count;
    res := res || format(E'Percuma: padam transaksi lama: %s baris (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;

    -- Pengasingan syarikat: transaksi syarikat B tak pernah nampak
    select count(*) into n from public.transactions where id = txB;
    res := res || format(E'Percuma: baca transaksi syarikat lain: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    reset role;

    -- Data lama masih wujud (tidak dipadam)
    select count(*) into n from public.transactions where id = txLama;
    res := res || format(E'Transaksi lama masih ada dalam database: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;

    -- ===== Owner, naik taraf ke Pro: sejarah lama kembali =====
    update public.businesses set plan = 'pro', plan_until = null where id = biz;
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.transactions where id = txLama;
    res := res || format(E'Pro: baca transaksi lama: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    select count(*) into n from public.transactions where id = txB;
    res := res || format(E'Pro: baca transaksi syarikat lain: %s (jangka 0)\n', n); if n <> 0 then gagal := gagal + 1; end if;
    reset role;

    -- ===== Trial Pro aktif (pakej asas Percuma): tiada had =====
    update public.businesses set plan = 'free', plan_until = null, trial_ends_at = now() + interval '5 days' where id = biz;
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.transactions where id = txLama;
    res := res || format(E'Trial Pro: baca transaksi lama: %s (jangka 1)\n', n); if n <> 1 then gagal := gagal + 1; end if;
    reset role;

    raise exception 'ROLLBACK_UJIAN';
  exception when others then
    if sqlerrm <> 'ROLLBACK_UJIAN' then
      res := res || format(E'RALAT TAK DIJANGKA: %s\n', sqlerrm); gagal := gagal + 1;
    end if;
  end;
  raise exception E'HASIL UJIAN (% gagal)\n%', gagal, res;
end $$;
