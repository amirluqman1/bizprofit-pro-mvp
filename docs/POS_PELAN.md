# Pelan POS: ciri seterusnya

Disusun 28 Nov 2026 selepas pengguna pilih **semua** ciri di bawah dan minta dipecahkan jadi aliran kerja.
Setiap fasa = satu PR (dan satu migration jika perlu), diuji (Postgres tempatan + Playwright),
kemudian **pengguna uji di kedai sebelum fasa seterusnya bermula**. Tanya soalan "Perlu ditanya"
kepada pengguna di awal setiap fasa. Jangan teka.

## Kenapa susunan ini

Beberapa ciri bergantung pada ciri lain. Kalau dibuat ikut susunan salah, kerja perlu diulang:

- **Diskaun / caj servis / SST mengubah cara jumlah dikira.** Laporan menu, resit dan offline semua
  bergantung pada kiraan ini, jadi ia mesti siap dan stabil dahulu.
- **Tolak stok automatik bertembung dengan masalah stok lama.** `stok.js` simpan nilai mutlak
  (`current_qty = 6`). Kalau POS tolak 2 pinggan, kemudian staf tekan +1 di phone yang masih papar
  angka lama, tolakan POS hilang. Stok mesti ditukar kepada cara "tambah/tolak" (`adjust_stock(id, delta)`)
  **sebelum** POS boleh tolak stok.
- **PIN staf menentukan siapa yang buat order / buka laci / batal.** Ciri yang merekod "siapa"
  (laci manual, batal, laporan ikut staf) lebih kemas kalau PIN dah ada.
- **Offline paling akhir**, sebab ia perlu tahu semua aliran order yang final (harga, diskaun, PIN, stok).
  Kalau dibuat awal, setiap ciri baru perlu dibina dua kali (online + offline).
  Offline **WAJIB** siap sebelum app dijual kepada pelanggan lain.

## Fasa

