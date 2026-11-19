// Bereitet den Single-File-Build für die Vorschau als claude.ai-Artefakt auf:
// Dokument-Gerüst entfernen (wird beim Veröffentlichen ergänzt), Manifest raus, Höhenraster als JSON.
import fs from 'node:fs';
const dir = 'artifact';
let html = fs.readFileSync(`${dir}/index.html`, 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '')
  .replace(/<link rel="manifest"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
fs.writeFileSync(`${dir}/sauerland-indoor.html`, `${title}\n${head.replace(title, '')}\n${body}`);
for (const r of fs.readdirSync('public/routes')) {
  fs.mkdirSync(`${dir}/routes/${r}`, { recursive: true });
  fs.copyFileSync(`public/routes/${r}/route.json`, `${dir}/routes/${r}/route.json`);
  fs.writeFileSync(`${dir}/routes/${r}/terrain.json`, JSON.stringify({ b64: fs.readFileSync(`public/routes/${r}/terrain.bin`).toString('base64') }));
}
console.log('Artefakt:', fs.statSync(`${dir}/sauerland-indoor.html`).size, 'Bytes');
