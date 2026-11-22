// Erzeugt eine FIT-Datei (Virtual Ride) für den Upload bei Strava, Garmin Connect & Co.
import { Encoder, Profile } from '@garmin/fitsdk';
import type { Recorder } from './recorder';

const semi = (deg: number) => Math.round(deg * 2 ** 31 / 180);

export function buildFit(rec: Recorder): Uint8Array {
  const s = rec.samples, sum = rec.summary();
  if (!sum) throw new Error('Keine Daten aufgezeichnet');
  const start = new Date(s[0].t), end = new Date(s.at(-1)!.t);
  const elapsed = (s.at(-1)!.t - s[0].t) / 1000 + 1;
  const timer = s.length;
  const M = Profile.MesgNum;
  const e = new Encoder();
  const put = (num: number, m: Record<string, unknown>) => e.onMesg(num, m as never);

  put(M.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, serialNumber: 1993, timeCreated: start });
  put(M.DEVICE_INFO, { timestamp: start, manufacturer: 'development', product: 1, productName: 'Indoortraining Sauerland', softwareVersion: 0.1, deviceIndex: 'creator' });
  put(M.EVENT, { timestamp: start, event: 'timer', eventType: 'start', eventGroup: 0 });

  for (const x of s) {
    const r: Record<string, unknown> = {
      timestamp: new Date(x.t), positionLat: semi(x.lat), positionLong: semi(x.lon),
      altitude: x.alt, distance: x.dist, speed: x.speed, power: Math.round(x.power), cadence: Math.round(x.cadence),
    };
    if (x.hr) r.heartRate = Math.round(x.hr);
    put(M.RECORD, r);
  }

  put(M.EVENT, { timestamp: end, event: 'timer', eventType: 'stopAll', eventGroup: 0 });
  const totals = {
    timestamp: end, startTime: start, totalElapsedTime: elapsed, totalTimerTime: timer, totalDistance: sum.distance,
    sport: 'cycling', subSport: 'virtualActivity', avgPower: Math.round(sum.avgPower), maxPower: Math.round(sum.maxPower),
    normalizedPower: Math.round(sum.np), avgCadence: Math.round(sum.avgCadence), avgSpeed: sum.avgSpeed, maxSpeed: sum.maxSpeed,
    totalAscent: Math.round(sum.ascent), totalCalories: Math.round(sum.kj), totalWork: Math.round(sum.kj * 1000),
    ...(sum.avgHr ? { avgHeartRate: Math.round(sum.avgHr), maxHeartRate: Math.round(sum.maxHr) } : {}),
  };
  put(M.LAP, { ...totals, event: 'lap', eventType: 'stop', messageIndex: 0 });
  put(M.SESSION, { ...totals, event: 'session', eventType: 'stop', messageIndex: 0, firstLapIndex: 0, numLaps: 1, trigger: 'activityEnd' });
  const tzOffset = -new Date().getTimezoneOffset() * 60;
  put(M.ACTIVITY, { timestamp: end, totalTimerTime: timer, numSessions: 1, type: 'manual', event: 'activity', eventType: 'stop', localTimestamp: Math.round(end.getTime() / 1000) - 631065600 + tzOffset });
  return e.close();
}
