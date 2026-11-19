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
  for (const f of fs.readdirSync(`public/routes/${r}`).filter(f => f.endsWith('.json')))
    fs.copyFileSync(`public/routes/${r}/${f}`, `${dir}/routes/${r}/${f}`);
  if (fs.existsSync(`public/routes/${r}/ortho`)) fs.cpSync(`public/routes/${r}/ortho`, `${dir}/routes/${r}/ortho`, { recursive: true });
  for (const f of fs.readdirSync(`public/routes/${r}`).filter(f => /\.(bin|gz)$/.test(f)))
    fs.writeFileSync(`${dir}/routes/${r}/${f.replace(/\.bin$/, '')}.json`, JSON.stringify({ b64: fs.readFileSync(`public/routes/${r}/${f}`).toString('base64') }));
}
console.log('Artefakt:', fs.statSync(`${dir}/sauerland-indoor.html`).size, 'Bytes');
