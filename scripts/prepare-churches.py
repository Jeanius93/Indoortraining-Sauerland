"""Kirchen (LoD2-Funktion 31001_3040/3041) finden und ihren Turm bestimmen: höchster Dachpunkt = Turmspitze.
Hat das Gebäude keinen ausgeprägten Turm, wird einer an die Giebelseite gesetzt.
Ergänzt public/routes/<name>/houses.json um "churches": [[x, y, base, spitze, seite], …]"""
import glob, json, math, os, re, sys
import numpy as np

route_dir = sys.argv[1]
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prepare-houses.py'), encoding='utf-8').read()
exec(src.split('# Abstand zur Strecke')[0])          # gemeinsame Hilfen: local(), terrain_at(), CACHE, Gitter
H = json.load(open(os.path.join(route_dir, 'houses.json')))
hs = np.array([h[:2] for h in H['houses']])
churches = []
for file in glob.glob(os.path.join(CACHE, 'lod2', '*.gml')):
    xml = open(file, encoding='utf-8').read()
    for m in re.finditer(r'<bldg:Building gml:id="([^"]+)">([\s\S]*?)</bldg:Building>', xml):
        body = m.group(2)
        fn = (re.search(r'<bldg:function>([^<]+)', body) or [None, ''])[1]
        if fn not in ('31001_3040', '31001_3041'): continue
        pts = [np.array(pl.split(), float).reshape(-1, 3) for pl in re.findall(r'<gml:posList[^>]*>([^<]+)</gml:posList>', body)]
        if not pts: continue
        P = np.vstack(pts); gz = P[:, 2].min()
        lx, ly = local(P[:, 0], P[:, 1]); cx, cy = lx.mean(), ly.mean()
        if not (x0 + 50 < cx < x0 + (nx - 1) * cell - 50 and y0 + 50 < cy < y0 + (ny - 1) * cell - 50): continue
        d = np.hypot(hs[:, 0] - cx, hs[:, 1] - cy); k = int(d.argmin())
        if d[k] > 25: continue                                   # nicht als Haus übernommen (zu weit von der Strecke)
        hx, hy, ang, L, W, base, eave, ridge = H['houses'][k][:8]
        if L * W < 60: continue                                  # Wegkreuze, kleine Kapellen ohne Turm
        i = int(P[:, 2].argmax()); tip = float(P[i, 2] - gz)
        tx, ty = float(lx[i]), float(ly[i])
        if tip < ridge + 5:                                      # kein Turm modelliert: an die Giebelseite stellen
            tx, ty, tip = hx + math.cos(ang) * (L / 2 + 1.8), hy + math.sin(ang) * (L / 2 + 1.8), max(ridge + 10, 18.0)
        side = max(3.2, min(6.0, W * 0.45))
        churches.append([round(tx, 2), round(ty, 2), round(float(base), 2), round(min(tip, 65), 1), round(side, 2), round(ang, 4)])
churches.sort(key=lambda c: -c[3]); keep = []
rx, ry = np.array(route['x']), np.array(route['y']); rw = np.array(route.get('width', [5.6] * len(rx))) / 2
for c in churches:                                           # Teile derselben Kirche: nur den höchsten Turm behalten
    if any(math.hypot(c[0] - k[0], c[1] - k[1]) < 30 for k in keep): continue
    dd = np.hypot(rx - c[0], ry - c[1]); j = int(dd.argmin())
    if dd[j] < rw[j] + c[4] * 0.75 + 1: continue             # Turm nicht auf die Fahrbahn
    keep.append(c)
churches = keep
H['churches'] = churches
json.dump(H, open(os.path.join(route_dir, 'houses.json'), 'w'), separators=(',', ':'))
print(f'{len(churches)} Kirchen')
