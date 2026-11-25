# Buku Teks: Belajar Coding dari BizProfit Pro

Folder ini bukan sebahagian daripada app. Ia panduan untuk belajar membaca dan memahami
kod BizProfit Pro, fail demi fail, dari yang paling senang ke yang paling susah.

Cara guna:
1. Baca **Peta Belajar** di bawah ikut urutan. Jangan lompat ke `pekerja.js` dulu, itu fail paling susah.
2. Bagi zip repo + `PROMPT-GPT.md` kepada GPT (atau mana-mana AI) untuk tulis bab buku teks.
3. Setiap bab, buka fail sebenar dan cuba ubah sikit di branch sendiri. Belajar paling laju bila tangan buat.

---

## Gambaran besar (baca ini dulu)

App ini ada **3 lapisan**:

```
 Phone pengguna (pelayar)                       Internet                 Supabase (cloud)
┌───────────────────────────────┐                                ┌──────────────────────────┐
│ HTML  = rangka (kotak, butang)│                                │ PostgreSQL (database)    │
│ CSS   = rupa (warna, saiz)    │  ── supabase-js (fetch) ──▶    │  + RLS: siapa boleh apa  │
│ JS    = otak (klik, kira,     │  ◀── data JSON ──              │ Auth: login / kata laluan│
│         ambil data)           │                                │ Storage: gambar resit    │
└───────────────────────────────┘                                └──────────────────────────┘
        app/  (GitHub Pages)                                        supabase/migrations/
```

Satu benda paling penting untuk faham: **UI tak menjaga keselamatan, database yang jaga.**
Kalau kau sorok butang "Delete" daripada staff, staff yang pandai masih boleh hantar arahan
padam terus ke Supabase. Yang betul-betul menghalang ialah policy RLS dalam SQL.
Sebab tu setiap ciri ada dua bahagian: kod JS (paparan) dan migration SQL (peraturan).

---

## Peta Belajar (ikut urutan)

### Peringkat 1: HTML & CSS asas
| # | Fail | Baris | Apa yang kau belajar |
|---|---|---|---|
| 1 | `index.html` (root) | 12 | Struktur dokumen HTML paling ringkas: `<head>`, `<meta>`, `<body>`. Juga cara melencong ke halaman lain (`location.replace`). |
| 2 | `app/index.html` | 134 | Rangka app sebenar: skrin `boot`, `login`, `app`. Atribut `id`, `hidden`, `<dialog>`, `<form>`, ikon SVG `<symbol>`. Urutan `<script>`: `config.js` → supabase-js → `main.js` (`type="module"`). |
| 3 | `app/css/app.css` (baris 1–60) | 909 | **CSS variables** (`--bg`, `--mint`) dalam `:root`, kenapa semua warna disimpan satu tempat. |
| 4 | `app/css/app.css` (selebihnya) | | Selector, `display:grid/flex`, `@media` (20 kali: susun ikut saiz skrin), animasi `@keyframes`, `prefers-reduced-motion`. |

### Peringkat 2: JavaScript asas (fail kecil, setiap baris penting)
| # | Fail | Baris | Konsep |
|---|---|---|---|
| 5 | `config.js` | 6 | `const`, string. Kenapa publishable key **selamat** didedahkan (RLS) dan `service_role` **tak** boleh. |
| 6 | `app/js/format.js` | 36 | Arrow function `n => ...`, `export`, `Intl.NumberFormat`, tarikh & zon masa. **Wajib faham:** `todayKL()` (kenapa bukan `toISOString()`), `sen()` (kenapa duit dikira dalam sen, `0.1 + 0.2 !== 0.3`). |
| 7 | `app/js/ui.js` | 94 | `document.getElementById` (`$`), `esc()` = halang serangan XSS, template literal `` `...${x}...` ``, `try/catch` dalam `store`, `setTimeout`, `Promise`. |
| 8 | `app/js/plan.js` | 56 | Object & array (`PLANS`, `FEATURES`), function yang pulangkan HTML. Kenapa fail ni "paparan sahaja". |
| 9 | `app/js/session.js` | 81 | **getter** (`get role()`), `Set` untuk listener (corak *pub/sub*), `async/await`, `Promise.all` (ambil 2 data serentak), query pertama ke Supabase. |

