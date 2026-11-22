import './styles.css';
import { loadRoute, listRoutes, type Route, type RouteInfo } from './route';
import { World } from './world/scene';
import { designColors, type JerseyDesign } from './world/avatar';
import { ENS } from './world/lookflag';
import { stepSpeed, defaultRider, type RiderSettings } from './physics';
import { FtmsTrainer, HeartRateMonitor, bluetoothAvailable } from './devices/ftms';
import { SimulatedTrainer } from './devices/simulator';
import type { Trainer } from './devices/types';
import { findWorkout, workoutTarget, workoutDuration, workoutTss, catTag, zone, type Workout } from './workouts';
import { Recorder } from './recorder';
import { buildFit } from './fit';
import { ProfileChart, MiniMap, drawWorkout, drawShape, drawMiniProfile, gradeColor, zoneColor } from './ui/charts';
import { WorkoutPage, fmtHM } from './ui/workoutPage';
import { GamepadInput, type PadAction } from './ui/gamepad';
import { PlacePicker, placeList, placeLabel } from './ui/places';
import { saveRide, deleteRide, listRides, type StoredRide } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtTime = (s: number) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };
const fmtMin = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- Einstellungen ----------
interface Settings { route: string; ftp: number; kg: number; difficulty: number; jersey: string; design: JerseyDesign; mode: 'sim' | 'erg'; workout: string; quality: 'auto' | 'high' | 'low' }
const defaults: Settings = { route: 'hausrunde', ftp: 250, kg: 80, difficulty: 50, jersey: '#d2412f', design: 'herscheid', mode: 'sim', workout: 'free', quality: 'auto' };
function loadSettings(): Settings {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('sauerland.settings') ?? '{}') }; } catch { return { ...defaults }; }
}
function saveSettings() { try { localStorage.setItem('sauerland.settings', JSON.stringify(settings)); } catch { /* egal */ } }
const settings = loadSettings();

// ---------- Zustand ----------
let route: Route, world: World, profile: ProfileChart, minimap: MiniMap, picker: PlacePicker;
let chosenStart: number | null = null;
let routes: RouteInfo[] = [];
let rideId = '', rideSimulated = false, trainerLost = false, lastSave = 0, resumeRide: StoredRide | null = null;
let trainer: Trainer | null = null, hrm: HeartRateMonitor | null = null;
let power = 0, cadence = 0, hr: number | undefined, hrFromStrap = false;
let running = false, paused = false;
let dist = 0, rideStart = 0, lap = 0, speed = 0, elapsed = 0, lastSampleSec = -1, nextSimSend = 0;
let ergTarget = 200, ergBias = 0;
let recorder = new Recorder();
let wakeLock: { release(): Promise<void> } | null = null;
const rider = (): RiderSettings => ({ ...defaultRider, riderKg: settings.kg });
const workout = (): Workout => findWorkout(settings.workout);
// Grafikstufe: Einstellung > Adresse (?q=high) > automatisch (Handy = niedrig; Windows-Handhelds wie die Claw = hoch)
const autoQuality = (): 'low' | 'high' => /Android|iPhone|iPad/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && !/Windows/i.test(navigator.userAgent) && Math.min(screen.width, screen.height) < 900) ? 'low' : 'high';
const qParam = new URLSearchParams(location.search).get('q');
const quality: 'low' | 'high' = qParam === 'high' || qParam === 'low' ? qParam : settings.quality !== 'auto' ? settings.quality : autoQuality();

function toast(msg: string, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout((toast as unknown as { h: number }).h);
  (toast as unknown as { h: number }).h = window.setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Start ----------
// ---------- immer die neueste Version ----------
// Die Startseite darf der Browser bis zu 10 min zwischenspeichern. Darum beim Start die aktuelle
// Versionsnummer frisch vom Server holen und bei Abweichung einmal mit neuer Adresse neu laden.
async function ensureLatest() {
  try {
    const mine = document.documentElement.dataset.v ?? '';
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) return;
    const { v } = await r.json() as { v: string };
    const url = new URL(location.href);
    if (v && v !== mine && url.searchParams.get('v') !== v) { url.searchParams.set('v', v); location.replace(url.toString()); await new Promise(() => {}); }
  } catch { /* offline: vorhandene Version nutzen */ }
}

