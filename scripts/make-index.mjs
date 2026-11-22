// Streckenliste für die App: public/routes/index.json (Hausrunde zuerst, dann nach Länge)
import fs from 'node:fs';
const order = ['hausrunde'];
const list = fs.readdirSync('public/routes', { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(`public/routes/${d.name}/route.json`)).map(d => {
  const r = JSON.parse(fs.readFileSync(`public/routes/${d.name}/route.json`, 'utf8'));
  // kleine Vorschau für die Streckenkarten: Umriss (0–1000, Nord oben) und Höhenprofil (80 Werte, m)
  const n = r.x.length, xs = r.x, ys = r.y, x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), s = Math.max(x1 - x0, y1 - y0) || 1;
  const shape = []; for (let k = 0; k < 160; k++) { const i = Math.round(k / 159 * (n - 1)); shape.push(Math.round((xs[i] - x0) / s * 1000), Math.round((y1 - ys[i]) / s * 1000)); }
  const prof = []; for (let k = 0; k < 80; k++) prof.push(Math.round(r.h[Math.round(k / 79 * (n - 1))]));
  return { id: d.name, name: r.name, length: r.length, ascent: r.ascent, maxGrade: r.maxGrade, shape, prof };
}).sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99) || a.length - b.length);
fs.writeFileSync('public/routes/index.json', JSON.stringify(list));
console.log(list.map(r => `${r.id}: ${r.name} ${(r.length / 1000).toFixed(1)} km`).join('\n'));
