# fedrowanie

Pobiera monitoringi [Sieci Obywatelskiej Watchdog](https://siecobywatelska.pl) (silnik
**Feder**, publiczne API `fedrowanie.siecobywatelska.pl`) do lokalnej bazy **SQLite** —
sprawy, instytucje, korespondencję i teksty stron spraw. Z surowych wniosków o informację
publiczną robi bazę, którą da się przeszukiwać i analizować.

Zero zależności (tylko wbudowany `node:sqlite`). Idempotentne i inkrementalne — bezpieczne
do cyklicznego uruchamiania.

## Wymagania

- **Node ≥ 22** (na 22 CLI samo dokłada flagę `--experimental-sqlite`; od 24 zbędna).

## Instalacja

```sh
git clone https://github.com/zarobkilekarzy/fedrowanie.git
cd fedrowanie
npm link          # udostępnia komendę `fedrowanie` (opcjonalnie; można wołać bin/ wprost)
```

## Szybki start

```sh
fedrowanie sync 161     # pobierz monitoring nr 161 (sprawy + instytucje + listy)
fedrowanie pages        # ściągnij teksty stron spraw (treść odpowiedzi + OCR załączników)
fedrowanie stats        # lejek odpowiedzi, geografia milczenia, skala wysiłku
```

Numer monitoringu znajdziesz w URL-u na `fedrowanie.siecobywatelska.pl`. Jedna baza może
trzymać wiele monitoringów naraz.

## Komendy

| Komenda | Co robi |
|---|---|
| `sync <monitoring>` | Sprawy, instytucje, listy i metadane załączników → SQLite. Dociąga tylko zmienione sprawy. |
| `pages` | Teksty publicznych stron spraw merytorycznych (wniosek + odpowiedź + OCR załączników). |
| `stats` | Przegląd jawności: kto odpowiada, kto milczy, gdzie i jak trzeba było naciskać. |

Opcje: `-d, --db <ścieżka>` (domyślnie `./fedrowanie.db`), `-m, --monitoring <id>` (zawęża
`pages`/`stats`), `-c, --concurrency <n>`. Pełna pomoc: `fedrowanie --help`.

Zmienne środowiskowe: `FEDR_DB`, `FEDR_BASE` (adres API), `FEDR_UA` (User-Agent klienta).

## Model danych

| Tabela | Zawartość |
|---|---|
| `cases` | Sprawy = pojedyncze wnioski; `answer_category` (A/B/C/E/G/receipt/none), agregaty. |
| `institutions` | Adresaci: nazwa, TERYT/województwo, REGON, tagi. |
| `letters` | Korespondencja: kierunek, ocena AI Federa, załączniki. |
| `attachments` | Metadane załączników (binaria bywają za logowaniem — patrz niżej). |
| `case_pages` | Tekst strony sprawy: treść + OCR załączników. |

**Skąd tekst załączników:** binarne pliki bywają dostępne dopiero po zalogowaniu (403), ale
Feder renderuje ich treść po własnym OCR na publicznej stronie sprawy (w `<iframe srcdoc>`).
Komenda `pages` wyciąga stamtąd tekst — bez logowania i bez pobierania binariów.

**Klasyfikacja spraw** idzie po `ai_evaluation` Federa (A = odpowiedź z danymi, B = odmowa,
C = inna odpowiedź, E = inna instytucja, G = nieustalona). Pole `is_spam` Federa jest
zawodne (miesza potwierdzenia z realnymi odpowiedziami) i nie używamy go jako filtra.

## Analizy i zapytania

Rdzeń pobiera dane; interpretację konkretnego tematu dokładasz osobnym skryptem lub zapytaniem
na tej samej bazie.

- [`examples/queries.sql`](examples/queries.sql) — gotowe zapytania **uniwersalne** (lejek
  odpowiedzi, geografia, czas reakcji, ponaglenia, opłaty, wyszukiwarka pełnotekstowa).
- [`examples/lekarze`](examples/lekarze) — przykład **domenowy** dla monitoringu wynagrodzeń:
  parser tabel per-osoba, heurystyka kwot i [zapytania o płace](examples/lekarze/queries.sql).

```sh
sqlite3 fedrowanie.db < examples/queries.sql
```

## Uczciwe użycie

Narzędzie czyta wyłącznie **dane publiczne** i tak, jak udostępnia je Watchdog. Publikując
cokolwiek na ich podstawie, podaj **źródło i link do Sieci Obywatelskiej Watchdog**. Rób to
z umiarem wobec serwera (domyślna współbieżność jest niska; nie podkręcaj bez potrzeby).

## Licencja

[MIT](LICENSE). Dane pobierane z Federa pozostają własnością ich źródeł i podlegają zasadom
Sieci Obywatelskiej Watchdog.
