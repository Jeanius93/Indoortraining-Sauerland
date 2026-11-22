import { Recorder } from '../src/recorder';
import { buildFit } from '../src/fit';
export function makeFit() {
  const r = new Recorder(); const t0 = Date.UTC(2026, 10, 19, 17, 0, 0);
  for (let i = 0; i < 120; i++) r.add({ t: t0 + i * 1000, dist: i * 8, speed: 8, power: 200 + (i % 10), cadence: 90, hr: 140, lat: 51.2, lon: 7.8 + i * 1e-4, alt: 300 + i * 0.1 });
  return buildFit(r);
}
