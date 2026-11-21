"""Häuser sauber neu aufbauen (Testkopie): aus LoD2 nur Lage, Ausrichtung, Grundriss-Rechteck, Trauf-/Firsthöhe,
Dachform und Nutzung übernehmen; Dachfarbe aus dem Luftbild auf eine Palette echter Dachfarben gerundet.
Ausgabe: public/routes/<name>/houses.json"""
import glob, json, math, os, re, sys, zlib
import numpy as np
from PIL import Image

route_dir = sys.argv[1]
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
route = json.load(open(os.path.join(route_dir, 'route.json')))
T = route['terrain']; x0, y0, cell, nx, ny = T['x0'], T['y0'], T['cell'], T['nx'], T['ny']
grid = np.frombuffer(open(os.path.join(route_dir, 'terrain.bin'), 'rb').read(), np.int16).reshape(ny, nx) * T['scale']
lat0, lon0 = route['origin']['lat'], route['origin']['lon']
a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
e2 = f * (2 - f); ep2 = e2 / (1 - e2); L0 = math.radians(9)
def from_utm(E, N):
    x = E - 500000; M = N / k0; mu = M / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    e1 = (1 - np.sqrt(1 - e2)) / (1 + np.sqrt(1 - e2))
    p1 = mu + (3*e1/2 - 27*e1**3/32)*np.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32)*np.sin(4*mu) + (151*e1**3/96)*np.sin(6*mu)
    N1 = a / np.sqrt(1 - e2*np.sin(p1)**2); T1 = np.tan(p1)**2; C1 = ep2*np.cos(p1)**2
    R1 = a*(1 - e2)/(1 - e2*np.sin(p1)**2)**1.5; D = x/(N1*k0)
    lat = p1 - (N1*np.tan(p1)/R1)*(D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*ep2)*D**4/24 + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*ep2 - 3*C1**2)*D**6/720)
    lon = L0 + (D - (1 + 2*T1 + C1)*D**3/6 + (5 - 2*C1 + 28*T1 + 3*C1**2 + 8*ep2 + 24*T1**2)*D**5/120)/np.cos(p1)
    return np.degrees(lat), np.degrees(lon)
R = 6378137.0; kx = R * math.cos(math.radians(lat0)) * math.pi / 180; ky = R * math.pi / 180
def local(E, N): la, lo = from_utm(np.asarray(E, float), np.asarray(N, float)); return (lo - lon0) * kx, (la - lat0) * ky
def terrain_at(x, y):
    fx = np.clip((x - x0) / cell, 0, nx - 1.001); fy = np.clip((y - y0) / cell, 0, ny - 1.001); i = fx.astype(int); j = fy.astype(int); u = fx - i; v = fy - j
    return grid[j, i] * (1 - u) * (1 - v) + grid[j, i + 1] * u * (1 - v) + grid[j + 1, i] * (1 - u) * v + grid[j + 1, i + 1] * u * v

# Abstand zur Strecke (Häuser dürfen nicht in die Fahrbahn ragen)
rx, ry = np.array(route['x']), np.array(route['y']); rw = np.array(route.get('width', [5.6] * len(rx))) / 2
from scipy.spatial import cKDTree
rtree = cKDTree(np.c_[rx, ry])

ROOFS = np.array([[58, 61, 66], [75, 79, 85], [125, 59, 44], [165, 83, 47], [90, 59, 42], [138, 144, 150], [52, 52, 50]], float)
tiles = {}
def dop(e, n):
    k = (e, n)
    if k not in tiles:
        p = os.path.join(CACHE, 'dop1m', f'{e}_{n}.jpg'); tiles[k] = np.asarray(Image.open(p).convert('RGB')) if os.path.exists(p) else None
    return tiles[k]
