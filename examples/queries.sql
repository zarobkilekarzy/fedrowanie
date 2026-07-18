-- Przykładowe zapytania do bazy zbudowanej przez `fedrowanie`.
-- Tabele rdzenia: cases, institutions, letters, attachments, case_pages.
-- Działają dla DOWOLNEGO monitoringu. Aby zawęzić do jednego: dołóż `WHERE monitoring = <nr>`.
--
-- Użycie:  sqlite3 fedrowanie.db < examples/queries.sql
--    albo skopiuj pojedyncze zapytanie do:  sqlite3 fedrowanie.db
-- (.mode/.headers to polecenia CLI sqlite3 — dbają tylko o ładny wydruk.)

.mode box
.headers on

-- 1) Lejek odpowiedzi: ile spraw w każdej kategorii + udział procentowy.
SELECT answer_category AS kategoria,
       COUNT(*)        AS spraw,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS proc
FROM cases
GROUP BY answer_category
ORDER BY spraw DESC;

-- 2) Jawność jednym wierszem: odpowiedziało vs cisza.
SELECT SUM(response_received)                           AS odpowiedzialo,
       SUM(response_received = 0)                       AS cisza,
       ROUND(100.0 * SUM(response_received) / COUNT(*), 1) AS proc_odp
FROM cases;

-- 3) Geografia: skuteczność per województwo (od najgłębszej ciszy).
SELECT i.voivodeship                            AS wojewodztwo,
       COUNT(*)                                 AS wyslano,
       SUM(c.response_received)                 AS odpowiedzi,
       SUM(c.answer_category = 'B')             AS odmowy,
       ROUND(100.0 * SUM(c.response_received = 0) / COUNT(*), 1) AS cisza_proc
FROM cases c JOIN institutions i ON i.pk = c.institution_pk
WHERE i.voivodeship IS NOT NULL
GROUP BY i.voivodeship
HAVING wyslano >= 10
ORDER BY cisza_proc DESC;

-- 4) Mur milczenia: instytucje, które w ogóle nie odpowiedziały.
SELECT i.name AS instytucja, i.voivodeship AS woj, c.number AS nr_sprawy
FROM cases c JOIN institutions i ON i.pk = c.institution_pk
WHERE c.response_received = 0
ORDER BY i.voivodeship, i.name;

-- 5) Czas reakcji: dni od pierwszego wniosku do pierwszego listu zwrotnego (per sprawa).
--    (pierwszy list przychodzący bywa potwierdzeniem — to „reakcja", niekoniecznie odpowiedź).
WITH wyslane AS (SELECT case_pk, MIN(created) t FROM letters WHERE is_outgoing = 1 GROUP BY case_pk),
     zwrotne AS (SELECT case_pk, MIN(created) t FROM letters WHERE is_incoming = 1 GROUP BY case_pk)
SELECT c.number AS nr, i.name AS instytucja,
       CAST(julianday(zwrotne.t) - julianday(wyslane.t) AS INT) AS dni
FROM cases c
JOIN institutions i ON i.pk = c.institution_pk
JOIN wyslane ON wyslane.case_pk = c.pk
JOIN zwrotne ON zwrotne.case_pk = c.pk
WHERE dni >= 0
ORDER BY dni DESC
LIMIT 20;

-- 6) Najbardziej oporne sprawy: ile ponagleń (listów wychodzących) trzeba było wysłać.
SELECT c.number AS nr, i.name AS instytucja, COUNT(*) AS listow_wychodzacych
FROM letters l
JOIN cases c ON c.pk = l.case_pk
JOIN institutions i ON i.pk = c.institution_pk
WHERE l.is_outgoing = 1
GROUP BY l.case_pk
HAVING listow_wychodzacych >= 2
ORDER BY listow_wychodzacych DESC
LIMIT 20;

-- 7) Jawność za pieniądze: sprawy z żądaniem opłaty (wymaga wcześniej `fedrowanie pages`).
SELECT c.number AS nr, i.name AS instytucja
FROM case_pages p
JOIN cases c ON c.pk = p.case_pk
JOIN institutions i ON i.pk = c.institution_pk
WHERE p.text LIKE '%opłat%' OR p.text LIKE '%koszt udostępn%';

-- 8) Wyszukiwarka pełnotekstowa po stronach spraw (podmień frazę w LIKE).
SELECT c.number AS nr, i.name AS instytucja, p.chars AS znakow
FROM case_pages p
JOIN cases c ON c.pk = p.case_pk
JOIN institutions i ON i.pk = c.institution_pk
WHERE p.text LIKE '%wynagrodzenie%'
ORDER BY p.chars DESC;

-- 9) Najwięcej załączników PDF (kandydaci na bogate w dane odpowiedzi).
SELECT c.number AS nr, i.name AS instytucja, COUNT(*) AS pdf
FROM attachments a
JOIN cases c ON c.pk = a.case_pk
JOIN institutions i ON i.pk = c.institution_pk
WHERE a.ext = 'pdf'
GROUP BY a.case_pk
ORDER BY pdf DESC
LIMIT 15;

-- 10) Odpowiedzialność wg typu instytucji (kind — pierwszy segment tagu Federa).
SELECT COALESCE(i.kind, '(brak)') AS typ,
       COUNT(*) AS spraw,
       ROUND(100.0 * SUM(c.response_received) / COUNT(*), 1) AS proc_odp
FROM cases c JOIN institutions i ON i.pk = c.institution_pk
GROUP BY i.kind
ORDER BY spraw DESC;
