// Direkter Upload zu Strava (OAuth 2). Für den Eigengebrauch: Du legst unter strava.com/settings/api eine eigene
// „API-Anwendung“ an und trägst Client-ID und Client-Secret einmalig in der App ein. Beides bleibt nur in diesem
// Browser gespeichert (localStorage) und wird ausschließlich an strava.com gesendet.
const KEY = 'sauerland.strava';
interface Conf { clientId: string; clientSecret: string; access?: string; refresh?: string; expires?: number; athlete?: string; auto?: boolean }

function load(): Conf | null { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } }
function save(c: Conf | null) { try { c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY); } catch { /* egal */ } }

export const strava = {
  get config() { return load(); },
  get connected() { return !!load()?.refresh; },
  get auto() { return load()?.auto !== false; },
  setAuto(v: boolean) { const c = load(); if (c) save({ ...c, auto: v }); },
  redirectUri() { return location.origin + location.pathname; },

  /** Schritt 1: zur Strava-Anmeldung weiterleiten */
  connect(clientId: string, clientSecret: string) {
    save({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), auto: true });
    const u = new URL('https://www.strava.com/oauth/authorize');
    u.searchParams.set('client_id', clientId.trim()); u.searchParams.set('redirect_uri', this.redirectUri());
    u.searchParams.set('response_type', 'code'); u.searchParams.set('approval_prompt', 'auto'); u.searchParams.set('scope', 'activity:write');
    location.href = u.toString();
  },

  /** Schritt 2: nach der Rückkehr (?code=…) den Code gegen Tokens tauschen. Gibt null zurück, wenn nichts zu tun ist. */
  async finishConnect(): Promise<string | null> {
    const q = new URLSearchParams(location.search), code = q.get('code'), err = q.get('error');
    if (!code && !err) return null;
    history.replaceState(null, '', this.redirectUri() + location.hash);
    if (err) return 'Strava-Verbindung abgebrochen';
    if (!q.get('scope')?.includes('activity:write')) return 'Bitte bei Strava das Hochladen von Aktivitäten erlauben';
    const c = load(); if (!c) return 'Client-ID fehlt – bitte erneut verbinden';
    const t = await token({ client_id: c.clientId, client_secret: c.clientSecret, code, grant_type: 'authorization_code' });
    save({ ...c, access: t.access_token, refresh: t.refresh_token, expires: t.expires_at, athlete: [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(' ') });
    return 'Strava verbunden';
  },

  disconnect() { const c = load(); save(c ? { clientId: c.clientId, clientSecret: c.clientSecret, auto: c.auto } : null); },

  /** FIT-Datei hochladen und warten, bis Strava sie verarbeitet hat. Liefert die Aktivitäts-ID. */
  async upload(fit: Uint8Array, name: string, externalId: string, onStatus?: (s: string) => void): Promise<number> {
    const access = await accessToken();
    const fd = new FormData();
    fd.append('file', new Blob([fit as BlobPart], { type: 'application/octet-stream' }), `${externalId}.fit`);
    fd.append('data_type', 'fit'); fd.append('name', name); fd.append('trainer', '1'); fd.append('external_id', externalId);
    fd.append('description', 'Indoortraining auf der Hausrunde – Sauerland Indoor');
    onStatus?.('Lade zu Strava hoch …');
    let r = await fetch('https://www.strava.com/api/v3/uploads', { method: 'POST', headers: { Authorization: `Bearer ${access}` }, body: fd });
    let j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message ?? j.error ?? `Strava antwortet ${r.status}`);
    for (let i = 0; i < 30 && !j.activity_id && !j.error; i++) {          // Verarbeitung abwarten (max. ~60 s)
      onStatus?.('Strava verarbeitet die Fahrt …');
      await new Promise(res => setTimeout(res, 2000));
      r = await fetch(`https://www.strava.com/api/v3/uploads/${j.id}`, { headers: { Authorization: `Bearer ${access}` } });
      j = await r.json().catch(() => ({}));
    }
    if (j.error) {
      // Doppelt hochgeladen? Dann ist die Fahrt schon da – die ID steht in der Meldung
      const dup = /duplicate of .*?(\d{6,})/i.exec(j.error); if (dup) return Number(dup[1]);
      throw new Error(j.error);
    }
    if (!j.activity_id) throw new Error('Strava hat die Fahrt noch nicht fertig verarbeitet – sie erscheint gleich in deinem Profil');
    return j.activity_id;
  },
};

async function token(body: Record<string, unknown>) {
  const r = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message === 'Bad Request' ? 'Client-ID oder Client-Secret falsch' : j.message ?? `Strava antwortet ${r.status}`);
  return j;
}
async function accessToken() {
  const c = load();
  if (!c?.refresh) throw new Error('Nicht mit Strava verbunden');
  if (c.access && c.expires && c.expires * 1000 > Date.now() + 120_000) return c.access;
  const t = await token({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token', refresh_token: c.refresh });
  save({ ...c, access: t.access_token, refresh: t.refresh_token ?? c.refresh, expires: t.expires_at });
  return t.access_token as string;
}