### Peringkat 3: Bagaimana app hidup
| # | Fail | Baris | Konsep |
|---|---|---|---|
| 10 | `app/js/main.js` | 98 | Titik mula. `addEventListener('submit')`, `e.preventDefault()`, `Promise.race` (timeout 10 saat), custom event `bp:logout`. Ikut aliran: `boot()` → `loadAccount()` → `enterApp()` → `startRouter()`. |
| 11 | `app/js/router.js` | 83 | Navigasi guna `#/rekod` (hash). Senarai `PAGES` + `roles`. `.filter()`, `.find()`, `.map().join('')`. Fungsi `cleanup`. |
| 12 | `app/js/pwa.js` | 31 | PWA: `navigator.serviceWorker.register`, event `online/offline`, butang install. |
| 13 | `app/sw.js` | 60 | Service worker: cache, strategi "network dulu, cache bila offline". **Kenapa `CACHE` mesti dinaikkan** setiap kali ubah app. |

### Peringkat 4: Halaman (dari senang ke susah)
| # | Fail | Baris | Fokus |
|---|---|---|---|
| 14 | `pages/pakej.js` | 63 | Halaman paling ringkas: `export default { render(view) }`, ternary bersarang `a ? b : c ? d : e`. |
| 15 | `pages/menu.js` | 131 | `<dialog>.showModal()`, borang, `sb.auth.updateUser`, `sb.from('outlets').update()`. `e.target.closest()` (event delegation). |
| 16 | `pages/utama.js` | 277 | Home: ambil data, kira jumlah, `countUp()` animasi nombor. |
| 17 | `pages/smartlist.js` | 225 | Senarai beli → teks WhatsApp (`encodeURIComponent`). |
| 18 | `pages/stok.js` | 388 | CRUD penuh: tambah, ubah kuantiti, log perubahan. Custom event `bp:stock-changed`. |
| 19 | `app/js/receipt.js` | 127 | `<canvas>`, kecilkan gambar, `Blob`, upload ke Supabase Storage. |
| 20 | `pages/rekod.js` | 615 | Key In transaksi + sejarah + edit/padam (dengan semakan payroll). |
| 21 | `pages/laporan.js` | 517 | Kumpul data ikut hari/minggu/bulan, banding tempoh. Banyak `reduce()`. |
| 22 | `pages/foodcost.js` | 350 | Kos resepi per pinggan, margin, %. |
| 23 | `pages/pnl.js` | 324 | Penyata untung rugi + PDF (`loadJsPdf`, `pdfText`). |
| 24 | `pages/pekerja.js` | 838 | **Paling susah.** Kehadiran, gaji harian/mingguan/bulanan, OT, advance, slip PDF, `sb.rpc('pay_payroll')`. Baca paling akhir. |

### Peringkat 5: Database (SQL)
| # | Fail | Konsep |
|---|---|---|
| 25 | `supabase/README.md` | Cara migration & ujian disusun. |
| 26 | `migrations/..._fasa0_asas_saas.sql` | `create table`, `primary key`, `references` (foreign key), `begin/commit` (transaksi), `enable row level security`, function `current_business_id()`, `security definer`. **Asas SaaS: semua data ikat pada `business_id`.** |
| 27 | `tests/..._fasa0_ujian.sql` | Cara uji keselamatan: menyamar jadi owner/manager (`set_config('request.jwt.claims')`, `set local role authenticated`), cuba benda dibenarkan DAN disekat, rollback. |
| 28 | `migrations/..._fasa1_kunci_profit_staff.sql` | Policy pertama yang sekat staff daripada nampak profit. |
| 29 | `migrations/..._fasa5_...` & `fasa5b` | Table pekerja, kehadiran, payroll. Function `pay_payroll` (satu langkah atomik: bayar + rekod transaksi). |
| 30 | `migrations/..._fasa9_admin_edit_audit.sql` | Trigger audit log: rekod setiap ubah/padam, tak boleh dipadam. |
| 31 | `migrations/..._fasa12_pakej_langganan.sql` | `current_plan()`, kunci ciri Pro di database. |
| 32 | `migrations/..._fasa13_gambar_resit.sql` | Policy pada Storage (fail gambar), laluan `business_id/outlet_id/uuid.jpg`. |

