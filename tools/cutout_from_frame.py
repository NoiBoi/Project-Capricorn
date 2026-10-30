"""Cut Capri out of one show frame by her palette, for shots where she stands against a background in
colours she never uses (open sky, fire). Writes an RGBA PNG like the other files in reference/cutouts.

    python -P tools/cutout_from_frame.py <video> <seconds> <out.png> [--drop x0,y0,x1,y1 ...]

Her pixels: crimson / pink glitter (red well above green), mask green, violet edges, and near-black ink
or dark navy body. The glitter's white speckle is filled by a closing. Only regions joined to her main
body are kept, so stray dark windows or embers elsewhere in the frame are dropped; --drop boxes (e.g.
the credit watermark) are cleared first.
"""
import os, sys
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vectorize import longpath


def her_mask(bgr):
    b, g, r = [bgr[..., i].astype(np.int16) for i in range(3)]
    # her crimson, plus glare-washed pink (which keeps its blue; orange fire has none)
    crimson = ((r > 120) & (r - g > 90) & (r > b - 10) & (b > g - 20)) | ((r > 180) & (r - g > 45) & (r > b) & (b > 100))
    green = (g > 170) & (g - r > 60) & (b < 190)
    violet = (b > 130) & (r > 90) & (g < 110) & (b - g > 60)
    dark = (np.maximum(np.maximum(r, g), b) < 95) & (np.abs(r - g) + np.abs(g - b) < 120)
    return crimson | green | violet | dark


def cutout(bgr, drop=()):
    m = her_mask(bgr).astype(np.uint8)
    for x0, y0, x1, y1 in drop: m[y0:y1, x0:x1] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))  # glitter speckle
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if n < 2: raise SystemExit('nothing of her found')
    main = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    keep = lab == main
    # pieces of her drawn apart from the body (hair shards, claws) sit within a short reach of it
    reach = cv2.dilate(keep.astype(np.uint8), np.ones((41, 41), np.uint8)) > 0
    for i in range(1, n):
        if i != main and st[i, cv2.CC_STAT_AREA] >= 60 and reach[lab == i].any(): keep |= lab == i
    out = np.dstack([bgr, (keep * 255).astype(np.uint8)])
    return out


if __name__ == '__main__':
    video, t, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    drop = [tuple(int(v) for v in a.split(',')) for a in sys.argv[4:] if a != '--drop']
    cap = cv2.VideoCapture(video)
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    if not ok: raise SystemExit('could not read the frame')
    rgba = cutout(frame, drop)
    cv2.imencode('.png', rgba)[1].tofile(longpath(out))
    print(out, 'her pixels:', int((rgba[..., 3] > 0).sum()))
