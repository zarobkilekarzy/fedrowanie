# fedrowanie

[![ci](https://github.com/zarobkilekarzy/fedrowanie/actions/workflows/ci.yml/badge.svg)](https://github.com/zarobkilekarzy/fedrowanie/actions/workflows/ci.yml)
[![licencja: MIT](https://img.shields.io/badge/licencja-MIT-blue.svg)](LICENSE)

Pobiera monitoringi [Sieci Obywatelskiej Watchdog](https://siecobywatelska.pl) (silnik
**Feder**, publiczne API `fedrowanie.siecobywatelska.pl`) do lokalnej bazy **SQLite** —
sprawy, instytucje, korespondencję i teksty stron spraw. Z surowych wniosków o informację
publiczną robi bazę, którą da się przeszukiwać i analizować.

Zero zależności (tylko wbudowany `node:sqlite`). Idempotentne i inkrementalne — bezpieczne
do cyklicznego uruchamiania.

## Wymagania

- **Node ≥ 22** (na 22 CLI samo dokłada flagę `--experimental-sqlite`; od 24 zbędna).

## Instalacja

Bez instalacji (zero zależności, więc `npx` odpala je prosto z repozytorium):

```sh
npx github:zarobkilekarzy/fedrowanie list
```

Albo na stałe, z kopii lokalnej:

```sh
git clone https://github.com/zarobkilekarzy/fedrowanie.git
cd fedrowanie
npm link          # udostępnia komendę `fedrowanie` (opcjonalnie; można wołać bin/ wprost)
```

## Szybki start

```sh
fedrowanie list         # wypisz dostępne monitoringi (albo: fedrowanie list lekarz)
fedrowanie sync 161     # pobierz monitoring nr 161 (sprawy + instytucje + listy)
fedrowanie pages        # ściągnij teksty stron spraw (treść odpowiedzi + OCR załączników)
fedrowanie stats        # lejek odpowiedzi, geografia milczenia, skala wysiłku
```

`stats` daje obraz jawności jednym rzutem oka:

```
  1. JAWNOŚĆ — czy instytucje w ogóle odpowiadają
  wniosków:                          11
  cisza (brak merytorycznej odp.):    1  (9.1%)
  odpowiedź merytoryczna:            10  (90.9%)
    ├ odpowiedź z danymi                  0  (0.0%)
    ├ WPROST ODMÓWIŁO                     0  (0.0%)
    …
    ├ odpowiedź bez oceny AI             10  (90.9%)
```

Jedna baza może trzymać wiele monitoringów naraz.

## Komendy

| Komenda | Co robi |
|---|---|
| `list [fraza]` | Wypisz dostępne monitoringi (numer + nazwa); `fraza` filtruje po nazwie. |
| `sync <monitoring>` | Sprawy, instytucje, listy i metadane załączników → SQLite. Dociąga tylko zmienione sprawy. |
| `pages` | Teksty publicznych stron spraw merytorycznych (wniosek + odpowiedź + OCR załączników). |
| `stats` | Przegląd jawności: kto odpowiada, kto milczy, gdzie i jak trzeba było naciskać. |

Opcje: `-d, --db <ścieżka>` (domyślnie `./fedrowanie.db`), `-m, --monitoring <id>` (zawęża
`pages`/`stats`), `-c, --concurrency <n>`. Pełna pomoc: `fedrowanie --help`.

Zmienne środowiskowe: `FEDR_DB`, `FEDR_BASE` (adres API), `FEDR_UA` (User-Agent klienta).

## Model danych

| Tabela | Zawartość |
|---|---|
| `cases` | Sprawy = pojedyncze wnioski; `answer_category` (A/B/C/E/G/other/receipt/none), agregaty. |
| `institutions` | Adresaci: nazwa, TERYT/województwo, REGON, tagi. |
| `letters` | Korespondencja: kierunek, ocena AI Federa, załączniki. |
| `attachments` | Metadane załączników (binaria bywają za logowaniem — patrz niżej). |
| `case_pages` | Tekst strony sprawy: treść + OCR załączników. |

**Skąd tekst załączników:** binarne pliki bywają dostępne dopiero po zalogowaniu (403), ale
Feder renderuje ich treść po własnym OCR na publicznej stronie sprawy (w `<iframe srcdoc>`).
Komenda `pages` wyciąga stamtąd tekst — bez logowania i bez pobierania binariów.

**Klasyfikacja spraw** korzysta z oceny AI Federa, gdy jest (A = odpowiedź z danymi,
B = odmowa, C = inna odpowiedź, E = inna instytucja, G = nieustalona). Starsze monitoringi
oceny nie mają — wtedy automatyczne potwierdzenia rozpoznajemy po temacie listu (→ `receipt`),
a pozostałe realne odpowiedzi trafiają do `other`. Dzięki temu lejek działa dla dowolnego
monitoringu. Pola `is_spam` Federa nie używamy — bywa ustawione na wszystkim, więc jako filtr
jest bezużyteczne.

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

**Dane osobowe (RODO).** Zbudowana baza to artefakt roboczy do analizy — może zawierać dane
osobowe (nazwiska w OCR załączników, adresy e-mail urzędników w treści listów). Nie publikuj
jej w całości ani nie udostępniaj danych na poziomie pojedynczej osoby. Do publikacji używaj
**agregatów i rekordów per instytucja**, a nie list „nazwisko + kwota". Baza `*.db` jest
w `.gitignore` właśnie po to, żeby nie trafiła przypadkiem do repozytorium.

## Licencja

[MIT](LICENSE). Dane pobierane z Federa pozostają własnością ich źródeł i podlegają zasadom
Sieci Obywatelskiej Watchdog.
