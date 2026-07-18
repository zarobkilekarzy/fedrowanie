#!/usr/bin/env node
// fedrowanie — CLI do pobierania monitoringów Sieci Obywatelskiej Watchdog (Feder) do SQLite.
//
// node:sqlite jest stabilny od Node 24; na Node 22 wymaga flagi --experimental-sqlite.
// Poniższy strażnik wykrywa jej brak i jednorazowo przeuruchamia proces z flagą — dzięki
// temu użytkownik nigdy nie musi jej podawać ręcznie.
try {
  await import('node:sqlite');
} catch (e) {
  if (!process.env.__FEDR_REEXEC) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['--experimental-sqlite', ...process.argv.slice(1)],
      { stdio: 'inherit', env: { ...process.env, __FEDR_REEXEC: '1' } });
    process.exit(r.status ?? 1);
  }
  console.error('Ten program wymaga Node ≥ 22 z modułem node:sqlite.\n' + e.message);
  process.exit(1);
}

const HELP = `fedrowanie — pobiera monitoringi Sieci Obywatelskiej Watchdog (Feder) do bazy SQLite.

Użycie:
  fedrowanie list [fraza]        Wypisz dostępne monitoringi (opcjonalnie filtruj po nazwie)
  fedrowanie sync <monitoring>   Pobierz sprawy, instytucje i listy monitoringu (inkrementalnie)
  fedrowanie pages               Pobierz teksty stron spraw (treść + OCR załączników)
  fedrowanie stats               Pokaż lejek odpowiedzi, geografię i skalę wysiłku

Opcje:
  -d, --db <ścieżka>        Plik bazy SQLite (domyślnie: ./fedrowanie.db, env FEDR_DB)
  -m, --monitoring <id>     Zawęź pages/stats do jednego monitoringu
  -c, --concurrency <n>     Liczba równoległych żądań (sync: 5, pages: 4)
  -h, --help                Ta pomoc
  -v, --version             Wersja

Typowa kolejność:  fedrowanie sync 161  →  fedrowanie pages  →  fedrowanie stats
Analizy domenowe (np. wyłuskiwanie kwot): patrz examples/.

Zmienne środowiskowe: FEDR_DB, FEDR_BASE (adres API), FEDR_UA (User-Agent).`;

// ── Mały parser argumentów (bez zależności) ─────────────────────────────────
const argv = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const take = () => argv[++i];
  if (a === '-h' || a === '--help') opts.help = true;
  else if (a === '-v' || a === '--version') opts.version = true;
  else if (a === '-d' || a === '--db') opts.dbPath = take();
  else if (a === '-m' || a === '--monitoring') opts.monitoring = Number(take());
  else if (a === '-c' || a === '--concurrency') opts.concurrency = Number(take());
  else if (a.startsWith('-')) { console.error('Nieznana opcja:', a); process.exit(2); }
  else positional.push(a);
}

if (opts.version) {
  const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
  console.log(pkg.version);
  process.exit(0);
}

const command = positional.shift();
if (opts.help || !command) { console.log(HELP); process.exit(command ? 0 : (opts.help ? 0 : 1)); }

const COMMANDS = { list: 'list', sync: 'sync', pages: 'pages', stats: 'stats' };
if (!COMMANDS[command]) { console.error('Nieznana komenda:', command, '\n\n' + HELP); process.exit(2); }

opts.dbPath ??= process.env.FEDR_DB || './fedrowanie.db';
if (command === 'list') opts.filter = positional[0];
if (command === 'sync' && opts.monitoring == null && positional[0] != null) {
  opts.monitoring = Number(positional[0]);
}

try {
  const mod = await import(`../src/commands/${COMMANDS[command]}.mjs`);
  await mod.run(opts);
} catch (e) {
  console.error('\n✗', e.message);
  process.exit(1);
}
