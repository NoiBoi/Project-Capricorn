"""Tile out/stills/*.jpg (named by seconds) into out/stills_sheet.jpg for review: python -P scripts/sheet.py"""
import glob, os
import cv2
import numpy as np

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = sorted(glob.glob(os.path.join(root, 'out', 'stills', '*.jpg')), key=lambda p: float(os.path.basename(p)[:-4]))
tiles = []
for p in files:
    im = cv2.resize(cv2.imdecode(np.fromfile(p, np.uint8), 1), (480, 270))
    cv2.putText(im, os.path.basename(p)[:-4], (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    tiles.append(im)
while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
sheet = np.vstack([np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)])
cv2.imencode('.jpg', sheet, [cv2.IMWRITE_JPEG_QUALITY, 80])[1].tofile(os.path.join(root, 'out', 'stills_sheet.jpg'))
print(len(files), 'stills')
