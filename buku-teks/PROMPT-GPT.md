# Prompt untuk GPT: Tulis Buku Teks

Cara guna: upload zip repo ke GPT, kemudian copy SEMUA teks dalam kotak di bawah dan paste.
Minta satu bab satu masa (buku penuh terlalu panjang untuk satu jawapan; GPT akan potong atau ringkaskan).

---

```
Aku lampirkan zip kod sebenar app aku, "BizProfit Pro": sistem pengurusan restoran/F&B
(kewangan, stok, pekerja, gaji). Teknologi: HTML, CSS, JavaScript biasa (ES modules, tiada
framework, tiada npm), Supabase (PostgreSQL + Row Level Security + Auth + Storage), PWA.

Aku pemilik bisnes, BUKAN programmer. Aku nak belajar coding dengan memahami kod app aku sendiri.
Tolong tulis BUKU TEKS dalam Bahasa Melayu santai (istilah teknikal kekal English, contohnya
"function", "array", "policy").

PERATURAN PENTING:
1. Guna HANYA kod sebenar dari zip. Setiap contoh mesti sebut nama fail dan nombor baris,
   contoh: app/js/format.js baris 12. JANGAN reka contoh kod yang tiada dalam repo.
   Kalau kau nak tunjuk konsep yang tiada dalam repo, label jelas "(contoh luar repo)".
2. Kalau kau tak pasti apa satu kod buat, tulis "TAK PASTI" dan terangkan kenapa. Jangan teka.
3. Terangkan SYNTAX baris demi baris untuk kod pendek (bawah 15 baris). Untuk kod panjang,
   pecah ikut blok dan terangkan setiap blok.
4. Setiap bab ada: (a) Objektif, (b) Konsep, (c) Bedah kod sebenar, (d) "Kenapa ditulis macam ni"
   (sebab reka bentuk, bukan sekadar apa ia buat), (e) Kesilapan biasa, (f) 3 latihan + jawapan
   di hujung bab, (g) 5 soalan kuiz.
5. Bila ada perkara keselamatan (esc(), RLS, service_role key, audit log), tandakan dengan
   ⚠️ dan terangkan apa yang boleh jadi kalau dibuang.
6. Ikut urutan dalam fail buku-teks/README.md ("Peta Belajar"). Fail itu juga ada glosari
   dan senarai corak berulang, guna sebagai rujukan.

STRUKTUR BUKU:
Bab 0  - Gambaran besar: pelayar, internet, Supabase. Bagaimana app dimuat (index.html → config.js → supabase-js → main.js)
Bab 1  - HTML: index.html root & app/index.html
Bab 2  - CSS: app/css/app.css (variables, grid/flex, @media, animasi)
Bab 3  - JavaScript asas melalui format.js (const, arrow function, export, Intl, tarikh, kenapa wang dalam sen)
Bab 4  - ui.js (DOM, esc/XSS, template literal, try/catch, Promise, IntersectionObserver)
Bab 5  - plan.js & session.js (object, array, getter, Set, async/await, Promise.all, query Supabase pertama)
Bab 6  - main.js (event listener, aliran login, Promise.race, custom event)
Bab 7  - router.js (hash routing, roles, filter/find/map/join, cleanup)
Bab 8  - PWA: pwa.js, sw.js, manifest.webmanifest (cache, offline, kenapa CACHE dinaikkan)
Bab 9  - Halaman ringkas: pakej.js, menu.js (dialog, borang, update data)
Bab 10 - utama.js & smartlist.js (ambil data, kira, WhatsApp)
Bab 11 - stok.js (CRUD lengkap)
Bab 12 - receipt.js (canvas, Blob, upload Storage)
Bab 13 - rekod.js (Key In, sejarah, edit/padam)
Bab 14 - laporan.js (reduce, kumpul ikut tempoh)
Bab 15 - foodcost.js & pnl.js (kos resepi, P&L, PDF dengan jsPDF)
Bab 16 - pekerja.js (kehadiran, gaji, OT, advance, slip) - paling kompleks
Bab 17 - SQL asas melalui migration Fasa 0 (table, key, transaksi begin/commit)
Bab 18 - Row Level Security & policy (Fasa 0, 1, 4, 9, 12, 13)
Bab 19 - Function & trigger database (current_business_id, pay_payroll, audit log)
Bab 20 - Ujian keselamatan SQL (supabase/tests/): menyamar peranan, jangka OK/GAGAL, rollback
Bab 21 - Gabung semua: ikut satu aliran penuh "staff key in jualan RM10" dari klik butang
         sampai baris masuk database dan policy yang membenarkannya.
Lampiran - Glosari, cheat sheet syntax JS & SQL.

Mula dengan Daftar Isi penuh dulu, kemudian Bab 0 sahaja. Aku akan minta bab seterusnya satu-satu.
```

---

## Tip semasa guna GPT

- **Semak dengan kod sebenar.** Kalau GPT kata "baris 40 buat X", buka fail dan tengok sendiri. AI boleh salah sebut baris atau reka penjelasan. Itu pun latihan yang bagus.
- Kalau jawapan terpotong: taip `sambung dari tempat terhenti`.
- Kalau terlalu teknikal: `terangkan semula macam aku budak 15 tahun, guna contoh kedai makan`.
- Bawa soalan yang tersangkut kepada Claude dengan nama fail + baris. Boleh juga minta Claude semak sama ada penjelasan GPT tu betul.
- Zip ini kod sahaja, tiada data pelanggan dan tiada kata laluan. `config.js` ada publishable key, memang selamat didedahkan (dilindungi RLS).
