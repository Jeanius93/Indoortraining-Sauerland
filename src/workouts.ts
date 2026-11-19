// ERG-Workouts: Abschnitte in % der FTP. `ramp` = linearer Übergang von `from` nach `to`.
export interface Step { dur: number; from: number; to?: number; label?: string }
export interface Workout { id: string; name: string; info: string; steps: Step[] }

const min = (m: number) => m * 60;

export const workouts: Workout[] = [
  { id: 'free', name: 'Freies ERG', info: 'Fester Zielwert, mit ± einstellbar', steps: [] },
  {
    id: 'ga1', name: 'Grundlage 60', info: '60 min · 65–70 % FTP',
    steps: [{ dur: min(8), from: 0.5, to: 0.68, label: 'Einfahren' }, { dur: min(45), from: 0.68, label: 'Grundlage' }, { dur: min(7), from: 0.6, to: 0.45, label: 'Ausfahren' }],
  },
  {
    id: 'ss3x10', name: 'Sweet Spot 3×10', info: '55 min · 3×10 min bei 90 %',
    steps: [
      { dur: min(10), from: 0.5, to: 0.75, label: 'Einfahren' },
      ...[1, 2, 3].flatMap(i => [{ dur: min(10), from: 0.9, label: `Sweet Spot ${i}/3` }, { dur: min(5), from: 0.55, label: 'Pause' }]),
    ],
  },
  {
    id: 'vo2', name: 'VO2max 5×3', info: '45 min · 5×3 min bei 115 %',
    steps: [
      { dur: min(12), from: 0.5, to: 0.75, label: 'Einfahren' },
      ...[1, 2, 3, 4, 5].flatMap(i => [{ dur: min(3), from: 1.15, label: `Intervall ${i}/5` }, { dur: min(3), from: 0.5, label: 'Pause' }]),
      { dur: min(3), from: 0.5, to: 0.4, label: 'Ausfahren' },
    ],
  },
  {
    id: 'ramp', name: 'Rampentest', info: 'FTP-Test · +20 W pro Minute bis zur Erschöpfung',
    steps: [{ dur: min(5), from: 0.45, label: 'Einfahren' }, ...Array.from({ length: 30 }, (_, i) => ({ dur: 60, from: 0.5 + i * 0.0667, label: `Stufe ${i + 1}` }))],
  },
];

export function workoutDuration(w: Workout) { return w.steps.reduce((s, x) => s + x.dur, 0); }

export function workoutTarget(w: Workout, t: number, ftp: number) {
  let acc = 0;
  for (let i = 0; i < w.steps.length; i++) {
    const s = w.steps[i];
    if (t < acc + s.dur) {
      const f = s.to === undefined ? s.from : s.from + (s.to - s.from) * (t - acc) / s.dur;
      return { watts: Math.round(f * ftp), step: s, index: i, remaining: acc + s.dur - t };
    }
    acc += s.dur;
  }
  return null;
}

/** Leistungszone nach Coggan (1–7) */
export function zone(watts: number, ftp: number) {
  const r = watts / ftp;
  return r < 0.55 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : r < 1.05 ? 4 : r < 1.2 ? 5 : r < 1.5 ? 6 : 7;
}
