"""Häuser sauber neu aufbauen: aus LoD2 je Gebäudeteil Lage, Grundriss (Rechteck, L-/T-Formen in Rechtecke zerlegt),
Firstrichtung und Trauf-/Firsthöhe aus den echten Dachflächen, Dachform und Nutzung; Dachneigung auf plausible Werte
begrenzt; Dachfarbe aus dem Luftbild auf eine Palette echter Dachfarben gerundet.
Danach: Nebenstraßen dort schmaler, wo sie ein Haus berühren würden; Bäume in/an Häusern und auf Fahrbahnen entfernen.
Ausgabe: public/routes/<name>/houses.json (+ roads.json, trees.bin bereinigt)"""
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

# Rückrechnung lokal → UTM (für das Luftbild); Drehung UTM → lokal (Meridiankonvergenz)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import Local as _Local
_loc = _Local(route)
def utm_of(x, y): return _loc.to_utm(x, y)
_E0, _N0 = _loc.to_utm(x0 + (nx - 1) * cell / 2, y0 + (ny - 1) * cell / 2)
_a = np.array(local(np.array([_E0, _E0 + 100.0]), np.array([_N0, _N0])))
ROT = math.atan2(_a[1, 1] - _a[1, 0], _a[0, 1] - _a[0, 0])          # Winkel UTM → lokal

from shapely.geometry import Polygon, box as sbox
from shapely.ops import unary_union
from shapely import affinity

ROOF_CODES = {'1000': 0, '2100': 1, '2200': 1, '3100': 2, '3200': 3, '3300': 3, '3400': 2, '3500': 4, '3600': 4, '5000': -1, '9999': -1}
def posl(txt): return np.array(txt.split(), float).reshape(-1, 3)

def plane(P):
    """Neigung (Grad), Fallrichtung (rad, Welt-UTM) und Grundfläche einer Dachfläche"""
    c = P.mean(0); u, s, vt = np.linalg.svd(P - c); nrm = vt[2] if vt[2][2] >= 0 else -vt[2]
    slope = math.degrees(math.acos(min(1, abs(nrm[2]))))
    x, y = P[:, 0], P[:, 1]; area = 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
    return slope, math.atan2(-nrm[1], -nrm[0]) + math.pi, area   # Fallrichtung = horizontale Komponente der Normalen

def roof_stats(roofs, gz):
    """Traufe, First, Firstrichtung (Achse), Walm-Anteil, flach?"""
    pl = [(plane(P), P) for P in roofs if len(P) >= 3]
    pitched = [(sl, az, ar, P) for (sl, az, ar), P in pl if sl > 8 and ar > 0.5]
    tot = sum(ar for (_, _, ar), _ in pl) or 1
    ridge = max(P[:, 2].max() for _, P in pl) - gz
    if sum(ar for _, _, ar, _ in pitched) < 0.35 * tot:
        zs = np.concatenate([P[:, 2] for _, P in pl]); return {'flat': True, 'eave': float(np.median(zs) - gz), 'ridge': float(np.median(zs) - gz)}
    w = np.array([ar for _, _, ar, _ in pitched]); mins = np.array([P[:, 2].min() - gz for *_, P in pitched])
    o = np.argsort(mins); cw = np.cumsum(w[o]) / w.sum(); eave = float(mins[o][np.searchsorted(cw, 0.5)])   # gewichteter Median
    c2 = sum(ar * math.cos(2 * az) for _, az, ar, _ in pitched); s2 = sum(ar * math.sin(2 * az) for _, az, ar, _ in pitched)
    down = 0.5 * math.atan2(s2, c2); strength = math.hypot(c2, s2) / w.sum()
    ends = sum(ar for _, az, ar, _ in pitched if abs(math.cos(az - down)) < 0.5) / w.sum()   # Flächen quer zur Hauptrichtung = Walm
    slopes = float(np.average([sl for sl, *_ in pitched], weights=w))
    big = max(pitched, key=lambda q: q[2])
    return {'flat': False, 'eave': eave, 'ridge': float(ridge), 'ridge_dir': down + math.pi / 2, 'strength': strength, 'hip': ends, 'slope': slopes, 'down_main': big[1]}