async function init() {
  await ensureLatest();
  routes = await listRoutes();
  if (!routes.some(r => r.id === settings.route)) settings.route = routes[0]?.id ?? 'hausrunde';
  const loaded = await loadRoute(`routes/${settings.route}`, msg => { $('loading').firstElementChild!.textContent = msg; }, { fine: settings.quality === 'high' && import.meta.env.MODE !== 'artifact', photo: !ENS });
  route = loaded.route;
  $('loading').firstElementChild!.textContent = 'Sauerland wird aufgebaut …';
  // Schrift für Ortstafeln laden (höchstens 2 s warten)
  try { await Promise.race([document.fonts.load('700 64px "Barlow Condensed"'), new Promise(r => setTimeout(r, 2000))]); } catch { /* Ersatzschrift */ }
  await new Promise(r => setTimeout(r, 30));
  world = new World($<HTMLCanvasElement>('view'), route, loaded.heights, loaded.world, { ...designColors(settings.design, settings.jersey), bike: '#20242b', design: settings.design }, quality);
  profile = new ProfileChart($<HTMLCanvasElement>('profile'), route, { bg: 'rgba(13,22,19,.78)', labels: true });
  minimap = new MiniMap($<HTMLCanvasElement>('minimap'), route);
  new ProfileChart($<HTMLCanvasElement>('routeThumb'), route, { padTop: 18 }).draw(null);
  const info = routes.find(r => r.id === settings.route);
  if (info?.shape) drawShape($<HTMLCanvasElement>('routeShape'), info.shape, '#ffb547', { l: 0.4, t: 0.03, r: 0.99, b: 0.7 });
  void renderRouteGrid();
  $('routeName').textContent = route.data.name;
  $('routeLen').textContent = fmt(route.length / 1000, 1);
  $('routeUp').textContent = fmt(route.data.ascent);
  $('routeMax').textContent = `${fmt(route.data.maxGrade, 1)} %`;
  $('attrib').textContent = route.data.attribution;
  $('routeAttrib').textContent = route.data.world
    ? `${fmt(world.buildingCount)} Häuser und ${fmt(world.treeCount)} Bäume aus amtlichen Geodaten. ${route.data.attribution}`
    : `${route.data.attribution} · Wald nachempfunden (${fmt(world.treeCount)} Bäume)`;
  onResize();
  picker = new PlacePicker(route, d => jumpTo(d));
  dist = startDist();
  updateStartLabel();
  $('loading').hidden = true;
  requestAnimationFrame(loop);
  void checkPending();
}

function onResize() { world?.resize(innerWidth, innerHeight); }
addEventListener('resize', onResize);

// ---------- Geräte ----------
function setDev(btn: string, state: string, cls: '' | 'ok' | 'err') {
  const b = $(btn); b.classList.remove('ok', 'err'); if (cls) b.classList.add(cls);
  b.querySelector('.dev-state')!.textContent = state;
  const pill = btn === 'btnHr' ? $('pillHr') : btn === 'btnTrainer' || (btn === 'btnSim' && cls === 'ok') ? $('pillTrainer') : null;
  if (pill) {
    pill.className = `pill ${cls}`;
    pill.textContent = btn === 'btnHr' ? (cls === 'ok' ? 'Puls' : cls === 'err' ? 'Puls getrennt' : 'Puls –') : btn === 'btnSim' ? 'Simulator' : cls === 'ok' ? (trainer?.name ?? 'Trainer') : cls === 'err' ? 'Trainer getrennt' : 'Trainer –';
  }
}
function attachTrainer(t: Trainer) {
  trainer?.disconnect();
  trainer = t;
  t.onData = d => {
    if (d.power !== undefined) power = d.power;
    if (d.cadence !== undefined) cadence = d.cadence;
    if (d.hr && !hrFromStrap) hr = d.hr;
  };
  t.onDisconnect = () => {
    trainerLost = true; power = 0; cadence = 0;
    setDev('btnTrainer', 'verbinde neu …', 'err');
    if (running) { $('lostBanner').hidden = false; persist(true); }
  };
  t.onReconnect = () => {
    trainerLost = false; $('lostBanner').hidden = true;
    setDev('btnTrainer', `verbunden: ${t.name}`, 'ok');
    nextSimSend = 0; applyMode();
    if (running) toast('Trainer wieder verbunden – weiter geht’s');
  };
  $<HTMLButtonElement>('btnGo').disabled = false;
  applyMode();
}
function btError(e: unknown, btn: string) {
  const err = e as DOMException;
  if (err?.name === 'NotFoundError') { setDev(btn, 'abgebrochen', ''); return; }
  const hint = $('btHint'); hint.hidden = false;
  hint.textContent = err?.name === 'SecurityError' || err?.name === 'NotAllowedError'
    ? 'Bluetooth ist in dieser Vorschau gesperrt. Öffne die App direkt (GitHub Pages) in Edge oder Chrome.'
    : `Verbindung fehlgeschlagen: ${err?.message ?? e}`;
  setDev(btn, 'Fehler', 'err');
}
function needBluetooth() {
  if (bluetoothAvailable()) return true;
  const hint = $('btHint'); hint.hidden = false;
  hint.textContent = 'Dieser Browser kann kein Bluetooth. Öffne die App in Microsoft Edge oder Google Chrome (auf der MSI Claw ist Edge vorinstalliert). Zum Ausprobieren gibt es den Simulator.';
  return false;
}
$('btnTrainer').onclick = async () => {
  if (!needBluetooth()) return;
  setDev('btnTrainer', 'suche …', '');
  try { const t = await FtmsTrainer.connect(); attachTrainer(t); setDev('btnTrainer', `verbunden: ${t.name}`, 'ok'); setDev('btnSim', 'ohne Rad testen', ''); }
  catch (e) { btError(e, 'btnTrainer'); }
};
$('btnHr').onclick = async () => {
  if (!needBluetooth()) return;
  setDev('btnHr', 'suche …', '');
  try {
    hrm?.disconnect(); hrm = await HeartRateMonitor.connect(); hrFromStrap = true;
    hrm.onHr = b => { hr = b; };
    hrm.onLost = () => { hr = undefined; setDev('btnHr', 'verbinde neu …', 'err'); if (running) toast('Pulsgurt getrennt – verbinde neu …'); };
    hrm.onBack = () => { setDev('btnHr', `verbunden: ${hrm!.name}`, 'ok'); if (running) toast('Pulsgurt wieder verbunden'); };
    setDev('btnHr', `verbunden: ${hrm.name}`, 'ok');
  } catch (e) { btError(e, 'btnHr'); }
};
$('btnSim').onclick = () => {
  attachTrainer(new SimulatedTrainer());
  setDev('btnSim', 'aktiv', 'ok');
  if (!(trainer && !trainer.simulated)) setDev('btnTrainer', 'verbinden', '');
};

