# Skills Claude Code

Skill di sini dimuat automatik oleh Claude Code untuk sesi dalam repo ini.
`CLAUDE.md` sentiasa menang kalau ada percanggahan.

## Sumber
Disalin dari [obra/superpowers](https://github.com/obra/superpowers)
(commit `22f0b463e7a5e579904dd6211a520321035526f7`, lesen MIT: lihat `LICENSE-superpowers`).
Salinan beku: tidak dikemas kini automatik.

| Skill | Bila aktif |
|---|---|
| `systematic-debugging` | Ada bug / ralat: cari punca dulu sebelum fix |
| `verification-before-completion` | Sebelum kata "siap": mesti ada bukti |
| `receiving-code-review` | Terima feedback review: semak dulu, jangan ikut buta |

## Perubahan dari asal
- `systematic-debugging`: buang `condition-based-waiting.md`, contoh `.ts` dan
  `find-polluter.sh` (untuk projek Node/Jest). Rujukan skill TDD diganti dengan cara
  ujian projek ini (Playwright + `supabase/tests/`).
- `root-cause-tracing.md`: buang bahagian `find-polluter.sh`.
- `receiving-code-review`: buang arahan `gh api`.

Jangan tambah skill baru tanpa baca isinya dulu (script, hooks, arahan yang bercanggah).