def rects_of(poly, ang):
    """Grundriss in bis zu 3 achsparallele Rechtecke (im Rahmen ang) zerlegen: jeweils größtes einbeschriebenes Rechteck"""
    rot = affinity.rotate(poly, -ang, origin=(0, 0), use_radians=True)
    x0_, y0_, x1_, y1_ = rot.bounds; res = 0.25
    nx_, ny_ = max(1, int((x1_ - x0_) / res)), max(1, int((y1_ - y0_) / res))
    from shapely import contains_xy
    gx, gy = np.meshgrid(x0_ + (np.arange(nx_) + 0.5) * res, y0_ + (np.arange(ny_) + 0.5) * res)
    m = contains_xy(rot, gx, gy)
    out = []
    total = m.sum()
    for _ in range(3):
        if m.sum() < max(12 / res ** 2, 0.12 * total): break
        # größtes Rechteck aus Einsen (Histogramm-Verfahren)
        h = np.zeros(nx_, int); best = (0, 0, 0, 0, 0)
        for j in range(ny_):
            h = np.where(m[j], h + 1, 0); st = []
            for i in range(nx_ + 1):
                cur = h[i] if i < nx_ else 0; start = i
                while st and st[-1][1] >= cur:
                    s0, hh = st.pop(); a_ = hh * (i - s0)
                    if a_ > best[0]: best = (a_, s0, i, j - hh + 1, j + 1)
                    start = s0
                st.append((start, cur))
        a_, i0, i1, j0, j1 = best
        if a_ * res * res < 10: break
        out.append((x0_ + i0 * res, y0_ + j0 * res, x0_ + i1 * res, y0_ + j1 * res)); m[j0:j1, i0:i1] = False
    return out   # im gedrehten Rahmen

def make_house(cx, cy, ang, L_, W_, eave, ridge, kind):
    """Plausible Höhen: Traufe ≥ 2,3 m, Dachneigung begrenzt"""
    eave = float(np.clip(eave, 2.3, 40))
    if kind == 0: return [cx, cy, ang, L_, W_, eave, eave, kind]
    span = W_ if kind == 1 else W_ / 2                          # Breite quer zum First (Pultdach: ganze Breite)
    lo, hi = (5, 35) if kind == 1 else (15, 55)
    rise = float(np.clip(ridge - eave, span * math.tan(math.radians(lo)), span * math.tan(math.radians(hi))))
    return [cx, cy, ang, L_, W_, eave, eave + min(rise, 14), kind]

