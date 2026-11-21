// ERG-Workouts: Bausteine in Anteilen der FTP (0,65 = 65 %). Eingebaute Bibliothek (LIT, Fat Max, HIT,
// Schwelle, Tests) und eigene Workouts aus dem Editor (im Browser gespeichert unter `sauerland.workouts`).

/** Abschnitt, wie er gefahren wird; `to` = linearer Übergang (Rampe) */
export interface Step { dur: number; from: number; to?: number; label?: string }
/** Baustein im Editor: Stufe, Rampe oder Intervall-Satz (Belastung + Pause, n-mal) */
export type Block =
  | { t: 'step'; dur: number; p: number; label?: string }
  | { t: 'ramp'; dur: number; from: number; to: number; label?: string }
  | { t: 'set'; reps: number; on: number; onP: number; off: number; offP: number; label?: string };
export type Cat = 'FREE' | 'LIT' | 'FAT' | 'HIT' | 'SCH' | 'TEST' | 'OWN';
export interface Workout { id: string; name: string; cat: Cat; info: string; steps: Step[]; blocks: Block[]; custom?: boolean }

export const CATS: { id: Cat; label: string; tag: string }[] = [
  { id: 'LIT', label: 'LIT · Grundlage', tag: 'LIT' }, { id: 'FAT', label: 'Fat Max', tag: 'FAT MAX' },
  { id: 'HIT', label: 'HIT · Intervalle', tag: 'HIT' }, { id: 'SCH', label: 'Schwelle', tag: 'SCHWELLE' },
  { id: 'TEST', label: 'Tests', tag: 'TEST' }, { id: 'OWN', label: 'Eigene', tag: 'EIGENES' },
];
export const catTag = (c: Cat) => c === 'FREE' ? 'ERG' : CATS.find(x => x.id === c)!.tag;

const m = (x: number) => x * 60;
const step = (dur: number, p: number, label?: string): Block => ({ t: 'step', dur: m(dur), p, label });
const ramp = (dur: number, from: number, to: number, label?: string): Block => ({ t: 'ramp', dur: m(dur), from, to, label });
const set = (reps: number, on: number, onP: number, off: number, offP: number, label?: string): Block => ({ t: 'set', reps, on, onP, off, offP, label });
const warm = (d = 10, to = 0.68) => ramp(d, 0.5, to, 'Einfahren');
const cool = (d = 8) => ramp(d, 0.6, 0.45, 'Ausfahren');

/** Bausteine → gefahrene Abschnitte */
export function expand(blocks: Block[]): Step[] {
  const out: Step[] = [];
  for (const b of blocks) {
    if (b.t === 'step') out.push({ dur: b.dur, from: b.p, label: b.label ?? 'Block' });
    else if (b.t === 'ramp') out.push({ dur: b.dur, from: b.from, to: b.to, label: b.label ?? 'Rampe' });
    else for (let i = 1; i <= b.reps; i++) {
      out.push({ dur: b.on, from: b.onP, label: `${b.label ?? 'Intervall'} ${i}/${b.reps}` });
      if (b.off > 0 && i < b.reps) out.push({ dur: b.off, from: b.offP, label: 'Pause' });
    }
  }
  return out;
}

const fmtDur = (s: number) => `${Math.floor(s / 3600)}:${String(Math.round(s / 60) % 60).padStart(2, '0')}`;
function make(id: string, name: string, cat: Cat, detail: string, blocks: Block[], custom = false): Workout {
  const steps = expand(blocks);
  return { id, name, cat, blocks, steps, custom, info: steps.length ? `${fmtDur(workoutDuration({ steps } as Workout))} · ${detail}` : detail };
}

