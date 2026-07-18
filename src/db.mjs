// Model danych Federa w SQLite + otwarcie bazy i drobne helpery.
//
// Silnik: node:sqlite (wbudowany, zero zależności). Node ≥ 24 działa bez flagi;
// Node 22 wymaga --experimental-sqlite (bin/fedrowanie dokłada ją sam).
//
// Jedna baza może trzymać wiele monitoringów naraz (kolumna cases.monitoring).
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Instytucje (adresaci wniosków). Pola TERYT/REGON są polskie — Feder to rejestr PL.
CREATE TABLE IF NOT EXISTS institutions (
  pk          INTEGER PRIMARY KEY,
  name        TEXT,
  slug        TEXT,
  regon       TEXT,
  nip         TEXT,
  jst_id      TEXT,   -- kod TERYT gminy (np. 2403011)
  voivodeship TEXT,   -- z 2-cyfrowego prefiksu TERYT
  kind        TEXT,   -- pierwszy segment pierwszego tagu (np. 'szpitale')
  tags        TEXT,   -- pełna lista tagów (JSON)
  email       TEXT,
  city        TEXT,
  raw         TEXT,   -- pełny obiekt z API (JSON) — na wypadek późniejszych potrzeb
  fetched_at  TEXT
);

-- Sprawy = pojedyncze wnioski w monitoringu.
CREATE TABLE IF NOT EXISTS cases (
  pk                 INTEGER PRIMARY KEY,
  monitoring         INTEGER,  -- pk monitoringu, z którego pochodzi sprawa
  number             INTEGER,  -- numer z nazwy sprawy (#1356)
  slug               TEXT,     -- np. ile-zarabiaja-lekarze-1356
  name               TEXT,
  institution_pk     INTEGER REFERENCES institutions(pk),
  created            TEXT,
  modified           TEXT,
  -- agregaty wyliczane przy synchronizacji listów:
  application_status TEXT,     -- status pierwszego wniosku wychodzącego
  response_received  INTEGER,  -- 0/1 — czy przyszła merytoryczna odpowiedź (nie samo potwierdzenie)
  answer_category    TEXT,     -- A|B|C|E|G|receipt|none (najlepsza kategoria AI w sprawie)
  letter_count       INTEGER,
  last_letter        TEXT,
  -- sterowanie inkrementalnością (dociągamy listy tylko dla zmienionych spraw):
  letters_synced_at  TEXT,
  letters_synced_mod TEXT      -- case.modified w chwili ostatniego pobrania listów
);

-- Listy = korespondencja w sprawie (wnioski wychodzące i odpowiedzi przychodzące).
CREATE TABLE IF NOT EXISTS letters (
  pk                    INTEGER PRIMARY KEY,
  record_pk             INTEGER,   -- pk rekordu w /api/records/
  case_pk               INTEGER REFERENCES cases(pk),
  title                 TEXT,
  body                  TEXT,
  email                 TEXT,
  author_institution_pk INTEGER,
  is_incoming           INTEGER,
  is_outgoing           INTEGER,
  is_spam               INTEGER,
  email_delivery_status TEXT,
  ai_evaluation         TEXT,      -- klasyfikacja AI Federa (podpowiedź, nie prawda)
  created               TEXT,
  modified              TEXT,
  eml_url               TEXT,
  has_attachments       INTEGER,
  fetched_at            TEXT
);

-- Załączniki — tylko metadane. Binaria bywają za logowaniem (403); ich TEKST po OCR
-- Feder renderuje na publicznej stronie sprawy i pobieramy go w komendzie "pages".
CREATE TABLE IF NOT EXISTS attachments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  letter_pk INTEGER REFERENCES letters(pk),
  case_pk   INTEGER,
  url       TEXT UNIQUE,
  filename  TEXT,
  ext       TEXT
);

