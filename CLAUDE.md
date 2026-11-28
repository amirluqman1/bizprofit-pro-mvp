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
- `pos/`: app POS kaunter (tablet). Import modul dari `../../app/js/`; teks juga guna `t()` + `i18n-ms.js`.
  Resit ESC/POS ASCII sahaja, 32 aksara sebaris (`pos/js/printer.js`). `pos/uji-printer.html` = halaman ujian printer.
- `design/`: konsep reka bentuk sahaja, bukan sebahagian app. `docs/`: pelan kerja (cth. `POS_PELAN.md`).
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
  tunggu bahagian app siap dulu. Nombor fasa seterusnya: 25 (12b, 15–24 sudah digunakan).
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
- **Pengecualian (pengguna, 28 Nov): kerja POS terus commit & push ke `main`** (POS belum dilancarkan).
  Tetap uji dulu; fail BizProfit yang dikongsi (`app/js/*`, `i18n-ms.js`) terus live. Migration tetap perlu izin
  dan dijalankan SEBELUM kod yang bergantung padanya ditolak (atau kod mesti tahan bila objek DB belum wujud).
- Commit message dalam English, ringkas, mula dengan kawasan: `Payroll: ...`, `Report: ...`, `Key In: ...`, `Stock: ...`.
- Satu commit satu perubahan yang logik.

## Status semasa (kemas kini atau buang bahagian ini bila selesai)
Dikemas kini 28 Nov 2026. Semua PR hingga #48 sudah di-merge.

### Sudah siap & aktif di production
- **Gaji (PR #41, Fasa 18)**: gaji bulanan pro-rata ikut hari kalendar (sebulan penuh = gaji penuh; "Minggu ini"
  dulu bayar sebulan penuh: BUG sudah dibaiki). Pilihan "Jika tidak hadir" setiap pekerja mingguan/bulanan:
  `penuh` / `sehari` (gaji ÷ hari bekerja, default 26 sebulan / 6 seminggu) / `tetap` (RM sehari). Separuh hari =
  separuh potongan; cuti & hari tak ditanda TIDAK dipotong; upah harian tiada pilihan ini (pengguna sahkan semua).
  `payroll_days` kunci setiap hari dibayar (PK employee+date); `pay_payroll()` satu-satunya cara jadi 'dibayar';
  app hantar `open_days`, DB kira semula. Padam transaksi gaji = hari dilepaskan.