houses = []; stats = {'teile': 0, 'zerlegt': 0, 'flach': 0, 'quer': 0}
old = []
op = os.path.join(CACHE, 'houses-orig', os.path.basename(os.path.normpath(route_dir)) + '.json')
for file in sorted(glob.glob(os.path.join(CACHE, 'lod2', '*.gml'))):
    xml = open(file, encoding='utf-8').read()
    for m in re.finditer(r'<bldg:Building gml:id="([^"]+)">([\s\S]*?)</bldg:Building>', xml):
        bid, body = m.groups()
        fn = (re.search(r'<bldg:function>([^<]+)', body) or [None, ''])[1]
        if fn.startswith('51') or fn.startswith('53'): continue
        rt_b = (re.search(r'<bldg:roofType>([^<]+)', body.split('<bldg:consistsOfBuildingPart>')[0]) or [None, '3100'])[1]
        parts = re.findall(r'<bldg:BuildingPart gml:id="([^"]+)">([\s\S]*?)</bldg:BuildingPart>', body)
        units = parts if parts else [(bid, body)]
        for uid, ub in units:
            rt = (re.search(r'<bldg:roofType>([^<]+)', ub) or [None, rt_b])[1]
            ground = [posl(t) for s_ in re.findall(r'<bldg:GroundSurface[\s\S]*?</bldg:GroundSurface>', ub) for t in re.findall(r'<gml:posList[^>]*>([^<]+)</gml:posList>', s_)]
            roofs = [posl(t) for s_ in re.findall(r'<bldg:RoofSurface[\s\S]*?</bldg:RoofSurface>', ub) for t in re.findall(r'<gml:posList[^>]*>([^<]+)</gml:posList>', s_)]
            if not ground or not roofs: continue
            gz = min(g[:, 2].min() for g in ground)
            polys = []
            for g in ground:
                lx, ly = local(g[:, 0], g[:, 1])
                pg = Polygon(np.c_[lx, ly]).buffer(0)
                if pg.area > 0.5: polys.append(pg)
            if not polys: continue
            fp = unary_union(polys)
            if fp.area < 12: continue                                # Schuppen/Kleinstanbauten: aus Fahrersicht unsichtbar
            cx, cy = fp.centroid.x, fp.centroid.y
            if not (x0 + 50 < cx < x0 + (nx - 1) * cell - 50 and y0 + 50 < cy < y0 + (ny - 1) * cell - 50): continue
            if rtree.query([cx, cy])[0] > 2500: continue
            stats['teile'] += 1
            mr = fp.minimum_rotated_rectangle; co = np.array(mr.exterior.coords)[:4]
            e1 = co[1] - co[0]; ang = math.atan2(e1[1], e1[0])
            # Dachflächen in lokale Koordinaten (für Richtung genügt UTM, Drehung zwischen UTM und lokal < 1°)
            rs = roof_stats(roofs, gz)
            conv = -ROT
            code = ROOF_CODES.get(rt, -1)
            if rs['flat'] or code == 0: kind = 0
            elif code == -1: kind = 3 if rs['hip'] > 0.15 else 2
            else: kind = code
            # sehr flache Neigung: nur Mischformen/Pultdächer werden flach, kartierte Sattel-/Walmdächer bleiben geneigt
            if not rs['flat'] and ((code == -1 and rs['slope'] < 10) or (code == 1 and rs['slope'] < 5)): kind = 0
            if kind == 0: stats['flach'] += 1
            fill = fp.area / max(mr.area, 1e-6)
            pieces = rects_of(fp, ang) if fill < 0.85 and fp.area > 40 else []
            if len(pieces) < 2: pieces = None
            # Rechteck(e) im Rahmen ang → Häuser
            def emit(rx0, ry0, rx1, ry1, eave, ridge, kind, rdir, down=None):
                lx_, ly_ = rx1 - rx0, ry1 - ry0
                if lx_ < 1.5 or ly_ < 1.5: return
                mx, my = (rx0 + rx1) / 2, (ry0 + ry1) / 2
                c, s = math.cos(ang), math.sin(ang); hx, hy = mx * c - my * s, mx * s + my * c
                a2, L2, W2 = ang, lx_, ly_
                if rdir is not None and kind in (1, 2, 3):
                    along = abs(math.cos(rdir - ang)) > abs(math.sin(rdir - ang))   # First entlang lx_?
                    if not along: a2, L2, W2 = ang + math.pi / 2, ly_, lx_
                elif L2 < W2: a2, L2, W2 = ang + math.pi / 2, ly_, lx_
                if kind == 1 and down is not None and math.cos(a2 + math.pi / 2 - (down + math.pi)) < 0: a2 += math.pi   # Pultdach: hohe Seite (+W) bergauf
                if rdir is not None and kind in (2, 3) and L2 < W2 * 0.9: stats['quer'] += 1
                houses.append(make_house(hx, hy, a2, L2, W2, eave, ridge, kind) + [uid, fn, rt])
            rdir = None if rs['flat'] or rs.get('strength', 0) < 0.3 else rs['ridge_dir'] - conv
            if pieces is None:
                rot = affinity.rotate(fp, -ang, origin=(0, 0), use_radians=True); b = rot.bounds
                # unregelmäßige Grundrisse ohne Zerlegung: flächengleiches Rechteck
                if fill < 0.85:
                    sc = math.sqrt(max(fill, 0.5)); mx_, my_ = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2; hw_, hh_ = (b[2] - b[0]) / 2 * sc, (b[3] - b[1]) / 2 * sc
                    b = (mx_ - hw_, my_ - hh_, mx_ + hw_, my_ + hh_)
                emit(*b, rs['eave'], rs['ridge'], kind, rdir, None if rs['flat'] else rs['down_main'] - conv)
            else:
                stats['zerlegt'] += 1
                main = pieces[0]; mw = min(main[2] - main[0], main[3] - main[1])
                for pi_, (a0, b0, a1, b1) in enumerate(pieces):
                    # Dachflächen über diesem Teil
                    c, s = math.cos(ang), math.sin(ang)
                    sub = []
                    for P in roofs:
                        lx, ly = local(P[:, 0], P[:, 1]); qx, qy = lx * c + ly * s, -lx * s + ly * c
                        if a0 - 0.3 <= qx.mean() <= a1 + 0.3 and b0 - 0.3 <= qy.mean() <= b1 + 0.3: sub.append(P)
                    rp = roof_stats(sub, gz) if sub else rs
                    k2 = kind if kind in (0, 1) else (2 if not rp['flat'] else 0)
                    # Flügel ins Hauptdach greifen lassen (Kreuzdach mit Kehle statt Giebel an der Wand)
                    if pi_ > 0 and k2 in (2, 3) and rp['ridge'] <= rs['ridge'] + 0.3:
                        ext = min(mw / 2, 3.0)
                        if abs(a0 - main[2]) < 0.6: a0 -= ext
                        elif abs(a1 - main[0]) < 0.6: a1 += ext
                        elif abs(b0 - main[3]) < 0.6: b0 -= ext
                        elif abs(b1 - main[1]) < 0.6: b1 += ext
                    lx_, ly_ = a1 - a0, b1 - b0
                    rd2 = ang if lx_ >= ly_ else ang + math.pi / 2          # First entlang der langen Seite des Teils
                    if rp is not rs and not rp['flat'] and rp.get('strength', 0) >= 0.5: rd2 = rp['ridge_dir'] - conv
                    emit(a0, b0, a1, b1, rp['eave'], rp['ridge'], k2, rd2 if k2 else None)
