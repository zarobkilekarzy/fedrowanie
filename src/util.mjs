// Drobne, czyste funkcje pomocnicze: parsowanie identyfikatorów z URL-i Federa
// oraz mapowanie kodu TERYT gminy na województwo.

// API zwraca powiązania jako URL-e (np. ".../api/institutions/123/"). Wyłuskujemy pk.
export const pkFromUrl = (u) => {
  const m = String(u ?? '').match(/\/(\d+)\/?(?:\?|$)/);
  return m ? Number(m[1]) : null;
};

// Numer sprawy z jej nazwy ("… #1356" → 1356).
export const numFromName = (n) => {
  const m = String(n ?? '').match(/#(\d+)/);
  return m ? Number(m[1]) : null;
};

// Slug sprawy z URL-a strony publicznej (".../sprawy/<slug>").
export const slugFromUrl = (u) => {
  const m = String(u ?? '').match(/\/sprawy\/([^/?]+)/);
  return m ? m[1] : null;
};

// TERYT: 2-cyfrowy prefiks kodu gminy → nazwa województwa.
export const TERYT_WOJ = {
  '02': 'Dolnośląskie',   '04': 'Kujawsko-Pomorskie', '06': 'Lubelskie',        '08': 'Lubuskie',
  '10': 'Łódzkie',        '12': 'Małopolskie',        '14': 'Mazowieckie',      '16': 'Opolskie',
  '18': 'Podkarpackie',   '20': 'Podlaskie',          '22': 'Pomorskie',        '24': 'Śląskie',
  '26': 'Świętokrzyskie', '28': 'Warmińsko-Mazurskie','30': 'Wielkopolskie',    '32': 'Zachodniopomorskie',
};
export const wojFromJst = (jst) =>
  TERYT_WOJ[String(jst ?? '').padStart(7, '0').slice(0, 2)] || null;
