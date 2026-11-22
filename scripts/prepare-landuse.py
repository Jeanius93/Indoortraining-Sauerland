"""Nutzungskarte einer Strecke aus ALKIS-Grundrissdaten (vereinfacht, Geobasis NRW, dl-de/zero-2-0).

Erzeugt:
  landuse.bin   – Nutzungsklasse je 2-m-Pixel (Uint8, Zeile 0 = Süden), gzip-komprimiert gespeichert
  route.json    – ergänzt um "landuse" (Rastergröße) und "places" (Orte/Straßen entlang der Strecke)

Aufruf: python3 scripts/prepare-landuse.py public/routes/hausrunde scripts/.cache/alkis/*.gpkg
"""
import gzip, json, math, os, sqlite3, struct, sys
import numpy as np
from PIL import Image, ImageDraw

route_dir, gpkgs = sys.argv[1], sys.argv[2:]
route = json.load(open(os.path.join(route_dir, 'route.json')))
T = route['terrain']
PX = 2.0
W = int(math.ceil((T['nx'] - 1) * T['cell'] / PX)) + 1
H = int(math.ceil((T['ny'] - 1) * T['cell'] / PX)) + 1
x0, y0 = T['x0'], T['y0']
lat0, lon0 = route['origin']['lat'], route['origin']['lon']

# Nutzungsklassen (Reihenfolge = Zeichenreihenfolge, später gezeichnete überdecken frühere)
CLASSES = [
    # id, Name, Bedingung(nutzart, bez)
    (1, 'Grünland', lambda n, b: n == 'Landwirtschaft' and b in ('Grünland', 'Streuobstwiese', None)),
    (12, 'Brache', lambda n, b: (n == 'Landwirtschaft' and b == 'Brachland') or n in ('Unland/Vegetationslose Fläche', 'Heide', 'Moor', 'Sumpf')),
    (2, 'Acker', lambda n, b: n == 'Landwirtschaft' and b in ('Ackerland', 'Gartenbauland', 'Baumschule')),
    (5, 'Gehölz/Mischwald', lambda n, b: n == 'Gehölz' or (n == 'Wald' and b not in ('Laubholz', 'Nadelholz'))),
    (3, 'Laubwald', lambda n, b: n == 'Wald' and b == 'Laubholz'),
    (4, 'Nadelwald', lambda n, b: n == 'Wald' and b == 'Nadelholz'),
    (13, 'Garten/Grünanlage', lambda n, b: n in ('Sport-, Freizeit- und Erholungsfläche', 'Friedhof')),
    (6, 'Siedlung', lambda n, b: n in ('Wohnbaufläche', 'Fläche gemischter Nutzung', 'Fläche besonderer funktionaler Prägung')),
    (7, 'Gewerbe/Platz', lambda n, b: n in ('Industrie- und Gewerbefläche', 'Platz', 'Tagebau, Grube, Steinbruch', 'Flugverkehr', 'Schiffsverkehr')),
    (8, 'Wasser', lambda n, b: n in ('Fließgewässer', 'Stehendes Gewässer', 'Hafenbecken')),
    (14, 'Straßenbegleitgrün', lambda n, b: n in ('Straßenverkehr', 'Weg') and b and b.startswith('Begleitfläche')),
    (11, 'Bahn', lambda n, b: n == 'Bahnverkehr'),
    (10, 'Weg', lambda n, b: n == 'Weg' and not (b and b.startswith('Begleitfläche'))),
    (9, 'Straße', lambda n, b: n == 'Straßenverkehr' and not (b and b.startswith('Begleitfläche'))),
]
ORDER = {cid: i for i, (cid, _, _) in enumerate(CLASSES)}

