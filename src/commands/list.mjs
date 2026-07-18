// Komenda `list` — wypisuje dostępne monitoringi Federa (numer + nazwa), żeby nie trzeba
// było szukać numeru w interfejsie web. Opcjonalny argument filtruje po fragmencie nazwy.
import { getJSON } from '../api.mjs';

export async function run({ filter }) {
  const rows = [];
  let url = '/api/monitorings/?format=json&page=1';
  while (url) {
    const page = await getJSON(url);
    rows.push(...(page.results || []));
    url = page.next;
  }

  let items = rows
    .filter((m) => m.pk != null && m.name)
    .sort((a, b) => a.pk - b.pk);
  if (filter) {
    const q = filter.toLowerCase();
    items = items.filter((m) => m.name.toLowerCase().includes(q));
  }

  if (!items.length) {
    console.log(filter ? `Brak monitoringów pasujących do „${filter}".` : 'Brak monitoringów.');
    return;
  }
  const w = String(Math.max(...items.map((m) => m.pk))).length;
  for (const m of items) console.log(`${String(m.pk).padStart(w)}  ${m.name}`);
  console.log(`\n${items.length}${filter ? ` (z ${rows.length})` : ''} monitoringów. ` +
              'Pobierz wybrany: fedrowanie sync <numer>');
}
