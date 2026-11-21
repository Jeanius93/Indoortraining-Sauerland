// Ortsauswahl: Karte (antippen), Höhenprofil (antippen) und Liste der Abschnitte mit Straßen- und Ortsnamen
import type { Route } from '../route';
import { ProfileChart } from './charts';

export interface Place { d: number; road: string; area: string }

/** Abschnitte zusammenfassen: gleiche Straße hintereinander nur einmal, Lücken mit Ortsnamen füllen */
export function placeList(route: Route): Place[] {
  const out: Place[] = [];
  for (const p of route.data.places ?? []) {
    const road = p.road ?? '', area = p.area ?? '';
    const last = out.at(-1);
    if (last && (last.road === road || !road) && last.area === area) continue;
    if (last && p.d - last.d < 600) { if (road && !last.road) last.road = road; continue; }
    out.push({ d: p.d, road, area });
  }
  if (!out.length || out[0].d > 0) out.unshift({ d: 0, road: 'Anfang', area: '' });
  return out;
}
export const placeLabel = (p: Place) => p.road || p.area || 'Strecke';

export class PlacePicker {
  private profile: ProfileChart;
  private d = 0;
  private bounds: { minX: number; minY: number; s: number; ox: number; oy: number } | null = null;
  constructor(private route: Route, private onPick: (d: number) => void) {
    const $ = (id: string) => document.getElementById(id)!;
    this.profile = new ProfileChart($('placesProfile') as HTMLCanvasElement, route, { padTop: 10, labels: true });
    const list = $('placesList');
    const places = placeList(route);
    list.innerHTML = places.map((p, i) => `<li><button data-i="${i}"><span class="km">${(p.d / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span><span class="nm"><b>${escapeHtml(placeLabel(p))}</b><small>${escapeHtml(p.road && p.area ? p.area : '')}</small></span></button></li>`).join('');
    list.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return;
      this.onPick(places[Number(b.dataset.i)].d);
    });
    const map = $('placesMap') as HTMLCanvasElement;
    map.addEventListener('pointerdown', e => this.pickOnMap(map, e));
    const prof = $('placesProfile') as HTMLCanvasElement;
    prof.addEventListener('pointerdown', e => { const r = prof.getBoundingClientRect(); this.onPick((e.clientX - r.left) / r.width * route.length); });
  }

  show(d: number) {
    this.d = d;
    document.getElementById('places')!.hidden = false;
    this.bounds = null;
    this.draw();
    document.querySelectorAll<HTMLButtonElement>('#placesList button').forEach(b => {
      const places = placeList(this.route), i = Number(b.dataset.i);
      const on = d >= places[i].d && (i === places.length - 1 || d < places[i + 1].d);
      b.classList.toggle('on', on);
    });
  }
  hide() { document.getElementById('places')!.hidden = true; }

  private draw() {
    const cv = document.getElementById('placesMap') as HTMLCanvasElement;
    const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const g = cv.getContext('2d')!, { x, y } = this.route.data, w = cv.width, h = cv.height;
    const minX = Math.min(...x), maxX = Math.max(...x), minY = Math.min(...y), maxY = Math.max(...y);
    const s = Math.min(w / (maxX - minX), h / (maxY - minY)) * 0.86;
    this.bounds = { minX, minY, s, ox: (w - (maxX - minX) * s) / 2, oy: (h - (maxY - minY) * s) / 2 };
    const P = (i: number): [number, number] => [this.bounds!.ox + (x[i] - minX) * s, h - this.bounds!.oy - (y[i] - minY) * s];
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 4 * dpr; g.strokeStyle = 'rgba(238,243,239,.55)';
    g.beginPath(); for (let i = 0; i < x.length; i += 3) { const [px, py] = P(i); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke();
    // Orte beschriften
    g.font = `500 ${11 * dpr}px Barlow, system-ui, sans-serif`; g.textBaseline = 'middle';
    const labelled: [number, number][] = [];
    for (const p of placeList(this.route)) {
      const [px, py] = P(Math.min(x.length - 1, Math.round(p.d / this.route.data.step)));
      g.fillStyle = 'rgba(238,243,239,.9)'; g.beginPath(); g.arc(px, py, 3 * dpr, 0, Math.PI * 2); g.fill();
      if (labelled.some(([lx, ly]) => Math.hypot(lx - px, ly - py) < 60 * dpr)) continue;
      labelled.push([px, py]);
      const label = `${(p.d / 1000).toFixed(1).replace('.', ',')} ${placeLabel(p)}`;
      const tw = g.measureText(label).width, lx = px + tw + 10 * dpr > w ? px - tw - 8 * dpr : px + 7 * dpr;
      g.fillStyle = 'rgba(15,23,20,.75)'; g.fillRect(lx - 3 * dpr, py - 8 * dpr, tw + 6 * dpr, 16 * dpr);
      g.fillStyle = '#eef3ef'; g.fillText(label, lx, py);
    }
    const [cx, cy] = P(Math.min(x.length - 1, Math.round(this.d / this.route.data.step)));
    g.fillStyle = '#ffb547'; g.beginPath(); g.arc(cx, cy, 7 * dpr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#0f1714'; g.lineWidth = 2 * dpr; g.stroke();
    this.profile.draw(this.d);
  }

  private pickOnMap(cv: HTMLCanvasElement, e: PointerEvent) {
    if (!this.bounds) return;
    const r = cv.getBoundingClientRect(), dpr = cv.width / r.width;
    const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr, b = this.bounds, { x, y } = this.route.data;
    const wx = (px - b.ox) / b.s + b.minX, wy = (cv.height - b.oy - py) / b.s + b.minY;
    let best = 0, bd = Infinity;
    for (let i = 0; i < x.length; i += 2) { const d = (x[i] - wx) ** 2 + (y[i] - wy) ** 2; if (d < bd) { bd = d; best = i; } }
    this.onPick(best * this.route.data.step);
  }
}

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
