-- Przykładowe zapytania do analizy wynagrodzeń — tabele `salaries` i `figures`
-- tworzone przez skrypty z tego katalogu. Najpierw:
--   fedrowanie sync 161 && fedrowanie pages
--   node examples/lekarze/salaries.mjs      # tabela salaries (czyste wiersze)
--   node examples/lekarze/figures.mjs       # tabela figures  (surowiec heurystyczny)
--
-- „Czysty" rdzeń danych to salaries.money_cells = 1 (dokładnie jedna kwota w wierszu) —
-- prawie wszystkie zapytania filtrują właśnie to. Wiersze money_cells > 1 są wieloznaczne
-- i wymagają ręcznej weryfikacji przy źródle.
--
-- Użycie:  sqlite3 fedrowanie.db < examples/lekarze/queries.sql

.mode box
.headers on

-- 1) Rozkład ujawnionych wynagrodzeń (kwantyle) na czystych wierszach.
WITH s AS (
  SELECT amount, ROW_NUMBER() OVER (ORDER BY amount) rn, COUNT(*) OVER () n
  FROM salaries WHERE money_cells = 1)
SELECT (SELECT MAX(n) FROM s)                                AS lekarzy,
       (SELECT amount FROM s WHERE rn = CAST(n * 0.50 AS INT)) AS mediana,
       (SELECT amount FROM s WHERE rn = CAST(n * 0.90 AS INT)) AS p90,
       (SELECT amount FROM s WHERE rn = CAST(n * 0.99 AS INT)) AS p99,
       (SELECT MAX(amount) FROM s)                           AS maks;

-- 2) Ilu lekarzy przekroczyło progi (na czystych wierszach).
SELECT SUM(amount >= 300000)  AS "od_300k",
       SUM(amount >= 500000)  AS "od_500k",
       SUM(amount >= 800000)  AS "od_800k",
       SUM(amount >= 1000000) AS "od_1mln"
FROM salaries WHERE money_cells = 1;

-- 3) Wg typu umowy: liczba, mediana, maksimum.
WITH s AS (
  SELECT contract_type, amount,
         ROW_NUMBER() OVER (PARTITION BY contract_type ORDER BY amount) rn,
         COUNT(*)     OVER (PARTITION BY contract_type) n
  FROM salaries WHERE money_cells = 1 AND contract_type IS NOT NULL)
SELECT contract_type AS umowa,
       MAX(n)        AS n,
       MAX(CASE WHEN rn = CAST(n * 0.5 AS INT) THEN amount END) AS mediana,
       MAX(amount)   AS maks
FROM s GROUP BY contract_type ORDER BY mediana DESC;

-- 4) Nierówności w JEDNEJ placówce: max / mediana / min (pełne listy, n >= 25).
WITH s AS (
  SELECT case_pk, amount,
         ROW_NUMBER() OVER (PARTITION BY case_pk ORDER BY amount) rn,
         COUNT(*)     OVER (PARTITION BY case_pk) n
  FROM salaries WHERE money_cells = 1)
SELECT c.number       AS nr,
       i.voivodeship  AS woj,
       MAX(s.n)       AS lekarzy,
       MAX(s.amount)  AS maks,
       MAX(CASE WHEN s.rn = CAST(s.n * 0.5 AS INT) THEN s.amount END) AS mediana,
       MIN(s.amount)  AS min,
       i.name         AS placowka
FROM s JOIN cases c ON c.pk = s.case_pk JOIN institutions i ON i.pk = c.institution_pk
GROUP BY s.case_pk HAVING lekarzy >= 25 ORDER BY maks DESC LIMIT 12;

-- 5) Najwyższe zweryfikowane rekordy (indeksowane listy, 1 kwota w wierszu).
SELECT CAST(s.amount AS INT) AS kwota, i.voivodeship AS woj, i.name AS placowka, c.number AS nr
FROM salaries s JOIN cases c ON c.pk = s.case_pk JOIN institutions i ON i.pk = c.institution_pk
WHERE s.money_cells = 1 AND s.row_index IS NOT NULL
ORDER BY s.amount DESC LIMIT 15;

-- 6) Placówki, które ujawniły najdłuższe listy (skala jawności).
SELECT c.number AS nr, i.name AS placowka, COUNT(*) AS wierszy, MAX(s.amount) AS maks
FROM salaries s JOIN cases c ON c.pk = s.case_pk JOIN institutions i ON i.pk = c.institution_pk
WHERE s.money_cells = 1
GROUP BY s.case_pk ORDER BY wierszy DESC LIMIT 15;

-- 7) Mediana ujawnionych płac per województwo (i gdzie ujawniono najwięcej).
WITH s AS (
  SELECT i.voivodeship woj, sa.amount,
         ROW_NUMBER() OVER (PARTITION BY i.voivodeship ORDER BY sa.amount) rn,
         COUNT(*)     OVER (PARTITION BY i.voivodeship) n
  FROM salaries sa JOIN cases c ON c.pk = sa.case_pk JOIN institutions i ON i.pk = c.institution_pk
  WHERE sa.money_cells = 1 AND i.voivodeship IS NOT NULL)
SELECT woj AS wojewodztwo, MAX(n) AS lekarzy,
       MAX(CASE WHEN rn = CAST(n * 0.5 AS INT) THEN amount END) AS mediana
FROM s GROUP BY woj ORDER BY lekarzy DESC;

-- 8) figures: surowe kwoty wg okresu (godz/mies/rok) — do weryfikacji przy źródle.
SELECT COALESCE(period, '(nieokreślony)') AS okres,
       COUNT(*)                 AS kwot,
       CAST(AVG(amount) AS INT) AS srednia,
       MAX(amount)              AS maks
FROM figures GROUP BY period ORDER BY kwot DESC;