# ---------- UTM32 → lokal (gleiche Formeln wie scripts/utm.mjs), dann affine Näherung ----------
a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
e2 = f * (2 - f); ep2 = e2 / (1 - e2); L0 = math.radians(9)
def from_utm(E, N):  # vektorisiert (numpy)
    x = E - 500000; M = N / k0; mu = M / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = mu + (3*e1/2 - 27*e1**3/32)*np.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32)*np.sin(4*mu) + (151*e1**3/96)*np.sin(6*mu)
    N1 = a / np.sqrt(1 - e2*np.sin(p1)**2); T1 = np.tan(p1)**2; C1 = ep2*np.cos(p1)**2
    R1 = a*(1 - e2)/(1 - e2*np.sin(p1)**2)**1.5; D = x/(N1*k0)
    lat = p1 - (N1*np.tan(p1)/R1)*(D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*ep2)*D**4/24 + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*ep2 - 3*C1**2)*D**6/720)
    lon = L0 + (D - (1 + 2*T1 + C1)*D**3/6 + (5 - 2*C1 + 28*T1 + 3*C1**2 + 8*ep2 + 24*T1**2)*D**5/120)/np.cos(p1)
    return np.degrees(lat), np.degrees(lon)
R = 6378137.0
kx = R * math.cos(math.radians(lat0)) * math.pi / 180; ky = R * math.pi / 180
def utm_to_local(E, N):
    la, lo = from_utm(np.asarray(E, float), np.asarray(N, float)); return (lo - lon0) * kx, (la - lat0) * ky
def to_px_arr(pts):  # Liste (E,N) → Pixel (Spalte, Zeile; Zeile 0 = Norden für PIL)
    arr = np.asarray(pts, float); lx, ly = utm_to_local(arr[:, 0], arr[:, 1])
    return list(zip(((lx - x0) / PX).tolist(), ((H - 1) - (ly - y0) / PX).tolist()))
# lokal → UTM (Newton auf der exakten Hinrichtung, für wenige Punkte)
def local_to_utm(lx, ly):
    E, N = 417000.0 + lx, 5672000.0 + ly
    for _ in range(6):
        fx, fy = utm_to_local(E, N); fx, fy = float(fx), float(fy)
        gx1, gy1 = utm_to_local(E + 1, N); gx2, gy2 = utm_to_local(E, N + 1)
        J = np.array([[float(gx1) - fx, float(gx2) - fx], [float(gy1) - fy, float(gy2) - fy]])
        d = np.linalg.solve(J, np.array([lx - fx, ly - fy])); E += d[0]; N += d[1]
    return E, N
cs = [local_to_utm(lx, ly) for lx, ly in [(x0, y0), (x0 + W*PX, y0), (x0, y0 + H*PX), (x0 + W*PX, y0 + H*PX)]]
minE, maxE = min(c[0] for c in cs), max(c[0] for c in cs)
minN, maxN = min(c[1] for c in cs), max(c[1] for c in cs)
print(f'Gebiet UTM: {minE:.0f}–{maxE:.0f} / {minN:.0f}–{maxN:.0f}')

# ---------- GeoPackage-Geometrie lesen ----------
def gpkg_env(blob):
    flags = blob[3]
    if ((flags >> 1) & 7) == 0: return None
    bo = '<' if flags & 1 else '>'
    return struct.unpack_from(bo + '4d', blob, 8)  # minx, maxx, miny, maxy
def gpkg_rings(blob):
    flags = blob[3]; env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 7]
    return wkb(memoryview(blob)[8 + env:])
