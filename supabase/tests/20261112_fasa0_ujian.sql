-- Ujian Fasa 0. Semua perubahan ujian DIBATALKAN di hujung (rollback).
do $$
declare
  res text := ''; gagal int := 0; n int;
  bA uuid; bB uuid; o uuid; mL uuid; mI uuid;
  amir uuid; lubok uuid; intan uuid; outB uuid; pay text; itB uuid;

  procedure_ok boolean;
begin
  select id into amir  from public.outlets where name = 'Amir Food Industry Services';
  select id into lubok from public.outlets where name = 'Lubok Sarapan';
  select id into intan from public.outlets where name = 'Restoran 3 Intan';
  select user_id into o  from public.staff_profiles where role = 'owner' limit 1;
  select user_id into mL from public.staff_profiles where role = 'manager' and outlet_id = lubok;
  select user_id into mI from public.staff_profiles where role = 'manager' and outlet_id = intan;
  select business_id into bA from public.outlets where id = amir;
  select name into pay from public.payment_methods where business_id = bA limit 1;

  begin  -- ===== blok ujian, dibatalkan di hujung =====
    -- Syarikat B palsu dengan outlet, kategori, cara bayaran sendiri
    insert into public.businesses (name) values ('Syarikat Ujian B') returning id into bB;
    insert into public.outlets (business_id, name) values (bB, 'Lubok Sarapan') returning id into outB; -- nama sama, syarikat lain
    insert into public.categories (business_id, key, name, type, counts_in_profit) values (bB, 'IN01', 'Shop Sales', 'In', true);
    insert into public.payment_methods (business_id, name) values (bB, 'Cash');
    -- Pindah manager Lubok ke syarikat B (sementara)
    update public.staff_profiles set business_id = bB, outlet_id = outB where user_id = mL;

    -- ---------- OWNER syarikat A ----------
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    select count(*) into n from public.businesses;      res := res || format(E'Owner nampak syarikat: %s (jangka 1)\n', n);  if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.outlets;         res := res || format(E'Owner nampak outlet: %s (jangka 3)\n', n);    if n<>3 then gagal:=gagal+1; end if;
    select count(*) into n from public.staff_profiles;  res := res || format(E'Owner nampak akaun: %s (jangka 3)\n', n);     if n<>3 then gagal:=gagal+1; end if;
    select count(*) into n from public.categories where name = 'Shop Sales'; res := res || format(E'Owner nampak kategori Shop Sales: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.inventory_items; res := res || format(E'Owner nampak barang: %s (jangka 2)\n', n);    if n<>2 then gagal:=gagal+1; end if;
    select count(*) into n from public.inventory_stock_logs; res := res || format(E'Owner nampak log: %s (jangka 4)\n', n); if n<>4 then gagal:=gagal+1; end if;
    -- Key in transaksi macam app (tanpa hantar business_id)
    begin
      insert into public.transactions (transaction_date, type, category, amount, payment_method, outlet_id, description)
      values (current_date, 'In', 'Shop Sales', 100, pay, amir, 'ujian');
      insert into public.transactions (transaction_date, type, category, amount, payment_method, outlet_id, description)
      values (current_date, 'Out', 'Ingredients', 30, pay, amir, 'ujian');
      res := res || E'Owner key in transaksi: OK\n';
    exception when others then res := res || 'Owner key in transaksi: GAGAL ' || sqlerrm || E'\n'; gagal:=gagal+1; end;
    select coalesce(sum(profit),0)::int into n from public.daily_summary where transaction_date = current_date;
    res := res || format(E'Owner profit hari ini: %s (jangka 70)\n', n); if n<>70 then gagal:=gagal+1; end if;
    -- Tambah barang macam app
    begin
      insert into public.inventory_items (outlet_id, name, unit, current_qty, target_qty) values (amir, 'Beras', 'kg', 5, 20);
      res := res || E'Owner tambah barang: OK\n';
    exception when others then res := res || 'Owner tambah barang: GAGAL ' || sqlerrm || E'\n'; gagal:=gagal+1; end;
    reset role;

    -- ---------- MANAGER 3 Intan (syarikat A) — tingkah laku lama kekal ----------
    perform set_config('request.jwt.claims', json_build_object('sub', mI)::text, true);
    set local role authenticated;
    select count(*) into n from public.outlets; res := res || format(E'Manager A nampak outlet: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    begin
      insert into public.inventory_items (outlet_id, name, unit, current_qty, target_qty) values (intan, 'Minyak', 'liter', 3, 10);
      update public.inventory_items set current_qty = 1 where outlet_id = intan and name = 'Minyak';
      res := res || E'Manager A tambah & ubah stok: OK\n';
    exception when others then res := res || 'Manager A tambah/ubah: GAGAL ' || sqlerrm || E'\n'; gagal:=gagal+1; end;
    reset role;

    -- ---------- MANAGER syarikat B — mesti terasing sepenuhnya ----------
    perform set_config('request.jwt.claims', json_build_object('sub', mL)::text, true);
    set local role authenticated;
    select count(*) into n from public.businesses;     res := res || format(E'Manager B nampak syarikat: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.outlets;        res := res || format(E'Manager B nampak outlet: %s (jangka 1)\n', n);   if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.categories;     res := res || format(E'Manager B nampak kategori: %s (jangka 1)\n', n); if n<>1 then gagal:=gagal+1; end if;
    select count(*) into n from public.transactions;   res := res || format(E'Manager B nampak transaksi A: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    select count(*) into n from public.daily_summary;  res := res || format(E'Manager B nampak ringkasan A: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    select count(*) into n from public.inventory_items; res := res || format(E'Manager B nampak barang A: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    select count(*) into n from public.inventory_stock_logs; res := res || format(E'Manager B nampak log A: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    begin
      insert into public.inventory_items (outlet_id, name, unit) values (amir, 'Curi', 'kg');
      res := res || E'Manager B tambah barang ke outlet A: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager B tambah barang ke outlet A: ditolak (betul)\n'; end;
    begin
      insert into public.inventory_items (business_id, outlet_id, name, unit) values (bA, outB, 'Curi2', 'kg');
      res := res || E'Manager B paksa business_id A: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager B paksa business_id A: ditolak (betul)\n'; end;
    begin
      insert into public.inventory_items (outlet_id, name, unit, current_qty, target_qty) values (outB, 'Ayam', 'kg', 2, 5) returning id into itB;
      res := res || E'Manager B tambah barang outlet sendiri: OK\n';
    exception when others then res := res || 'Manager B tambah outlet sendiri: GAGAL ' || sqlerrm || E'\n'; gagal:=gagal+1; end;
    begin
      insert into public.transactions (transaction_date, type, category, amount, payment_method, outlet_id) values (current_date, 'Out', 'Ingredients', 5, 'Cash', outB);
      res := res || E'Manager B guna kategori milik A: DITERIMA (SALAH)\n'; gagal:=gagal+1;
    exception when others then res := res || E'Manager B guna kategori milik A: ditolak (betul)\n'; end;
    reset role;

    -- ---------- OWNER A tak nampak barang B ----------
    perform set_config('request.jwt.claims', json_build_object('sub', o)::text, true);
    set local role authenticated;
    select count(*) into n from public.inventory_items where id = itB; res := res || format(E'Owner A nampak barang B: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    reset role;

    -- ---------- Orang tak login ----------
    perform set_config('request.jwt.claims', '', true);
    set local role anon;
    begin
      select count(*) into n from public.outlets;
      res := res || format(E'Tak login nampak outlet: %s (jangka 0)\n', n); if n<>0 then gagal:=gagal+1; end if;
    exception when others then res := res || E'Tak login baca outlet: ditolak (betul)\n'; end;
    reset role;

    raise exception 'UNDO_UJIAN';
  exception when raise_exception then
    if sqlerrm <> 'UNDO_UJIAN' then raise; end if;
  end;

  raise exception E'\n===== HASIL UJIAN FASA 0 (semua dibatalkan) =====\n%\nGAGAL: % ujian', res, gagal;
end $$;
