"""Straßen- und Wegeachsen aus dem ATKIS Basis-DLM NRW (NAS, dl-de/zero-2-0) für das Streckengebiet herausziehen.

Quelle: https://www.opengeodata.nrw.de/produkte/geobasis/lm/akt/basis-dlm/ (basis-dlm_EPSG25832_NAS.zip,
entpackt nach scripts/.cache/dlm/*.xml.gz). Ausgabe: scripts/.cache/dlm/axes.json – Liste von Achsen mit
Art, Breite, Fahrstreifen, Widmung (über AX_Strasse), Name/Bezeichnung und Koordinaten (UTM32).

Aufruf: python3 scripts/extract-dlm.py [E0 E1 N0 N1]   (Standard: Gebiet aller Strecken + 3 km)
"""
import glob, gzip, json, os, re, sys
from multiprocessing import Pool

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', 'dlm')
BOX = [float(v) for v in sys.argv[1:5]] if len(sys.argv) >= 5 else [401000, 426500, 5658000, 5681000]
TAGS = ('AX_Strassenachse', 'AX_Fahrbahnachse', 'AX_Fahrwegachse', 'AX_WegPfadSteig')
RX_FEAT = re.compile(r'<(AX_Strassenachse|AX_Fahrbahnachse|AX_Fahrwegachse|AX_WegPfadSteig|AX_Strasse) gml:id="([^"]+)">([\s\S]*?)</\1>')
RX_POS = re.compile(r'<gml:posList[^>]*>([^<]+)</gml:posList>')
def val(body, tag):
    m = re.search(rf'<{tag}[^>]*>([^<]+)</{tag}>', body); return m.group(1) if m else None

def scan(file):
    out, streets = [], {}
    with gzip.open(file, 'rt', encoding='utf-8-sig') as f: s = f.read()
    for m in RX_FEAT.finditer(s):
        tag, gid, body = m.groups()
        if tag == 'AX_Strasse':
            streets[gid] = {'name': val(body, 'name'), 'widmung': val(body, 'widmung'), 'bez': val(body, 'bezeichnung'), 'trennung': val(body, 'fahrbahntrennung')}
            continue
        parts = [list(map(float, p.split())) for p in RX_POS.findall(body)]
        if not parts: continue
        # Kurvenstücke aneinanderhängen
        pts = []
        for p in parts:
            q = [(round(p[i], 2), round(p[i + 1], 2)) for i in range(0, len(p) - 1, 2)]
            if pts and q and pts[-1] == q[0]: q = q[1:]
            pts += q
        if not any(BOX[0] <= x <= BOX[1] and BOX[2] <= y <= BOX[3] for x, y in pts): continue
        teil = re.findall(r'<istTeilVon xlink:href="urn:adv:oid:([^"]+)"', body)
        out.append({'t': tag[3:], 'id': gid, 'p': pts, 'teil': teil,
                    'breite': val(body, 'breiteDerFahrbahn') or val(body, 'breiteDesVerkehrsweges'),
                    'streifen': val(body, 'anzahlDerFahrstreifen'), 'funktion': val(body, 'funktion'),
                    'oberflaeche': val(body, 'oberflaechenmaterial'), 'zustand': val(body, 'zustand'),
                    'bedeutung': val(body, 'besondereVerkehrsbedeutung'), 'oben': 'hatDirektUnten' in body})
    return out, streets

if __name__ == '__main__':
    files = sorted(glob.glob(os.path.join(CACHE, '*.xml.gz')))
    axes, streets = [], {}
    with Pool(max(1, os.cpu_count() or 2)) as pool:
        for i, (a, st) in enumerate(pool.imap_unordered(scan, files, chunksize=4)):
            axes += a; streets.update(st)
            if i % 50 == 0: print(f'{i}/{len(files)} Dateien, {len(axes)} Achsen', flush=True)
    for a in axes:
        for t in a.pop('teil'):
            if t in streets: a.update({k: v for k, v in streets[t].items() if v}); break
    json.dump(axes, open(os.path.join(CACHE, 'axes.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    from collections import Counter
    print(len(axes), 'Achsen', Counter(a['t'] for a in axes), Counter(a.get('widmung') for a in axes).most_common(8))
