-- =====================================================================
-- BizProfit Pro · Fasa 13: Trial Pro 30 hari (dahulu 14 hari)
-- Hanya nilai lalai untuk syarikat BARU. Syarikat sedia ada tidak disentuh.
-- =====================================================================
begin;
alter table public.businesses alter column trial_ends_at set default (now() + interval '30 days');
commit;