print('Gebäudeteile:', stats)

# ---------- Strecke freihalten, Höhe, Farbe, Fassade ----------
roads_path = os.path.join(route_dir, 'roads.json')
RD = json.load(open(roads_path)) if os.path.exists(roads_path) else {'roads': []}
out = []; dropped = 0
for cx_, cy_, ang, L_, W_, eave, ridge, kind, uid, fn, rt in houses:
    ctr = np.array([cx_, cy_])
    for _ in range(6):
        c, s = math.cos(ang), math.sin(ang)
        corners = np.array([ctr + np.array([c * sx * L_ / 2 - s * sy * W_ / 2, s * sx * L_ / 2 + c * sy * W_ / 2]) for sx in (-1, 1) for sy in (-1, 1)])
        dd, kk = rtree.query(np.vstack([corners, ctr]))
        if (dd > rw[kk] + 1.8).all(): break
        L_, W_ = L_ * 0.9, W_ * 0.9
    else: dropped += 1; continue
    base = float(terrain_at(corners[:, 0], corners[:, 1]).min())
    # Dachfarbe aus dem Luftbild
    sx_ = np.array([ctr[0] + math.cos(ang) * a_ * L_ * 0.35 - math.sin(ang) * b_ * W_ * 0.35 for a_ in (-1, 0, 1) for b_ in (-1, 0, 1)])
    sy_ = np.array([ctr[1] + math.sin(ang) * a_ * L_ * 0.35 + math.cos(ang) * b_ * W_ * 0.35 for a_ in (-1, 0, 1) for b_ in (-1, 0, 1)])
    E_, N_ = utm_of(sx_, sy_)
    rc = roof_color(E_, N_) if kind else 6
    h = zlib.crc32(uid.encode()) % 1000
    if fn.startswith('31001_1') or fn.startswith('31001_3') or fn.startswith('31001_9'): fac = 0 if h < 400 else 1 if h < 700 else 2 if h < 850 else 5
    elif fn.startswith('31001_27'): fac = 4 if h < 600 else 1 if h < 800 else 0
    elif fn.startswith('31001_2'): fac = 3 if h < 700 else 0
    else: fac = 0 if h < 500 else 5
    if eave > 12 and fac == 2: fac = 0
    chim = 1 if fac in (0, 1, 2, 5) and kind in (2, 3) and h % 4 != 0 and L_ * W_ > 50 else 0
    out.append([round(float(cx_), 2), round(float(cy_), 2), round(ang, 4), round(L_, 2), round(W_, 2), round(base, 2), round(eave, 2), round(ridge, 2), kind, fac, rc, chim])
