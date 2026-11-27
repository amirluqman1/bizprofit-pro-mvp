# CLAUDE.md: BizProfit Pro

Sistem pengurusan F&B berbilang outlet (kewangan, stok, pekerja, gaji). PWA vanilla
HTML/CSS/JS + Supabase. SaaS: setiap syarikat (`business_id`) terasing sepenuhnya.
Live: https://amirluqman1.github.io/bizprofit-pro-mvp/ (GitHub Pages dari `main`).

## Peraturan wajib
- **Repo ini PUBLIC.** Jangan sesekali commit `service_role` key, kata laluan, token,
  atau data pelanggan sebenar. `config.js` hanya ada URL + publishable key (selamat, dilindungi RLS).
- **Keselamatan dikuatkuasa di database (RLS), bukan UI.** Sekatan di UI (router `roles`,
  kunci 🔒 dalam `plan.js`) hanya untuk paparan. Setiap ciri yang menyentuh data perlu
  policy RLS + ujian dalam `supabase/tests/`.
- **Database production: jangan ubah tanpa izin.** Jangan apply migration, run SQL yang
  mengubah data, atau padam apa-apa di Supabase tanpa pengguna setuju secara jelas dalam
  mesej itu. Baca (select, list tables, logs) boleh.
- **Gaji ialah duit orang.** Jangan teka peraturan gaji. Kalau tak pasti (kiraan OT, advance,
  slip mingguan vs bulanan), tanya. Prinsip yang dah tetap: satu hari kerja tak boleh dibayar dua kali.
- Log audit tidak boleh diubah atau dipadam. Setiap ubah/padam transaksi mesti direkod.

## Peranan
`owner` (semua outlet) > `admin` > `manager` > `staff` (outlet sendiri). Ringkasnya:
- Staff: tak nampak profit/laporan/pekerja; Key In sahaja, nampak transaksi sendiri hari ini.
- Manager: tak boleh ubah/padam transaksi; urus pekerja bukan peringkat pengurus.
- Admin: penuh untuk outlet sendiri, termasuk log audit.
Jadual penuh dalam `README.md`. Pastikan README dikemas kini bila peranan berubah.

## Pakej langganan (Fasa 12)
`free` / `pro` (RM15) / `business` (RM80, ≤10 outlet). Sumber sebenar: fungsi `current_plan()`
+ RLS. `app/js/plan.js` (`PLANS`, `FEATURES`) hanya paparan dan mesti selari dengan database.
Prinsip: bila turun ke Free, data lama TIDAK dipadam; cuma tak boleh tambah/ubah. Rekod gaji, menu dan
harga lama masih boleh dibaca. Pengecualian: transaksi untuk Free terhad kepada bulan lepas + bulan ini
(baca/tambah/ubah/padam), dikunci di database (Fasa 16, `history_floor()`) dan dipapar di app
(`freeHistoryStart()`, mesti sama). Data lama tidak dipadam dan kembali bila naik taraf.

## Struktur
- `app/index.html`: rangka; muat `../config.js`, supabase-js dari CDN (versi tetap), kemudian `js/main.js` (ES module).
- `app/js/router.js`: navigasi hash (`#/rekod`). Senarai `PAGES` = halaman + `roles` + `tab`.
- `app/js/pages/*.js`: satu fail satu halaman; eksport `{ render(view) }` yang pulangkan fungsi `cleanup` (pilihan).
- `app/js/ui.js` (`$`, `esc`, `icon`, `toast`, `store`), `format.js` (`todayKL`, `rm`, `sen`, `addDays`), `session.js` (`session.role`, `session.plan`, `session.isManagerUp`).
- `app/js/auth.js`: skrin log masuk, daftar, lupa/set semula kata laluan, sediakan syarikat, pautan jemputan (`?invite=TOKEN`).
- `app/js/members.js`: Menu → akaun pengguna & jemput staf (owner/admin). `app/js/receipt.js`: gambar resit (Pro).
- `app/js/i18n.js` (`t`, `getLang`, `setLang`, `locale`) + `app/js/i18n-ms.js` (kamus BM, ~760 entri).
- `app/js/plan.js`: `freeHistoryStart()` = had tarikh Percuma di app (mesti sama dengan `history_floor()` di DB).
- `app/css/app.css`: semua gaya. `app/sw.js`: service worker.
- `supabase/migrations/`: `YYYYMMDD_faseN_nama.sql`. `supabase/tests/`: `YYYYMMDD_faseN_ujian.sql`.
- `design/`: konsep reka bentuk sahaja, bukan sebahagian app.
- `index.html` & `inventory-emerald-v1.html` di root hanya melencong ke `app/`.

