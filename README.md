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
- **PWA** — pasang di skrin utama; boleh dibuka tanpa internet (data perlukan internet)

## Peranan
| | Owner | Admin | Manager | Staff |
|---|---|---|---|---|
| Outlet | Semua | Sendiri | Sendiri | Sendiri |
| Profit & laporan | ✓ | Outlet sendiri | Outlet sendiri | ✗ |
| Key In | ✓ | ✓ | ✓ | ✓ (nampak transaksi sendiri hari ini sahaja) |
| Ubah & padam transaksi | ✓ | Outlet sendiri | ✗ | ✗ |
| Log audit | ✓ | Outlet sendiri | ✗ | ✗ |
| Stok | ✓ | Penuh (outlet sendiri) | Tambah & ubah kuantiti | Tambah & ubah kuantiti |
| Pekerja & gaji | ✓ | Semua pekerja outlet sendiri | Pekerja outlet sendiri (bukan peringkat pengurus) | ✗ |

Padam rekod gaji di Rekod akan membuka semula slip gaji (draf). Setiap ubah/padam transaksi direkod dalam log audit yang tidak boleh diubah.

Semua sekatan dikuatkuasa di database (Row Level Security), bukan sekadar di UI.

## Struktur
- `app/` — aplikasi (rangka, halaman dalam `js/pages/`, service worker `sw.js`)
- `config.js` — URL Supabase dan publishable key (selamat untuk awam; dilindungi RLS)
- `supabase/migrations/` — perubahan database ikut urutan; `supabase/tests/` — ujian keselamatan (rollback)
- `index.html`, `inventory-emerald-v1.html` — hanya melencong ke `app/`
- `design/` — konsep reka bentuk (`concept-2-emerald.html`) dan salinan design lama (`legacy-v1/`)

## Aliran kerja
Kerja dibuat di branch `development`, diuji, kemudian digabung ke `main` (yang disiarkan oleh GitHub Pages).
Jangan sekali-kali letak `service_role` key atau kata laluan dalam repo ini — repo ini awam.
