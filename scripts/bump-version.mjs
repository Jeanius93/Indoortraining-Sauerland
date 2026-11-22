// Versionskennung in app/index.html automatisch auf Datum + Uhrzeit setzen (Cache-Bruch bei jedem Deploy)
import fs from 'node:fs';
const p = 'app/index.html', d = new Date(), z = n => String(n).padStart(2, '0');
const v = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/data-v="[^"]*"/, `data-v="${v}"`));
console.log('Version', v);
