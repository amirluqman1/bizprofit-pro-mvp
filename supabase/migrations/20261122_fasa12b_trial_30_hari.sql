-- =====================================================================
-- BizProfit Pro · Fasa 12b: Trial Pro 30 hari (dahulu 14 hari)
-- Hanya nilai lalai untuk syarikat BARU. Syarikat sedia ada tidak disentuh.
-- Sudah dijalankan di production pada 22 Nov 2026 (asalnya dinamakan fasa13 dalam PR #25).
-- =====================================================================
begin;
alter table public.businesses alter column trial_ends_at set default (now() + interval '30 days');
commit;