print(len(out), 'Häuser', f'({dropped} an der Strecke verworfen)')

# ---------- Nebenstraßen nicht in Häuser ragen lassen ----------
from shapely.strtree import STRtree
from shapely.geometry import Point, LineString
hp = []
for h in out:
    c, s_ = math.cos(h[2]), math.sin(h[2]); hl, hw = h[3] / 2, h[4] / 2
    hp.append(Polygon([(h[0] + c * a_ * hl - s_ * b_ * hw, h[1] + s_ * a_ * hl + c * b_ * hw) for a_, b_ in ((-1, -1), (1, -1), (1, 1), (-1, 1))]))
tree_h = STRtree(hp)
LO = {'B': 6.0, 'L': 5.5, 'K': 5.0, 'G': 3.2, 'H': 2.6, 'F': 2.2, 'P': 1.8, 'R': 5.5}
narrowed = 0; conflicts = 0
for r_ in RD['roads']:
    P = r_['p']
    for i_ in range(len(P)):
        q = Point(P[i_][0], P[i_][1]); hw_ = r_['w'][i_] / 2
        near = tree_h.query(q.buffer(hw_ + 0.6))
        if not len(near): continue
        dmin = min(hp[j].distance(q) for j in near)
        if dmin < hw_ + 0.4:
            nw = max(LO.get(r_['k'], 3.0), (dmin - 0.4) * 2)
            if nw < r_['w'][i_] - 0.05: r_['w'][i_] = round(nw, 1); narrowed += 1
            if dmin < nw / 2: conflicts += 1
if RD['roads']: json.dump(RD, open(roads_path, 'w'), separators=(',', ':'))
print(f'Nebenstraßen: {narrowed} Punkte schmaler, {conflicts} Punkte berühren weiterhin ein Haus')

# ---------- Bäume: nicht in/an Häusern, nicht auf Fahrbahnen ----------
tp = os.path.join(route_dir, 'trees.bin')
if os.path.exists(tp):
    raw = open(tp, 'rb').read(); gzd = raw[:2] == b'\x1f\x8b'
    if gzd: raw = __import__('gzip').decompress(raw)
    A = np.frombuffer(raw, np.uint8).reshape(-1, 7)
    tx = x0 + A[:, 0:2].copy().view('<u2')[:, 0] * 0.25; ty = y0 + A[:, 2:4].copy().view('<u2')[:, 0] * 0.25
    crown = A[:, 5] / 10.0
    keep = np.ones(len(A), bool)
    for i_ in range(len(A)):
        q = Point(tx[i_], ty[i_]); m_ = 1.0 + 0.3 * crown[i_]
        for j in tree_h.query(q.buffer(m_)):
            if hp[j].distance(q) < m_: keep[i_] = False; break
    # Fahrbahnen: Strecke und Nebenstraßen
    segs = [(np.array(r_['p'])[:, :2], np.array(r_['w']) / 2) for r_ in RD['roads']]
    segs.append((np.c_[rx, ry], rw))
    lines = []; halfs = []
    for pts, hw_ in segs:
        for i_ in range(len(pts) - 1):
            lines.append(LineString([pts[i_], pts[i_ + 1]])); halfs.append(max(hw_[i_], hw_[i_ + 1]))
    tree_r = STRtree(lines)
    for i_ in np.nonzero(keep)[0]:
        q = Point(tx[i_], ty[i_])
        for j in tree_r.query(q.buffer(10)):
            if lines[j].distance(q) < halfs[j] + 0.8: keep[i_] = False; break
    print(f'Bäume: {int((~keep).sum())} von {len(A)} entfernt (in/an Häusern oder auf Fahrbahnen)')
    data = A[keep].tobytes()
    open(tp, 'wb').write(__import__('gzip').compress(data) if gzd else data)
    rj = json.load(open(os.path.join(route_dir, 'route.json')))
    if rj.get('world', {}).get('trees'): rj['world']['trees']['count'] = int(keep.sum()); json.dump(rj, open(os.path.join(route_dir, 'route.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

json.dump({'palette': ['#%02x%02x%02x' % tuple(int(v) for v in c) for c in ROOFS], 'houses': out}, open(os.path.join(route_dir, 'houses.json'), 'w'), separators=(',', ':'))
