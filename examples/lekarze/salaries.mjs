// PRZYKŁAD (domenowy, nie część rdzenia) — deterministyczny parser TABEL per-lekarz.
// Placówki często renderują listy jako wiersze:  | idx | lekarz N | umowa | KWOTA zł |.
// Parsujemy je czysto do tabeli `salaries` (bez nazwisk: indeks + typ umowy + kwota).
// Wiersze nagłówka i sum ("razem/ogółem") są odrzucane.
//
// Uruchom (po `fedrowanie pages`):  node examples/lekarze/salaries.mjs
import { openDb, tx } from '../../src/db.mjs';

const DB_PATH = process.env.FEDR_DB || './fedrowanie.db';
const now = () => new Date().toISOString();
const db = openDb(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS salaries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  case_pk        INTEGER,
  institution_pk INTEGER,
  row_index      INTEGER,   -- numer porządkowy z tabeli (jeśli jest)
  row_label      TEXT,      -- np. "lekarz 29"
  contract_type  TEXT,      -- etat | zlecenie | kontrakt | dzielo | null
  amount         REAL,      -- kwota (PLN)
  money_cells    INTEGER,   -- ile kwot było w wierszu (>1 → wielokolumnowy, do przeglądu)
  raw_row        TEXT,
  created_at     TEXT
);`);
db.exec('DELETE FROM salaries');

const CONTRACT = [
  [/umow\w*\s+o\s+prac|stosunek\s+pracy|na\s+etat|\betat\b|o\s+prac[eę]/i, 'etat'],
  [/cywilnoprawn|\bkontrakt|b2b|dzia[łl]alno[śs]|udzielani\w*\s+[śs]wiadcze/i, 'kontrakt'],
  [/zlece/i, 'zlecenie'],
  [/o\s+dzie[łl]o|\bdzie[łl]o\b/i, 'dzielo'],
];
const TOTAL = /razem|suma|ogó[łl]em|[łl][aą]cznie(?!\s*\d)|x{3,}/i;
const MONEY_CELL = /(?<![\d.,])\d{1,3}(?:[  .]\d{3})+(?:,\d{2})?|\d{2,7},\d{2}/;

function toNumber(tok) {
  let t = tok.replace(/[  ]/g, '');
  if (/,\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/\./g, '');
  return parseFloat(t);
}
const contractOf = (s) => { for (const [re, k] of CONTRACT) if (re.test(s)) return k; return null; };

const ins = db.prepare(`INSERT INTO salaries
  (case_pk,institution_pk,row_index,row_label,contract_type,amount,money_cells,raw_row,created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const pages = db.prepare(`SELECT p.case_pk, p.text, c.institution_pk
  FROM case_pages p JOIN cases c ON c.pk=p.case_pk`).all();

let n = 0; const cases = new Set();
tx(db, () => {
  for (const pg of pages) {
    for (const line of pg.text.split('\n')) {
      if ((line.match(/\|/g) || []).length < 2) continue; // musi wyglądać jak wiersz tabeli
      const cells = line.split('|').map((c) => c.trim())
        .filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
      const money = cells.filter((c) => MONEY_CELL.test(c))
        .map((c) => toNumber(c.match(MONEY_CELL)[0]))
        .filter((v) => Number.isFinite(v) && v >= 100 && v <= 5_000_000);
      if (!money.length) continue; // brak kwoty → nagłówek/inny wiersz
      const joined = cells.join(' ');
      if (TOTAL.test(joined) && !/lekarz/i.test(joined)) continue; // wiersz sumy
      let idx = null, label = null;
      const mLabel = joined.match(/lekarz\s*(?:nr\.?\s*)?(\d{1,4})/i);
      if (mLabel) { label = mLabel[0]; idx = +mLabel[1]; }
      if (idx == null) { const c0 = cells[0]?.match(/^(\d{1,4})\.?$/); if (c0) idx = +c0[1]; }
      ins.run(pg.case_pk, pg.institution_pk, idx, label, contractOf(joined),
        Math.max(...money), money.length, line.slice(0, 240), now());
      n++; cases.add(pg.case_pk);
    }
  }
});

// Rdzeń „czysty" = wiersze jednokolumnowe (jedna kwota w wierszu).
const pl = (x) => (x == null ? '—' : Math.round(x).toLocaleString('pl-PL'));
const clean = db.prepare('SELECT amount FROM salaries WHERE money_cells=1 ORDER BY amount').all().map((r) => r.amount);
const q = (p) => (clean.length ? clean[Math.floor((clean.length - 1) * p)] : null);
console.log('══ Wiersze per-lekarz ══');
console.log('  wierszy:', n, 'z', cases.size, 'placówek  ·  czyste (1 kwota):', clean.length);
console.log('  rozkład czystych: p50=%s  p90=%s  p99=%s  max=%s', pl(q(.5)), pl(q(.9)), pl(q(.99)), pl(q(1)));
console.log('  wg typu umowy (mediana / max / n):');
for (const r of db.prepare(`SELECT COALESCE(contract_type,'(brak)') t, COUNT(*) n, MAX(amount) mx
    FROM salaries WHERE money_cells=1 GROUP BY t ORDER BY n DESC`).all()) {
  const med = db.prepare(`SELECT amount a FROM salaries WHERE money_cells=1
    AND COALESCE(contract_type,'(brak)')=? ORDER BY amount LIMIT 1 OFFSET ?`)
    .get(r.t, Math.floor(r.n / 2));
  console.log(`    ${r.t.padEnd(12)} n=${String(r.n).padStart(4)}  med≈${pl(med?.a).padStart(9)}  max≈${pl(r.mx)}`);
}
db.close();