- **Kehadiran (PR #44)**: pengesahan sebelum "Tanda semua … Hadir" + butang "↶ Batal tanda pukal terakhir"
  (kumpulan baris dengan `updated_at` sama tepat). Insiden 27 Nov (168 hari tertanda) sudah dipulihkan pengguna.
- **POS (PR #42, #43, Fasa 19)**: `pos/` app tablet + halaman BizProfit `#/pos` (Menu → POS (kaunter)).
  Printer ZyWell Z58-III terbukti cetak melalui Web Bluetooth (BLE) terus dari Chrome Android, tanpa RawBT
  (servis `000018f0-...`, tulis `00002af1-...`, potongan 100 bait). `pos/uji-printer.html` = halaman ujian printer.
  Keputusan pengguna: nombor order & meja On/Off (default Off); bayar dulu DAN bil terbuka; kaedah bayar = semua
  `payment_methods` (nama mengandungi tunai/cash = skrin baki); kategori "Jualan POS" (key `INPOS`, dicipta auto);
  1 order = 1 transaksi; slip dapur pada printer sama (On/Off); staff boleh buang item bil terbuka (direkod
  removed_at/by); batal order dibayar/bil berisi = owner/admin + wajib sebab; bil kosong staff boleh batal.
  Harga disalin dari menu oleh DB; jumlah & baki dikira oleh `pos_pay_order()` (selamat dipanggil 2 kali).
  ID order/item dijana di tablet (asas offline). Jualan POS tak boleh dipadam/ubah jumlah di Rekod.
  Laci duit: `ESC p` pin 2 + pin 5 dihantar di awal resit bila bayar TUNAI sahaja (cetak semula tidak buka laci);
  `pos/uji-printer.html` ada butang "Uji laci duit". Ditambah 28 Nov selepas pengguna lapor laci tak terbuka.
  Edit menu dalam POS (Fasa 22, `pos/js/menu-edit.js`): owner/admin ✎ Edit menu → tambah/ubah/padam menu & kategori,
  seret ⠿ untuk susun (dalam satu kategori; RPC `reorder_menu`), seret kategori (`reorder_menu_categories`), warna
  kategori (`menu_categories.color`, palet 8). Kategori kekal teks dalam `menu_items.category`; trigger cipta baris
  `menu_categories` automatik. POS tahan jika Fasa 22 belum dijalankan (tiada warna/susun kategori).
  Fasa 22 aktif di production 28 Nov (disahkan: RLS + 6 policy + 3 trigger + 3 fungsi; kategori sedia ada diisi).
  Shift (Fasa 23, `pos/js/shift.js`; keputusan pengguna 28 Nov): satu shift dibuka setiap outlet (`pos_shifts`); order
  tak boleh DIBAYAR tanpa shift (trigger `pos_orders_shift_guard` isi `shift_id`; batal order dibayar isi `void_shift_id`).
  Jangkaan laci = modal + tunai dibayar dalam shift − pulangan tunai order dibatal dalam shift + cash in − cash out.
  Cash out (`pos_cash_move` 'keluar') = transaksi Out di Rekod (kategori dipilih, kaedah tunai); cash in bukan transaksi.
  Tutup = kiraan buta: `pos_shift_summary` sembunyi jangkaan untuk bukan owner/admin semasa shift dibuka; `pos_close_shift`
  simpan gambaran akhir (tak berubah). Semua staf POS boleh buka/tutup/cash in-out. POS tahan jika Fasa 23 belum dijalankan.
  Fasa 23 aktif di production 28 Nov (disahkan: RLS + 4 policy + trigger + 7 fungsi; ujian SQL production tidak dijalankan).

- **Gaji Fasa 20 (PR #46, aktif di production 28 Nov; ujian di production 0 gagal)**: `payroll_calc()` kira
  gaji asas/OT/potongan tidak hadir dalam sen integer; `pay_payroll(slip, kaedah, p_expected_net)` tolak bayaran jika
  angka slip atau jumlah bersih tak sama dengan kiraan DB. Bayar gaji & advance = owner/admin sahaja (manager draf).
  Elaun/potongan > RM0 wajib nota (`payroll.note`). `pekerja.js` guna kiraan integer yang SAMA (`rdiv`, `MONTH_LCM`);
  diuji 600 kes rawak app vs DB = 0 beza. Ubah satu, ubah dua-dua. Keputusan pengguna 27 Nov.

- **Kehadiran Fasa 21 (PR #47, aktif di production 28 Nov; ujian production dilangkau atas keputusan pengguna)**: hari dalam
  `payroll_days` dikunci oleh trigger `attendance_paid_guard`: manager/staff ditolak; owner/admin hanya melalui
  `change_paid_attendance(emp, tarikh, status|null, ot, sebab)` → log kekal `attendance_audit` (baca: owner/admin).
  Slip dibayar tak berubah; OT terlupa = elaun + sebab dalam slip seterusnya. Tanda/batal pukal langkau hari dibayar.
  Semasa ditulis: 56 daripada 128 hari dibayar sudah diubah selepas bayar (insiden 27 Nov); data lama tidak disentuh.

- **Hari mula minggu (Fasa 24, aktif di production 28 Nov; migration dijalankan pengguna, ujian tempatan 0 gagal)**:
  `outlets.week_start` (0 = Ahad ... 6 = Sabtu, lalai 1 = Isnin), owner/admin ubah di Menu → Outlet. Grid kehadiran Week dan
  butang "This week" di Payroll ikut tetapan (`weekStartDay()` dalam `session.js`, `weekStartOf()` dalam `format.js`).
  Semua outlet = guna nilai sama jika seragam, kalau tidak Isnin. Tiada kesan pada kiraan DB (ikut `open_days`).
  Laporan: pengguna kata sudah fleksibel; Food Cost belum disetting. Kod tahan jika kolum belum wujud.
- **Menu dikemas (28 Nov)**: kad akaun satu baris, Outlet & Akaun pengguna boleh dilipat, tajuk kumpulan Business/Tools/Settings.

### Perlu disahkan pengguna (belum diuji dengan login sebenar)
- POS: setup menu di #/pos, buat order sebenar, cetak resit, semak "Jualan POS" di Rekod, bil terbuka, batal.
  Semak juga sama ada printer bersambung sendiri bila POS dibuka semula (`navigator.bluetooth.getDevices`).
  Semasa ditulis: 0 order POS, 0 menu berkategori di production.
- Gaji: "Jika tidak hadir" di Staf, dan angka Gaji untuk "Minggu ini" (pekerja bulanan).
- Gaji Fasa 20: bayar satu slip sebenar (owner), manager nampak "Simpan draf" sahaja, sebab elaun tercetak dalam PDF.
- POS edit menu: uji seret ⠿ dengan jari di tablet sebenar (Playwright hanya uji dengan tetikus).
- POS shift: buka shift, jual tunai/QR, cash out (semak masuk Rekod), cash in, tutup shift (kiraan buta), laporan dicetak.
- POS laci duit: uji di `pos/uji-printer.html` (butang 4) dan bayar tunai sebenar. Belum disahkan Z58-III ada port DK.
- Supabase → Authentication: benarkan sign-up + Redirect URL `https://amirluqman1.github.io/bizprofit-pro-mvp/`.

### Seterusnya (ikut keutamaan; tanya pengguna dahulu sebelum mula)
**POS: ikut `docs/POS_PELAN.md`** (P1–P8, susunan ikut kebergantungan; satu fasa satu PR; pengguna uji di kedai
antara fasa; tanya soalan "Perlu ditanya" di awal setiap fasa). Item POS di bawah sudah dimasukkan ke pelan itu.
1. **Maklum balas ujian POS sebenar** → baiki apa yang pengguna jumpa.
2. **Rekod: paparan ringkasan harian jualan POS** (On/Off, paparan sahaja; data kekal 1 order = 1 transaksi).
   Pengguna kata "jawab nanti".
3. **Peranan selepas POS jalan** (keputusan pengguna): BizProfit = back office owner + admin (manager tak
   disarankan); Key In di BizProfit untuk manager ke atas sahaja (buang Key In staff HANYA selepas POS dipakai);
   Pro = maksimum 2 admin seoutlet, lebih perlu pakej lain. Perlu migration (sekarang `plan_limits` Pro = 10 akaun
   staf, kira semua peranan) + kemas kini `plan.js` + README jadual peranan.
4. **Offline POS** (pengguna: tangguh sampai nak komersialkan, tapi WAJIB sebelum jual): service worker untuk
   `pos/`, menu disimpan, order beratur dalam IndexedDB, hantar semula guna ID sama (DB dah sedia: upsert
   ignoreDuplicates + `pos_pay_order` idempotent).
5. **Had pakej POS**: pengguna kata tunggu SaaS lengkap. Nota: `menu_items` tambah/ubah dikunci Pro ke atas (Fasa 12).
6. POS kemudian: diskaun / caj servis / SST, skrin dapur (tablet kedua, ganti slip dapur), PIN tukar staf,
   tolak stok automatik ikut `menu_ingredients`, e-Invois (bawah RM3 juta setahun dikecualikan mulai
   1 Sep 2026 menurut sumber sekunder; sahkan di laman LHDN).
7. **Baki kritik app (dari audit 26 Nov)**:
   - (Pengguna 28 Nov: "takde masalah, biar dulu" untuk dua ini; simpan, jangan mula tanpa tanya.)
     Stok: `stok.js` simpan nilai mutlak `current_qty` → dua phone serentak boleh hilang satu kiraan.
     Cadangan: RPC `adjust_stock(id, delta)`.
     Key In tiada simpanan offline / boleh rekod berganda bila line lemah (guna ID dijana klien macam POS).
   - Ujian Fasa 15 belum dijalankan; staging kosong; tiada CI untuk ujian DB.
   - Kod wang bercampur (`cents()` dalam pekerja.js, `sen()` dalam format.js, `Math.round(x*100)` di rekod.js).
   - `pekerja.js` besar (~900 baris): pertimbang pecahkan bahagian gaji.
- Fasa 14 (off day, elaun/potongan tetap, advance ansuran): draf lama, belum di repo; nombor fasa seterusnya 25.

### Nota kerja untuk sesi baru
- Pengguna guna PHONE. Kotak pengesahan tool Supabase tak muncul di phone: beri SQL dalam blok kod (```sql) untuk
  pengguna salin ke SQL Editor. Uji migration dalam Postgres tempatan DULU (lihat seksyen Migration); ralat nama
  constraint auto (`<table>_<kolum>_check`) pernah menggagalkan Fasa 18 kali pertama.
- Pengguna merge PR sendiri dengan cepat: selepas merge, mulakan semula branch kerja dari `origin/main` sebelum
  commit baru, kalau tak commit tertinggal dan perlu PR baru.
- Pengguna suka penerangan santai dalam BM, ringkas tapi lengkap; beri URL/SQL dalam kotak supaya mudah disalin.

## Sebelum kata "siap"
- Buka app dalam Playwright (Chromium dah ada) pada lebar phone dan semak halaman yang berubah, jika boleh login.
- Semak peranan yang terlibat (terutama staff tak nampak data yang disekat).
- `sw.js` CACHE dah dinaikkan? README perlu dikemas kini (ciri/peranan baru)?
