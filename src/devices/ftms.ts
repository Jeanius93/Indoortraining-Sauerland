// Bluetooth FTMS (Fitness Machine Service) – Elite Suito und andere Smarttrainer
import type { Trainer, TrainerData } from './types';

const FTMS = 0x1826, INDOOR_BIKE_DATA = 0x2ad2, CONTROL_POINT = 0x2ad9;

export function bluetoothAvailable() {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function parseIndoorBikeData(dv: DataView): TrainerData {
  const flags = dv.getUint16(0, true); let o = 2; const d: TrainerData = {};
  if (!(flags & 0x0001)) { d.speed = dv.getUint16(o, true) / 100; o += 2; }
  if (flags & 0x0002) o += 2;                                 // Durchschnittsgeschw.
  if (flags & 0x0004) { d.cadence = dv.getUint16(o, true) / 2; o += 2; }
  if (flags & 0x0008) o += 2;                                 // Durchschnittskadenz
  if (flags & 0x0010) o += 3;                                 // Gesamtstrecke
  if (flags & 0x0020) o += 2;                                 // Widerstandsstufe
  if (flags & 0x0040) { d.power = dv.getInt16(o, true); o += 2; }
  if (flags & 0x0080) o += 2;                                 // Durchschnittsleistung
  if (flags & 0x0100) o += 5;                                 // Energie
  if (flags & 0x0200) { d.hr = dv.getUint8(o); o += 1; }
  return d;
}

/** Hält eine Bluetooth-Verbindung: verbindet bei Abbruch selbstständig neu (alle 2–10 s, unbegrenzt bis disconnect()). */
class Link {
  private closed = false; private retrying = false;
  onLost: () => void = () => {};
  onBack: () => void = () => {};
  constructor(readonly device: BluetoothDevice, private setup: () => Promise<void>) {
    device.addEventListener('gattserverdisconnected', () => { if (!this.closed) { this.onLost(); void this.retry(); } });
  }
  private async retry() {
    if (this.retrying) return; this.retrying = true;
    for (let attempt = 0; !this.closed; attempt++) {
      await new Promise(r => setTimeout(r, Math.min(10000, 2000 + attempt * 1000)));
      if (this.closed) break;
      try { await this.setup(); this.retrying = false; this.onBack(); return; } catch { /* erneut versuchen */ }
    }
    this.retrying = false;
  }
  close() { this.closed = true; this.device.gatt?.disconnect(); }
}

export class FtmsTrainer implements Trainer {
  readonly simulated = false;
  onData: (d: TrainerData) => void = () => {};
  onDisconnect: () => void = () => {};
  onReconnect: () => void = () => {};
  private queue: Promise<unknown> = Promise.resolve();
  private lastSim = '';
  private cp!: BluetoothRemoteGATTCharacteristic;
  private link: Link;

  private constructor(private device: BluetoothDevice) {
    this.link = new Link(device, () => this.setup());
    this.link.onLost = () => this.onDisconnect();
    this.link.onBack = () => this.onReconnect();
  }

  get name() { return this.device.name ?? 'Smarttrainer'; }

  static async connect(): Promise<FtmsTrainer> {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [FTMS] }] });
    const t = new FtmsTrainer(device);
    await t.setup();
    return t;
  }

  /** GATT verbinden, Daten abonnieren, Steuerung übernehmen (auch beim Neuverbinden) */
  private async setup() {
    const server = await this.device.gatt!.connect();
    const svc = await server.getPrimaryService(FTMS);
    const data = await svc.getCharacteristic(INDOOR_BIKE_DATA);
    this.cp = await svc.getCharacteristic(CONTROL_POINT);
    data.addEventListener('characteristicvaluechanged', e => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value; if (v) this.onData(parseIndoorBikeData(v));
    });
    await data.startNotifications();
    await this.cp.startNotifications(); // Indications für Antworten
    this.queue = Promise.resolve(); this.lastSim = '';
    await this.write([0x00]);           // Steuerung anfordern
    await this.write([0x07]);           // Start/Fortsetzen
  }

  private write(bytes: number[]) {
    const job = this.queue.then(() => this.cp.writeValueWithResponse(new Uint8Array(bytes)));
    this.queue = job.catch(() => {});
    return job.then(() => {});
  }

  setErg(watts: number) {
    const w = Math.round(Math.max(0, Math.min(2000, watts)));
    return this.write([0x05, w & 0xff, (w >> 8) & 0xff]);
  }

  setSim(gradePct: number, crr: number, cw: number) {
    const g = Math.round(Math.max(-40, Math.min(40, gradePct)) * 100);
    const bytes = [0x11, 0, 0, g & 0xff, (g >> 8) & 0xff, Math.round(crr * 10000) & 0xff, Math.round(cw * 100) & 0xff];
    const key = bytes.join(',');
    if (key === this.lastSim) return Promise.resolve();
    this.lastSim = key;
    return this.write(bytes);
  }

  disconnect() { this.link.close(); }
}

export class HeartRateMonitor {
  onHr: (bpm: number) => void = () => {};
  onLost: () => void = () => {};
  onBack: () => void = () => {};
  private link: Link;
  private constructor(private device: BluetoothDevice) {
    this.link = new Link(device, () => this.setup());
    this.link.onLost = () => this.onLost(); this.link.onBack = () => this.onBack();
  }
  get name() { return this.device.name ?? 'Pulsgurt'; }

  static async connect() {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    const m = new HeartRateMonitor(device);
    await m.setup();
    return m;
  }
  private async setup() {
    const svc = await (await this.device.gatt!.connect()).getPrimaryService('heart_rate');
    const ch = await svc.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', e => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
      this.onHr(v.getUint8(0) & 1 ? v.getUint16(1, true) : v.getUint8(1));
    });
    await ch.startNotifications();
  }
  disconnect() { this.link.close(); }
}
