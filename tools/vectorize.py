"""Trace a cut-out of Capri (RGBA, from a show frame) into clean, palette-flat vector layers.

    python -P tools/vectorize.py <cutout.png> <out.json> [--preview out.png]

The show draws her in a handful of flat colours, so each pixel is snapped to her palette, each colour
region is traced into polygons (holes kept with even-odd fill), and the hair's glitter speckle is
detected and dropped (the renderer re-creates it as a texture over the 'hair' regions). The eyes (blue
irises inside the green mask) and the mouth (white teeth below them) are located so the renderer can
draw live eyes and a live mouth over the traced face.
"""
import json, sys
import cv2
import numpy as np
import os


def longpath(p):
    """Windows: allow paths past MAX_PATH (deep project folders)."""
    p = os.path.abspath(p)
    prefix = '\\\\?\\'
    return prefix + p if os.name == 'nt' and not p.startswith(prefix) else p

# her palette (BGR) -> class
PALETTE = {
    'crimson': (74, 22, 236),
    'ink': (16, 8, 12),
    'shade': (50, 14, 112),  # dark crimson linework on the torso and legs
    'green': (122, 236, 34),
    'violet': (230, 60, 140),
    'white': (245, 240, 250),
    'blue': (230, 110, 30),
}
ORDER = ['violet', 'hair', 'crimson', 'shade', 'ink', 'green', 'blue', 'white']


def classify(bgr, alpha):
    """Snap every opaque pixel to the nearest palette colour (in Lab, after removing glitter speckle)."""
    smooth = cv2.medianBlur(bgr, 5)
    lab = cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB).astype(np.float32)
    names = list(PALETTE)
    ref = cv2.cvtColor(np.uint8([[PALETTE[n] for n in names]]), cv2.COLOR_BGR2LAB).astype(np.float32)[0]
    d = ((lab[:, :, None, :] - ref[None, None]) ** 2).sum(-1)
    idx = d.argmin(-1)
    cls = np.full(alpha.shape, -1, np.int16)
    cls[alpha > 110] = idx[alpha > 110]
    # glitter: high local contrast inside crimson -> hair (the speckles themselves become crimson)
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mean = cv2.blur(grey, (9, 9)); sq = cv2.blur(grey * grey, (9, 9))
    std = np.sqrt(np.maximum(sq - mean * mean, 0))
    crim, white = names.index('crimson'), names.index('white')
    hairy = (std > 22).astype(np.uint8)
    hairy = cv2.morphologyEx(hairy, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    hairy = cv2.morphologyEx(hairy, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    hair = (hairy > 0) & ((cls == crim) | (cls == white))
    # flat crimson patches enclosed by the glittery cloud are hair too (no blotchy glitter-less squares)
    zone = cv2.morphologyEx(hair.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))) > 0
    shade = names.index('shade')
    hair = hair | (zone & ((cls == crim) | (cls == white) | (cls == shade)))  # scene shadows on the hair are still hair
    return cls, names, hair


def trace(mask, eps):
    """Polygons (outer rings + holes) of a binary mask."""
    m = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None: return out
    for i, c in enumerate(cs):
        if cv2.contourArea(c) < 14: continue
        p = cv2.approxPolyDP(c, eps, True)[:, 0, :]
        if len(p) >= 3: out.append(p.astype(int).tolist())
    return out