def roof_color(E, N):
    vals = []
    for e_, n_ in zip(E, N):
        t = dop(int(e_ // 1000), int(n_ // 1000))
        if t is not None: vals.append(t[min(999, int((int(n_ // 1000) + 1) * 1000 - n_)), min(999, int(e_ - int(e_ // 1000) * 1000))])
    if not vals: return 0
    c = np.median(np.array(vals, float), axis=0)
    return int(np.argmin(((ROOFS - c) ** 2).sum(1)))

def min_rect(pts):
    """Kleinstes umschließendes Rechteck (Rotating Calipers über die konvexe Hülle)"""
    from scipy.spatial import ConvexHull
    hull = pts[ConvexHull(pts).vertices]; best = None
    for i in range(len(hull)):
        e = hull[(i + 1) % len(hull)] - hull[i]; ang = math.atan2(e[1], e[0]); c, s = math.cos(ang), math.sin(ang)
        rot = pts @ np.array([[c, -s], [s, c]]); mn, mx = rot.min(0), rot.max(0); area = np.prod(mx - mn)
        if best is None or area < best[0]: best = (area, ang, (mn + mx) / 2 @ np.array([[c, s], [-s, c]]), mx - mn)
    return best

houses = []
roof_codes = {'1000': 0, '2100': 1, '2200': 1, '3100': 2, '3200': 3, '3300': 3, '3400': 2, '3500': 4, '5000': 2, '9999': 2}
for file in glob.glob(os.path.join(CACHE, 'lod2', '*.gml')):
    xml = open(file, encoding='utf-8').read()
    for m in re.finditer(r'<bldg:Building gml:id="([^"]+)">([\s\S]*?)</bldg:Building>', xml):
        bid, body = m.groups()
        fn = (re.search(r'<bldg:function>([^<]+)', body) or [None, ''])[1]
        if fn.startswith('51') or fn.startswith('53'): continue                 # Bauwerke (Masten, Brücken …) nicht als Haus
        rt = (re.search(r'<bldg:roofType>([^<]+)', body) or [None, '3100'])[1]
        def rings(kind):
            out = []
            for s in re.finditer(rf'<bldg:{kind}[\s\S]*?</bldg:{kind}>', body):
                for pl in re.finditer(r'<gml:posList[^>]*>([^<]+)</gml:posList>', s.group(0)):
                    v = np.array(pl.group(1).split(), float).reshape(-1, 3); out.append(v)
            return out
        ground, roofs = rings('GroundSurface'), rings('RoofSurface')
        if not ground or not roofs: continue
        gp = np.vstack(ground); rp = np.vstack(roofs)
        gz = gp[:, 2].min(); eave = rp[:, 2].min() - gz; ridge = rp[:, 2].max() - gz
        lx, ly = local(gp[:, 0], gp[:, 1]); P = np.c_[lx, ly]
        cx, cy = P.mean(0)
        if not (x0 + 50 < cx < x0 + (nx - 1) * cell - 50 and y0 + 50 < cy < y0 + (ny - 1) * cell - 50): continue
        d, k = rtree.query([cx, cy])
        if d > 2500: continue
        area_poly = 0.0
        for g in ground:
            gx, gy = local(g[:, 0], g[:, 1]); area_poly += 0.5 * abs(np.dot(gx, np.roll(gy, 1)) - np.dot(gy, np.roll(gx, 1)))
        if len(P) < 3 or area_poly < 6: continue
        area, ang, ctr, dims = min_rect(P)
        fill = area_poly / max(area, 1e-6)
        L_, W_ = dims
        if fill < 0.8: s_ = math.sqrt(max(fill, 0.4)); L_, W_ = L_ * s_, W_ * s_    # unregelmäßige Grundrisse: flächengleiches Rechteck
        if W_ > L_: L_, W_, ang = W_, L_, ang + math.pi / 2
        # nicht in die Fahrbahn ragen: Ecken prüfen, ggf. verkleinern
        for _ in range(6):
            c, s = math.cos(ang), math.sin(ang)
            corners = np.array([ctr + np.array([c * sx * L_ / 2 - s * sy * W_ / 2, s * sx * L_ / 2 + c * sy * W_ / 2]) for sx in (-1, 1) for sy in (-1, 1)])
            dd, kk = rtree.query(corners)
            if (dd > rw[kk] + 1.8).all(): break
            L_, W_ = L_ * 0.9, W_ * 0.9
        else: continue
        base = float(terrain_at(corners[:, 0], corners[:, 1]).min())
        kind = roof_codes.get(rt, 2)
        eave = max(2.4, min(eave, 40)); ridge = max(eave + (0.3 if kind == 0 else 1.5), min(ridge, eave + W_ * 0.9))
        if kind == 0: ridge = eave
        # Dachfarbe aus dem Luftbild (Punkte im Grundriss-Inneren), auf Palette gerundet
        sx_ = np.array([ctr[0] + math.cos(ang) * a_ * L_ * 0.35 - math.sin(ang) * b_ * W_ * 0.35 for a_ in (-1, 0, 1) for b_ in (-1, 0, 1)])
        sy_ = np.array([ctr[1] + math.sin(ang) * a_ * L_ * 0.35 + math.cos(ang) * b_ * W_ * 0.35 for a_ in (-1, 0, 1) for b_ in (-1, 0, 1)])
        # lokal → UTM rückwärts über Gitter der Originalpunkte (lineare Näherung um den Mittelpunkt)
        Ec, Nc = gp[:, 0].mean(), gp[:, 1].mean()
        J = np.linalg.lstsq(np.c_[P - [cx, cy], np.ones(len(P))], np.c_[gp[:, 0] - Ec, gp[:, 1] - Nc], rcond=None)[0]
        EN = np.c_[sx_ - cx, sy_ - cy, np.ones(9)] @ J + [Ec, Nc]
        rc = roof_color(EN[:, 0], EN[:, 1]) if kind else 6
        h = zlib.crc32(bid.encode()) % 1000
        if fn.startswith('31001_1') or fn.startswith('31001_3') or fn.startswith('31001_9'): fac = 0 if h < 400 else 1 if h < 700 else 2 if h < 850 else 5
        elif fn.startswith('31001_27'): fac = 4 if h < 600 else 1 if h < 800 else 0
        elif fn.startswith('31001_2'): fac = 3 if h < 700 else 0
        else: fac = 0 if h < 500 else 5
        if eave > 12 and fac == 2: fac = 0                                       # kein Fachwerk an Hochhäusern
        chim = 1 if fac in (0, 1, 2, 5) and kind in (2, 3) and h % 4 != 0 else 0
        houses.append([round(float(ctr[0]), 2), round(float(ctr[1]), 2), round(ang, 4), round(L_, 2), round(W_, 2), round(base, 2), round(eave, 2), round(ridge, 2), kind, fac, rc, chim])
json.dump({'palette': ['#%02x%02x%02x' % tuple(int(v) for v in c) for c in ROOFS], 'houses': houses}, open(os.path.join(route_dir, 'houses.json'), 'w'), separators=(',', ':'))
print(len(houses), 'Häuser')
