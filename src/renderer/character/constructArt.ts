/** Original canvas shapes in the companion palette. No alternate body cutout or color filter. */
export function polygon(
  g: CanvasRenderingContext2D,
  points: number[][],
  fill: string,
) {
  g.fillStyle = fill;
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
}
export function drawConstructMask(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  eyes: number,
  look = 0,
  peek = false,
) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  const slab = [
    [-49, -35],
    [-29, -18],
    [-8, -24],
    [-2, -17],
    [10, -25],
    [40, -18],
    [33, 9],
    [15, 25],
    [4, 15],
    [-5, 20],
    [-29, 10],
    [-39, -16],
  ];
  g.save();
  g.translate(3, 4);
  polygon(g, slab, "#7b3df2");
  g.restore();
  polygon(g, slab, "#22f27a");
  polygon(
    g,
    [
      [-3, -18],
      [1, -13],
      [0, 9],
      [-5, 13],
    ],
    "#0a0710",
  );
  for (const side of [-1, 1]) {
    const cx = side * 19,
      openness = peek && side < 0 ? 0.34 : eyes;
    if (openness < 0.15) {
      g.strokeStyle = "#0a0710";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx - 9, -6);
      g.lineTo(cx, 1);
      g.lineTo(cx + 8, -8);
      g.stroke();
    } else {
      g.save();
      g.translate(cx, -5);
      g.scale(1, openness);
      g.fillStyle = "#0a0710";
      g.beginPath();
      g.ellipse(0, 0, 11, 12, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#eaffff";
      g.beginPath();
      g.arc(look * 2, 0, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#236cff";
      g.beginPath();
      g.arc(look * 2, 0, 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#0a0710";
      g.beginPath();
      g.arc(look * 2, 0, 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.fillRect(-2 + look * 2, -4, 3, 3);
      g.restore();
    }
  }
  polygon(
    g,
    [
      [-7, 27],
      [0, 32],
      [9, 26],
      [5, 35],
      [-2, 33],
    ],
    "#f5f4ff",
  );
  g.restore();
}
export function bolt(
  g: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  time: number,
  strength = 1,
) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    len = Math.max(1, Math.hypot(dx, dy)),
    nx = -dy / len,
    ny = dx / len;
  const points = Array.from({ length: 10 }, (_, i) => {
    const u = i / 9,
      j =
        i === 0 || i === 9
          ? 0
          : Math.sin(i * 2.29 + Math.floor(time * 12) * 1.7) *
            Math.min(24, len * 0.07);
    return { x: from.x + dx * u + nx * j, y: from.y + dy * u + ny * j };
  });
  g.save();
  g.globalAlpha *= strength;
  for (const [color, width] of [
    ["#7b3df2", 8],
    ["#f2154c", 4],
    ["#ffe5ed", 1.4],
  ] as const) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
  }
  g.restore();
}
export function star(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color = "#ffecf3",
) {
  polygon(
    g,
    [
      [x, y - size],
      [x + size * 0.23, y - size * 0.23],
      [x + size, y],
      [x + size * 0.23, y + size * 0.23],
      [x, y + size],
      [x - size * 0.23, y + size * 0.23],
      [x - size, y],
      [x - size * 0.23, y - size * 0.23],
    ],
    color,
  );
}
