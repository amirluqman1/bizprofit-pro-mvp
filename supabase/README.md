# Database BizProfit Pro (Supabase)

- `migrations/` — perubahan struktur database, ikut tarikh. Dijalankan sekali sahaja, mengikut urutan.
- `tests/` — skrip ujian. Semua perubahan ujian dibatalkan (rollback); hasil keluar sebagai mesej ralat "HASIL UJIAN".

Jangan sekali-kali letak `service_role` key atau kata laluan dalam folder ini. Repo ini public.

Perubahan sebelum Fasa 0 (policy inventori, log stok) dibuat terus di Supabase dan belum direkodkan di sini.
