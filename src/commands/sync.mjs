// Komenda `sync` — synchronizacja metadanych monitoringu z API Federa do SQLite:
// sprawy + instytucje + listy + metadane załączników, na końcu klasyfikacja spraw.
//
// Idempotentna i inkrementalna: ponowny bieg dociąga tylko sprawy zmienione od ostatniego
// razu (po case.modified). Bezpieczna do cyklicznego uruchamiania.
import { openDb, tx, setMeta, reclassify } from '../db.mjs';
import { getJSON, mapLimit } from '../api.mjs';
import { pkFromUrl, numFromName, slugFromUrl, wojFromJst } from '../util.mjs';

const now = () => new Date().toISOString();
const bar = (label) => (done, total) => process.stdout.write(`\r  ${label} ${done}/${total}`);

export async function run({ dbPath, monitoring, concurrency = 5 }) {
  if (!Number.isInteger(monitoring)) {
    throw new Error('Podaj numer monitoringu, np. `fedrowanie sync 161`.');
  }
  const db = openDb(dbPath);

  // ── A. Wszystkie sprawy monitoringu (paginacja po 100) ────────────────────
  console.log('› Pobieram listę spraw monitoringu %d …', monitoring);
  const cases = [];
  let url = `/api/cases/?format=json&monitoring=${monitoring}&page=1`;
  while (url) {
    const page = await getJSON(url);
    cases.push(...page.results);
    url = page.next;
    process.stdout.write(`\r  zebrano ${cases.length}/${page.count} spraw`);
  }
  console.log('\n  łącznie spraw:', cases.length);
  if (!cases.length) {
    console.log('  (monitoring pusty lub nieistniejący — sprawdź numer)');
    db.close();
    return;
  }

  const upCase = db.prepare(`
    INSERT INTO cases (pk, monitoring, number, slug, name, institution_pk, created, modified)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(pk) DO UPDATE SET
      monitoring=excluded.monitoring, number=excluded.number, slug=excluded.slug,
      name=excluded.name, institution_pk=excluded.institution_pk,
      created=excluded.created, modified=excluded.modified`);
  tx(db, () => {
    for (const c of cases) {
      upCase.run(c.pk, monitoring, numFromName(c.name), slugFromUrl(c.url), c.name,
        pkFromUrl(c.institution), c.created, c.modified);
    }
  });

  // ── B. Instytucje (dedup; pobieramy tylko brakujące) ──────────────────────
  const instPks = [...new Set(cases.map((c) => pkFromUrl(c.institution)).filter(Boolean))];
  const known = new Set(db.prepare('SELECT pk FROM institutions').all().map((r) => r.pk));
  const toFetch = instPks.filter((pk) => !known.has(pk));
  console.log('› Instytucje: %d unikalnych, %d do pobrania …', instPks.length, toFetch.length);

  const upInst = db.prepare(`
    INSERT INTO institutions (pk,name,slug,regon,nip,jst_id,voivodeship,kind,tags,email,city,raw,fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(pk) DO UPDATE SET
      name=excluded.name, regon=excluded.regon, nip=excluded.nip, jst_id=excluded.jst_id,
      voivodeship=excluded.voivodeship, kind=excluded.kind, tags=excluded.tags,
      email=excluded.email, city=excluded.city, raw=excluded.raw, fetched_at=excluded.fetched_at`);

  const instWriters = await mapLimit(toFetch, concurrency, async (pk) => {
    const o = await getJSON(`/api/institutions/${pk}/?format=json`);
    const reg = o.extra?.regon || {};
    const kind = Array.isArray(o.tags) && o.tags.length ? String(o.tags[0]).split('/')[0] : null;
    return () => upInst.run(
      o.pk, o.name, o.slug ?? null, o.regon ?? null, reg.nip ?? null, o.jst ?? null,
      wojFromJst(o.jst), kind, JSON.stringify(o.tags ?? []),
      o.email ?? reg.adsiedzemail ?? null, reg.adsiedzmiejscowosc_nazwa ?? null,
      JSON.stringify(o), now());
  }, toFetch.length ? bar('instytucje') : null);
  tx(db, () => instWriters.forEach((w) => w && w()));
  if (toFetch.length) console.log('');

  // ── C. Listy (records) per sprawa — tylko nowe/zmienione ──────────────────
  const needSync = db.prepare(`
    SELECT pk, modified FROM cases
    WHERE monitoring = ? AND (letters_synced_mod IS NULL OR letters_synced_mod <> modified)`)
    .all(monitoring);
  console.log('› Listy: %d spraw do (re)synchronizacji …', needSync.length);

  const upLetter = db.prepare(`
    INSERT INTO letters
      (pk,record_pk,case_pk,title,body,email,author_institution_pk,is_incoming,is_outgoing,
       is_spam,email_delivery_status,ai_evaluation,created,modified,eml_url,has_attachments,fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(pk) DO UPDATE SET
      record_pk=excluded.record_pk, title=excluded.title, body=excluded.body, email=excluded.email,
      author_institution_pk=excluded.author_institution_pk, is_incoming=excluded.is_incoming,
      is_outgoing=excluded.is_outgoing, is_spam=excluded.is_spam,
      email_delivery_status=excluded.email_delivery_status, ai_evaluation=excluded.ai_evaluation,
      created=excluded.created, modified=excluded.modified, eml_url=excluded.eml_url,
      has_attachments=excluded.has_attachments, fetched_at=excluded.fetched_at`);
  const insAtt = db.prepare(`INSERT INTO attachments (letter_pk,case_pk,url,filename,ext)
    VALUES (?,?,?,?,?) ON CONFLICT(url) DO NOTHING`);
  const updCaseAgg = db.prepare(`UPDATE cases SET
    letter_count=?, last_letter=?, response_received=?, application_status=?,
    letters_synced_mod=?, letters_synced_at=? WHERE pk=?`);

  const letterWriters = await mapLimit(needSync, concurrency, async (row) => {
    const casePk = row.pk;
    let u = `/api/records/?format=json&case=${casePk}`;
    const records = [];
    while (u) { const p = await getJSON(u); records.push(...p.results); u = p.next; }

    const letters = records
      .filter((r) => r.content_type === 'letter' && r.content_object)
      .map((r) => ({ record_pk: r.pk, co: r.content_object }));

    let lastLetter = null, respRecv = 0, appStatus = null;
    const outgoing = letters.filter((l) => l.co.is_outgoing);
    const incoming = letters.filter((l) => l.co.is_incoming && !l.co.is_spam && !l.co.is_draft);
    if (incoming.length) respRecv = 1;
    if (outgoing.length) appStatus = outgoing[0].co.email_delivery_status ?? null;
    for (const l of letters) if (!lastLetter || l.co.created > lastLetter) lastLetter = l.co.created;

    return () => {
      for (const { record_pk, co } of letters) {
        const eml = co.eml || '';
        const letterPk = pkFromUrl(eml) || Number(String(eml).match(/\/listy\/(\d+)-msg/)?.[1]) || record_pk;
        const atts = Array.isArray(co.attachments) ? co.attachments : [];
        upLetter.run(
          letterPk, record_pk, casePk, co.title ?? null, co.body ?? null, co.email ?? null,
          pkFromUrl(co.author_institution), co.is_incoming ? 1 : 0, co.is_outgoing ? 1 : 0,
          co.is_spam ? 1 : 0, co.email_delivery_status ?? null, co.ai_evaluation ?? null,
          co.created ?? null, co.modified ?? null, eml || null, atts.length ? 1 : 0, now());
        for (const a of atts) {
          const ext = (a.filename?.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
          insAtt.run(letterPk, casePk, a.url, a.filename ?? null, ext);
        }
      }
      updCaseAgg.run(letters.length, lastLetter, respRecv, appStatus, row.modified, now(), casePk);
    };
  }, needSync.length ? bar('listy') : null);
  tx(db, () => letterWriters.forEach((w) => w && w()));
  if (needSync.length) console.log('');

  // ── D. Klasyfikacja spraw po ai_evaluation ────────────────────────────────
  console.log('› Klasyfikuję sprawy …');
  reclassify(db);
  setMeta(db, `last_sync:${monitoring}`, now());

  summary(db, monitoring);
  db.close();
}

function summary(db, monitoring) {
  const n = (q, ...a) => db.prepare(q).get(...a).n;
  const inMon = 'FROM cases WHERE monitoring = ?';
  console.log('\n══ Podsumowanie (monitoring %d) ══', monitoring);
  console.log('  sprawy:         ', n(`SELECT COUNT(*) n ${inMon}`, monitoring));
  console.log('  odpowiedziało:  ', n(`SELECT COUNT(*) n ${inMon} AND response_received=1`, monitoring),
              '/', n(`SELECT COUNT(*) n ${inMon}`, monitoring));
  console.log('  instytucje:     ', n('SELECT COUNT(*) n FROM institutions'));
  console.log('  listy:          ', n('SELECT COUNT(*) n FROM letters'));
  console.log('  załączniki (PDF):', n("SELECT COUNT(*) n FROM attachments WHERE ext='pdf'"));
}
