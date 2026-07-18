// Komenda `pages` — pobiera publiczne strony spraw merytorycznych i zapisuje z nich
// czysty tekst (wniosek + treść odpowiedzi + OCR załączników renderowany przez Feder).
//
// Dlaczego nie z API: binarne załączniki bywają za logowaniem (403), ale Feder pokazuje
// ich tekst po własnym OCR na publicznej stronie sprawy — stąd bierzemy dane.
//
// Idempotentna i inkrementalna: pobiera tylko strony nowe lub zmienione (po case.modified).
import { openDb, tx } from '../db.mjs';
import { getText, mapLimit, sleep } from '../api.mjs';
import { htmlToText } from '../html.mjs';

const now = () => new Date().toISOString();

export async function run({ dbPath, monitoring, concurrency = 4 }) {
  const db = openDb(dbPath);

  // Strony pobieramy dla spraw, w których przyszła odpowiedź (jest co czytać). Kryterium
  // response_received jest uniwersalne — obejmuje też odpowiedzi bez oceny AI (kat. 'other').
  const monFilter = Number.isInteger(monitoring) ? 'AND c.monitoring = ?' : '';
  const params = Number.isInteger(monitoring) ? [monitoring] : [];
  const targets = db.prepare(`
    SELECT c.pk, c.slug, c.modified
    FROM cases c
    LEFT JOIN case_pages p ON p.case_pk = c.pk
    WHERE c.response_received = 1 ${monFilter}
      AND (p.case_pk IS NULL OR p.case_modified IS NOT c.modified)`).all(...params);
  console.log('› Strony spraw do pobrania: %d (sprawy z odpowiedzią)', targets.length);
  if (!targets.length) { db.close(); return; }

  const up = db.prepare(`INSERT INTO case_pages (case_pk,text,chars,case_modified,fetched_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(case_pk) DO UPDATE SET
      text=excluded.text, chars=excluded.chars,
      case_modified=excluded.case_modified, fetched_at=excluded.fetched_at`);

  const results = await mapLimit(targets, concurrency, async (t) => {
    const html = await getText(`/sprawy/${t.slug}`);
    await sleep(120); // drobna kurtuazja wobec serwera między żądaniami
    if (!html) return null;
    const text = htmlToText(html);
    return { pk: t.pk, text, chars: text.length, mod: t.modified };
  }, (d, tt) => process.stdout.write(`\r  ${d}/${tt}`));
  console.log('');

  let saved = 0, thin = 0;
  tx(db, () => {
    for (const r of results) if (r) { up.run(r.pk, r.text, r.chars, r.mod, now()); saved++; if (r.chars < 200) thin++; }
  });

  console.log('══ Strony spraw ══');
  console.log('  zapisane w tym biegu:', saved);
  console.log('  łącznie w bazie:     ', db.prepare('SELECT COUNT(*) n FROM case_pages').get().n);
  // Sygnał kruchości: `pages` opiera się na strukturze HTML Federa. Gdy prawie nic nie
  // wyszło, to zwykle znak, że strona się zmieniła (a nie że spraw brak treści).
  if (saved > 0 && thin / saved > 0.5) {
    console.log(`\n⚠ ${thin}/${saved} stron ma <200 znaków — możliwe, że HTML Federa się zmienił`);
    console.log('  (patrz src/html.mjs: znacznik "class=content" / iframe srcdoc).');
  }
  db.close();
}
