# BizProfit Pro

Sistem pengurusan F&B berbilang outlet: kewangan, stok, pekerja dan gaji.
Dibina sebagai PWA (HTML, CSS, JavaScript) dengan Supabase. Sedia untuk SaaS (setiap syarikat terasing).

**App:** https://amirluqman1.github.io/bizprofit-pro-mvp/

## Ciri
- **Home** — sekilas hari ini: Profit Bersih (dengan trend 7 hari), Jualan, Perbelanjaan, Transaksi; *Needs attention* (stok habis/rendah, food cost outlet > 35%); transaksi terkini
- **Rekod** — Key In transaksi dan sejarah
- **Stok** — inventori dengan − / +, senarai beli untuk WhatsApp, sejarah perubahan
- **Report** — harian, mingguan, bulanan, tahunan; banding tempoh sebelum, purata & hari terbaik, prestasi outlet, perbelanjaan ikut kategori, jualan ikut kaedah bayaran, kongsi ringkasan ke WhatsApp
- **Pekerja** — kehadiran harian, gaji harian/mingguan/bulanan, OT, elaun, potongan, advance, slip gaji
  - Gaji bulanan: sebulan penuh = gaji penuh; tempoh lebih pendek dikira pro-rata ikut hari kalendar (gaji ÷ hari dalam bulan itu)
  - Tidak hadir (mingguan/bulanan), tetapan setiap pekerja: bayar penuh, potong gaji sehari (gaji ÷ hari bekerja), atau potong RM tetap sehari. Separuh hari = separuh potongan; cuti tidak dipotong
  - Semasa bayar, database kira semula gaji asas, OT, potongan tidak hadir dan advance; kalau angka berubah sejak dipapar, bayaran ditolak (muat semula). Elaun/potongan manual wajib ada sebab
  - Kehadiran hari yang gajinya sudah dibayar dikunci: manager/staff tak boleh ubah; owner/admin boleh dengan sebab, direkod dalam log yang tidak boleh diubah. Slip dibayar tidak berubah (OT terlupa = elaun dalam slip seterusnya)
- **POS** (`pos/`, untuk tablet kaunter, Chrome Android) — ambil order makan sini/bungkus, bil terbuka (bayar lepas makan), semua kaedah bayaran + baki tunai, resit & slip dapur ke printer thermal 58mm melalui Bluetooth (BLE). Jualan masuk ke Rekod sebagai "Jualan POS". Jumlah dikira oleh database. Tetapan & menu POS: Menu → POS (kaunter)
- **PWA** — pasang di skrin utama; boleh dibuka tanpa internet (data perlukan internet)
- **Akaun** — daftar sendiri (syarikat + outlet pertama, trial Pro 30 hari), lupa kata laluan, jemput staf melalui pautan WhatsApp (sekali guna, 7 hari), owner tambah outlet
- **Bahasa** — English (asal) atau Bahasa Melayu; tukar di Menu, disimpan dalam peranti
- **Pakej** — Free / Pro / Business. Free: laporan, Key In dan sejarah transaksi terhad kepada bulan lepas + bulan ini (dikunci di database; data lama tidak dipadam dan kembali bila naik taraf)

## Peranan
| | Owner | Admin | Manager | Staff |
|---|---|---|---|---|
| Outlet | Semua | Sendiri | Sendiri | Sendiri |
| Profit & laporan | ✓ | Outlet sendiri | Outlet sendiri | ✗ |
| Key In | ✓ | ✓ | ✓ | ✓ (nampak transaksi sendiri hari ini sahaja) |
| Ubah & padam transaksi | ✓ | Outlet sendiri | ✗ | ✗ |
| Log audit | ✓ | Outlet sendiri | ✗ | ✗ |
| Stok | ✓ | Penuh (outlet sendiri) | Tambah & ubah kuantiti | Tambah & ubah kuantiti |
| Pekerja & kehadiran | ✓ | Semua pekerja outlet sendiri | Pekerja outlet sendiri (bukan peringkat pengurus) | ✗ |
| Ubah kehadiran hari yang gaji dah dibayar | ✓ (wajib sebab, direkod) | Outlet sendiri (wajib sebab, direkod) | ✗ | ✗ |
| Gaji: sediakan draf | ✓ | Semua pekerja outlet sendiri | Pekerja outlet sendiri (bukan peringkat pengurus) | ✗ |
| Gaji: bayar & beri advance | ✓ | Semua pekerja outlet sendiri | ✗ | ✗ |
| Akaun pengguna & jemputan | Semua outlet; jemput admin/manager/staff | Outlet sendiri; jemput manager/staff | ✗ | ✗ |
| Tambah outlet | ✓ (ikut had pakej) | ✗ | ✗ | ✗ |
| POS: order, bil terbuka, bayar | ✓ | Outlet sendiri | Outlet sendiri | Outlet sendiri |
| POS: batal order dibayar / bil berisi | ✓ (wajib sebab) | Outlet sendiri (wajib sebab) | ✗ | ✗ |
| POS: tetapan & menu | ✓ | Outlet sendiri | ✗ (boleh tanda Habis di POS) | ✗ (boleh tanda Habis di POS) |

Padam rekod gaji di Rekod akan membuka semula slip gaji (draf). Setiap ubah/padam transaksi direkod dalam log audit yang tidak boleh diubah.

Semua sekatan dikuatkuasa di database (Row Level Security), bukan sekadar di UI.

## Struktur
- `app/` — aplikasi (rangka, halaman dalam `js/pages/`, service worker `sw.js`)
- `config.js` — URL Supabase dan publishable key (selamat untuk awam; dilindungi RLS)
- `supabase/migrations/` — perubahan database ikut urutan; `supabase/tests/` — ujian keselamatan (rollback)
- `index.html`, `inventory-emerald-v1.html` — hanya melencong ke `app/`
- `design/` — konsep reka bentuk (`concept-2-emerald.html`) dan salinan design lama (`legacy-v1/`)

## Aliran kerja
Setiap perubahan dibuat di branch kerja sendiri, diuji, kemudian digabung ke `main` melalui pull request (`main` disiarkan oleh GitHub Pages). Jangan push terus ke `main`.
Jangan sekali-kali letak `service_role` key atau kata laluan dalam repo ini — repo ini awam.
