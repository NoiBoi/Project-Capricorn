"""Side-by-side review of each pose: source frame crop | traced vectors (after restore and cleanup).

    python -P tools/preview_traces.py   -> docs/previews/trace_<pose>.png
"""
import os, sys
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vectorize import vectorize, render, longpath
from build_model import POSES, REF, ROOT

out = os.path.join(ROOT, 'docs', 'previews')
os.makedirs(longpath(out), exist_ok=True)
for pose, P in POSES.items():
    src = os.path.join(REF, P['src'])
    im = cv2.imdecode(np.fromfile(longpath(src), np.uint8), cv2.IMREAD_UNCHANGED)
    m = vectorize(src, restore=P.get('restore'))
    x0, y0 = m['origin']; w, h = m['size']
    sheet = np.hstack([im[y0:y0 + h, x0:x0 + w, :3], render(m)])
    s = 900 / sheet.shape[1]
    cv2.imencode('.png', cv2.resize(sheet, None, fx=s, fy=s))[1].tofile(longpath(os.path.join(out, f'trace_{pose}.png')))
    print(pose, 'origin', m['origin'], 'before restore', m['origin0'], 'size', m['size'])
