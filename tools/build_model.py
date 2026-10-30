"""Build Capri's character model (assets/capri/model.json) from the reference cut-outs.

    python -P tools/build_model.py [--preview docs/previews/model]

For each pose: trace the cut-out (tools/vectorize.py), drop the traced face (the renderer draws a live,
expressive face in its place), clean up scene artefacts, reconstruct anything the original shot cropped
off (hair tips, the end of a leg), then normalise to one shared unit: 26 units = the distance between
her eyes, the same unit the live face is drawn in. Every pose therefore has the same head size, and
coordinates are relative to the pose's anchor (the seat / contact point, or the centre when floating).
"""
import json, math, os, sys
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vectorize import vectorize, ORDER, longpath

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, 'reference', 'cutouts')
EYE_UNITS = 26.0

# Per pose: source cut-out, eye centres (crop px, measured by hand where detection is unreliable),
# anchor (crop px), kind, which crop sides were cut by the original shot, cleanup rules.
POSES = {
    'sit': dict(src='sit_wiki01.png', eyes=[(489, 426), (541, 425)], anchor=(538, 786), kind='sit',
                cut={'top': 'hair', 'bottom': 'leg'}, restore=[(560, 680, 960, 810, 'ink violet green'), (400, 430, 760, 990, 'green violet')], note='Official still (wiki Capri_01): seated on the edge of a bed, one leg along it'),
    'lie': dict(src='lie_5wG_0030.png', eyes=[(1117.3, 436.7), (1150.0, 484.0)], anchor=(760, 548), kind='lie',
                cut={'right': 'hair'}, restore=[(460, 170, 990, 700)], note='Netflix clip 5wGdjjwoDbY 0:29-0:31: lying on her side on the bed'),
    'crouch': dict(src='crouch_Nli_0023.png', eyes=[(227.5, 297.5), (256.0, 291.0)], anchor=(232, 330), kind='float',
                   cut={}, drop_ink_above=0.33, drop_shade_above=0.33, note='Netflix footage (Nli_SZ-DBco 0:23-0:25): knees drawn up, sitting on nothing in mid-air'),
    # cut by tools/cutout_from_frame.py; points given in frame px (coords='frame')
    'back': dict(src='stand_back_n2137.png', coords='frame', back=True,
                 # no face in a back view: the scale comes from her head-to-hip length matching the sitting
                 # pose's (175 units), i.e. an eye spacing of ~43 px at this size
                 eyes=[(963.5, 495), (1006.5, 495)], anchor=(985, 790), kind='stand', leg_len=6.0,
                 cut={'top': 'hair', 'bottom': 'leg'}, note='Netflix footage (Nli_SZ-DBco 3:33.7): standing in the sky, seen from behind'),
}
# Tried and left out: e 1:14 (arms and claws spread, in the fire). The shot is so tight that her hair is
# cropped on three sides and her body at the hips; the rebuilt version was mostly invented shape.
KEEP = ['violet', 'hair', 'crimson', 'shade', 'ink', 'green']  # eyes, irises and teeth come from the live face


def centroid(p):
    a = np.array(p, float); return a[:, 0].mean(), a[:, 1].mean()


