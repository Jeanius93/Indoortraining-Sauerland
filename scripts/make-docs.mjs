// Veröffentlichungsordner für GitHub Pages („Deploy from a branch“ → Ordner /docs):
// kopiert den Build (dist/) nach docs/ und packt die großen Binärdateien mit gzip.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
fs.rmSync('docs', { recursive: true, force: true });
fs.cpSync('dist', 'docs', { recursive: true });
fs.writeFileSync('docs/.nojekyll', '');
let before = 0, after = 0;
for (const dir of fs.readdirSync('docs/routes')) {
  for (const f of fs.readdirSync(path.join('docs/routes', dir))) {
    const p = path.join('docs/routes', dir, f);
    if (!f.endsWith('.bin')) continue;
    const raw = fs.readFileSync(p); before += raw.length;
    const gz = raw[0] === 0x1f && raw[1] === 0x8b ? raw : zlib.gzipSync(raw, { level: 9 });
    after += gz.length; fs.writeFileSync(p, gz);
  }
  fs.rmSync(path.join('docs/routes', dir, 'canopy.bin'), { force: true });   // nur ohne Nutzungskarte nötig
}
console.log(`docs/ fertig – Binärdaten ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);
