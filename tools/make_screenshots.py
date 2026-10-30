"""Repo screenshots from the recorded desktop take and the renderer captures:
python -P tools/make_screenshots.py <desktop.mp4>  ->  docs/screenshots/*"""
import json, os, sys, glob
import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'screenshots')
os.makedirs(OUT, exist_ok=True)
marks = json.load(open(os.path.join(ROOT, 'trailer', 'public', 'clips', 'marks.json')))
cap = cv2.VideoCapture(sys.argv[1])
BG = np.array((15, 11, 12), np.uint8)

def frame(t):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * 30)); ok, f = cap.read(); assert ok, t
    return f

def desk(t, x=0, y=0, w=1813, h=1020):  # the recording minus the taskbar (bottom 60 px), 16:9
    return frame(t)[y:y + h, x:x + w]

def save(name, im, q=88):
    path = os.path.join(OUT, name)
    if name.endswith('.png'): cv2.imencode('.png', im)[1].tofile(path)
    else: cv2.imencode('.jpg', im, [cv2.IMWRITE_JPEG_QUALITY, q])[1].tofile(path)
    print(name, im.shape[1], 'x', im.shape[0])

def on_bg(rgba):
    a = rgba[..., 3:4] / 255.0
    return (rgba[..., :3] * a + BG * (1 - a)).astype(np.uint8)

# hero: her and the chat on the desktop
save('desktop.jpg', cv2.resize(desk(marks['ask_timer'] + 6.5, x=0), (1600, 900), interpolation=cv2.INTER_AREA))
# she arrives
save('arrive.jpg', cv2.resize(desk(marks['watch'] + 1.0, x=107), (1600, 900), interpolation=cv2.INTER_AREA))
# teleport, mid-glitch: three moments side by side, cropped around her
L = marks['layout']
def around(r, t, pad=40):
    x, y, w, h = r; f = frame(t)
    return f[max(0, y - pad):y + h + pad, max(0, x - pad):x + w + pad]
m = marks['moved']
strip = []
for t, r in [(m - 0.55, L['chat']['her']), (m - 0.42, L['chat']['her']), (m + 0.0, L['moved']['her']), (m + 0.6, L['moved']['her'])]:
    im = around(r, t); strip.append(cv2.resize(im, (int(im.shape[1] * 480 / im.shape[0]), 480)))
save('teleport.jpg', np.hstack(strip))
# expressions from the renderer close-ups
faces = []
for name, f in [('smug', 30), ('maniac', 30), ('wink', 15), ('many_eyes', 40), ('tilt_grin', 30), ('talk', 20)]:
    p = os.path.join(ROOT, 'trailer', 'public', 'clips', 'faces', name, f'{f:03d}.png')
    faces.append(cv2.resize(on_bg(cv2.imdecode(np.fromfile(p, np.uint8), cv2.IMREAD_UNCHANGED)), (640, 360), interpolation=cv2.INTER_AREA))
save('expressions.jpg', np.vstack([np.hstack(faces[:3]), np.hstack(faces[3:])]))
# poses
poses = []
for n in ('sit_window', 'lie_taskbar', 'float_air', 'back_taskbar'):
    im = on_bg(cv2.imdecode(np.fromfile(os.path.join(ROOT, 'docs', 'previews', 'model', f'{n}.png'), np.uint8), cv2.IMREAD_UNCHANGED))
    poses.append(im)
h = max(i.shape[0] for i in poses)
poses = [cv2.copyMakeBorder(i, 0, h - i.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=BG.tolist()) for i in poses]
save('poses.jpg', np.hstack(poses))
# panel: chat and character settings
pan = [cv2.imdecode(np.fromfile(os.path.join(ROOT, 'docs', 'previews', 'panel', f'{n}.png'), np.uint8), 1) for n in ('chat', 'character', 'model')]
gap = np.full((pan[0].shape[0], 24, 3), BG, np.uint8)
save('panel.png', np.hstack([pan[0], gap, pan[1], gap, pan[2]]))