---

## Corak yang berulang dalam semua halaman (kenal sekali, nampak di mana-mana)

1. **Setiap halaman = object dengan `render(view)`.** Router panggil `render`, halaman isi `view.innerHTML`, kemudian pasang event. Kalau ada `return () => {...}`, itu `cleanup` (buang listener bila tukar halaman).
2. **Ambil data:** `const { data, error } = await sb.from('table').select('kolum').eq('kolum', nilai);` Setiap kali, semak `error` dulu.
3. **Tulis data:** `.insert({...})`, `.update({...}).eq('id', x)`, `.delete().eq('id', x)`. Tambah `.select('id')` untuk tahu sama ada betul-betul berjaya (RLS boleh sekat secara senyap, pulangkan 0 baris).
4. **Bina HTML dari data:** `` list.map(x => `<li>${esc(x.name)}</li>`).join('') ``. **Mesti `esc()`.** Tanpa `esc()`, nama "`<img src=x onerror=...>`" boleh jalankan kod jahat.
5. **Butang disable semasa simpan:** `btn.disabled = true` → `await` → `btn.disabled = false`. Elak tekan dua kali = rekod berganda.
6. **Event delegation:** satu listener pada senarai, cari butang dengan `e.target.closest('[data-id]')`. Lebih jimat daripada satu listener setiap baris.

---

## Glosari ringkas

| Istilah | Maksud mudah |
|---|---|
| **PWA** | Laman web yang boleh "dipasang" macam app di phone. |
| **ES module** | Fail JS yang guna `import` / `export` untuk kongsi function antara fail. |
| **async / await** | Tunggu benda lambat (internet) tanpa beku skrin. |
| **Promise** | "Janji" hasil yang akan sampai nanti. |
| **DOM** | Struktur HTML yang JS boleh ubah semasa app berjalan. |
| **Supabase** | Servis cloud: database PostgreSQL + login + storan fail. |
| **RLS** (Row Level Security) | Peraturan dalam database: setiap baris data, siapa boleh baca/tulis. |
| **Migration** | Fail SQL yang ubah struktur database, dijalankan sekali ikut urutan. |
| **RPC** | Panggil function dalam database dari app (`sb.rpc('nama')`). |
| **XSS** | Serangan menyelit kod dalam teks pengguna. Dihalang dengan `esc()`. |
| **Service worker** | Skrip latar belakang yang simpan fail app supaya boleh buka tanpa internet. |
| **Hash routing** | Tukar halaman guna `#/nama` dalam URL tanpa muat semula. |

---

## Latihan cadangan (buat di branch sendiri, bukan `main`)

1. Dalam `format.js`, buka Console pelayar (F12) dan cuba: `0.1 + 0.2`. Faham kenapa kita guna `sen()`.
2. Tukar warna `--mint` dalam `app.css`, tengok apa yang berubah. Kemudian pulangkan.
3. Tambah satu baris baru dalam `FEATURES` (`plan.js`) dan lihat jadual di halaman Plan.
4. Dalam `router.js`, buang `'staff'` daripada `roles` halaman Menu. Login sebagai staff: tab hilang. Tanya diri: adakah data betul-betul selamat sekarang? (Jawapan: tab je hilang; RLS yang jaga data.)
5. Baca satu fail ujian SQL dan senaraikan semua benda yang "jangka GAGAL". Itu senarai benda yang sistem sengaja sekat.

Tanya Claude bila-bila masa kalau tersangkut. Bawa nombor fail dan baris, contoh `session.js:57`.
