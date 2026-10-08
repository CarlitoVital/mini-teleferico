// Startet den Teleférico-Server (API + Frontend).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { parseTrustProxy } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function readPort(raw) {
  if (raw === undefined || raw === '') return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Ungültiger PORT: ${raw}`);
    process.exit(1);
  }
  return port;
}

const port = readPort(process.env.PORT);

// TRUST_PROXY=1: hinter genau einem Reverse-Proxy (für korrekte Client-IP beim Rate-Limit)
let trustProxy;
try {
  trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const dbPath = path.resolve(process.env.TELEFERICO_DB || path.join(here, 'data', 'teleferico.db'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const { app, close } = createApp({
  dbPath,
  cookieSecure: process.env.COOKIE_SECURE === '1',
  trustProxy,
});

const server = app.listen(port, (err) => {
  if (err) {
    console.error(`Server konnte nicht starten: ${err.message}`);
    close();
    process.exit(1);
  }
  const proxy = trustProxy === false ? '' : `, TRUST_PROXY: ${trustProxy}`;
  console.log(`Teleférico läuft auf http://localhost:${server.address().port} (Datenbank: ${dbPath}${proxy})`);
});

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} empfangen – Server wird beendet …`);
  // Notbremse, falls Verbindungen hängen bleiben
  setTimeout(() => {
    close();
    process.exit(1);
  }, 5000).unref();
  server.close(() => {
    close();
    process.exit(0);
  });
  server.closeIdleConnections?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