def wkb(buf):
    out = []
    def rd(off):
        bo = '<' if buf[off] == 1 else '>'
        t = struct.unpack_from(bo + 'I', buf, off + 1)[0]; off += 5
        dims = 3 if (t // 1000) in (1, 2) or (t & 0x80000000) else 2
        base = (t & 0xffff) % 1000
        if base == 3:
            n = struct.unpack_from(bo + 'I', buf, off)[0]; off += 4; poly = []
            for _ in range(n):
                m = struct.unpack_from(bo + 'I', buf, off)[0]; off += 4
                pts = struct.unpack_from(bo + f'{m*dims}d', buf, off); off += m * dims * 8
                poly.append([(pts[i], pts[i + 1]) for i in range(0, len(pts), dims)])
            out.append(poly); return off
        if base == 6:
            n = struct.unpack_from(bo + 'I', buf, off)[0]; off += 4
            for _ in range(n): off = rd(off)
            return off
        raise ValueError(f'WKB-Typ {t}')
    rd(0); return out

img = Image.new('L', (W, H), 0)
polys = []
for g in gpkgs:
    c = sqlite3.connect(g)
    rows = []
    for row in c.execute('select nutzart, bez, name, geometrie from Nutzung'):
        env = row[3] and gpkg_env(row[3])
        if env and (env[1] < minE or env[0] > maxE or env[3] < minN or env[2] > maxN): continue
        rows.append(row)
    for nutzart, bez, name, geom in rows:
        cid = next((cid for cid, _, cond in CLASSES if cond(nutzart, bez)), None)
        if cid is None or geom is None: continue
        try: parts = gpkg_rings(geom)
        except ValueError: continue
        polys.append((ORDER[cid], cid, parts, nutzart, name))
    print(f'{os.path.basename(g)}: {len(rows)} Nutzungsflächen im Gebiet')
polys.sort(key=lambda p: p[0])
for _, cid, parts, _, _ in polys:
    for poly in parts:
        ext = to_px_arr(poly[0])
        xs = [p[0] for p in ext]; ys = [p[1] for p in ext]
        bx0, by0 = max(0, int(min(xs)) - 1), max(0, int(min(ys)) - 1)
        bx1, by1 = min(W, int(max(xs)) + 2), min(H, int(max(ys)) + 2)
        if bx1 <= bx0 or by1 <= by0: continue
        mask = Image.new('1', (bx1 - bx0, by1 - by0), 0); d = ImageDraw.Draw(mask)
        d.polygon([(x - bx0, y - by0) for x, y in ext], fill=1)
        for hole in poly[1:]: d.polygon([(x - bx0, y - by0) for x, y in to_px_arr(hole)], fill=0)
        img.paste(cid, (bx0, by0, bx1, by1), mask)
arr = np.flipud(np.array(img, dtype=np.uint8))  # Zeile 0 = Süden (wie Geländeraster)
with gzip.open(os.path.join(route_dir, 'landuse.bin'), 'wb', compresslevel=9) as fz: fz.write(arr.tobytes())
counts = np.bincount(arr.ravel(), minlength=16) / arr.size * 100
print('Anteile:', ', '.join(f'{name} {counts[cid]:.1f} %' for cid, name, _ in CLASSES if counts[cid] >= 0.5), f'· ohne Daten {counts[0]:.1f} %')

# ---------- Orte entlang der Strecke: Straßenname + Gemarkung ----------
def point_in(poly, E, N):
    inside = False
    for ring in poly:
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]; xj, yj = ring[j]
            if (yi > N) != (yj > N) and E < (xj - xi) * (N - yi) / (yj - yi) + xi: inside = not inside
            j = i
    return inside
gem = []
for g in gpkgs:
    c = sqlite3.connect(g)
    for name, geom in c.execute("select name, geometrie from KatasterBezirk where art = 'Gemarkung'"):
        env = gpkg_env(geom)
        if env and (env[1] < minE or env[0] > maxE or env[3] < minN or env[2] > maxN): continue
        gem.append((name, gpkg_rings(geom)))
roads = [(p[4], p[2]) for p in polys if p[3] == 'Straßenverkehr' and p[4]]
def bbox(parts): pts = [pt for poly in parts for pt in poly[0]]; return min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts)
roads = [(n, parts, bbox(parts)) for n, parts in roads]
gem = [(n, parts, bbox(parts)) for n, parts in gem]
def lookup(items, E, N):
    for n, parts, (a0, a1, b0, b1) in items:
        if a0 <= E <= a1 and b0 <= N <= b1 and any(point_in(p, E, N) for p in parts): return n
    return None
step = route['step']; places = []; last = (None, None)
for k in range(0, len(route['x']), int(100 / step)):
    E, N = local_to_utm(route['x'][k], route['y'][k])
    cur = (lookup(roads, E, N), lookup(gem, E, N))
    if cur != last and (cur[0] or cur[1]):
        if places and k * step - places[-1]['d'] < 300: places[-1].update(road=cur[0] or places[-1]['road'], area=cur[1] or places[-1]['area'])
        else: places.append({'d': k * step, 'road': cur[0], 'area': cur[1]})
        last = cur
route['places'] = places
route['landuse'] = {'px': PX, 'w': W, 'h': H, 'classes': {str(cid): name for cid, name, _ in CLASSES}}
route.setdefault('attribution', '')
json.dump(route, open(os.path.join(route_dir, 'route.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(f'{len(places)} Orte: ' + ' · '.join(f"{p['d']/1000:.1f} km {p['road'] or ''} ({p['area'] or '–'})" for p in places))
