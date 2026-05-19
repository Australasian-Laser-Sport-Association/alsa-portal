# ZLTAC history migration — dry-run report

Generated: 2026-05-19T03:47:07.482Z
Mode: commit

## Summary

### Source rows discovered

- Hall of Fame inductees: **11**
- Event years: **29** (would produce **499** rows in `zltac_event_placings`)
- Legends: **8**
- Dynasties: **5** (three-peats: 2, back-to-back: 3)

### Findings by category

| Section | Errors | Warnings | Info |
|---|---:|---:|---:|
| Hall of Fame | 0 | 10 | 0 |
| Events       | 0     | 0     | 0 |
| Legends      | 0    | 0    | 0 |
| Dynasties    | 0  | 0  | 0 |
| Cross-ref    | 0   | 0   | 5 |
| **Total**    | **0** | **10** | **5** |

> **Result:** no errors — safe to re-run with `--commit` after reviewing warnings.

## Hall of Fame

- [warn] `index 1 (Barry Baldwin / Doc)` — contribution is empty
- [warn] `index 2 (Peter Maskell / Master Guardian)` — contribution is empty
- [warn] `index 3 (Benny Janssen / 111+444)` — contribution is empty
- [warn] `index 4 (Ricky Aherne / CV)` — contribution is empty
- [warn] `index 5 (David Ohl / MstMopar)` — contribution is empty
- [warn] `index 6 (Ben Baker / Bootza)` — contribution is empty
- [warn] `index 7 (Andrew Hawkes / Dorky)` — contribution is empty
- [warn] `index 8 (Simone Bell / Simmybear)` — contribution is empty
- [warn] `index 9 (Ben Ferris / Beefy)` — contribution is empty
- [warn] `index 10 (Robert Dorward / Tricky)` — contribution is empty

## Events / placings

_No findings._

## Legends

_No findings._

## Dynasties

_No findings._

## Cross-reference (informational)

- [info] `Hall of Fame: Doug Burbidge (Ronin441)` — alias does not appear in any placing or legend — may indicate a name spelling drift
- [info] `Hall of Fame: Barry Baldwin (Doc)` — alias does not appear in any placing or legend — may indicate a name spelling drift
- [info] `Hall of Fame: Peter Maskell (Master Guardian)` — alias does not appear in any placing or legend — may indicate a name spelling drift
- [info] `Hall of Fame: Andrew Hawkes (Dorky)` — alias does not appear in any placing or legend — may indicate a name spelling drift
- [info] `Hall of Fame: Robert Dorward (Tricky)` — alias does not appear in any placing or legend — may indicate a name spelling drift
