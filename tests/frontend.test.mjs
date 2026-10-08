// Auslieferung des Frontends durch den eigenen Server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/app.js';

test('index.html enthält die Server-Markierung, damit das Spiel Konten anbietet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-front-'));
  const { app, close } = createApp({ dbPath: path.join(dir, 'db.sqlite'), bcryptRounds: 4 });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const p of ['/', '/index.html']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.match(html, /<meta name="teleferico-server" content="1" \/>\s*<\/head>/);
      assert.match(html, /src\/main\.js/);
    }
    // Statische Dateien enthalten die Markierung nicht
    const raw = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'index.html'), 'utf8');
    assert.doesNotMatch(raw, /teleferico-server/);
  } finally {
    await new Promise((r) => server.close(r));
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
