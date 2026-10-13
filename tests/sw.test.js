import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';

const root = new URL('..', import.meta.url);

test('el service worker guarda en caché todos los archivos de la app', async () => {
  const sw = await readFile(new URL('sw.js', root), 'utf8');
  const listed = [...sw.matchAll(/'([^']+\.(?:js|css|html|svg|webmanifest))'/g)].map((m) => m[1]);
  for (const f of listed) await access(new URL(f, root));
  const jsFiles = [
    'js/app.js',
    ...(await readdir(new URL('js/core/', root))).map((f) => 'js/core/' + f),
    ...(await readdir(new URL('js/data/', root))).map((f) => 'js/data/' + f),
  ];
  for (const f of jsFiles) assert.ok(listed.includes(f), `${f} falta en sw.js`);
});
