// PRZYKŁAD (domenowy, nie część rdzenia) — heurystyczne wyłuskanie kwot z tekstu stron
// spraw do tabeli `figures`. To surowiec roboczy o niepełnej precyzji: służy do agregatów
// i typowania kandydatów do RĘCZNEJ weryfikacji przy źródle, nie do publikacji wprost.
//
// Uruchom (po `fedrowanie sync … && fedrowanie pages`):  node examples/lekarze/figures.mjs
import { openDb, tx } from '../../src/db.mjs';

const DB_PATH = process.env.FEDR_DB || './fedrowanie.db';
const now = () => new Date().toISOString();
const db = openDb(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS figures (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  case_pk        INTEGER,
  institution_pk INTEGER,
  amount         REAL,   -- znormalizowana kwota (PLN)
  amount_raw     TEXT,
  period         TEXT,   -- 'godz' | 'mies' | 'rok' | null (heurystyka)
  context        TEXT,   -- fragment linii źródłowej
  created_at     TEXT
);`);

// Token pieniężny: tysiące grupowane spacją/kropką LUB część groszowa ",dd".
const MONEY = /(?<![\d.,])(\d{1,3}(?:[  .]\d{3})+(?:,\d{2})?|\d{2,7},\d{2})(?![\d])/g;
// Linie-śmieci (dane teleadresowe/prawne/identyfikatory) — pomijamy z nich liczby.
const NOISE_LINE = /\b(tel\.?|faks|fax|KRS|NIP|REGON|RODO|ePUAP|kod pocztow|art\.\s*\d|ust\.\s*\d|poz\.\s*\d|Dz\.\s*U|§|nr\s+rachunku|IBAN|PWZ|ul\.\s)/i;
// Konteksty NIE-płacowe: kapitał spółki, wartość kontraktu/zamówienia, przychody, budżet.
const NEG_CTX = /kapitał|zakładow|wpłacon|\bBDO\b|obrot|przychod|przychód|dochód spółk|wartość (umow|zamówie|kontrakt)|budżet|suma bilansow|aktyw[ao]|zobowiązan/i;
const SALARY_KW = /wynagrodz|wypłac|brutto|netto|łączn|pobor|uposaż|pensj|honorar|stawk|za godz|umow o prac|kontrakt/i;
const SALARY_MAX = 5_000_000; // powyżej — niemal na pewno suma/kapitał/kontrakt, nie płaca

function toNumber(tok) {
  let t = tok.replace(/[  ]/g, '');
  if (/,\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56 → 1234.56
  else t = t.replace(/\./g, '');                                    // 48.000 → 48000
  return parseFloat(t);
}
const period = (c) =>
  /godzin|\/godz|za godz|stawk[aę] godz/i.test(c) ? 'godz'
  : /miesi[ęe]czn|\/mies|za miesiąc|mies\.?\b/i.test(c) ? 'mies'
  : /roczn|w roku|za rok|rok 20\d\d|20\d\d r|w 20\d\d/i.test(c) ? 'rok' : null;

db.exec('DELETE FROM figures');
const ins = db.prepare(`INSERT INTO figures (case_pk,institution_pk,amount,amount_raw,period,context,created_at)
  VALUES (?,?,?,?,?,?,?)`);
const pages = db.prepare(`SELECT p.case_pk, p.text, c.institution_pk
  FROM case_pages p JOIN cases c ON c.pk=p.case_pk`).all();

let nFig = 0, nCases = 0;
tx(db, () => {
  for (const pg of pages) {
    const lines = pg.text.split('\n');
    let hit = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (NOISE_LINE.test(line)) continue;
      const ctx = (lines[i - 1] || '') + ' | ' + line + ' | ' + (lines[i + 1] || '');
      if (NEG_CTX.test(ctx)) continue;
      let m; MONEY.lastIndex = 0;
      while ((m = MONEY.exec(line))) {
        const raw = m[1], val = toNumber(raw);
        if (!Number.isFinite(val) || val < 100 || val > SALARY_MAX) continue;
        // wymagaj kontekstu płacowego LUB groszy (typowych dla płac)
        if (!(SALARY_KW.test(ctx) || /,\d{2}$/.test(raw))) continue;
        ins.run(pg.case_pk, pg.institution_pk, val, raw, period(ctx), line.slice(0, 200), now());
        nFig++; hit = true;
      }
    }
    if (hit) nCases++;
  }
});

const vals = db.prepare('SELECT amount FROM figures ORDER BY amount').all().map((r) => r.amount);
const q = (p) => (vals.length ? vals[Math.floor((vals.length - 1) * p)] : 0);
const pl = (n) => Math.round(n).toLocaleString('pl-PL');
console.log('══ Wyłuskane kwoty (surowiec do weryfikacji) ══');
console.log('  figures:           ', nFig, 'z', nCases, 'spraw');
console.log('  rozkład (PLN):  p50=%s  p90=%s  p99=%s  max=%s', pl(q(.5)), pl(q(.9)), pl(q(.99)), pl(q(1)));
db.close();
