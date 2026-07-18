import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pkFromUrl, numFromName, slugFromUrl, wojFromJst } from '../src/util.mjs';

test('pkFromUrl wyłuskuje id z URL-a API', () => {
  assert.equal(pkFromUrl('https://fedrowanie.siecobywatelska.pl/api/institutions/123/'), 123);
  assert.equal(pkFromUrl('/api/cases/4567/?format=json'), 4567);
  assert.equal(pkFromUrl(null), null);
  assert.equal(pkFromUrl('bez-liczby'), null);
});

test('numFromName czyta numer sprawy z nazwy', () => {
  assert.equal(numFromName('Ile zarabiają lekarze? #1356'), 1356);
  assert.equal(numFromName('Monitoring sądów apelacyjnych #4'), 4);
  assert.equal(numFromName('bez numeru'), null);
});

test('slugFromUrl czyta slug ze ścieżki sprawy', () => {
  assert.equal(slugFromUrl('https://x/sprawy/ile-zarabiaja-lekarze-1356'), 'ile-zarabiaja-lekarze-1356');
  assert.equal(slugFromUrl('/sprawy/monitoring-sadow-4?foo=1'), 'monitoring-sadow-4');
  assert.equal(slugFromUrl('/inne/123'), null);
});

test('wojFromJst mapuje prefiks TERYT na województwo', () => {
  assert.equal(wojFromJst('2403011'), 'Śląskie');      // prefiks 24
  assert.equal(wojFromJst('1465011'), 'Mazowieckie');  // prefiks 14
  assert.equal(wojFromJst('0201011'), 'Dolnośląskie'); // prefiks 02
  assert.equal(wojFromJst(null), null);
  assert.equal(wojFromJst('99'), null);                // nieznany prefiks
});
