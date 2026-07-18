# Przykład: „Ile zarabiają lekarze?" (monitoring 161)

Pokazuje, jak zbudować analizę domenową na danych zebranych przez `fedrowanie` —
tu: wyłuskanie wynagrodzeń z odpowiedzi placówek. To **nie** część rdzenia; rdzeń
pobiera dane dowolnego monitoringu, a takie skrypty dokładasz per temat.

```sh
fedrowanie sync 161      # pobierz monitoring
fedrowanie pages         # ściągnij teksty stron spraw (treść + OCR)

node examples/lekarze/figures.mjs    # heurystyczne kwoty  → tabela figures (surowiec)
node examples/lekarze/salaries.mjs   # parser tabel per-lekarz → tabela salaries (czyste)
```

Oba skrypty czytają tę samą bazę (`FEDR_DB`, domyślnie `./fedrowanie.db`) i dokładają
własne tabele. Idempotentne — przeliczają od zera przy każdym biegu.

**Dwie jakości danych:**

- `salaries` — deterministyczny parser wierszy `| idx | lekarz N | umowa | kwota |`.
  Najczystsze; filtruj `money_cells = 1` (jedna kwota w wierszu).
- `figures` — heurystyka po całym tekście. Szerszy zasięg, więcej szumu (sumy, kapitał).
  Traktuj jako **kandydatów do ręcznej weryfikacji przy źródle**, nie jako fakt.

Formaty niejednoznaczne (inicjały + składniki w wielu wierszach) trafiają do `salaries`
z `money_cells > 1` — te trzeba obejrzeć ręcznie przed jakimkolwiek użyciem.
