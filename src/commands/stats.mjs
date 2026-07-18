// Komenda `stats` — przegląd jawności monitoringu: lejek odpowiedzi, geografia milczenia,
// skala wysiłku. Czyta wyłącznie ogólne metadane Federa (bez treści domenowych) — działa
// dla dowolnego monitoringu. Analizy specyficzne (np. kwoty) buduje się osobno; patrz
// `examples/lekarze`.
import { openDb, getMeta } from '../db.mjs';

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0') + '%';
const H = (t) => console.log('\n' + '─'.repeat(64) + '\n  ' + t + '\n' + '─'.repeat(64));

export function run({ dbPath, monitoring }) {
  const db = openDb(dbPath);
  const where = Number.isInteger(monitoring) ? 'WHERE c.monitoring = ?' : '';
  const p = Number.isInteger(monitoring) ? [monitoring] : [];
  const one = (q, ...a) => db.prepare(q).get(...a);
  const all = (q, ...a) => db.prepare(q).all(...a);

  const TOT = one(`SELECT COUNT(*) n FROM cases c ${where}`, ...p).n;
  if (!TOT) {
    console.log('Baza jest pusta dla podanego zakresu — najpierw `fedrowanie sync <monitoring>`.');
    db.close();
    return;
  }
  const last = getMeta(db, Number.isInteger(monitoring) ? `last_sync:${monitoring}` : 'last_sync:*');
  console.log('Baza:', dbPath, last ? `· ostatni sync: ${last}` : '');

  // ── 1. Lejek odpowiedzi ────────────────────────────────────────────────────
  H('1. JAWNOŚĆ — czy instytucje w ogóle odpowiadają');
  const cat = Object.fromEntries(
    all(`SELECT answer_category k, COUNT(*) n FROM cases c ${where} GROUP BY answer_category`, ...p)
      .map((r) => [r.k, r.n]));
  const resp = one(`SELECT COUNT(*) n FROM cases c ${where} ${where ? 'AND' : 'WHERE'} response_received=1`, ...p).n;
  const silent = (cat.none || 0) + (cat.receipt || 0);
  const LAB = [
    ['A', 'odpowiedź z danymi'], ['B', 'WPROST ODMÓWIŁO'],
    ['C', 'inna odpowiedź (np. gra na czas)'], ['E', 'odesłanie do innej instytucji'],
    ['G', 'nieustalona'],
  ];
  console.log(`  wniosków:                       ${String(TOT).padStart(5)}`);
  console.log(`  cisza (brak merytorycznej odp.):${String(silent).padStart(5)}  (${pct(silent, TOT)})`);
  console.log(`  odpowiedź merytoryczna:         ${String(resp).padStart(5)}  (${pct(resp, TOT)})`);
  for (const [k, desc] of LAB)
    console.log(`    ├ ${desc.padEnd(32)} ${String(cat[k] || 0).padStart(4)}  (${pct(cat[k] || 0, TOT)})`);
  console.log(`  → wśród odpowiadających odmowa (B) to ${pct(cat.B || 0, resp)}`);

  // ── 2. Geografia ───────────────────────────────────────────────────────────
  H('2. GEOGRAFIA — gdzie mur milczenia najwyższy (min. 15 wniosków)');
  console.log('  województwo            wysł.  cisza%  odmowa   dane');
  for (const r of all(`
    SELECT i.voivodeship w, COUNT(*) wys,
      SUM(c.response_received=0) cisza, SUM(c.answer_category='B') odm, SUM(c.answer_category='A') dane
    FROM cases c JOIN institutions i ON i.pk=c.institution_pk
    ${where} ${where ? 'AND' : 'WHERE'} i.voivodeship IS NOT NULL
    GROUP BY i.voivodeship HAVING wys>=15 ORDER BY 1.0*cisza/wys DESC`, ...p))
    console.log(`  ${r.w.padEnd(22)} ${String(r.wys).padStart(4)}   ${pct(r.cisza, r.wys).padStart(5)}   ` +
                `${String(r.odm).padStart(4)}   ${String(r.dane).padStart(4)}`);

  // ── 3. Wysiłek ─────────────────────────────────────────────────────────────
  H('3. WYSIŁEK — ile trzeba było naciskać');
  const casePks = all(`SELECT c.pk FROM cases c ${where}`, ...p).map((r) => r.pk);
  const inCases = `case_pk IN (${casePks.join(',')})`;
  console.log(`  listów łącznie:                     ${one(`SELECT COUNT(*) n FROM letters WHERE ${inCases}`).n}`);
  console.log(`  wnioski z ponagleniami (2+ wych.):  ${one(`SELECT COUNT(*) n FROM (SELECT case_pk FROM letters WHERE ${inCases} AND is_outgoing=1 GROUP BY case_pk HAVING COUNT(*)>=2)`).n}`);
  console.log(`  sprawy z żądaniem opłaty:           ${one(`SELECT COUNT(DISTINCT case_pk) n FROM case_pages WHERE ${inCases} AND (text LIKE '%opłat%' OR text LIKE '%koszt udostęp%')`).n}`);

  db.close();
}
