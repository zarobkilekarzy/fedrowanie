import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, reclassify, letterCategory } from '../src/db.mjs';

test('letterCategory: ocena AI Federa ma pierwszeństwo', () => {
  assert.equal(letterCategory('A) email jest odpowiedzią z danymi', 'x'), 'A');
  assert.equal(letterCategory('B) odmowa udostępnienia', ''), 'B');
  assert.equal(letterCategory('G) nie można ustalić kategorii', ''), 'G');
  assert.equal(letterCategory('D) potwierdzenie doręczenia', ''), 'receipt'); // D = potwierdzenie
});

test('letterCategory: bez oceny AI — potwierdzenia po temacie, reszta to realna odpowiedź', () => {
  assert.equal(letterCategory(null, 'Przeczytane: Wniosek o udostępnienie'), 'receipt');
  assert.equal(letterCategory(null, 'Read: Wniosek'), 'receipt');
  assert.equal(letterCategory(null, 'Automatyczna odpowiedź'), 'receipt');
  assert.equal(letterCategory(null, 'decyzja odmowa SA Gdańsk'), 'other');
  assert.equal(letterCategory(null, 'rejestr umów'), 'other');
});

test('letterCategory: "Kategoryzacja AI pominięta" (wiadomość automatyczna) to potwierdzenie', () => {
  assert.equal(letterCategory('Kategoryzacja AI została pominięta dla listu z automatyczną odpowiedzią', ''), 'receipt');
});

// ── reclassify na bazie w pamięci ──────────────────────────────────────────
function seed() {
  const db = openDb(':memory:');
  let lp = 0;
  const addCase = (pk) => db.prepare('INSERT INTO cases (pk, monitoring) VALUES (?, 1)').run(pk);
  const addLetter = (casePk, isIncoming, ai, title) =>
    db.prepare('INSERT INTO letters (pk, case_pk, is_incoming, ai_evaluation, title) VALUES (?,?,?,?,?)')
      .run(++lp, casePk, isIncoming, ai, title);
  return { db, addCase, addLetter };
}
const cat = (db, pk) => {
  // node:sqlite zwraca wiersze z prototypem null — przepisz na zwykły obiekt do porównań.
  const x = db.prepare('SELECT answer_category k, response_received r FROM cases WHERE pk=?').get(pk);
  return { k: x.k, r: x.r };
};

test('reclassify: bierze najlepszą kategorię w sprawie (A > B)', () => {
  const { db, addCase, addLetter } = seed();
  addCase(1);
  addLetter(1, 1, 'B) odmowa', 'odmowa');
  addLetter(1, 1, 'A) odpowiedź z danymi', 'dane');
  reclassify(db);
  assert.deepEqual(cat(db, 1), { k: 'A', r: 1 });
});

test('reclassify: realna odpowiedź bez oceny AI (miks z potwierdzeniem) → other, odpowiedziało', () => {
  const { db, addCase, addLetter } = seed();
  addCase(2);
  addLetter(2, 1, null, 'Przeczytane: Wniosek');   // potwierdzenie
  addLetter(2, 1, null, 'decyzja SA Gdańsk');       // realna odpowiedź
  reclassify(db);
  assert.deepEqual(cat(db, 2), { k: 'other', r: 1 });
});

test('reclassify: same potwierdzenia → receipt, cisza', () => {
  const { db, addCase, addLetter } = seed();
  addCase(3);
  addLetter(3, 1, null, 'Read: Wniosek');
  addLetter(3, 1, 'D) potwierdzenie doręczenia', 'Doręczono');
  reclassify(db);
  assert.deepEqual(cat(db, 3), { k: 'receipt', r: 0 });
});

test('reclassify: brak listów przychodzących → none, cisza', () => {
  const { db, addCase, addLetter } = seed();
  addCase(4);
  addLetter(4, 0, null, 'Wniosek o udostępnienie'); // tylko wychodzący
  reclassify(db);
  assert.deepEqual(cat(db, 4), { k: 'none', r: 0 });
});
