"""Straßenausstattung entlang der Strecke (nach deutschen Regelwerken, abgeleitet aus amtlichen Daten):

- Ortslagen: Abschnitte, in denen beidseits Siedlungs-/Gewerbeflächen liegen (Nutzungskarte)
- Ortstafeln (Z 310 Eingang / Z 311 Ausgang) mit Ortsname (Weilername aus Straßennamen oder Gemarkung)
  und Gemeinde (ALKIS)
- Leitpfosten außerorts alle 50 m beidseitig (nicht an Einmündungen, nicht auf Radwegen)
- Schutzplanken an Böschungen (Gelände > 2,5 m unter der Fahrbahn) und an Gewässern
- Straßenlaternen innerorts alle ~32 m, Bordsteine innerorts

Aufruf: python3 scripts/prepare-furniture.py public/routes/hausrunde scripts/.cache/alkis/*.gpkg
Ausgabe: furniture.json (Positionen als Streckenmeter + Seite)
"""
import gzip, json, math, os, re, sqlite3, struct, sys
import numpy as np

route_dir, gpkgs = sys.argv[1], sys.argv[2:]
route = json.load(open(os.path.join(route_dir, 'route.json')))
T = route['terrain']; x0, y0, cell, nx, ny = T['x0'], T['y0'], T['cell'], T['nx'], T['ny']
L = route['landuse']; PX = L['px']
raw = open(os.path.join(route_dir, 'landuse.bin'), 'rb').read()
lu = np.frombuffer(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw, np.uint8).reshape(L['h'], L['w'])
terr = np.frombuffer(open(os.path.join(route_dir, 'terrain_raw.bin'), 'rb').read(), np.int16).reshape(ny, nx) * T['scale']
side_roads = json.load(open(os.path.join(route_dir, 'roads.json')))['roads'] if os.path.exists(os.path.join(route_dir, 'roads.json')) else []
rx, ry, rh = np.array(route['x']), np.array(route['y']), np.array(route['h'])
step, n = route['step'], len(route['x'])
radweg = route.get('surface', [])
is_rad = np.array([any(s['from'] <= k * step <= s['to'] for s in radweg) for k in range(n)])
hw = np.where(is_rad, 1.7, 2.8)

def lu_at(x, y):
    i, j = int((x - x0) / PX), int((y - y0) / PX)
    return lu[j, i] if 0 <= i < L['w'] and 0 <= j < L['h'] else 0
def terrain_at(x, y):
    fx, fy = (x - x0) / cell, (y - y0) / cell; i, j = int(fx), int(fy)
    if not (0 <= i < nx - 1 and 0 <= j < ny - 1): return float('nan')
    u, v = fx - i, fy - j
    return terr[j, i] * (1 - u) * (1 - v) + terr[j, i + 1] * u * (1 - v) + terr[j + 1, i] * (1 - u) * v + terr[j + 1, i + 1] * u * v
# Normale (links der Fahrtrichtung) je Punkt
dx = np.gradient(rx); dy = np.gradient(ry); ln = np.hypot(dx, dy); dx /= ln; dy /= ln
nlx, nly = -dy, dx   # links

def segments(mask, min_len, gap):
    out, k = [], 0
    while k < n:
        if mask[k]:
            s = k
            while k < n and mask[k]: k += 1
            out.append([s, k - 1])
        else: k += 1
    merged = []
    for a, b in out:
        if merged and (a - merged[-1][1]) * step < gap: merged[-1][1] = b
        else: merged.append([a, b])
    return [[a, b] for a, b in merged if (b - a) * step >= min_len]

# ---------- Ortslagen ----------
settle = np.zeros(n)
for k in range(n):
    hits = tot = 0
    for side in (-1, 1):
        for off in (12, 22, 35, 50):
            c = lu_at(rx[k] + nlx[k] * off * side, ry[k] + nly[k] * off * side); tot += 1
            hits += c in (6, 7, 13)
    settle[k] = hits / tot
win = int(150 / step)
settle_s = np.convolve(settle, np.ones(2 * win + 1) / (2 * win + 1), mode='same')
towns = segments(settle_s > 0.38, 250, 200)