def extend_cut(layers, side, kind, w, h, rng, leg_len=2.4):
    """Rebuild what the shot cropped: jagged hair spikes, or a tapering leg tip, past the cut edge."""
    vertical = side in ('top', 'bottom')          # the cut runs horizontally
    edge = {'top': 0.0, 'bottom': float(h), 'left': 0.0, 'right': float(w)}[side]
    out = -1.0 if side in ('top', 'left') else 1.0  # direction away from the picture
    def P(along, across):  # point from (position along the cut, distance past it)
        return [round(along, 1), round(edge + out * across, 1)] if vertical else [round(edge + out * across, 1), round(along, 1)]
    add = {}
    for cls in ('hair', 'violet', 'crimson', 'ink'):
        for poly in layers.get(cls, []):
            a = np.array(poly, float)
            c_across, c_along = (a[:, 1], a[:, 0]) if vertical else (a[:, 0], a[:, 1])
            on = np.abs(c_across - edge) <= 2.5
            if on.sum() < 2: continue
            lo, hi = c_along[on].min(), c_along[on].max()
            if hi - lo < 6: continue
            if kind == 'hair' and cls == 'hair':
                # each spike tip the frame cut off gets its own continuation (contiguous runs of the
                # outline lying on the cut), a little longer than it is wide, with the violet offset
                runs, cur = [], []
                for i in range(len(a) + 1):
                    if i < len(a) and on[i]: cur.append(c_along[i])
                    elif cur: runs.append((min(cur), max(cur))); cur = []
                for b0, b1 in runs:
                    if b1 - b0 < 6: continue
                    if b1 - b0 > 60:
                        # a wide cut through the hair cloud closes as a low, jagged dome (the cloud is
                        # round on top, W1/infobox), not one giant spike
                        n = max(8, int((b1 - b0) / 22))
                        dome = [P(b0, -2)]
                        for i in range(1, n):
                            t = i / n
                            hgt = (b1 - b0) * 0.2 * math.sin(math.pi * t) ** 0.7
                            jag = (b1 - b0) * 0.05 * (1.0 if i % 2 else -0.35) * (0.6 + rng.random() * 0.8)
                            dome.append(P(b0 + (b1 - b0) * t + (rng.random() - 0.5) * 6, max(2.0, hgt + jag)))
                        dome.append(P(b1, -2))
                        add.setdefault('violet', []).append([[x - 3.5, y + 4.5] for x, y in dome])
                        add.setdefault('hair', []).append(dome)
                        continue
                    L = (b1 - b0) * (0.7 + rng.random() * 0.8)
                    tip = (b0 + b1) / 2 + (rng.random() - 0.5) * (b1 - b0) * 0.8
                    shard = [P(b0, -2), P(b1, -2), P(tip, L)]
                    add.setdefault('violet', []).append([[x - 3.5, y + 4.5] for x, y in shard])
                    add.setdefault('hair', []).append(shard)
            elif kind == 'leg' and cls in ('crimson', 'ink', 'violet') and vertical:
                # continue the limb along its own direction to a point, the way her legs end (W2, N 1:51)
                near = a[np.abs(c_across - edge) < 140]
                if len(near) < 3: continue
                slope = np.polyfit(near[:, 1], near[:, 0], 1)[0]  # dx/dy of the limb near the cut
                L = (hi - lo) * leg_len
                add.setdefault(cls, []).append([P(lo, -2), P(hi, -2), P((lo + hi) / 2 + slope * L * out, L)])
    for k, v in add.items(): layers.setdefault(k, []).extend(v)


