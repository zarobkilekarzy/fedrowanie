import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, htmlToText } from '../src/html.mjs';

test('decodeEntities dekoduje encje nazwane, dziesiętne i szesnastkowe', () => {
  assert.equal(decodeEntities('&oacute;&lstrok;&aogon;czne'), 'ółączne');
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
  assert.equal(decodeEntities('Kowalski &amp; syn'), 'Kowalski & syn');
});

test('htmlToText wyciąga treść z iframe srcdoc (tam Feder renderuje OCR)', () => {
  const html = `<div class="content">
    <h2>Odpowiedź</h2>
    <iframe srcdoc="&lt;p&gt;Lekarz 1 &amp;ndash; 250&amp;nbsp;000 z&amp;lstrok;&lt;/p&gt;"></iframe>
    <div class="footer">stopka — pomiń</div>`;
  const t = htmlToText(html);
  assert.match(t, /Lekarz 1 – 250 000 zł/);
  assert.doesNotMatch(t, /stopka/);      // treść za class="footer" ucięta
  assert.doesNotMatch(t, /^class=/);     // brak resztki otwierającego tagu
});

test('htmlToText usuwa skrypty i style, bloki dają nowe linie', () => {
  const html = `<div class="content"><script>evil()</script><p>Pierwszy</p><p>Drugi</p></div>`;
  const t = htmlToText(html);
  assert.doesNotMatch(t, /evil/);
  assert.deepEqual(t.split('\n'), ['Pierwszy', 'Drugi']);
});
