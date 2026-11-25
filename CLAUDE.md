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
harga lama masih boleh dibaca. Pengecualian (had paparan sahaja, data kekal dan kembali bila naik taraf):
Laporan, Key In dan Records → History untuk Free terhad kepada bulan lepas + bulan ini (`freeHistoryStart()`).

## Struktur
- `app/index.html`: rangka; muat `../config.js`, supabase-js dari CDN (versi tetap), kemudian `js/main.js` (ES module).
- `app/js/router.js`: navigasi hash (`#/rekod`). Senarai `PAGES` = halaman + `roles` + `tab`.
- `app/js/pages/*.js`: satu fail satu halaman; eksport `{ render(view) }` yang pulangkan fungsi `cleanup` (pilihan).
- `app/js/ui.js` (`$`, `esc`, `icon`, `toast`, `store`), `format.js` (`todayKL`, `rm`, `sen`, `addDays`), `session.js` (`session.role`, `session.plan`, `session.isManagerUp`).
- `app/css/app.css`: semua gaya. `app/sw.js`: service worker.
- `supabase/migrations/`: `YYYYMMDD_faseN_nama.sql`. `supabase/tests/`: `YYYYMMDD_faseN_ujian.sql`.
- `design/`: konsep reka bentuk sahaja, bukan sebahagian app.
- `index.html` & `inventory-emerald-v1.html` di root hanya melencong ke `app/`.

## Konvensyen kod
- **Tiada build step, tiada npm.** JS biasa dengan `import`/`export`. Jangan tambah framework/bundler tanpa tanya.
- **Teks UI dalam English** (Home, Records, Stock, Save). **Komen kod dalam Bahasa Melayu.**
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
  tunggu bahagian app siap dulu.

## Skills (`.claude/skills/`)
- 3 skill dari obra/superpowers (MIT): `systematic-debugging`, `verification-before-completion`,
  `receiving-code-review`. Butiran & perubahan dalam `.claude/skills/README.md`.
- **Kalau skill bercanggah dengan CLAUDE.md, ikut CLAUDE.md.**
- Jangan tambah skill/plugin pihak ketiga tanpa semak isinya dan tanya pengguna.

## Git
- Kerja di branch kerja (bukan terus ke `main`); `main` = production (GitHub Pages).
- Commit message dalam English, ringkas, mula dengan kawasan: `Payroll: ...`, `Report: ...`, `Key In: ...`, `Stock: ...`.
- Satu commit satu perubahan yang logik.

## Sebelum kata "siap"
- Buka app dalam Playwright (Chromium dah ada) pada lebar phone dan semak halaman yang berubah, jika boleh login.
- Semak peranan yang terlibat (terutama staff tak nampak data yang disekat).
- `sw.js` CACHE dah dinaikkan? README perlu dikemas kini (ciri/peranan baru)?
