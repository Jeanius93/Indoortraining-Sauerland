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

export class FtmsTrainer implements Trainer {
  readonly simulated = false;
  onData: (d: TrainerData) => void = () => {};
  onDisconnect: () => void = () => {};
  private queue: Promise<unknown> = Promise.resolve();
  private lastSim = '';

  private constructor(private device: BluetoothDevice, private cp: BluetoothRemoteGATTCharacteristic) {}

  get name() { return this.device.name ?? 'Smarttrainer'; }

  static async connect(): Promise<FtmsTrainer> {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [FTMS] }] });
    const server = await device.gatt!.connect();
    const svc = await server.getPrimaryService(FTMS);
    const data = await svc.getCharacteristic(INDOOR_BIKE_DATA);
    const cp = await svc.getCharacteristic(CONTROL_POINT);
    const t = new FtmsTrainer(device, cp);
    device.addEventListener('gattserverdisconnected', () => t.onDisconnect());
    data.addEventListener('characteristicvaluechanged', e => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value; if (v) t.onData(parseIndoorBikeData(v));
    });
    await data.startNotifications();
    await cp.startNotifications(); // Indications für Antworten
    await t.write([0x00]);        // Steuerung anfordern
    await t.write([0x07]);        // Start/Fortsetzen
    return t;
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

  disconnect() { this.device.gatt?.disconnect(); }
}

export class HeartRateMonitor {
  onHr: (bpm: number) => void = () => {};
  private constructor(private device: BluetoothDevice) {}
  get name() { return this.device.name ?? 'Pulsgurt'; }

  static async connect() {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    const svc = await (await device.gatt!.connect()).getPrimaryService('heart_rate');
    const ch = await svc.getCharacteristic('heart_rate_measurement');
    const m = new HeartRateMonitor(device);
    ch.addEventListener('characteristicvaluechanged', e => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
      m.onHr(v.getUint8(0) & 1 ? v.getUint16(1, true) : v.getUint8(1));
    });
    await ch.startNotifications();
    return m;
  }
  disconnect() { this.device.gatt?.disconnect(); }
}
