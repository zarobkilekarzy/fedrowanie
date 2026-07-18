// HTML strony sprawy → czysty tekst.
//
// Kluczowy szczegół: treść listów i OCR załączników Feder renderuje w <iframe srcdoc="…">
// (zaescapowany HTML wewnątrz atrybutu). Bez wyciągnięcia i zdekodowania srcdoc traci się
// najważniejsze dane. Poniżej: dekoder encji + spłaszczanie fragmentów + składanie strony.

const NAMED = {
  oacute:'ó',Oacute:'Ó',aogon:'ą',Aogon:'Ą',eogon:'ę',Eogon:'Ę',lstrok:'ł',Lstrok:'Ł',
  nacute:'ń',Nacute:'Ń',sacute:'ś',Sacute:'Ś',cacute:'ć',Cacute:'Ć',zacute:'ź',Zacute:'Ź',
  zdot:'ż',Zdot:'Ż',ndash:'–',mdash:'—',hellip:'…',bdquo:'„',rdquo:'”',laquo:'«',raquo:'»',
  nbsp:' ',quot:'"',apos:"'",lt:'<',gt:'>',
};

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in NAMED ? NAMED[name] : m))
    .replace(/&amp;/g, '&'); // na końcu, by nie dekodować podwójnie
}

// Fragment HTML → tekst: bloki i <br> stają się nowymi liniami, reszta tagów znika.
function fragToText(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|td|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

export function htmlToText(html) {
  let s = html;
  const ci = s.indexOf('class="content"'); if (ci > 0) s = s.slice(ci);
  const fi = s.indexOf('class="footer"');  if (fi > 0) s = s.slice(0, fi);
  const parts = [];
  // 1) treść w iframe srcdoc (e-maile + OCR załączników),
  for (const m of s.matchAll(/srcdoc="([^"]*)"/gi)) parts.push(fragToText(decodeEntities(m[1])));
  // 2) widoczna treść poza iframe (bez ponownego łapania iframe).
  parts.push(fragToText(s.replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')));
  return decodeEntities(parts.join('\n'))
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n');
}