| # | Fasa | Saiz | Bergantung pada | Migration |
|---|---|---|---|---|
| P1 | Ringkasan jualan POS di Rekod | Kecil | - | Tidak |
| P2 | Butang buka laci manual + log | Kecil | Laci automatik (PR #48) diuji di kedai | Ya |
| P3 | Diskaun / caj servis / SST | Besar | - | Ya |
| P4 | Laporan jualan menu | Sederhana | P3 | Mungkin (view/fungsi) |
| P5 | PIN tukar staf | Sederhana | - | Ya |
| P6a | Stok guna tambah/tolak (`adjust_stock`) | Sederhana | - | Ya |
| P6b | Tolak stok automatik dari POS | Sederhana | P3, P6a | Ya |
| P7 | Skrin dapur (tablet kedua) | Besar | P5 (pilihan) | Ya |
| P8 | Offline POS | Besar | Semua di atas | Mungkin |

### P1. Ringkasan jualan POS di Rekod
Paparan sahaja; data kekal 1 order = 1 transaksi (tiada perubahan database).
Rekod tunjuk satu baris "Jualan POS hari ini: RM X (n order)" yang boleh dibuka untuk lihat order satu-satu.
- Perlu ditanya: suis On/Off untuk siapa (setiap pengguna / setiap syarikat)? Ringkas ikut hari sahaja,
  atau ikut hari + kaedah bayar (Tunai / QR / kad)?

### P2. Butang buka laci manual + log
Butang "Buka laci" di POS. Setiap kali ditekan direkod (siapa, bila, sebab) dalam log yang tak boleh diubah.
- Perlu ditanya: siapa boleh tekan (owner/admin sahaja, atau staf juga)? Sebab wajib?
  Log dipapar di mana (Rekod / halaman POS di BizProfit)?

### P3. Diskaun / caj servis / SST
Jumlah dikira oleh database (`pos_pay_order`), bukan tablet, sama prinsip dengan gaji Fasa 20.
Resit papar pecahan: subjumlah, diskaun, caj servis, SST, jumlah.
- Perlu ditanya: diskaun ikut item, ikut bil, atau dua-dua? RM atau %? Siapa boleh beri diskaun
  (staf ada had?), wajib sebab? Caj servis berapa % dan dikenakan sebelum atau selepas diskaun?
  Kedai berdaftar SST atau tidak; kadar (6% / 8%) dan harga menu sudah termasuk SST atau belum?
  Bagaimana masuk ke Rekod (satu transaksi jumlah bersih, atau SST/caj servis berasingan)?

### P4. Laporan jualan menu
Item paling laku, jualan ikut jam dan kategori, untuk tahu menu mana bawa untung
(boleh guna kos resepi `menu_ingredients` / food cost Fasa 10).
- Perlu ditanya: dipapar di BizProfit (Laporan) atau di POS? Diskaun bil diagih kepada item atau tidak?

### P5. PIN tukar staf
Satu tablet kaunter, ramai staf: tukar staf guna PIN 4 digit tanpa log keluar akaun.
Order, batal dan buka laci direkod ikut staf yang aktif.
- Perlu ditanya: setiap staf perlu akaun BizProfit sendiri, atau cukup nama + PIN di bawah akaun kaunter?
  PIN diminta setiap order, atau sekali sehingga ditukar / tamat masa?

### P6a. Stok guna tambah/tolak
Tukar `stok.js` daripada simpan nilai mutlak kepada `adjust_stock(id, delta)` dalam database,
supaya dua phone serentak (atau phone + POS) tidak hilang kiraan. Ini juga menyelesaikan isu stok dari audit 26 Nov.
- Perlu ditanya: "Kira stok" (masukkan jumlah sebenar selepas kira fizikal) masih perlu set nilai mutlak.
  Kekalkan sebagai tindakan berasingan?

### P6b. Tolak stok automatik
Bila order dibayar, database tolak bahan ikut resepi menu (`menu_ingredients`). Batal order = stok dipulangkan.
- Perlu ditanya: tolak bila dibayar, atau bila order dihantar ke dapur? Stok boleh jadi negatif
  (jual walaupun stok sistem habis)? Menu tanpa resepi diabaikan?

### P7. Skrin dapur
Tablet kedua di dapur papar order masuk secara langsung; tekan "Siap" bila dah masak. Ganti / tambah slip dapur kertas.
- Perlu ditanya: ganti slip kertas atau dua-dua? Siap ikut item atau ikut order? Kaunter perlu nampak status siap?

### P8. Offline POS
Service worker untuk `pos/`, menu disimpan dalam tablet, order beratur dalam IndexedDB, dihantar semula
guna ID sama (database sudah sedia: ID dijana di tablet, `pos_pay_order` selamat dipanggil dua kali).
Kiraan jumlah di tablet mesti sama tepat dengan database (macam gaji Fasa 20: uji ratusan kes rawak).
- Perlu ditanya: berapa lama tablet dibenarkan offline? Resit dicetak semasa offline (jumlah dari tablet)?
  Tunjuk amaran "belum dihantar" di mana?

## Status
- [x] Laci automatik bila bayar tunai (PR #48), menunggu ujian di kedai
- [x] P0 (permintaan pengguna 28 Nov, didahulukan): Edit menu dalam POS + seret susun + warna kategori (Fasa 22)
- [x] Shift (permintaan pengguna 28 Nov, didahulukan): buka/tutup kedai, modal laci, cash in/out, kiraan buta, laporan (Fasa 23).
      Nota: P1 (ringkasan POS di Rekod) & P2 (laci manual) sebahagiannya diliputi: laci terbuka bila cash in/out & tutup shift.
- [ ] P1 · [ ] P2 · [ ] P3 · [ ] P4 · [ ] P5 · [ ] P6a · [ ] P6b · [ ] P7 · [ ] P8
