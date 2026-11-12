# BizProfit Pro

Sistem pengurusan F&B berbilang outlet: kewangan, stok, pekerja dan gaji.
Dibina sebagai PWA (HTML, CSS, JavaScript) dengan Supabase. Sedia untuk SaaS (setiap syarikat terasing).

**App:** https://amirluqman1.github.io/bizprofit-pro-mvp/

## Ciri
- **Utama** — Profit Bersih, Jualan, Perbelanjaan, Transaksi (berbanding semalam), graf 7 hari
- **Rekod** — Key In transaksi dan sejarah
- **Stok** — inventori dengan − / +, senarai beli untuk WhatsApp, sejarah perubahan
- **Laporan** — harian, mingguan, bulanan, tahunan; pecahan ikut outlet
- **Pekerja** — kehadiran harian, gaji harian/mingguan/bulanan, OT, elaun, potongan, advance, slip gaji
- **PWA** — pasang di skrin utama; boleh dibuka tanpa internet (data perlukan internet)

## Peranan
| | Owner | Manager | Staff |
|---|---|---|---|
| Outlet | Semua | Sendiri | Sendiri |
| Profit & laporan | ✓ | Outlet sendiri | ✗ |
| Key In | ✓ | ✓ | ✓ (nampak transaksi sendiri hari ini sahaja) |
| Stok | ✓ | Tambah & ubah kuantiti | Tambah & ubah kuantiti |
| Pekerja & gaji | ✓ | Pekerja outlet sendiri (bukan peringkat pengurus) | ✗ |

Semua sekatan dikuatkuasa di database (Row Level Security), bukan sekadar di UI.

## Struktur
- `app/` — aplikasi (rangka, halaman dalam `js/pages/`, service worker `sw.js`)
- `config.js` — URL Supabase dan publishable key (selamat untuk awam; dilindungi RLS)
- `supabase/migrations/` — perubahan database ikut urutan; `supabase/tests/` — ujian keselamatan (rollback)
- `index.html`, `inventory-emerald-v1.html` — hanya melencong ke `app/`

## Aliran kerja
Kerja dibuat di branch `development`, diuji, kemudian digabung ke `main` (yang disiarkan oleh GitHub Pages).
Jangan sekali-kali letak `service_role` key atau kata laluan dalam repo ini — repo ini awam.