const BUILTIN: Workout[] = [
  make('free', 'Freies ERG', 'FREE', 'Fester Zielwert, mit ± einstellbar', []),
  // LIT – lockere Grundlage (Zone 2)
  make('ga1', 'Grundlage 60', 'LIT', '65–70 %', [warm(8), step(45, 0.68, 'Grundlage'), cool(7)]),
  make('ga90', 'Grundlage 90', 'LIT', '66 %', [warm(10, 0.66), step(72, 0.66, 'Grundlage'), cool(8)]),
  make('ga120', 'Lange Ausfahrt 2 h', 'LIT', '60–70 %', [warm(15, 0.64), ...[1, 2, 3].flatMap(() => [step(25, 0.64, 'Grundlage'), step(5, 0.7, 'etwas zügiger')]), cool(15)]),
  make('kad60', 'Kadenz-Grundlage 60', 'LIT', '65 % · 5× hohe Trittfrequenz', [warm(10, 0.65), ...[1, 2, 3, 4, 5].flatMap(() => [step(6, 0.65, 'locker'), step(2, 0.68, 'Trittfrequenz über 100')]), cool(10)]),
  // Fat Max – höchste Fettverbrennung, knapp unter der ersten Schwelle
  make('fm3x20', 'FatMax 3×20', 'FAT', '62 %', [warm(10, 0.62), set(3, m(20), 0.62, m(3), 0.55, 'FatMax'), cool(6)]),
  make('fm80', 'FatMax Dauer 80', 'FAT', '63 %', [warm(10, 0.63), step(60, 0.63, 'FatMax'), cool(10)]),
  make('fmpyr', 'FatMax Pyramide', 'FAT', '58–66 %', [warm(10, 0.58), step(15, 0.58, 'FatMax'), step(15, 0.63, 'FatMax'), step(15, 0.66, 'FatMax'), step(15, 0.63, 'FatMax'), step(15, 0.58, 'FatMax'), cool(5)]),
  // HIT – hochintensive Intervalle
  make('vo2', 'VO2max 5×3', 'HIT', '115 %', [warm(12, 0.75), set(5, m(3), 1.15, m(3), 0.5), cool(6)]),
  make('nor4x4', 'Norweger 4×4', 'HIT', '110–115 %', [warm(12, 0.75), set(4, m(4), 1.12, m(3), 0.55), cool(8)]),
  make('s3030', '30/30 · 3×10', 'HIT', '125 / 50 %', [warm(12, 0.75), ...[1, 2, 3].flatMap(i => [set(10, 30, 1.25, 30, 0.5, `30/30 Satz ${i}`), ...(i < 3 ? [step(5, 0.5, 'Satzpause')] : [])]), cool(8)]),
  make('s4020', '40/20 · 3×8', 'HIT', '120 / 50 %', [warm(12, 0.75), ...[1, 2, 3].flatMap(i => [set(8, 40, 1.2, 20, 0.5, `40/20 Satz ${i}`), ...(i < 3 ? [step(5, 0.5, 'Satzpause')] : [])]), cool(8)]),
  // Schwelle
  make('ss3x10', 'Sweet Spot 3×10', 'SCH', '90 %', [warm(10, 0.75), set(3, m(10), 0.9, m(5), 0.55, 'Sweet Spot'), cool(7)]),
  make('ss3x15', 'Sweet Spot 3×15', 'SCH', '88–92 %', [warm(10, 0.75), set(3, m(15), 0.9, m(5), 0.55, 'Sweet Spot'), cool(7)]),
  make('thr2x20', 'Schwelle 2×20', 'SCH', '97 %', [warm(12, 0.75), set(2, m(20), 0.97, m(6), 0.55, 'Schwelle'), cool(8)]),
  make('ou3x9', 'Over-Under 3×9', 'SCH', '95 / 105 %', [warm(12, 0.75), ...[1, 2, 3].flatMap(i => [set(3, 120, 0.95, 60, 1.05, `Under/Over ${i}`), ...(i < 3 ? [step(5, 0.55, 'Pause')] : [])]), cool(8)]),
  // Tests
  make('ramp', 'Rampentest', 'TEST', '+20 W pro Minute bis zur Erschöpfung', [step(5, 0.45, 'Einfahren'), ...Array.from({ length: 30 }, (_, i) => ({ t: 'step', dur: 60, p: 0.5 + i * 0.0667, label: `Stufe ${i + 1}` }) as Block)]),
  make('ftp20', 'FTP-Test 20 min', 'TEST', 'FTP ≈ 95 % der 20-min-Leistung', [ramp(15, 0.5, 0.7, 'Einfahren'), step(5, 1.1, 'Öffner'), step(10, 0.55, 'locker'), step(20, 1.0, 'FTP-Test – gleichmäßig alles geben'), ramp(10, 0.5, 0.4, 'Ausfahren')]),
];

// ---------- eigene Workouts ----------
const KEY = 'sauerland.workouts';
interface Saved { id: string; name: string; blocks: Block[] }
function loadCustom(): Workout[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as Saved[]).map(s => make(s.id, s.name, 'OWN', 'eigenes Workout', s.blocks, true)); } catch { return []; }
}
let custom = loadCustom();
export const allWorkouts = (): Workout[] => [...BUILTIN, ...custom];
export const findWorkout = (id: string) => allWorkouts().find(w => w.id === id) ?? BUILTIN[0];
export function saveCustom(id: string | null, name: string, blocks: Block[]): Workout {
  const wid = id ?? `own-${Date.now().toString(36)}`;
  const list: Saved[] = custom.map(w => ({ id: w.id, name: w.name, blocks: w.blocks })).filter(w => w.id !== wid);
  list.push({ id: wid, name: name.trim() || 'Mein Workout', blocks });
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* voll */ }
  custom = loadCustom();
  return findWorkout(wid);
}
export function deleteCustom(id: string) {
  const list: Saved[] = custom.filter(w => w.id !== id).map(w => ({ id: w.id, name: w.name, blocks: w.blocks }));
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* egal */ }
  custom = loadCustom();
}

export function workoutDuration(w: Pick<Workout, 'steps'>) { return w.steps.reduce((s, x) => s + x.dur, 0); }
/** Trainingsbelastung (TSS), vereinfacht aus den Zielwerten */
export function workoutTss(w: Pick<Workout, 'steps'>) {
  let s = 0; for (const x of w.steps) { const f = x.to === undefined ? x.from : (x.from + x.to) / 2; s += x.dur * f * f; }
  return Math.round(s / 36);
}

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
