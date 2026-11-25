-- =====================================================================
-- BizProfit Pro · Fasa 16: Had sejarah transaksi pakej Percuma
--
-- Apa berubah:
--   Pakej Percuma hanya boleh baca, tambah, ubah dan padam transaksi bertarikh
--   dari 1hb BULAN LEPAS (waktu Malaysia) hingga sekarang. Contoh: pada 25 Nov,
--   dari 1 Okt. Pro / Business / trial Pro: tiada had.
--
-- Siapa boleh buat apa:
--   Policy RESTRICTIVE: ditambah di atas policy peranan sedia ada (owner, admin,
--   manager, staff) dan tenant_isolation. Ia hanya MENGECILKAN akses, tak pernah
--   membuka akses baru.
--
-- Prinsip (CLAUDE.md, pakej): data lama TIDAK dipadam. Ia cuma tak kelihatan
-- untuk pakej Percuma dan kembali sebaik sahaja syarikat naik taraf.
--
-- Kes tepi:
--   - Januari: had bermula 1 Dis tahun lepas.
--   - Fungsi SECURITY DEFINER (cth. give_advance) tidak tertakluk RLS; ia
--     sentiasa guna tarikh hari ini, jadi tidak terjejas.
--   - Staff sedia ada hanya nampak transaksi sendiri hari ini: masih sama.
--   - App juga hadkan paparan (freeHistoryStart() dalam app/js/plan.js); nilai
--     mesti sama dengan fungsi di bawah.
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- Tarikh paling awal yang dibenarkan untuk syarikat semasa.
-- Percuma: 1hb bulan lepas (waktu Malaysia). Pakej lain: tiada had (-infinity).
create function public.history_floor()
returns date language sql stable security definer set search_path = '' as $$
  select case when public.current_plan() = 'free'
    then (date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur')) - interval '1 month')::date
    else '-infinity'::date end
$$;
revoke execute on function public.history_floor() from public, anon;
grant execute on function public.history_floor() to authenticated;

create policy "pakej percuma: had sejarah" on public.transactions as restrictive for all to authenticated
  using (transaction_date >= (select public.history_floor()))
  with check (transaction_date >= (select public.history_floor()));

commit;
