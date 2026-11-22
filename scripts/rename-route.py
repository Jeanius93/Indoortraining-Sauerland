"""Streckennamen setzen (route.json + Rundkurs-GPX). Aufruf: python3 scripts/rename-route.py <id> "<Name>" """
import json, re, sys
rid, name = sys.argv[1], sys.argv[2]
p = f'public/routes/{rid}/route.json'; r = json.load(open(p)); r['name'] = name
json.dump(r, open(p, 'w'), separators=(',', ':'))
g = f'routes/{rid}.gpx'; s = open(g, encoding='utf-8').read(); s = re.sub(r'<name>[^<]*</name>', f'<name>{name}</name>', s, count=1); open(g, 'w', encoding='utf-8').write(s)
print(rid, '→', name)
