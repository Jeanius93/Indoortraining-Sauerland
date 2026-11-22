// Workout-Seite: Bibliothek mit Filtern und Editor für eigene Workouts (Blöcke, Intervalle, Rampen in % FTP)
import { allWorkouts, findWorkout, saveCustom, deleteCustom, expand, workoutDuration, workoutTss, CATS, catTag, type Block, type Cat, type Workout } from '../workouts';
import { drawWorkout } from './charts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const fmtHM = (s: number) => `${Math.floor(s / 3600)}:${String(Math.round(s / 60) % 60).padStart(2, '0')}`;
const fmtMS = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const parseMS = (v: string) => { const [a, b] = v.split(':').map(x => Number(x.replace(',', '.'))); return Math.max(5, Math.round(b === undefined ? (a || 0) * 60 : (a || 0) * 60 + (b || 0))); };
const pct = (f: number) => String(Math.round(f * 100));
const parsePct = (v: string) => Math.max(0.2, Math.min(3, (Number(v.replace(',', '.')) || 50) / 100));

export class WorkoutPage {
  private filter: Cat | 'ALL' = 'ALL';
  private shown: Workout | null = null;             // im Editor angezeigt
  private draft: { id: string | null; name: string; blocks: Block[] } | null = null;   // bearbeitbar
  constructor(private ftp: () => number, private selected: () => string, private choose: (id: string) => void, private goRide: () => void, private toast: (m: string) => void) {
    $('woFilter').innerHTML = [`<button class="chip on" data-c="ALL">Alle</button>`, ...CATS.map(c => `<button class="chip" data-c="${c.id}">${c.label}</button>`)].join('');
    $('woFilter').onclick = e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b) return; this.filter = b.dataset.c as Cat | 'ALL'; this.render(); };
    $('woGrid').onclick = e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]'); if (!b) return; this.choose(b.dataset.id!); this.show(findWorkout(b.dataset.id!)); this.render(); };
    $('btnWoNew').onclick = () => this.edit(null, 'Mein Workout', [
      { t: 'ramp', dur: 600, from: 0.5, to: 0.7, label: 'Einfahren' },
      { t: 'set', reps: 4, on: 480, onP: 0.98, off: 180, offP: 0.55, label: 'Intervall' },
      { t: 'ramp', dur: 480, from: 0.6, to: 0.45, label: 'Ausfahren' }]);
    $('edCopy').onclick = () => { const w = this.shown; if (w) this.edit(null, `${w.name} (Kopie)`, structuredClone(w.blocks)); };
    $('edSave').onclick = () => this.save();
    $('edDel').onclick = () => {
      const d = this.draft; if (!d?.id) { this.show(findWorkout(this.selected())); return; }
      const b = $('edDel'); if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Wirklich löschen?'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Löschen'; }, 3000); return; }
      deleteCustom(d.id); if (this.selected() === d.id) this.choose('free'); this.toast('Workout gelöscht'); this.show(findWorkout(this.selected())); this.render();
    };
    $('edUse').onclick = () => { if (this.draft) { if (!this.save()) return; } else if (this.shown) this.choose(this.shown.id); this.goRide(); };
    $('edAdd').onclick = e => {
      const k = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-add]')?.dataset.add; if (!k || !this.draft) return;
      this.draft.blocks.push(k === 'step' ? { t: 'step', dur: 600, p: 0.65, label: 'Block' } : k === 'ramp' ? { t: 'ramp', dur: 300, from: 0.5, to: 0.8, label: 'Rampe' } : { t: 'set', reps: 5, on: 180, onP: 1.1, off: 180, offP: 0.5, label: 'Intervall' });
      this.rows();
    };
    $('edName').oninput = () => { if (this.draft) { this.draft.name = $<HTMLInputElement>('edName').value; } };
    $('edRows').addEventListener('input', e => this.onInput(e.target as HTMLInputElement));
    $('edRows').onclick = e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]'); if (!b || !this.draft) return;
      const i = Number(b.dataset.i), bl = this.draft.blocks;
      if (b.dataset.act === 'del') bl.splice(i, 1);
      if (b.dataset.act === 'up' && i > 0) [bl[i - 1], bl[i]] = [bl[i], bl[i - 1]];
      if (b.dataset.act === 'down' && i < bl.length - 1) [bl[i + 1], bl[i]] = [bl[i], bl[i + 1]];
      this.rows();
    };
    this.show(findWorkout(selected()));
  }

  /** Bibliothek zeichnen (erst wenn die Seite sichtbar ist, sonst haben die Balken keine Größe) */
  render() {
    $('woFilter').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === this.filter));
    const list = allWorkouts().filter(w => this.filter === 'ALL' ? true : w.cat === this.filter);
    const sel = this.selected();
    $('woGrid').innerHTML = list.map(w => `<button class="card wcard${w.id === sel ? ' on' : ''}" data-id="${w.id}"><div><span class="tag ${w.cat}">${catTag(w.cat)}</span></div><div class="wn">${esc(w.name)}</div><div class="wi">${esc(w.info)}</div><canvas class="wo-mini"></canvas></button>`).join('')
      || '<p class="muted">Noch keine eigenen Workouts – mit „+ Neues Workout“ anlegen.</p>';
    $('woGrid').querySelectorAll<HTMLElement>('[data-id]').forEach(el => { const w = findWorkout(el.dataset.id!); if (w.steps.length) drawWorkout(el.querySelector('canvas')!, w, this.ftp(), 0, false); });
    this.preview();
  }

  /** Workout im Editor anzeigen (eingebaute schreibgeschützt, eigene bearbeitbar) */
  show(w: Workout) {
    this.shown = w;
    if (w.custom) { this.edit(w.id, w.name, structuredClone(w.blocks)); return; }
    this.draft = null; this.ui();
  }
  private edit(id: string | null, name: string, blocks: Block[]) { this.draft = { id, name, blocks }; this.ui(); }

  private ui() {
    const d = this.draft, w = this.shown, editable = !!d;
    $('edHead').textContent = editable ? (d!.id ? 'Eigenes Workout bearbeiten' : 'Neues Workout') : `Workout · ${w ? catTag(w.cat) : ''}`;
    const nm = $<HTMLInputElement>('edName'); nm.value = editable ? d!.name : w?.name ?? ''; nm.readOnly = !editable;
    $('edAdd').hidden = !editable; $('edSave').hidden = !editable; $('edDel').hidden = !editable;
    $('edDel').textContent = d?.id ? 'Löschen' : 'Verwerfen';
    $('edCopy').hidden = editable || !w || w.id === 'free';
    $('edHint').textContent = editable ? 'Dauer als Minuten:Sekunden (z. B. 8:00), Leistung in % deiner FTP. Der Trainer hält die Wattzahl im ERG-Modus.'
      : w?.id === 'free' ? 'Freies ERG: fester Zielwert, während der Fahrt mit + und − einstellbar.' : 'Eingebautes Workout. Mit „Kopie bearbeiten“ als eigenes Workout anpassen.';
    this.rows();
  }

  private blocks() { return this.draft ? this.draft.blocks : this.shown?.blocks ?? []; }
  private rows() {
    const editable = !!this.draft, dis = editable ? '' : ' disabled';
    const inp = (i: number, k: string, v: string, cls = '') => `<input${dis} class="${cls}" data-i="${i}" data-k="${k}" value="${esc(v)}">`;
    $('edRows').innerHTML = this.blocks().map((b, i) => {
      const tools = editable ? `<span><button class="mv" data-act="up" data-i="${i}" aria-label="nach oben">▲</button><button class="mv" data-act="down" data-i="${i}" aria-label="nach unten">▼</button><button class="x" data-act="del" data-i="${i}" aria-label="entfernen">✕</button></span>` : '<span></span>';
      const lbl = editable ? inp(i, 'label', b.label ?? '', 'lbl') : `<span class="ed-l">${esc(b.label ?? '')}</span>`;
      const v = b.t === 'step' ? `Dauer ${inp(i, 'dur', fmtMS(b.dur))} Leistung ${inp(i, 'p', pct(b.p))} %`
        : b.t === 'ramp' ? `Dauer ${inp(i, 'dur', fmtMS(b.dur))} Rampe ${inp(i, 'from', pct(b.from))} → ${inp(i, 'to', pct(b.to))} %`
        : `${inp(i, 'reps', String(b.reps))} × &nbsp;Belastung ${inp(i, 'on', fmtMS(b.on))} bei ${inp(i, 'onP', pct(b.onP))} % &nbsp;Pause ${inp(i, 'off', fmtMS(b.off))} bei ${inp(i, 'offP', pct(b.offP))} %`;
      return `<div class="ed-row">${lbl}${tools}<div class="ed-v">${v}</div></div>`;
    }).join('') || '<p class="muted">Keine Blöcke.</p>';
    this.preview();
  }

  private onInput(el: HTMLInputElement) {
    if (!this.draft || !el.dataset.k) return;
    const b = this.draft.blocks[Number(el.dataset.i)] as Record<string, unknown>, k = el.dataset.k, v = el.value;
    if (k === 'label') b.label = v;
    else if (k === 'reps') b.reps = Math.max(1, Math.min(50, Math.round(Number(v) || 1)));
    else if (k === 'dur' || k === 'on' || k === 'off') b[k] = parseMS(v);
    else b[k] = parsePct(v);
    this.preview();
  }

  private preview() {
    const steps = expand(this.blocks()), tmp = { steps } as Workout, cv = $<HTMLCanvasElement>('edPreview');
    if (steps.length) drawWorkout(cv, tmp, this.ftp(), 0, false); else cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
    $('edInfo').textContent = steps.length ? `${fmtHM(workoutDuration(tmp))} h · TSS ${workoutTss(tmp)} · FTP ${this.ftp()} W` : this.shown?.info ?? '';
  }

  private save() {
    const d = this.draft; if (!d) return true;
    if (!d.blocks.length) { this.toast('Mindestens einen Block anlegen'); return false; }
    const w = saveCustom(d.id, d.name, d.blocks); this.choose(w.id); this.shown = w; d.id = w.id;
    this.toast('Workout gespeichert'); this.filter = this.filter === 'ALL' ? 'ALL' : 'OWN'; this.render(); this.ui();
    return true;
  }
}
