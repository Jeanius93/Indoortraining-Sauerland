// Fahrten dauerhaft im Browser sichern (IndexedDB). Die laufende Fahrt wird alle paar Sekunden gespeichert,
// damit sie einen Verbindungsabbruch, Absturz oder ein versehentliches Schließen übersteht.
import type { Sample } from './recorder';

export interface StoredRide {
  id: string;                 // Startzeit als ISO-Text
  route: string;
  samples: Sample[];
  finished: boolean;
  simulated: boolean;
  upload?: { status: 'ok' | 'error' | 'pending'; activityId?: number; message?: string };
}

const DB = 'sauerland-indoor', STORE = 'rides';
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await db();
  return new Promise<T>((res, rej) => { const q = fn(d.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
export const saveRide = (r: StoredRide) => tx('readwrite', s => s.put(r)).catch(e => console.warn('Speichern fehlgeschlagen', e));
export const deleteRide = (id: string) => tx('readwrite', s => s.delete(id)).catch(() => {});
export async function listRides(): Promise<StoredRide[]> {
  try { return ((await tx('readonly', s => s.getAll())) as StoredRide[]).sort((a, b) => b.id.localeCompare(a.id)); } catch { return []; }
}
/** Alte, erfolgreich hochgeladene Fahrten aufräumen (die letzten 20 bleiben) */
export async function pruneRides() {
  const all = await listRides();
  for (const r of all.slice(20)) if (r.upload?.status === 'ok') await deleteRide(r.id);
}
