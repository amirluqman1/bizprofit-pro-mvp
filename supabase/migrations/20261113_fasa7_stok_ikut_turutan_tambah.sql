-- =====================================================================
-- BizProfit Pro · Fasa 7: Senarai stok ikut turutan barang ditambah
-- App susun barang ikut created_at (lama di atas, baru di bawah).
-- Pastikan kolum wujud; selamat dijalankan walaupun kolum sudah ada.
-- =====================================================================
alter table public.inventory_items
  add column if not exists created_at timestamptz not null default now();
