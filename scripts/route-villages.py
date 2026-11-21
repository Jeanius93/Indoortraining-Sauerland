"""Ortschaften entlang einer Strecke für die Namensgebung – aus den amtlichen Gebäudeadressen (ALKIS):
kleine Sauerland-Dörfer haben oft keinen Straßennamen, die Adresse ist dann der Ortsname („Rärin 3“).
Aufruf: python3 scripts/route-villages.py public/routes/<id> scripts/.cache/alkis/*.gpkg"""
import json, math, os, re, sqlite3, struct, sys
from collections import defaultdict
import numpy as np
from scipy.spatial import cKDTree
rd = sys.argv[1]; r = json.load(open(os.path.join(rd, 'route.json')))
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prepare-houses.py'), encoding='utf-8').read()
route_dir = rd; route = r
exec(src[src.index('lat0, lon0'):src.index('def terrain_at')])        # from_utm(), local()
X, Y = np.array(r['x']), np.array(r['y']); tree = cKDTree(np.c_[X, Y])
STREET = re.compile(r'(straße|strasse|weg|platz|ring|allee|gasse|pfad|stieg|steig|berg$|hang|höhe|grund|feld|kamp|ufer|tal$|siepen|wiese|garten|hof$|im |am |an |auf |zum |zur |in der|unter|ober|hinter)', re.I)
hits = defaultdict(list)
for f in sys.argv[2:]:
    c = sqlite3.connect(f)
    for txt, geom in c.execute("select lagebeztxt, geometrie from GebauedeBauwerk where lagebeztxt is not null"):
        # GeoPackage-Kopf: Hüllrechteck (minx, maxx, miny, maxy) → Mittelpunkt
        if not (geom[3] >> 1) & 7: continue
        x0_, x1_, y0_, y1_ = struct.unpack('<dddd', geom[8:40]); e, n = (x0_ + x1_) / 2, (y0_ + y1_) / 2
        x, y = local(e, n)
        d, k = tree.query([float(x), float(y)])
        if d > 120: continue
        name = re.sub(r'\s*\d.*$', '', txt.split(',')[0]).strip()
        if name and not STREET.search(name): hits[name].append(k * r['step'])
for name, ds in sorted(hits.items(), key=lambda kv: np.median(kv[1])):
    if len(ds) >= 2: print(f'{np.median(ds) / 1000:5.1f} km  {name}  ({len(ds)} Häuser)')
