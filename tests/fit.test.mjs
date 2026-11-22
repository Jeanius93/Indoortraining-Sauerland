// Prüft, dass die erzeugte FIT-Datei gültig ist und als virtuelle Radfahrt erkannt wird.
import test from 'node:test';
import assert from 'node:assert';
import { build } from 'vite';

test('FIT-Datei ist gültig und lesbar', async () => {
  const out = await build({
    logLevel: 'silent', configFile: false,
    build: { write: false, lib: { entry: 'tests/fit-entry.ts', formats: ['es'], fileName: 'x' }, rollupOptions: { external: [/@garmin/] } },
  });
  const code = out[0].output[0].code;
  const url = 'data:text/javascript;base64,' + Buffer.from(code.replaceAll('"@garmin/fitsdk"', JSON.stringify(import.meta.resolve('@garmin/fitsdk')))).toString('base64');
  const { makeFit } = await import(url);
  const { Decoder, Stream } = await import('@garmin/fitsdk');
  const bytes = makeFit();
  const dec = new Decoder(Stream.fromByteArray(bytes));
  assert.ok(dec.isFIT(), 'FIT-Header');
  assert.ok(dec.checkIntegrity(), 'CRC');
  const { messages, errors } = dec.read();
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(messages.recordMesgs.length, 120);
  assert.strictEqual(messages.sessionMesgs[0].subSport, 'virtualActivity');
  assert.ok(Math.abs(messages.recordMesgs[0].positionLat * 180 / 2 ** 31 - 51.2) < 1e-5);
  assert.strictEqual(messages.recordMesgs[5].power, 205);
  assert.ok(messages.sessionMesgs[0].avgHeartRate > 0);
});