def build():
    model = {'unit': 'eye spacing = 26', 'poses': {}}
    rng = np.random.default_rng(7)
    for name, P in POSES.items():
        m = vectorize(os.path.join(REF, P['src']), restore=P.get('restore'))
        # eyes and anchor are measured in the original crop; a restore can widen it
        sx, sy = m['origin0'][0] - m['origin'][0], m['origin0'][1] - m['origin'][1]
        if P.get('coords') == 'frame': sx, sy = -m['origin'][0], -m['origin'][1]  # points measured on the whole frame
        if P['eyes'] == 'auto':  # front views: the irises are found in the trace
            if not m['face']: raise SystemExit(f'{name}: no eyes found; give them by hand')
            P = dict(P, eyes=[tuple(e) for e in m['face']['eyes']], anchor=(P['anchor'][0] + sx, P['anchor'][1] + sy))
        else:
            P = dict(P, eyes=[(x + sx, y + sy) for x, y in P['eyes']], anchor=(P['anchor'][0] + sx, P['anchor'][1] + sy))
        w, h = m['size']
        ox, oy = m['origin']
        layers = {k: v for k, v in m['layers'].items() if k in KEEP}
        if 'drop_ink_above' in P:
            layers['ink'] = [p for p in layers.get('ink', []) if centroid(p)[1] > P['drop_ink_above'] * h]
        if 'drop_shade_above' in P:  # the cut-out's soft shadow halo above her hair traces as a dark band
            layers['shade'] = [p for p in layers.get('shade', []) if centroid(p)[1] > P['drop_shade_above'] * h]
        (e1, e2) = P['eyes']
        dist = math.dist(e1, e2)
        k = EYE_UNITS / dist
        ang = math.atan2(e2[1] - e1[1], e2[0] - e1[0])
        mx, my = (e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2
        # live-face origin: the head centre sits 5 units below the eye line, in face space
        fx, fy = mx - math.sin(ang) * 5 / k, my + math.cos(ang) * 5 / k
        ax, ay = P['anchor']
        tx = lambda x, y: [round((x - ax) * k, 2), round((y - ay) * k, 2)]
        # the live face replaces the traced one: drop the traced mask pieces under it, or they poke out
        # around it as mismatched green shards (worst on the tilted lying pose)
        face_r = 34 / k  # model units → crop px; the live head plate is ~30 units across from its centre
        layers['green'] = [p for p in layers.get('green', []) if math.dist(centroid(p), (fx, fy)) > face_r]
        # crimson patches enclosed by the hair cloud are hair: as crimson they stay flat discs with no glitter
        hair_rings = [np.array(p, np.float32).reshape(-1, 1, 2) for p in layers.get('hair', [])]
        keep, to_hair = [], []
        for p in layers.get('crimson', []):
            c = tuple(float(v) for v in centroid(p))
            # class masks are disjoint, so crimson inside the hair outline sits in one of its holes; added to
            # the hair layer it fills that hole under the renderer's even-odd fill
            inside = any(cv2.pointPolygonTest(r, c, False) >= 0 for r in hair_rings)
            # in her head's own frame (rotated with the face, so the lying pose works too): crimson at or
            # above head height and outside the neck/torso column under the face is the hair cloud, flat
            # only because shadow weakened its glitter; the torso column and the legs stay body
            dx, dy = c[0] - fx, c[1] - fy
            ux = dx * math.cos(-ang) - dy * math.sin(-ang); uy = dx * math.sin(-ang) + dy * math.cos(-ang)
            torso = abs(ux) < 30 / k and uy > 12 / k
            cloud = uy < 75 / k and not torso
            near_face = math.dist(c, (fx, fy)) < face_r * 1.3
            (to_hair if (inside or cloud) and not near_face and not torso else keep).append(p)
        layers['crimson'] = keep
        layers['hair'] = layers.get('hair', []) + to_hair
        # rebuild what the shot cropped, once every hair piece is classed as hair: only on sides where the
        # cut-out really touches the frame edge
        src_w, src_h = 1920, 1080
        for side, kind in P['cut'].items():
            touching = {'top': oy <= 1, 'bottom': oy + h >= src_h - 1, 'left': ox <= 1, 'right': ox + w >= src_w - 1}[side]
            if touching: extend_cut(layers, side, kind, w, h, rng, P.get('leg_len', 2.4))
        out_layers = {}
        allpts = []
        for cls in ORDER:
            if cls not in layers: continue
            polys = []
            for p in layers[cls]:
                q = [tx(x, y) for x, y in p]
                polys.append(q); allpts += q
            out_layers[cls] = polys
        a = np.array(allpts)
        model['poses'][name] = {
            'kind': P['kind'], 'note': P['note'], **({'back': True} if P.get('back') else {}),
            'face': {'x': round((fx - ax) * k, 2), 'y': round((fy - ay) * k, 2), 'angle': round(ang, 4)},
            'bounds': [round(float(a[:, 0].min()), 1), round(float(a[:, 1].min()), 1), round(float(a[:, 0].max()), 1), round(float(a[:, 1].max()), 1)],
            'layers': out_layers,
        }
        print(f"{name:7s} bounds {model['poses'][name]['bounds']}  face {model['poses'][name]['face']}  polys {sum(len(v) for v in out_layers.values())}")
    return model


if __name__ == '__main__':
    model = build()
    out = os.path.join(ROOT, 'assets', 'capri', 'model.json')
    with open(longpath(out), 'w') as f: json.dump(model, f, separators=(',', ':'))
    print('wrote', out, f'{os.path.getsize(longpath(out)) / 1024:.0f} KB')
