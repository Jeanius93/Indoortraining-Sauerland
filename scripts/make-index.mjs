// Streckenliste für die App: public/routes/index.json (Hausrunde zuerst, dann nach Länge)
import fs from 'node:fs';
const order = ['hausrunde'];
const list = fs.readdirSync('public/routes', { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(`public/routes/${d.name}/route.json`)).map(d => {
  const r = JSON.parse(fs.readFileSync(`public/routes/${d.name}/route.json`, 'utf8'));
  return { id: d.name, name: r.name, length: r.length, ascent: r.ascent, maxGrade: r.maxGrade };
}).sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99) || a.length - b.length);
fs.writeFileSync('public/routes/index.json', JSON.stringify(list, null, 1));
console.log(list.map(r => `${r.id}: ${r.name} ${(r.length / 1000).toFixed(1)} km`).join('\n'));
