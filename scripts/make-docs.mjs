// Veröffentlichungsordner für GitHub Pages („Deploy from a branch“ → Ordner /docs):
// kopiert den Build (dist/) nach docs/ und packt die großen Binärdateien mit gzip.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
// Aufruf: node scripts/make-docs.mjs [zielordner] [--ohne-luftbild]
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'docs';
const lean = process.argv.includes('--ohne-luftbild');
if (OUT === 'docs') { for (const f of fs.readdirSync('docs', { withFileTypes: true })) if (f.name !== 'vorschau') fs.rmSync(path.join('docs', f.name), { recursive: true, force: true }); }
else fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync('dist', OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
let before = 0, after = 0;
for (const dir of fs.readdirSync(path.join(OUT, 'routes')).filter(d => fs.statSync(path.join(OUT, 'routes', d)).isDirectory())) {
  if (lean) for (const f of ['ortho', 'ortho1', 'ortho.json', 'buildings.bin']) fs.rmSync(path.join(OUT, 'routes', dir, f), { recursive: true, force: true });
  for (const f of fs.readdirSync(path.join(OUT, 'routes', dir))) {
    const p = path.join(OUT, 'routes', dir, f);
    if (!f.endsWith('.bin')) continue;
    const raw = fs.readFileSync(p); before += raw.length;
    const gz = raw[0] === 0x1f && raw[1] === 0x8b ? raw : zlib.gzipSync(raw, { level: 9 });
    after += gz.length; fs.writeFileSync(p, gz);
  }
  fs.rmSync(path.join(OUT, 'routes', dir, 'canopy.bin'), { force: true });   // nur ohne Nutzungskarte nötig
}
console.log(`${OUT}/ fertig – Binärdaten ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);
