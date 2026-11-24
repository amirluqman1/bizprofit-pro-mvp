-- =====================================================================
-- BizProfit Pro · Fasa 13: Gambar resit pada transaksi (ciri Pro)
--
--   - Setiap transaksi (In / Out) boleh ada SATU gambar resit.
--   - Gambar disimpan dalam Storage bucket peribadi "receipts":
--       <business_id>/<outlet_id>/<uuid>.jpg
--   - Siapa boleh LAMPIR : sesiapa yang boleh key in untuk outlet itu
--                          (owner: semua outlet; lain-lain: outlet sendiri).
--   - Siapa boleh TENGOK : sesiapa yang boleh nampak transaksi itu
--                          (staff: transaksi sendiri hari ini sahaja).
--   - Tukar / buang resit pada transaksi lama: owner & admin (macam edit
--     transaksi biasa, direkod dalam log audit).
--   - Pakej Percuma: tidak boleh lampir/tukar resit. Resit lama TIDAK dipadam
--     dan masih boleh dilihat (prinsip sama macam Fasa 12).
--
-- Fail gambar tidak dipadam bila transaksi dipadam: rekod audit masih
-- menyimpan laluan resit sebagai bukti.
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Kolum resit -------------------------------------------------------------
alter table public.transactions add column receipt_path text;
create index idx_transactions_receipt_path on public.transactions (receipt_path) where receipt_path is not null;

-- 2. Siapa boleh key in untuk outlet ini (sama dengan policy insert transaksi)
create function public.can_keyin_outlet(p_outlet uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_profiles sp
    join public.outlets o on o.id = p_outlet and o.business_id = sp.business_id
    where sp.user_id = (select auth.uid())
      and (sp.role = 'owner' or sp.outlet_id = p_outlet)
  )
$$;
revoke execute on function public.can_keyin_outlet(uuid) from public, anon;
grant execute on function public.can_keyin_outlet(uuid) to authenticated;

-- 3. Kawalan resit pada transaksi --------------------------------------------
-- Resit baru/bertukar: mesti pakej Pro/Business, dan laluan mesti dalam folder
-- syarikat sendiri (tak boleh tunjuk ke fail syarikat lain). Folder outlet
-- disemak semasa muat naik; owner masih boleh pindah transaksi ke outlet lain.
create function public.transactions_receipt_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.receipt_path is null then return new; end if;
  if tg_op = 'UPDATE' and new.receipt_path is not distinct from old.receipt_path then return new; end if;
  if public.current_plan() = 'free' then
    raise exception 'Gambar resit ialah ciri pakej Pro. Naik taraf untuk guna.';
  end if;
  if new.receipt_path not like new.business_id::text || '/%' then
    raise exception 'Laluan gambar resit tidak sah';
  end if;
  return new;
end $$;
revoke execute on function public.transactions_receipt_guard() from public, anon, authenticated;

create trigger trg_transactions_receipt_guard before insert or update of receipt_path on public.transactions
  for each row execute function public.transactions_receipt_guard();

-- Adakah gambar ini sudah dipautkan ke mana-mana transaksi (tanpa ikut RLS,
-- supaya staff tak boleh padam resit transaksi lama yang dia tak nampak lagi).
create function public.receipt_in_use(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.transactions t where t.receipt_path = p_path)
$$;
revoke execute on function public.receipt_in_use(text) from public, anon;
grant execute on function public.receipt_in_use(text) to authenticated;

-- 4. Storage bucket (peribadi, gambar sahaja, maks 5 MB) ---------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Muat naik: folder syarikat sendiri, outlet yang dia boleh key in, pakej Pro.
create policy "resit: muat naik" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_business_id())::text
    and (select public.can_keyin_outlet(((storage.foldername(name))[2])::uuid))
    and (select public.current_plan()) <> 'free'
  );

-- Tengok: hanya jika dia boleh nampak transaksi yang guna gambar ini
-- (subquery ikut RLS transaksi, jadi akses resit = akses transaksi).
create policy "resit: tengok" on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_business_id())::text
    and exists (select 1 from public.transactions t where t.receipt_path = objects.name)
  );

-- Padam: owner/admin outlet itu, atau pemuat naik sendiri untuk gambar yang
-- belum dipautkan ke mana-mana transaksi (contoh simpan transaksi gagal).
create policy "resit: padam" on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_business_id())::text
    and (
      (select public.can_admin_outlet(((storage.foldername(name))[2])::uuid))
      or (owner_id = (select auth.uid())::text
          and not public.receipt_in_use(objects.name))
    )
  );

commit;
