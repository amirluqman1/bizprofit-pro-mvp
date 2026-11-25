# Snapshot database & staging

| Fail | Apa |
|---|---|
| `production_schema.sql` | Struktur penuh database production (table, fungsi, trigger, view, RLS, kebenaran, bucket resit). **Tiada data.** |
| `staging_seed.sql` | Data palsu + 5 akaun ujian untuk projek staging. |

## Kenapa ada snapshot
`supabase/migrations/` tidak lengkap: perubahan awal (policy inventori, log stok, trigger
inventori) dibuat terus di Supabase, dan sejarah migration di production tidak sama dengan
repo. Snapshot ini diambil terus dari katalog production (baca sahaja) pada 2026-11-25,
selepas Fasa 13, jadi ia ialah sumber yang tepat untuk membina database baru.

## Bina staging dari kosong
1. Buat projek Supabase baru (cth. `bizprofit-staging`, region sama: ap-northeast-1).
2. SQL Editor → jalankan `production_schema.sql`.
3. SQL Editor → jalankan (dalam satu run):
   ```sql
   select set_config('app.seed_password', '<kata laluan ujian>', false);
   -- kemudian tampal isi staging_seed.sql
   ```
   Jangan commit kata laluan itu. Simpan sebagai secret.

Seed akan **menolak** untuk berjalan jika database sudah ada syarikat lain (pelindung
supaya tak tersilap jalankan di production).

## Akaun ujian
| Emel | Peranan | Syarikat / outlet |
|---|---|---|
| owner.demo@example.com | owner | A (pakej Business), semua outlet |
| admin.demo@example.com | admin | A, Outlet Bangi |
| manager.demo@example.com | manager | A, Outlet Bangi |
| staff.demo@example.com | staff | A, Outlet Bangi |
| owner.lain@example.com | owner | B (pakej Free), untuk uji pengasingan |

## Disahkan
Snapshot + seed dijalankan pada Postgres 16 tempatan (dengan tiruan `auth`/`storage`).
Semakan RLS ikut peranan:

| Peranan | Transaksi | Outlet | Pekerja | Ringkasan profit | Data syarikat lain |
|---|---|---|---|---|---|
| owner A | 158 (semua) | 2 | 5 | 60 | 0 |
| admin | 98 (Bangi) | 1 | 4 | 30 | 0 |
| manager | 98 (Bangi) | 1 | 3 (bukan pengurus) | 30 | 0 |
| staff | 2 (sendiri, hari ini) | 1 | 0 | 0 | 0 |
| owner B | 30 | 1 | 1 | 30 | 0 |

## Nota dari production (untuk tindakan kemudian)
- Peranan `anon` masih ada grant penuh pada 6 table (`transactions`, `staff_profiles`, dll).
  Tiada kesan sekarang kerana RLS aktif dan semua policy hanya `to authenticated`, tapi
  lebih selamat jika ditarik balik (lapisan pertahanan kedua). Perlu migration + izin.
- Kategori & kaedah bayaran production hanya wujud untuk satu syarikat; tiada mekanisme
  automatik untuk syarikat baru.
