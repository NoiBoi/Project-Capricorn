"""Map of which class each traced shape ended up in, per pose (hair outlined red, crimson yellow, ink
grey, green green, violet magenta): python -P tools/preview_classes.py -> docs/previews/classes.png"""
import json, os
import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
m = json.load(open(os.path.join(ROOT, 'assets', 'capri', 'model.json')))
col = {'violet': (255, 0, 255), 'hair': (60, 60, 230), 'crimson': (0, 255, 255), 'shade': (0, 128, 0), 'ink': (90, 90, 90), 'green': (0, 255, 0)}
tiles = []
for name, P in m['poses'].items():
    x0, y0, x1, y1 = P['bounds']
    s = 560 / max(x1 - x0, y1 - y0)
    img = np.zeros((600, 600, 3), np.uint8)
    for cls in ['violet', 'hair', 'crimson', 'shade', 'ink', 'green']:
        for p in P['layers'].get(cls, []):
            q = ((np.array(p) - [x0, y0]) * s + 20).astype(np.int32)
            if cls == 'hair': cv2.polylines(img, [q], True, col[cls], 1)
            else: cv2.fillPoly(img, [q], col[cls])
    f = P['face']; cv2.circle(img, (int((f['x'] - x0) * s + 20), int((f['y'] - y0) * s + 20)), 6, (255, 255, 255), 2)
    cv2.putText(img, name, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    tiles.append(img)
out = os.path.join(ROOT, 'docs', 'previews', 'classes.png')
cv2.imencode('.png', np.hstack(tiles))[1].tofile('\\\\?\\' + out if os.name == 'nt' else out)
