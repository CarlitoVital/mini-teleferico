// Auswertung von Umgebungsvariablen für den Serverstart.
import net from 'node:net';

const OFF = new Set(['', '0', 'false', 'no', 'off', 'nein']);
const ONE = new Set(['true', 'yes', 'on', 'ja']);
const NAMED = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isTrustEntry(entry) {
  if (NAMED.has(entry)) return true;
  const [addr, bits, rest] = entry.split('/');
  if (rest !== undefined) return false;
  const family = net.isIP(addr);
  if (!family) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (family === 4 ? 32 : 128);
}

/**
 * TRUST_PROXY → Express-Einstellung „trust proxy“.
 * Aus: leer, 0, false, no, off. Ein Proxy: true, yes, on (bewusst nicht „allen vertrauen“,
 * sonst wäre X-Forwarded-For fälschbar). Zahl n: n Proxys. Sonst kommagetrennte IPs/CIDR-Bereiche
 * oder loopback, linklocal, uniquelocal. Alles andere ist ein Fehler.
 */
export function parseTrustProxy(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim().toLowerCase();
  if (OFF.has(v)) return false;
  if (ONE.has(v)) return 1;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (Number.isSafeInteger(n)) return n;
  }
  const entries = v.split(',').map((s) => s.trim());
  if (entries.every((e) => e && isTrustEntry(e))) return entries.join(', ');
  throw new Error(
    `Ungültiger Wert für TRUST_PROXY: „${raw}“. Erlaubt sind 0/1, true/false, eine Anzahl von Proxys ` +
      'oder eine kommagetrennte Liste von IP-Adressen/CIDR-Bereichen (z. B. „loopback, 10.0.0.0/8“).',
  );
}
