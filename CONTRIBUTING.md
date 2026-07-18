# Współtworzenie

Dzięki za zainteresowanie. Repozytorium jest małe i bez zależności — łatwo się w nim odnaleźć.

## Uruchomienie i testy

```sh
git clone https://github.com/zarobkilekarzy/fedrowanie.git
cd fedrowanie
npm run check    # składnia wszystkich modułów
npm test         # testy jednostkowe (node:test, bez sieci)
node bin/fedrowanie.mjs list
```

Wymagany Node ≥ 22. Nie ma kroku instalacji zależności, bo ich nie ma.

## Układ

- `bin/fedrowanie.mjs` — CLI (parsowanie argumentów, wybór komendy).
- `src/` — **rdzeń**, ogólny dla dowolnego monitoringu: `commands/{list,sync,pages,stats}.mjs`
  oraz `db.mjs` (schemat + klasyfikacja), `api.mjs`, `html.mjs`, `util.mjs`.
- `examples/` — analizy **domenowe** (np. wynagrodzenia lekarzy) i zapytania SQL.
- `test/` — testy `node:test`.

Model danych opisuje [README](README.md#model-danych), a schemat SQL — `src/db.mjs`.

## Zasady

- **Zero zależności** — nie dodawaj paczek npm. Wystarcza standardowa biblioteka Node.
- **Rdzeń zostaje ogólny.** Logika jednego tematu (słowniki, parsery kwot) idzie do
  `examples/`, nie do `src/`.
- Trzymaj styl otoczenia: zwięźle, komentarze po polsku, funkcje czyste tam, gdzie się da.
- Zmieniasz parser lub heurystykę (`html.mjs`, klasyfikacja, parsery z `examples/`)? **Dołóż
  albo zaktualizuj test** i napisz w PR, **na jakim monitoringu** to sprawdziłeś — zachowanie
  bywa zależne od konkretnego monitoringu.

## Zgłoszenia i PR-y

Błędy i pomysły → Issues; zmiany → pull request z gałęzi. W zgłoszeniu błędu podaj numer
monitoringu, wersję Node i użytą komendę — to zwykle wystarcza, by odtworzyć problem.
