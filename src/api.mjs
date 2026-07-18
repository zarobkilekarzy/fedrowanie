// Klient publicznego REST API Federa (silnik monitoringów Sieci Obywatelskiej Watchdog).
// Wyłącznie odczyt zasobów publicznych, z rozsądnym backoffem i limitem współbieżności.
import pkg from '../package.json' with { type: 'json' };

export const BASE = process.env.FEDR_BASE || 'https://fedrowanie.siecobywatelska.pl';

// User-Agent identyfikuje klienta wobec serwera (dobra praktyka crawlera). Nadpisywalny.
export const UA = process.env.FEDR_UA ||
  `fedrowanie/${pkg.version} (+https://github.com/zarobkilekarzy/fedrowanie)`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET JSON z ponawianiem tylko błędów przejściowych (429 / 5xx / sieć). Backoff wykładniczy.
export async function getJSON(url, { retries = 4 } = {}) {
  const full = url.startsWith('http') ? url : BASE + url;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(full, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' (nie ponawiam)');
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (String(e.message).includes('nie ponawiam')) throw e;
      await sleep(800 * 2 ** i); // 0,8s → 1,6s → 3,2s → 6,4s …
    }
  }
  throw lastErr;
}

// GET surowego HTML (strony spraw renderują treść i OCR, którego nie ma w API JSON).
export async function getText(url, { retries = 3 } = {}) {
  const full = url.startsWith('http') ? url : BASE + url;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(full, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) return null; // 403/404 — sprawa bez publicznej strony; nie ponawiamy
      return await res.text();
    } catch { await sleep(800 * 2 ** i); }
  }
  return null;
}

// Prosty limiter współbieżności z opcjonalnym callbackiem postępu.
export async function mapLimit(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let idx = 0, done = 0;
  const worker = async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
      if (onProgress) onProgress(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