# ---------- Namen: Gemarkung, Gemeinde, Weilernamen aus Straßennamen ----------
a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
e2 = f * (2 - f); ep2 = e2 / (1 - e2); L0 = math.radians(9)
lat0, lon0 = route['origin']['lat'], route['origin']['lon']
def to_utm(lat, lon):
    p, l = math.radians(lat), math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(p)**2); Tt = math.tan(p)**2; C = ep2 * math.cos(p)**2; A = math.cos(p) * (l - L0)
    M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256)*p - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024)*math.sin(2*p) + (15*e2**2/256 + 45*e2**3/1024)*math.sin(4*p) - (35*e2**3/3072)*math.sin(6*p))
    E = 500000 + k0*N*(A + (1 - Tt + C)*A**3/6 + (5 - 18*Tt + Tt**2 + 72*C - 58*ep2)*A**5/120)
    Nn = k0*(M + N*math.tan(p)*(A**2/2 + (5 - Tt + 9*C + 4*C**2)*A**4/24 + (61 - 58*Tt + Tt**2 + 600*C - 330*ep2)*A**6/720))
    return E, Nn
R = 6378137.0; kx = R * math.cos(math.radians(lat0)) * math.pi / 180; ky = R * math.pi / 180
utm = lambda x, y: to_utm(lat0 + y / ky, lon0 + x / kx)
def gpkg_rings(blob):
    flags = blob[3]; env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 7]; buf = memoryview(blob)[8 + env:]; out = []
    def rd(off):
        bo = '<' if buf[off] == 1 else '>'; t = struct.unpack_from(bo + 'I', buf, off + 1)[0]; off += 5
        dims = 3 if (t // 1000) in (1, 2) or (t & 0x80000000) else 2; base = (t & 0xffff) % 1000
        if base == 3:
            m = struct.unpack_from(bo + 'I', buf, off)[0]; off += 4; poly = []
            for _ in range(m):
                c = struct.unpack_from(bo + 'I', buf, off)[0]; off += 4
                pts = struct.unpack_from(bo + f'{c*dims}d', buf, off); off += c * dims * 8
                poly.append([(pts[i], pts[i + 1]) for i in range(0, len(pts), dims)])
            out.append(poly); return off
        if base == 6:
            m = struct.unpack_from(bo + 'I', buf, off)[0]; off += 4
            for _ in range(m): off = rd(off)
            return off
        raise ValueError(t)
    rd(0); return out
def inside(parts, E, N):
    for poly in parts:
        ins = False
        for ring in poly:
            j = len(ring) - 1
            for i in range(len(ring)):
                xi, yi = ring[i]; xj, yj = ring[j]
                if (yi > N) != (yj > N) and E < (xj - xi) * (N - yi) / (yj - yi) + xi: ins = not ins
                j = i
        if ins: return True
    return False
E_all = [utm(x, y) for x, y in zip(rx[::20], ry[::20])]
minE, maxE = min(e for e, _ in E_all) - 600, max(e for e, _ in E_all) + 600
minN, maxN = min(nn for _, nn in E_all) - 600, max(nn for _, nn in E_all) + 600
gem, gde, streets = [], [], []
for g in gpkgs:
    c = sqlite3.connect(g)
    for name, geom in c.execute("select name, geometrie from KatasterBezirk where art = 'Gemarkung'"): gem.append((name, gpkg_rings(geom)))
    for name, geom in c.execute("select name, geometrie from VerwaltungsEinheit where art = 'Gemeinde'"): gde.append((name, gpkg_rings(geom)))
    for name, geom in c.execute("select name, geometrie from Nutzung where nutzart = 'Straßenverkehr' and name is not null"):
        parts = gpkg_rings(geom); pts = [p for poly in parts for p in poly[0]]
        e0_, e1_ = min(p[0] for p in pts), max(p[0] for p in pts); n0_, n1_ = min(p[1] for p in pts), max(p[1] for p in pts)
        if e1_ < minE or e0_ > maxE or n1_ < minN or n0_ > maxN: continue
        streets.append((name, ((e0_ + e1_) / 2, (n0_ + n1_) / 2)))
def lookup(items, E, N): return next((nm for nm, parts in items if inside(parts, E, N)), None)
STAEDTE = {'Altena', 'Balve', 'Halver', 'Hemer', 'Iserlohn', 'Kierspe', 'Lüdenscheid', 'Meinerzhagen', 'Menden (Sauerl.)', 'Neuenrade', 'Plettenberg', 'Werdohl', 'Attendorn', 'Olpe', 'Lennestadt', 'Drolshagen'}
NOT_PLACE = re.compile(r'(straße|strasse|weg|gasse|platz|ring|allee|pfad|steig|ufer|hang|berg$|^(am|an|auf|im|in|zum|zur|von|bei|unterm|unter|hinter|vor|über)\b|^[A-Z]{1,2} ?\d)', re.I)
PLACE = re.compile(r'(hausen|bert|lin|mert|scheid|bruch|dorf|hagen|thal|tal|rade|ohl|siepen|ecke|feld|born|bach|holz|heim|ingen|stein|kamp)$', re.I)
town_out = []
for a_, b_ in towns:
    mid = (a_ + b_) // 2; E, N = utm(rx[mid], ry[mid])
    gemarkung, gemeinde = lookup(gem, E, N), lookup(gde, E, N)
    # Weilername: Straßenname ohne Straßen-Endung in der Nähe der Ortslage
    cand = {}
    for k in range(a_, b_ + 1, 10):
        Ek, Nk = utm(rx[k], ry[k])
        for nm, (se, sn) in streets:
            if ' ' not in nm and not NOT_PLACE.search(nm) and PLACE.search(nm) and math.hypot(se - Ek, sn - Nk) < 250: cand[nm] = cand.get(nm, 0) + 1
    # kurze Ortslagen (Weiler) dürfen nach ihrer Straße heißen, größere nach der Gemarkung
    name = max(cand, key=cand.get) if cand and (b_ - a_) * step < 1200 else (gemarkung or gemeinde or 'Ort')
    if gemeinde and name == gemeinde: sub = 'Märkischer Kreis'
    elif gemeinde: sub = ('Stadt ' if gemeinde in STAEDTE else 'Gemeinde ') + gemeinde.replace(' (Sauerl.)', '')
    else: sub = ''
    town_out.append({'from': round(a_ * step), 'to': round(b_ * step), 'name': name, 'sub': sub})
# gleichnamige Ortslagen mit kurzer Lücke zusammenfassen
merged_t = []
for t in town_out:
    if merged_t and merged_t[-1]['name'] == t['name'] and t['from'] - merged_t[-1]['to'] < 800: merged_t[-1]['to'] = t['to']
    else: merged_t.append(t)
town_out = merged_t
towns = [[int(t['from'] / step), int(t['to'] / step)] for t in town_out]
print('Ortslagen:', ' · '.join(f"{t['from']/1000:.1f}–{t['to']/1000:.1f} km {t['name']} ({t['sub']})" for t in town_out))
in_town = np.zeros(n, bool)
for a_, b_ in towns: in_town[a_:b_ + 1] = True

# ---------- Einmündungen (keine Pfosten/Planken dort) ----------
junction = np.zeros(n, bool)
for r in side_roads:
    for p in (r['p'][0], r['p'][-1]):
        d = np.hypot(rx - p[0], ry - p[1]); k = int(np.argmin(d))
        if d[k] < 12: junction[max(0, k - 4):k + 5] = True

# ---------- Schutzplanken: Böschung oder Gewässer neben der Fahrbahn ----------
rails = []
for side in (-1, 1):
    need = np.zeros(n, bool)
    for k in range(n):
        if in_town[k] or is_rad[k] or junction[k]: continue
        drops = []
        for off in (3, 6):
            t = terrain_at(rx[k] + nlx[k] * (hw[k] + off) * side, ry[k] + nly[k] * (hw[k] + off) * side)
            if not math.isnan(t): drops.append(rh[k] - t)
        water = any(lu_at(rx[k] + nlx[k] * (hw[k] + o) * side, ry[k] + nly[k] * (hw[k] + o) * side) == 8 for o in (2, 5, 8))
        need[k] = (drops and max(drops) > 2.5 and min(drops) > 1.2) or water
    for a_, b_ in segments(need, 40, 30):
        rails.append({'from': round(max(0, a_ - 3) * step), 'to': round(min(n - 1, b_ + 3) * step), 'side': side})
print(f'Schutzplanken: {len(rails)} Abschnitte, {sum(r["to"] - r["from"] for r in rails)/1000:.1f} km')

# ---------- Leitpfosten (außerorts, alle 50 m) und Laternen (innerorts) ----------
posts, lights = [], []
railed = {s: np.zeros(n, bool) for s in (-1, 1)}
for r in rails: railed[r['side']][int(r['from'] / step):int(r['to'] / step) + 1] = True
for k in range(0, n, int(50 / step)):
    if in_town[k] or is_rad[k] or junction[k]: continue
    for side in (-1, 1):
        if not railed[side][k]: posts.append([k * step, side])
for k in range(0, n, int(32 / step)):
    if in_town[k] and not junction[k]: lights.append([k * step, -1])   # rechte Seite (−1 = rechts)
print(f'Leitpfosten: {len(posts)}, Laternen: {len(lights)}')

json.dump({'towns': town_out, 'rails': rails, 'posts': posts, 'lights': lights}, open(os.path.join(route_dir, 'furniture.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