## Konvensyen kod
- **Tiada build step, tiada npm.** JS biasa dengan `import`/`export`. Jangan tambah framework/bundler tanpa tanya.
- **Teks UI dalam English** (Home, Records, Stock, Save), dibungkus `t('...')` dari `i18n.js`.
  English ialah bahasa asal; BM pilihan di Menu. Setiap teks baru: tambah terjemahan dalam
  `app/js/i18n-ms.js` (kalau tiada, teks dipapar dalam English). Jangan namakan pembolehubah `t`
  (ia fungsi terjemahan). **Komen kod dalam Bahasa Melayu.**
- Sentiasa `esc()` data pengguna sebelum masuk `innerHTML`.
- Masa ikut Malaysia: guna `todayKL()`, jangan `new Date().toISOString().slice(0,10)` (UTC, salah tarikh selepas 8 pagi).
- Wang: papar dengan `rm()` dari `format.js`. Untuk jumlahkan, kira dalam **sen (integer)** guna `sen()`, jangan tambah float terus (elak ralat 0.1 + 0.2).
- PDF (slip gaji, P&L): `loadJsPdf()` + `pdfText()` dari `ui.js` (jsPDF tak boleh papar `−` dan `—`).
- `localStorage` melalui `store` (boleh gagal dalam mod peribadi).
- Mobile-first: semak pada lebar phone (~375px); landscape juga disokong di Key In.

## ⚠️ Service worker: senang terlupa
Setiap kali ubah fail dalam `app/`:
1. Naikkan `CACHE` dalam `app/sw.js` (cth. `bizprofit-app-v38` → `v39`), kalau tak, pengguna dapat versi lama.
2. Fail JS/CSS **baru** mesti ditambah ke senarai `SHELL` dalam `sw.js`.
3. Tukar versi supabase-js? Kemas kini di `app/index.html` DAN `CDN` dalam `sw.js`.

## Migration & ujian database
- Satu fasa = satu migration, dibungkus `begin; ... commit;` (gagal satu langkah, tiada apa berubah).
- Mulakan dengan blok komen header (BM): apa berubah, siapa boleh buat apa, kes tepi.
- Tulis ujian padanan: blok `do $$ ... $$` yang menyamar setiap peranan
  (`set_config('request.jwt.claims', ...)` + `set local role authenticated`), cuba benda yang
  dibenarkan DAN yang disekat (termasuk syarikat lain), kumpul hasil `(jangka OK/GAGAL)`, dan
  keluarkan sebagai ralat "HASIL UJIAN" supaya semuanya rollback.
- Ujian mesti uji pengasingan antara syarikat (`business_id` lain) setiap kali ada table/policy baru.
- Fasa 14 (off day, elaun/potongan tetap, advance ansuran) ada draf tapi **belum** di repo/database;
  tunggu bahagian app siap dulu. Nombor fasa seterusnya: 19 (12b, 15, 16, 17, 18 sudah digunakan).
- Tarikh fail tak ikut susunan nombor fasa (cth. `20261123_fasa15` sebelum `20261124_fasa13`). Fasa 12b,
  15, 16, 17 asalnya dari PR #25 dan dinamakan semula supaya tak bertembung dengan draf Fasa 14.
- Sejarah migration dalam Supabase tak lengkap (ada yang dijalankan terus di SQL Editor). Untuk tahu
  sama ada sesuatu fasa dah aktif, semak objeknya (table/policy/fungsi) dengan `select`, bukan senarai migration.
- Projek Supabase: production `seducczotbziwhmugkrw`; staging `wphdvtmrsveoyksmewuk` (masih kosong, tiada skema).
- **Uji migration secara tempatan dulu** (terbukti berjaya, tangkap ralat sebelum pengguna run): Postgres 16 ada
  dalam container. Tarik STRUKTUR sahaja dari production (baca: `pg_get_functiondef`, `pg_get_constraintdef`,
  `pg_policies`, `pg_get_triggerdef`, kolum + grant), stub `auth.uid()`/`auth.users`/peranan `anon`,`authenticated`,
  isi data palsu, kemudian jalankan migration + ujian. Jangan simpan dump dalam repo.
- Jalankan ujian melalui `execute_sql`: hasil keluar sebagai "error" `HASIL UJIAN (n gagal)`, itu normal.
  Data ujian tak boleh guna syarikat B tanpa kategori & kaedah bayaran (FK), dan `created_by` wajib.
- Tool Supabase (apply migration / SQL yang ubah data) minta pengesahan pengguna dalam app. Di app phone
  kotak itu mungkin tak muncul dan tamat masa: minta pengguna buka sesi di komputer.