// ---------- Modus / Workout ----------
document.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode as Settings['mode']));
function setMode(m: Settings['mode']) {
  settings.mode = m; saveSettings();
  document.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach(b => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  $('trainSim').hidden = m === 'erg'; $('trainErg').hidden = m !== 'erg';
  renderTraining();
  applyMode();
}
/** Trainings-Karte auf der Seite „Fahren“ */
function renderTraining() {
  const w = workout(), tag = $('woTag');
  tag.className = `tag ${w.cat}`; tag.textContent = catTag(w.cat);
  $('woName').textContent = w.name;
  $('woWatt').textContent = w.steps.length ? w.info.replace(/^\d+:\d+ · /, '') : 'Zielwert während der Fahrt mit ± einstellen';
  $('woDur').textContent = w.steps.length ? fmtHM(workoutDuration(w)) : '–';
  $('woTss').textContent = w.steps.length ? String(workoutTss(w)) : '–';
  const cv = $<HTMLCanvasElement>('woPreview'); cv.hidden = !w.steps.length;
  if (w.steps.length && !$('trainErg').hidden) requestAnimationFrame(() => drawWorkout(cv, w, settings.ftp, 0, false));
  $('pillFtp').textContent = `FTP ${settings.ftp} W · ${settings.kg} kg`;
}
const woPage = new WorkoutPage(() => settings.ftp, () => settings.workout,
  id => { settings.workout = id; saveSettings(); setMode('erg'); },
  () => showPage('ride'), m => toast(m));

// ---------- Reiter ----------
function showPage(p: string) {
  document.querySelectorAll<HTMLElement>('.tab').forEach(t => t.classList.toggle('on', t.dataset.page === p));
  document.querySelectorAll<HTMLElement>('.page').forEach(el => { el.hidden = el.dataset.page !== p; });
  $('start').scrollTop = 0;
  if (p === 'workouts') woPage.render();
  if (p === 'routes') void renderRouteGrid();
  if (p === 'history') void renderHistory();
  if (p === 'ride') renderTraining();
}
document.querySelectorAll<HTMLElement>('.tab').forEach(t => t.onclick = () => showPage(t.dataset.page!));
document.addEventListener('click', e => { const g = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]'); if (g) showPage(g.dataset.goto!); });

function applyMode() {
  const erg = settings.mode === 'erg';
  $('btnMode').textContent = erg ? 'ERG' : 'Frei';
  $('btnMode').classList.toggle('on', erg);
  $('workoutBar').hidden = !(erg && workout().steps.length);
  if (erg && running && power > 30 && workout().steps.length === 0) ergTarget = Math.round(power / 5) * 5;
  nextSimSend = 0;
  if (erg) trainer?.setErg(currentErgTarget()).catch(() => {});
  updateControl();
}
function currentErgTarget() {
  const w = workout();
  if (!w.steps.length) return ergTarget;
  const t = workoutTarget(w, elapsed, settings.ftp);
  return Math.max(0, (t?.watts ?? Math.round(settings.ftp * 0.5)) + ergBias);
}

// Bedienfeld (je nach Modus: Simulator-Leistung, Schwierigkeit oder ERG-Ziel)
type CtlKind = 'simPower' | 'difficulty' | 'erg';
function ctlKind(): CtlKind {
  if (settings.mode === 'erg') return 'erg';
  return trainer?.simulated ? 'simPower' : 'difficulty';
}
const range = $<HTMLInputElement>('ctlRange');
function updateControl() {
  const k = ctlKind(), sim = trainer as SimulatedTrainer | null;
  if (k === 'simPower') { $('ctlLabel').textContent = 'Simulator-Leistung'; range.min = '0'; range.max = '600'; range.step = '5'; range.value = String(sim?.manualPower ?? 180); $('ctlValue').textContent = `${range.value} W`; }
  if (k === 'difficulty') { $('ctlLabel').textContent = 'Trainer-Schwierigkeit'; range.min = '0'; range.max = '100'; range.step = '5'; range.value = String(settings.difficulty); $('ctlValue').textContent = `${settings.difficulty} %`; }
  if (k === 'erg') {
    const w = workout().steps.length > 0;
    $('ctlLabel').textContent = w ? `ERG-Ziel (Anpassung ${ergBias >= 0 ? '+' : ''}${ergBias} W)` : 'ERG-Ziel';
    range.min = w ? '-100' : '50'; range.max = w ? '100' : '600'; range.step = '5';
    range.value = String(w ? ergBias : ergTarget);
    $('ctlValue').textContent = `${currentErgTarget()} W`;
  }
}
function changeControl(v: number) {
  const k = ctlKind();
  if (k === 'simPower' && trainer?.simulated) (trainer as SimulatedTrainer).manualPower = Math.max(0, Math.min(600, v));
  if (k === 'difficulty') { settings.difficulty = Math.max(0, Math.min(100, v)); saveSettings(); nextSimSend = 0; }
  if (k === 'erg') {
    if (workout().steps.length) ergBias = Math.max(-100, Math.min(100, v)); else ergTarget = Math.max(50, Math.min(600, v));
    trainer?.setErg(currentErgTarget()).catch(() => {});
  }
  updateControl();
}
const nudge = (dir: number) => changeControl(Number(range.value) + dir * Number(range.step));
range.oninput = () => changeControl(Number(range.value));
$('btnPlus').onclick = () => nudge(1);
$('btnMinus').onclick = () => nudge(-1);
$('btnMode').onclick = () => setMode(settings.mode === 'erg' ? 'sim' : 'erg');
$('btnCam').onclick = () => { $('btnCam').textContent = world.nextCamera(); };
$('btnPause').onclick = () => togglePause();
$('btnEnd').onclick = () => {
  const b = $('btnEnd');
  if (b.dataset.armed) { finish(); return; }
  b.dataset.armed = '1'; b.textContent = 'Wirklich?';
  setTimeout(() => { delete b.dataset.armed; b.textContent = 'Beenden'; }, 3000);
};
function togglePause() {
  if (!running) return;
  paused = !paused;
  $('btnPause').textContent = paused ? 'Weiter' : 'Pause';
  $('btnPause').classList.toggle('on', paused);
  toast(paused ? 'Pausiert' : 'Weiter geht’s');
}
const pad = new GamepadInput((a: PadAction) => {
  if (!running) return;
  if (a === 'up') nudge(1); if (a === 'down') nudge(-1);
  if (a === 'camNext' || a === 'camPrev') $('btnCam').textContent = world.nextCamera(a === 'camNext' ? 1 : -1);
  if (a === 'pause') togglePause();
  if (a === 'mode') setMode(settings.mode === 'erg' ? 'sim' : 'erg');
});

// ---------- Eingaben Startbildschirm ----------
const bindNum = (id: string, key: 'ftp' | 'kg' | 'difficulty') => {
  const el = $<HTMLInputElement>(id); el.value = String(settings[key]);
  el.onchange = () => { const v = Number(el.value); if (Number.isFinite(v) && v > 0 || key === 'difficulty') { settings[key] = v; saveSettings(); renderTraining(); } };
};
bindNum('inFtp', 'ftp'); bindNum('inKg', 'kg'); bindNum('inDiff', 'difficulty');
const qSel = $<HTMLSelectElement>('inQuality'); qSel.value = settings.quality;
qSel.onchange = () => { settings.quality = qSel.value as Settings['quality']; saveSettings(); toast('Grafikstufe gilt ab dem nächsten Laden der Seite'); };
const jersey = $<HTMLInputElement>('inJersey'); jersey.value = settings.jersey;
jersey.onchange = () => { settings.jersey = jersey.value; saveSettings(); toast('Trikotfarbe gilt ab dem nächsten Laden'); };
const design = $<HTMLSelectElement>('inDesign'); design.value = settings.design;
const syncDesign = () => { $('jerseyColorField').hidden = settings.design !== 'sauerland'; };
design.onchange = () => { settings.design = design.value as JerseyDesign; saveSettings(); syncDesign(); toast('Trikot gilt ab dem nächsten Laden der Strecke'); };
syncDesign();
setMode(settings.mode);

$('btnGo').onclick = async () => {
  if (!trainer) return;
  $('start').hidden = true; $('hud').hidden = false;
  running = true; paused = false;
  dist = startDist(); speed = 0; elapsed = 0; lastSampleSec = -1; ergBias = 0; recorder = new Recorder(); lap = 0;
  rideId = new Date().toISOString(); rideSimulated = trainer.simulated; trainerLost = false; rideStart = dist;
  if (resumeRide) {           // unterbrochene Fahrt fortsetzen
    recorder.samples = resumeRide.samples; rideId = resumeRide.id; rideSimulated = resumeRide.simulated && trainer.simulated;
    const lastS = recorder.samples.at(-1); dist = lastS?.dist ?? 0; elapsed = recorder.samples.length; lastSampleSec = Math.floor(elapsed);
    resumeRide = null; $('resumeBox').hidden = true; $('btnGo').textContent = 'Losfahren';
    world.snapCamera();
    rideStart = (recorder.samples[0]?.dist ?? dist); lap = Math.floor(dist / route.length) - Math.floor(rideStart / route.length);
  }
  ergTarget = Math.round(settings.ftp * 0.65 / 5) * 5;
  applyMode();
  $('btnPlaces').hidden = !trainer.simulated;
  onResize();
  try { wakeLock = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* optional */ }
  addEventListener('beforeunload', warnUnload);
  void persist(true);
  toast(trainer.simulated ? 'Simulator: Leistung unten einstellen' : 'Gute Fahrt!');
};

function finish() {
  if (!running) return;
  removeEventListener('beforeunload', warnUnload);
  running = false;
  wakeLock?.release().catch(() => {}); wakeLock = null;
  if (trainer && !trainer.simulated) trainer.setErg(0).catch(() => {});
  $('hud').hidden = true; $('done').hidden = false;
  const s = recorder.summary();
  const rows: [string, string][] = s ? [
    ['Strecke', `${fmt(s.distance / 1000, 2)} km`], ['Zeit', fmtTime(s.duration)], ['Ø Tempo', `${fmt(s.avgSpeed * 3.6, 1)} km/h`],
    ['Ø Leistung', `${fmt(s.avgPower)} W`], ['NP', s.np ? `${fmt(s.np)} W` : '–'], ['max. Leistung', `${fmt(s.maxPower)} W`],
    ['Ø Trittfrequenz', `${fmt(s.avgCadence)} U/min`], ['Ø Puls', s.avgHr ? `${fmt(s.avgHr)} bpm` : '–'], ['Arbeit', `${fmt(s.kj)} kJ`],
    ['Anstieg', `${fmt(s.ascent)} Hm`],
  ] : [['Strecke', '0 km']];
  $('summary').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('doneTitle').textContent = route.loop ? (lap >= 1 ? `${lap} ${lap === 1 ? 'Runde' : 'Runden'} geschafft!` : 'Gut gefahren!') : dist >= route.length - 1 ? 'Runde geschafft!' : 'Gut gefahren!';
  $<HTMLButtonElement>('btnFit').disabled = !s || s.duration < 10;
  void persist(true, true).then(() => { if (s && s.duration >= 10) saveFit(true); else $('uploadStatus').textContent = 'Fahrt zu kurz zum Speichern (unter 10 Sekunden)'; });
  $('lostBanner').hidden = true;
}

/** FIT-Datei in den Download-Ordner speichern (nach dem Beenden automatisch) */
function saveFit(auto = false) {
  try {
    const bytes = buildFit(recorder);
    const date = new Date(recorder.samples[0].t);
    const name = `Sauerland_${route.data.name}_${date.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.fit`;
    downloadFit(bytes, name);
    $('uploadStatus').textContent = `${auto ? 'Automatisch gespeichert' : 'Gespeichert'}: ${name} (Ordner „Downloads“)`;
    $('uploadBox').className = 'upload ok';
  } catch (e) { $('uploadStatus').textContent = `Speichern fehlgeschlagen: ${(e as Error).message}`; $('uploadBox').className = 'upload err'; }
}
$('btnFit').onclick = () => saveFit();
$('btnAgain').onclick = () => {
  rideId = ''; $('done').hidden = true; $('start').hidden = false; dist = startDist(); world.snapCamera(); };

// ---------- Streckenauswahl ----------
let routeFilter = 'all';
$('routeFilter').onclick = e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b) return; routeFilter = b.dataset.f!; $('routeFilter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); void renderRouteGrid(); };
$<HTMLSelectElement>('routeSort').onchange = () => void renderRouteGrid();
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ago = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? 'heute' : d === 1 ? 'gestern' : d < 14 ? `vor ${d} Tagen` : d < 60 ? `vor ${Math.round(d / 7)} Wochen` : new Date(iso).toLocaleDateString('de-DE'); };
async function renderRouteGrid() {
  const rides = await listRides(), lastBy = new Map<string, string>();
  for (const r of rides) if (r.samples.length >= 30 && !lastBy.has(r.route)) lastBy.set(r.route, r.id);
  const sort = $<HTMLSelectElement>('routeSort').value;
  const list = routes.filter(r => routeFilter === 'all' || (routeFilter === 's' ? r.length < 25000 : routeFilter === 'm' ? r.length >= 25000 && r.length <= 40000 : r.length > 40000))
    .sort((a, b) => sort === 'up' ? a.ascent - b.ascent : sort === 'name' ? a.name.localeCompare(b.name, 'de') : a.length - b.length);
  $('routeGrid').innerHTML = list.map(r => `<button class="card rcard${r.id === settings.route ? ' on' : ''}" data-id="${r.id}">
    <div class="rshape"><canvas></canvas>${r.id === settings.route ? '<span class="badge">gewählt</span>' : ''}</div><canvas class="rprof"></canvas>
    <div class="rb"><div class="rname">${esc(r.name)}</div>
    <dl class="stats"><div><dd>${fmt(r.length / 1000, 1)}</dd><dt>km</dt></div><div><dd>${fmt(r.ascent)}</dd><dt>Hm</dt></div><div><dd>${fmt(r.maxGrade, 1)} %</dd><dt>max</dt></div></dl>
    <div class="last">zuletzt gefahren: ${lastBy.has(r.id) ? ago(lastBy.get(r.id)!) : '–'}</div></div></button>`).join('') || '<p class="muted">Keine Strecke in dieser Auswahl.</p>';
  $('routeGrid').querySelectorAll<HTMLElement>('[data-id]').forEach(el => {
    const r = routes.find(x => x.id === el.dataset.id)!;
    if (r.shape) drawShape(el.querySelector('.rshape canvas')!, r.shape);
    if (r.prof) drawMiniProfile(el.querySelector('.rprof')!, r.prof);
    el.onclick = () => {
      if (running) return;
      if (r.id === settings.route) { showPage('ride'); return; }
      settings.route = r.id; chosenStart = null; saveSettings();
      $('loading').hidden = false; $('loading').firstElementChild!.textContent = 'Strecke wird gewechselt …';
      const u = new URL(location.href); u.searchParams.delete('km'); location.replace(u.toString());
    };
  });
}

// ---------- Fahrten ----------
async function renderHistory() {
  const rides = (await listRides()).filter(r => r.samples.length >= 10);
  $('historyList').innerHTML = rides.map(r => {
    const rec = new Recorder(); rec.samples = r.samples; const s = rec.summary();
    const name = routes.find(x => x.id === r.route)?.name ?? r.route;
    return `<div class="hrow" data-id="${esc(r.id)}"><div><div class="hd">${new Date(r.id).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</div><div class="hr">${esc(name)}${r.simulated ? ' · Simulator' : ''}${r.finished ? '' : ' · unterbrochen'}</div></div>
      <dl class="stats"><div><dd>${s ? fmt(s.distance / 1000, 1) : '0'}</dd><dt>km</dt></div><div><dd>${s ? fmtTime(s.duration) : '–'}</dd><dt>Zeit</dt></div><div><dd>${s ? fmt(s.avgPower) : '–'}</dd><dt>Ø W</dt></div><div><dd>${s?.avgHr ? fmt(s.avgHr) : '–'}</dd><dt>Ø Puls</dt></div></dl>
      <div class="ha"><button class="btn" data-act="fit">FIT speichern</button><button class="btn danger" data-act="del">Löschen</button></div></div>`;
  }).join('') || '<p class="muted">Noch keine Fahrten gespeichert.</p>';
}
$('historyList').onclick = async e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]'); if (!b) return;
  const id = b.closest<HTMLElement>('.hrow')!.dataset.id!, ride = (await listRides()).find(r => r.id === id); if (!ride) return;
  if (b.dataset.act === 'fit') {
    const rec = new Recorder(); rec.samples = ride.samples;
    const name = `Sauerland_${routes.find(x => x.id === ride.route)?.name ?? ride.route}_${new Date(ride.samples[0].t).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.fit`;
    downloadFit(buildFit(rec), name); toast(`Gespeichert: ${name}`);
  } else {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Wirklich?'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Löschen'; }, 3000); return; }
    if (id === rideId && running) return;
    await deleteRide(id); void renderHistory();
  }
};
function downloadFit(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- Sicherung der Fahrt ----------
const warnUnload = (e: BeforeUnloadEvent) => { persist(true); e.preventDefault(); e.returnValue = ''; };
function persist(force = false, finished = false) {
  if (!rideId || !recorder.samples.length) return Promise.resolve();
  const now = Date.now();
  if (!force && now - lastSave < 5000) return Promise.resolve();
  lastSave = now;
  return saveRide({ id: rideId, route: settings.route, samples: recorder.samples, finished, simulated: rideSimulated, upload: finished ? { status: 'pending' } : undefined });
}
addEventListener('pagehide', () => { if (running) persist(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && running) persist(true); });

/** Beim Start: unterbrochene Fahrt anbieten */
async function checkPending() {
  const rides = await listRides();
  const open = rides.find(r => !r.finished && r.samples.length >= 30);
  if (open && open.route && open.route !== settings.route && routes.some(r => r.id === open.route)) { settings.route = open.route; saveSettings(); location.reload(); return; }
  if (open) {
    resumeRide = open;
    const last = open.samples.at(-1)!;
    $('resumeInfo').textContent = `${new Date(open.samples[0].t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · ${fmt(last.dist / 1000, 1)} km · ${fmtTime(open.samples.length)}`;
    $('resumeBox').hidden = false; $('btnGo').textContent = 'Weiterfahren';
  }
}
$('btnResume').onclick = () => { toast(trainer ? 'Mit „Weiterfahren“ geht es an der gespeicherten Stelle weiter' : 'Erst Trainer (oder Simulator) verbinden, dann „Weiterfahren“'); };
$('btnResumeDrop').onclick = async () => { if (resumeRide) await deleteRide(resumeRide.id); resumeRide = null; $('resumeBox').hidden = true; $('btnGo').textContent = 'Losfahren'; };
$('btnResumeEnd').onclick = async () => {
  if (!resumeRide) return;
  recorder = new Recorder(); recorder.samples = resumeRide.samples; rideId = resumeRide.id; rideSimulated = resumeRide.simulated;
  dist = recorder.samples.at(-1)!.dist; resumeRide = null; $('resumeBox').hidden = true; $('btnGo').textContent = 'Losfahren';
  running = true; $('start').hidden = true; finish();
};

// Startpunkt per Adresse wählbar, z. B. ?km=12.5 (zum Testen einzelner Abschnitte)
function startDist() {
  if (chosenStart !== null) return chosenStart;
  const km = Number(new URLSearchParams(location.search).get('km'));
  return Number.isFinite(km) && km > 0 ? Math.min(route.length - 100, km * 1000) : 0;
}

// ---------- Springen ----------
const canJump = () => !running || !!trainer?.simulated;
function jumpTo(d: number) {
  d = Math.max(0, Math.min(route.length - 50, d));
  if (!canJump()) { toast('Springen geht während einer echten Fahrt nicht – nur im Simulator oder vor dem Start'); return; }
  if (running) { const ridden = dist - rideStart; dist = d + Math.floor(dist / route.length) * (route.loop ? route.length : 0); rideStart = dist - ridden; toast(`Weiter bei km ${fmt(d / 1000, 1)}`); }
  else { chosenStart = d; dist = d; updateStartLabel(); }
  world.snapCamera();
  picker.hide();
}
function updateStartLabel() {
  const places = placeList(route);
  const p = [...places].reverse().find(x => x.d <= dist + 1) ?? places[0];
  $('startAtLabel').textContent = `km ${fmt(dist / 1000, 1)} · ${placeLabel(p)}${p.area && p.road ? `, ${p.area}` : ''}`;
}
$('btnStartAt').onclick = () => picker.show(dist);
$('btnPlaces').onclick = () => { if (canJump()) picker.show(dist); else toast('Springen geht nur im Simulator'); };
$('btnPlacesClose').onclick = () => picker.hide();
$('profile').addEventListener('pointerdown', e => {
  if (!running || !canJump()) return;
  const r = $('profile').getBoundingClientRect();
  jumpTo((e.clientX - r.left) / r.width * route.length);
});

// ---------- Hauptschleife ----------
let last = performance.now(), lastPhysics = performance.now(), hudTimer = 0;
function loop(now: number) {
  const dt = Math.min(1, (now - last) / 1000); last = now;
  const prevPhysics = lastPhysics; lastPhysics = now;
  pad.poll(now);
  const grade = route.gradeAt(dist);
  const stalled = trainerLost && !!trainer && !trainer.simulated;   // Verbindung weg → Fahrt pausiert
  if (running && !paused && !stalled) {
    // Physik in Echtzeit, auch bei niedriger Bildrate (Teilschritte à max. 50 ms)
    const p = trainer ? power : 0, realDt = Math.min(1, (now - prevPhysics) / 1000);
    for (let left = realDt; left > 1e-6; left -= 0.05) {
      const h = Math.min(0.05, left);
      speed = stepSpeed(speed, p, route.gradeAt(dist), rider(), h);
      dist = route.loop ? dist + speed * h : Math.min(route.length, dist + speed * h);
      elapsed += h;
    }
    // Trainer steuern
    if (now >= nextSimSend && trainer) {
      nextSimSend = now + 1000;
      if (settings.mode === 'sim') {
        const g = grade * settings.difficulty / 100;
        trainer.setSim(Math.round(g * 10) / 10, 0.004, 0.51).catch(() => {});
      } else if (workout().steps.length) trainer.setErg(currentErgTarget()).catch(() => {});
    }
    // Aufzeichnung (1 Hz)
    const sec = Math.floor(elapsed);
    if (sec !== lastSampleSec) {
      lastSampleSec = sec;
      const [lat, lon] = route.toLatLon(route.xAt(dist), route.yAt(dist));
      recorder.add({ t: Date.now(), dist, speed, power: trainer ? power : 0, cadence, hr, lat, lon, alt: route.hAt(dist) });
      void persist();
    }
    if (route.loop) {
      const l = Math.floor(dist / route.length) - Math.floor(rideStart / route.length);   // Überquerungen der Ziellinie
      if (l > lap) { lap = l; toast(`Runde ${lap} geschafft – weiter geht’s mit Runde ${lap + 1}`, 4000); }
    } else if (dist >= route.length) finish();
  } else if (running && (paused || stalled)) {
    if (stalled) lastPhysics = now;
    speed = Math.max(0, speed - dt * 3);
  }
  const shownCad = running && !paused ? cadence : 0;
  world.frame(dist, dt, speed, shownCad, Math.min(1.5, power / settings.ftp));

  hudTimer -= dt;
  if (running && hudTimer <= 0) { hudTimer = 0.2; updateHud(grade); }
  requestAnimationFrame(loop);
}

function updateHud(grade: number) {
  const z = zone(power, settings.ftp);
  $('vPower').textContent = fmt(power);
  $('vZone').textContent = `Z${z}`;
  document.querySelector<HTMLElement>('.tile.power')!.style.setProperty('--zone', zoneColor(z));
  $('vSpeed').textContent = fmt(speed * 3.6, 1);
  $('vCad').textContent = fmt(cadence);
  $('vHr').textContent = hr ? fmt(hr) : '–';
  $('vGrade').textContent = fmt(grade, 1);
  document.querySelector<HTMLElement>('.tile.grade')!.style.setProperty('--grade-c', grade > 1 ? gradeColor(grade) : 'var(--ink)');
  $('vTime').textContent = fmtTime(elapsed);
  $('vDist').textContent = `${fmt(dist / 1000, 2)} km`;
  const pos = route.wrap(dist);
  $('vDist').textContent = `${fmt((dist - rideStart) / 1000, 2)} km`;
  $('vLeft').textContent = route.loop ? `R${lap + 1} · ${fmt((route.length - pos) / 1000, 1)} km` : `${fmt((route.length - dist) / 1000, 1)} km`;
  profile.draw(pos);
  minimap.draw(pos);
  if (settings.mode === 'erg') {
    const w = workout();
    if (w.steps.length) {
      const t = workoutTarget(w, elapsed, settings.ftp);
      $('woLabel').textContent = t ? `${t.step.label ?? ''} · ${currentErgTarget()} W` : 'Workout fertig – weiter mit freiem ERG';
      $('woRemain').textContent = t ? fmtMin(t.remaining) : '';
      drawWorkout($<HTMLCanvasElement>('woCanvas'), w, settings.ftp, elapsed);
    }
    $('ctlValue').textContent = `${currentErgTarget()} W`;
  }
}

(window as unknown as { __sauerland: unknown }).__sauerland = { get world() { return world; } };
init().catch(e => { $('loading').firstElementChild!.textContent = 'Fehler beim Laden'; const el = $('loadError'); el.hidden = false; el.textContent += `${(e as Error).message}\n${(e as Error).stack ?? ''}`; console.error(e); });