def find_face(cls, names):
    """Two iris blobs (blue inside or beside green) -> eye centres and radius; white teeth below -> mouth box."""
    blue = (cls == names.index('blue')).astype(np.uint8)
    green = (cls == names.index('green')).astype(np.uint8)
    near_green = cv2.dilate(green, np.ones((25, 25), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(blue & near_green, 8)
    blobs = sorted([(st[i, cv2.CC_STAT_AREA], cen[i]) for i in range(1, n)], key=lambda x: -x[0])[:2]
    if len(blobs) < 2: return None
    (a1, c1), (a2, c2) = blobs
    eyes = sorted([c1, c2], key=lambda c: c[0])
    r = float(np.sqrt((a1 + a2) / 2 / np.pi))
    ex, ey = (eyes[0][0] + eyes[1][0]) / 2, (eyes[0][1] + eyes[1][1]) / 2
    dist = float(np.hypot(eyes[1][0] - eyes[0][0], eyes[1][1] - eyes[0][1]))
    white = (cls == names.index('white')).astype(np.uint8)
    win = np.zeros_like(white)
    y0, y1 = int(ey + dist * 0.25), int(ey + dist * 1.6)
    x0, x1 = int(ex - dist * 1.1), int(ex + dist * 1.1)
    win[max(0, y0):y1, max(0, x0):x1] = 1
    ys, xs = np.where(white & win)
    mouth = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) > 8 else None
    return {'eyes': [[float(e[0]), float(e[1])] for e in eyes], 'iris': r, 'eyeDist': dist, 'mouth': mouth}


def restore_body(bgr, alpha, boxes):
    """The cut-out masks dropped parts of her drawn dark-on-dark (a raised black leg against a dark
    curtain, a black leg along a dark bed) or thin (green streaks). The frame's colours are still in the
    file, so inside each box take back the pixels in her exact colours — near-black ink (almost no green
    channel, unlike any room shadow), mask green, violet edge, crimson — but only regions that join her
    existing body, or float within a stroke's width of it (her streaks and stripes are separate shapes
    beside the limb). Each box is (x0, y0, x1, y1[, 'classes']), classes defaulting to all four."""
    b, g, r = [bgr[..., i].astype(np.int16) for i in range(3)]
    colours = {
        'ink': (g < 16) & (r < 50) & (b < 80),
        'green': (g > 190) & (r < 110) & (b < 170),
        'violet': (b > 140) & (r > 100) & (g < 100),
        'crimson': (r > 190) & (g < 70) & (b < 140),
    }
    cand = np.zeros(alpha.shape, bool)
    for spec in boxes:
        x0, y0, x1, y1 = spec[:4]
        want = spec[4].split() if len(spec) > 4 else list(colours)
        box = np.zeros(alpha.shape, bool); box[y0:y1, x0:x1] = True
        for c in want: cand |= box & colours[c]
    cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0  # no speckle
    body = alpha > 110
    n, lab, st, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), connectivity=8)
    reach = np.ones((31, 31), np.uint8)
    added = np.zeros(n, bool)
    for _ in range(4):  # grow outward: a stripe beside a restored leg joins on the next pass
        near = cv2.dilate(body.astype(np.uint8), reach) > 0
        hit = np.unique(lab[near & cand])
        new = [i for i in hit if i and not added[i] and st[i, cv2.CC_STAT_AREA] >= 40]
        if not new: break
        added[new] = True
        body = body | added[lab]
    out = alpha.copy(); out[added[lab]] = 255
    return out


def vectorize(path, eps=1.3, restore=None):
    im = cv2.imdecode(np.fromfile(longpath(path), np.uint8), cv2.IMREAD_UNCHANGED)  # works on deep Windows paths
    bgr, alpha = im[..., :3], im[..., 3]
    ys0, xs0 = np.where(alpha > 110)
    origin0 = [int(xs0.min()), int(ys0.min())]  # crop origin before any restore (pose tables measure in it)
    if restore: alpha = restore_body(bgr, alpha, restore)
    ys, xs = np.where(alpha > 110)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    bgr, alpha = bgr[y0:y1, x0:x1], alpha[y0:y1, x0:x1]
    cls, names, hair = classify(bgr, alpha)
    layers = {}
    for name in ORDER:
        if name == 'hair': mask = hair
        else:
            mask = cls == names.index(name)
            if name in ('crimson', 'white', 'shade'): mask = mask & ~hair
        polys = trace(mask, eps)
        if name in ('ink', 'shade'):
            # drop anti-aliasing slivers along outlines: tiny, or too thin to be one of her shapes
            def solid(p):
                c = np.array(p, np.float32).reshape(-1, 1, 2)
                area, per = cv2.contourArea(c), cv2.arcLength(c, True)
                return area >= 60 and area / max(per, 1) >= 1.1
            polys = [p for p in polys if solid(p)]
        if polys: layers[name] = polys
    face = find_face(cls, names)
    return {'size': [int(x1 - x0), int(y1 - y0)], 'origin': [int(x0), int(y0)], 'origin0': origin0, 'layers': layers, 'face': face}


def render(model, scale=1.0):
    """Quick preview of the traced vectors (no glitter)."""
    w, h = model['size']
    canvas = np.full((h, w, 3), (60, 50, 70), np.uint8)
    col = dict(PALETTE, hair=PALETTE['crimson'])
    for name in ORDER:
        for p in model['layers'].get(name, []):
            cv2.fillPoly(canvas, [np.array(p, np.int32)], col[name])
    f = model.get('face')
    if f:
        for e in f['eyes']: cv2.circle(canvas, (int(e[0]), int(e[1])), int(f['iris'] * 1.6), (0, 255, 255), 1)
        if f['mouth']: cv2.rectangle(canvas, tuple(f['mouth'][:2]), tuple(f['mouth'][2:]), (0, 255, 255), 1)
    return canvas


if __name__ == '__main__':
    m = vectorize(sys.argv[1])
    json.dump(m, open(sys.argv[2], 'w'))
    n = sum(len(v) for v in m['layers'].values())
    print(f"{n} polygons, {sum(len(p) for v in m['layers'].values() for p in v)} points, face={'yes' if m['face'] else 'no'}")
    if '--preview' in sys.argv:
        out = sys.argv[sys.argv.index('--preview') + 1]
        src = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
        x0, y0 = m['origin']; w, h = m['size']
        crop = src[y0:y0 + h, x0:x0 + w]
        a = crop[..., 3:4] / 255.0
        orig = (crop[..., :3] * a + np.array((60, 50, 70)) * (1 - a)).astype(np.uint8)
        cv2.imwrite(out, np.hstack([orig, render(m)]))