## Cara uji app tanpa login sebenar (terbukti berjaya)
- Tiada akaun ujian. Uji dengan Playwright + Supabase palsu: `python3 -m http.server 8765` dari root repo,
  buka `http://localhost:8765/app/`, `page.route('**/*.supabase.co/**', ...)` pulangkan data palsu
  (header `Accept: application/vnd.pgrst.object+json` = satu objek; `rpc/current_plan` = pakej).
- Sesi palsu: `localStorage['sb-seducczotbziwhmugkrw-auth-token']` = JSON sesi dengan `expires_at` masa depan.
  Bahasa: `localStorage['bp.lang'] = 'ms'`.
- `cdn.jsdelivr.net` disekat proxy dalam sandbox: ambil supabase-js versi sama dengan
  `npm pack @supabase/supabase-js@2.81.1` (dalam scratchpad, bukan repo) dan `route.fulfill({ path })`.
- Tangkap `pageerror`; lawati setiap halaman untuk owner (Business & Free), staff, EN & BM, lebar 375px.
- `node --check` TIDAK tangkap import berganda / nama import yang tiada. Semak import secara statik
  (setiap nama yang di-import mesti dieksport fail sumber), kalau tak app terus tak boleh dibuka.

## Skills (`.claude/skills/`)
- 3 skill dari obra/superpowers (MIT): `systematic-debugging`, `verification-before-completion`,
  `receiving-code-review`. Butiran & perubahan dalam `.claude/skills/README.md`.
- **Kalau skill bercanggah dengan CLAUDE.md, ikut CLAUDE.md.**
- Jangan tambah skill/plugin pihak ketiga tanpa semak isinya dan tanya pengguna.

## Git
- Kerja di branch kerja (bukan terus ke `main`); `main` = production (GitHub Pages).
- Commit message dalam English, ringkas, mula dengan kawasan: `Payroll: ...`, `Report: ...`, `Key In: ...`, `Stock: ...`.
- Satu commit satu perubahan yang logik.

## Status semasa (kemas kini atau buang bahagian ini bila selesai)
Dikemas kini 27 Nov 2026.
- PR #39 dan #40 sudah di-merge ke `main`. Pengguna masih perlu set Supabase → Authentication (benarkan
  sign-up, tambah `https://amirluqman1.github.io/bizprofit-pro-mvp/` dalam Redirect URLs) dan uji dengan login sebenar.
- **Fasa 18 aktif di production DAN app sudah di-merge (PR #41)**: potongan tidak hadir + `payroll_days`
  (satu hari tak boleh dibayar dua kali, dikunci di DB). Pengguna perlu uji dengan login sebenar.
- **Rancangan POS (perbincangan, belum dibina)**: BizProfit jadi back office untuk owner + admin sahaja (manager
  tak disarankan); maksimum 2 admin seoutlet untuk Pro, lebih perlu pakej lain (BELUM dikuatkuasa: sekarang
  `plan_limits` Pro = 10 akaun staf). App POS berasingan untuk staff ambil order + cetak resit, guna Supabase yang
  sama (jualan masuk terus ke transaksi, tolak stok ikut `menu_ingredients`). Peranti: tablet Android + printer
  ZyWell Z58-III (58mm, USB + Bluetooth, ESC/POS). Offline WAJIB. Halaman ujian: `pos/uji-printer.html`
  (BLE terus / RawBT / WebUSB). **Terbukti 27 Nov: Web Bluetooth (BLE) terus dari Chrome tablet BERJAYA cetak**,
  tanpa RawBT. Printer dikesan sebagai "Printer001"; servis `000018f0-...`, tulis ke `00002af1-0000-1000-8000-00805f9b34fb`
  (writeWithoutResponse), 301 bait dalam potongan 100 bait OK. e-Invois: bawah RM3 juta setahun dikecualikan (sumber sekunder, semak LHDN).
- Belum dibuat: jumlah ringgit slip masih dikira di app (DB kunci HARI sahaja). Stok simpan nilai mutlak (dua phone serentak boleh hilang
  satu kiraan). Key In tiada simpanan offline. Ujian Fasa 15 belum dijalankan; staging kosong.

## Sebelum kata "siap"
- Buka app dalam Playwright (Chromium dah ada) pada lebar phone dan semak halaman yang berubah, jika boleh login.
- Semak peranan yang terlibat (terutama staff tak nampak data yang disekat).
- `sw.js` CACHE dah dinaikkan? README perlu dikemas kini (ciri/peranan baru)?
