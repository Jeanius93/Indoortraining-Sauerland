// Höhenprofil, Übersichtskarte und Workout-Balken (Canvas)
import type { Route } from '../route';
import { workoutDuration, zone, type Workout } from '../workouts';

export const gradeColor = (g: number) =>
  g < 1 ? '#5c8f63' : g < 3 ? '#8bbd5a' : g < 5 ? '#e7c84a' : g < 7 ? '#f0953c' : g < 10 ? '#e2553f' : '#a8344b';

const zoneVar = ['--z1', '--z2', '--z3', '--z4', '--z5', '--z6', '--z7'];
export const zoneColor = (z: number) => getComputedStyle(document.documentElement).getPropertyValue(zoneVar[z - 1]).trim();

function fit(cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { w, h, dpr };
}

export class ProfileChart {
  private cache: HTMLCanvasElement | null = null;
  constructor(private cv: HTMLCanvasElement, private route: Route, private opts: { bg?: string; padTop?: number; labels?: boolean } = {}) {}

  private drawBase(w: number, h: number, dpr: number) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!, r = this.route, L = r.length;
    const hs = r.data.h, lo = Math.min(...hs) - 15, hi = Math.max(...hs) + 10;
    const top = (this.opts.padTop ?? 14) * dpr, bottom = h - (this.opts.labels ? 16 * dpr : 0);
    const X = (d: number) => d / L * w, Y = (e: number) => bottom - (e - lo) / (hi - lo) * (bottom - top);
    if (this.opts.bg) { g.fillStyle = this.opts.bg; g.fillRect(0, 0, w, h); }
    const stepPx = Math.max(1, Math.round(dpr));
    for (let px = 0; px < w; px += stepPx) {
      const d = px / w * L, e = r.hAt(d);
      g.fillStyle = gradeColor(r.gradeAt(d, 60));
      g.fillRect(px, Y(e), stepPx, bottom - Y(e));
    }
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5 * dpr; g.beginPath();
    for (let px = 0; px <= w; px += 2) { const d = px / w * L; px ? g.lineTo(px, Y(r.hAt(d))) : g.moveTo(px, Y(r.hAt(d))); }
    g.stroke();
    if (this.opts.labels) {
      g.fillStyle = 'rgba(238,243,239,.75)'; g.font = `${11 * dpr}px Barlow, system-ui, sans-serif`; g.textBaseline = 'bottom';
      for (let km = 5; km < L / 1000; km += 5) { const x = X(km * 1000); g.fillRect(x, bottom, 1, 4 * dpr); g.fillText(`${km}`, x + 2 * dpr, h - 1); }
    }
    return { c, X, Y };
  }

  private base: ReturnType<ProfileChart['drawBase']> | null = null;
  draw(d: number | null) {
    const { w, h, dpr } = fit(this.cv);
    if (!this.base || this.cache?.width !== w || this.cache?.height !== h) { this.base = this.drawBase(w, h, dpr); this.cache = this.base.c; }
    const g = this.cv.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.drawImage(this.base.c, 0, 0);
    if (d === null) return;
    const x = this.base.X(d), y = this.base.Y(this.route.hAt(d));
    g.fillStyle = 'rgba(15,23,20,.45)'; g.fillRect(0, 0, x, h);
    g.strokeStyle = '#ffb547'; g.lineWidth = 2 * dpr; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    g.fillStyle = '#ffb547'; g.beginPath(); g.arc(x, y, 5 * dpr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#0f1714'; g.lineWidth = 2 * dpr; g.stroke();
  }
}

