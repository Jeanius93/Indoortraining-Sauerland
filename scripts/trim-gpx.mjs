// Entfernt Zeit/Puls/Temperatur aus einer GPX und schneidet Anfang und Ende ab (Privatsphäre).
// Aufruf: node scripts/trim-gpx.mjs <eingabe.gpx> <ausgabe.gpx> [meter=500] [name]
import fs from 'node:fs';
const [, , input, output, cutArg = '500', name = 'Hausrunde'] = process.argv;
const cut = Number(cutArg);
const xml = fs.readFileSync(input, 'utf8');
const pts = [...xml.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">\s*<ele>([-\d.]+)<\/ele>/g)]
  .map(m => ({ lat: +m[1], lon: +m[2], ele: +m[3] }));
const R = 6371000, rad = Math.PI / 180;
const dist = (a, b) => R * Math.hypot((b.lon - a.lon) * rad * Math.cos(a.lat * rad), (b.lat - a.lat) * rad);
let d = 0; pts[0].d = 0;
for (let i = 1; i < pts.length; i++) { d += dist(pts[i - 1], pts[i]); pts[i].d = d; }
const kept = pts.filter(p => p.d >= cut && p.d <= d - cut);
const body = kept.map(p => `   <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele.toFixed(1)}</ele></trkpt>`).join('\n');
fs.writeFileSync(output, `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Indoortraining-Sauerland" xmlns="http://www.topografix.com/GPX/1/1">
 <trk>
  <name>${name}</name>
  <type>cycling</type>
  <trkseg>
${body}
  </trkseg>
 </trk>
</gpx>
`);
console.log(`${pts.length} -> ${kept.length} Punkte, ${(d / 1000).toFixed(2)} km -> ${((kept.at(-1).d - kept[0].d) / 1000).toFixed(2)} km`);