-- Tekst publicznej strony sprawy: treść wniosku + odpowiedzi + OCR załączników.
CREATE TABLE IF NOT EXISTS case_pages (
  case_pk       INTEGER PRIMARY KEY,
  text          TEXT,
  chars         INTEGER,
  case_modified TEXT,   -- case.modified w chwili pobrania (do inkrementalności)
  fetched_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_cases_monitoring ON cases(monitoring);
CREATE INDEX IF NOT EXISTS idx_cases_inst       ON cases(institution_pk);
CREATE INDEX IF NOT EXISTS idx_letters_case     ON letters(case_pk);
CREATE INDEX IF NOT EXISTS idx_letters_incoming ON letters(is_incoming);
CREATE INDEX IF NOT EXISTS idx_att_letter       ON attachments(letter_pk);
CREATE INDEX IF NOT EXISTS idx_att_case         ON attachments(case_pk);
`;

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  // Klucze obce zostają w schemacie jako dokumentacja, ale ich nie egzekwujemy:
  // kolejność wstawiania (sprawy → instytucje → listy) rodziłaby fałszywe naruszenia.
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(SCHEMA);
  return db;
}

// node:sqlite nie ma .transaction() (jak better-sqlite3) — własny, mały wrapper.
export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const getMeta = (db, key, def = null) => {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  return r ? r.value : def;
};
export const setMeta = (db, key, value) =>
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));

// Tematy automatycznych potwierdzeń (MDN / read-receipt / autoreply). Potrzebne, gdy Feder
// nie nadał oceny AI — starsze monitoringi mają ai_evaluation puste, a is_spam ustawione na
// wszystkim (i na potwierdzeniach, i na realnych odpowiedziach), więc jako filtr bezużyteczne.
const RECEIPT_SUBJECT = /^(re:\s*)?(read:|not read:|delivered:|delivery\b|undeliverable:|automatic reply|out of office|auto[- ]?reply|przeczyta|nieprzeczyta|nie przeczyt|odczytano|nie odczytano|dostarczono\b|niedostarczono|zwrotne potwierdzenie|potwierdzenie (odczytu|dostarczenia|doręczenia)|automatyczna odpowiedź|wiadomość automatyczna)/i;

// Priorytet kategorii w obrębie sprawy (bierzemy najlepszą z listów przychodzących).
const CAT_RANK = { A: 6, C: 5, B: 4, E: 3, other: 2, G: 1, receipt: 0 };

// Kategoria pojedynczego listu przychodzącego. Kody z oceny AI Federa:
//  A = odpowiedź z danymi, B = odmowa, C = inna odpowiedź (np. przedłużenie terminu),
//  D = potwierdzenie doręczenia/otwarcia, E = inna instytucja, G = nieustalona.
// Poza tym: 'other' = realna odpowiedź, której AI nie ocenił; 'receipt' = auto-potwierdzenie.
function letterCategory(ai, title) {
  ai = ai || '';
  const m = /^([A-G])\)/.exec(ai);
  if (m) return m[1] === 'D' ? 'receipt' : (['A', 'B', 'C', 'E', 'G'].includes(m[1]) ? m[1] : 'other');
  // Feder wprost pomija ocenę AI dla wiadomości automatycznych — to potwierdzenia, nie odpowiedzi.
  if (/pomini[ęe]ta|automatyczn/i.test(ai)) return 'receipt';
  return RECEIPT_SUBJECT.test((title || '').trim()) ? 'receipt' : 'other';
}

// Klasyfikacja spraw po listach przychodzących. Działa dla dowolnego monitoringu: gdy jest
// ocena AI Federa, używamy jej; gdy jej nie ma, rozpoznajemy potwierdzenia po temacie, a
// pozostałe realne odpowiedzi lądują w 'other'. Idempotentne, bez sieci.
export function reclassify(db) {
  const rows = db.prepare('SELECT case_pk, ai_evaluation, title FROM letters WHERE is_incoming=1').all();
  const best = new Map();
  for (const r of rows) {
    const cat = letterCategory(r.ai_evaluation, r.title);
    const cur = best.get(r.case_pk);
    if (cur === undefined || CAT_RANK[cat] > CAT_RANK[cur]) best.set(r.case_pk, cat);
  }
  const upd = db.prepare('UPDATE cases SET answer_category=?, response_received=? WHERE pk=?');
  tx(db, () => {
    db.exec("UPDATE cases SET answer_category='none', response_received=0");
    for (const [pk, cat] of best) upd.run(cat, cat === 'receipt' ? 0 : 1, pk);
  });
}