export class MiniMap {
  private bounds: { minX: number; minY: number; s: number; ox: number; oy: number } | null = null;
  constructor(private cv: HTMLCanvasElement, private route: Route) {}
  draw(d: number) {
    const { w, h, dpr } = fit(this.cv), g = this.cv.getContext('2d')!, { x, y } = this.route.data;
    if (!this.bounds) {
      const minX = Math.min(...x), maxX = Math.max(...x), minY = Math.min(...y), maxY = Math.max(...y);
      const s = Math.min(w, h) * 0.66 / Math.max(maxX - minX, maxY - minY);
      this.bounds = { minX, minY, s, ox: (w - (maxX - minX) * s) / 2, oy: (h - (maxY - minY) * s) / 2 };
    }
    const b = this.bounds, P = (i: number): [number, number] => [b.ox + (x[i] - b.minX) * b.s, h - b.oy - (y[i] - b.minY) * b.s];
    g.clearRect(0, 0, w, h);
    const cur = Math.min(x.length - 1, Math.round(d / this.route.data.step));
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(238,243,239,.45)'; g.beginPath();
    for (let i = 0; i < x.length; i += 4) { const [px, py] = P(i); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke();
    g.strokeStyle = '#ffb547'; g.beginPath();
    for (let i = 0; i <= cur; i += 4) { const [px, py] = P(i); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke();
    const [px, py] = P(cur);
    g.fillStyle = '#ffb547'; g.beginPath(); g.arc(px, py, 5 * dpr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#0f1714'; g.lineWidth = 2 * dpr; g.stroke();
    g.fillStyle = 'rgba(238,243,239,.7)'; g.font = `600 ${11 * dpr}px Barlow, system-ui`; g.textAlign = 'center'; g.fillText('N', w / 2, 14 * dpr);
  }
}

export function drawWorkout(cv: HTMLCanvasElement, w0: Workout, ftp: number, t: number, marker = true) {
  const { w, h, dpr } = fit(cv), g = cv.getContext('2d')!, total = workoutDuration(w0);
  g.clearRect(0, 0, w, h);
  const maxF = Math.max(1.2, ...w0.steps.map(s => Math.max(s.from, s.to ?? 0)));
  let acc = 0;
  for (const s of w0.steps) {
    const x0 = acc / total * w, x1 = (acc + s.dur) / total * w;
    const f0 = s.from, f1 = s.to ?? s.from;
    g.fillStyle = zoneColor(zone(((f0 + f1) / 2) * ftp, ftp));
    g.globalAlpha = acc + s.dur < t ? 0.35 : 0.9;
    g.beginPath(); g.moveTo(x0, h); g.lineTo(x0, h - f0 / maxF * h); g.lineTo(x1, h - f1 / maxF * h); g.lineTo(x1, h); g.fill();
    acc += s.dur;
  }
  g.globalAlpha = 1;
  if (!marker) return;
  const x = t / total * w;
  g.fillStyle = '#fff'; g.fillRect(x - dpr, 0, 2 * dpr, h);
}

/** Streckenvorschau aus routes/index.json: Umriss (oben) oder Höhenprofil */
export function drawShape(cv: HTMLCanvasElement, shape: number[], color = '#ffb547', box = { l: 0, t: 0, r: 1, b: 1 }) {
  const { w, h, dpr } = fit(cv), g = cv.getContext('2d')!; g.clearRect(0, 0, w, h);
  let mx = 0, my = 0; for (let i = 0; i < shape.length; i += 2) { mx = Math.max(mx, shape[i]); my = Math.max(my, shape[i + 1]); }
  const bw = w * (box.r - box.l), bh = h * (box.b - box.t), pad = 10 * dpr;
  const s = Math.min((bw - 2 * pad) / (mx || 1), (bh - 2 * pad) / (my || 1)), ox = w * box.l + (bw - mx * s) / 2, oy = h * box.t + (bh - my * s) / 2;
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const [lw, c] of [[6, 'rgba(0,0,0,.35)'], [3, color]] as const) {
    g.strokeStyle = c; g.lineWidth = lw * dpr; g.beginPath();
    for (let i = 0; i < shape.length; i += 2) { const x = ox + shape[i] * s, y = oy + shape[i + 1] * s; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
  g.fillStyle = '#fff'; g.beginPath(); g.arc(ox + shape[0] * s, oy + shape[1] * s, 4.5 * dpr, 0, Math.PI * 2); g.fill();
}
export function drawMiniProfile(cv: HTMLCanvasElement, prof: number[]) {
  const { w, h } = fit(cv), g = cv.getContext('2d')!; g.clearRect(0, 0, w, h);
  const lo = Math.min(...prof) - 10, hi = Math.max(...prof) + 5, X = (i: number) => i / (prof.length - 1) * w, Y = (e: number) => h - (e - lo) / (hi - lo) * h * 0.9;
  g.beginPath(); g.moveTo(0, h); prof.forEach((e, i) => g.lineTo(X(i), Y(e))); g.lineTo(w, h); g.closePath();
  g.fillStyle = 'rgba(92,192,106,.35)'; g.fill();
  g.beginPath(); prof.forEach((e, i) => i ? g.lineTo(X(i), Y(e)) : g.moveTo(X(i), Y(e))); g.strokeStyle = '#8fd49a'; g.lineWidth = Math.max(1, w / 300); g.stroke();
}
