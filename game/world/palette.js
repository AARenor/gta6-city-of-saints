// City of Saints: the palette and the ground of the whole world.
//
// paint() draws grass, beach, sea, asphalt, lane paint, crosswalks and kerbs in
// world coordinates. Geometry comes from the world object createWorld() makes
// (grid, pitch, road, size, coast, shore) and falls back to the same constants
// when one is missing. Nothing here keeps state: the sea highlight moves with
// state.t and the day and night tones follow state.dayPhase.
//
// Exports: PALETTE, paint.

export const PALETTE = {
  sky: '#8ecfe6',
  grass: '#527f3e',
  asphalt: '#2e3037',
  seam: '#23252b',
  lane: '#f4f2ea',
  kerb: '#c9c6bc',
  sidewalk: '#a3a5a6',
  sand: '#e6d5a4',
  sandWet: '#c3ab7b',
  sea: '#1b5f7d',
  seaShallow: '#2f86a3',
  seaDeep: '#0e3a50',
  seaHighlight: '#b0e8f2',
  foam: '#eef9fc',
  palm: '#2f7a3a',
  palmDark: '#1f5a2a',
  trunk: '#6b4a2a',
  pier: '#7d5a34',
  pierPlank: '#8f6a40',
  lamp: '#ffd9a0',
  glow: 'rgba(255, 214, 150, 0.18)',
  neon: ['#ff3ea5', '#38e8ff', '#ffd23f', '#7cff6b', '#b46bff'],
  cars: ['#c0392b', '#2a6fb0', '#d8b13a', '#2f8f5b', '#8e44ad', '#e2e2e2', '#32363c', '#e07b39'],
  skins: ['#f2c9a4', '#c98d63', '#82512f'],
  families: [
    { name: 'brick', roof: '#8c4a3a', roofs: ['#8c4a3a', '#9c5442', '#7c4032'], wall: '#a2624a', trim: '#5c2f26', glass: '#2b3a44', tall: 8 },
    { name: 'glass', roof: '#3f6f86', roofs: ['#3f6f86', '#4a7f96', '#37617a'], wall: '#2a4b5c', trim: '#8fd3e8', glass: '#9fe6f2', tall: 16 },
    { name: 'stucco', roof: '#d8c9a8', roofs: ['#d8c9a8', '#e3d5b6', '#c9b894'], wall: '#efe4cc', trim: '#b09b74', glass: '#3a4a52', tall: 10 },
    { name: 'concrete', roof: '#8a8d92', roofs: ['#8a8d92', '#7c7f85', '#969aa0'], wall: '#a9adb3', trim: '#5f6369', glass: '#31414a', tall: 12 },
    { name: 'hotel', roof: '#7a4f52', roofs: ['#7a4f52', '#8a5b5c', '#6b4547'], wall: '#c79084', trim: '#f2dfc0', glass: '#2f4650', tall: 14 },
  ],
  night: {
    sky: '#0d1524',
    grass: '#1d2c1d',
    asphalt: '#191a1f',
    seam: '#131418',
    lane: '#a9a698',
    kerb: '#6d7078',
    sidewalk: '#4f5257',
    sand: '#776c50',
    sandWet: '#5b5440',
    sea: '#0a2231',
    seaShallow: '#12455c',
    seaDeep: '#04121c',
    seaHighlight: '#3f8299',
    foam: '#8fb4c2',
  },
};

const FALLBACK = { grid: 12, pitch: 320, road: 96, size: 3840, coast: 3520, shore: 3628 };
const KERB = 14;
const TONE_KEYS = ['grass', 'asphalt', 'seam', 'lane', 'kerb', 'sidewalk', 'sand', 'sandWet',
  'sea', 'seaShallow', 'seaDeep', 'seaHighlight', 'foam'];

function geo(world) {
  const w = world || {};
  return {
    grid: w.grid || FALLBACK.grid,
    pitch: w.pitch || FALLBACK.pitch,
    road: w.road || FALLBACK.road,
    size: w.size || FALLBACK.size,
    coast: w.coast || FALLBACK.coast,
    shore: w.shore || FALLBACK.shore,
  };
}

function viewRect(state) {
  const cam = (state && state.camera) || { x: 0, y: 0 };
  const w = (state && state.canvas && state.canvas.w) || 1280;
  const h = (state && state.canvas && state.canvas.h) || 720;
  const m = 120;
  return { x: cam.x - m, y: cam.y - m, w: w + m * 2, h: h + m * 2 };
}

function mix(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

// 0 at midday, 1 at midnight. dayPhase 0.32 is day and 0.92 is night.
function nightAmount(dayPhase) {
  const p = ((dayPhase || 0) % 1 + 1) % 1;
  const light = 0.5 + 0.5 * Math.cos((p - 0.4) * Math.PI * 2);
  return 1 - Math.min(1, Math.max(0, (light - 0.15) / 0.75));
}

function tones(night) {
  const out = {};
  for (const key of TONE_KEYS) out[key] = mix(PALETTE[key], PALETTE.night[key], night);
  return out;
}

// Clipped fill: draws only the part of the rect inside the visible bounds.
function box(ctx, x, y, w, h, L, T, R, B) {
  const x0 = Math.max(x, L);
  const y0 = Math.max(y, T);
  const x1 = Math.min(x + w, R);
  const y1 = Math.min(y + h, B);
  if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

function blocksOf(g, world) {
  if (world && Array.isArray(world.blocks) && world.blocks.length > 0) return world.blocks;
  const out = [];
  for (let j = 0; j < g.grid; j += 1) {
    for (let i = 0; i < g.grid; i += 1) {
      const x = i * g.pitch + g.road;
      const y = j * g.pitch + g.road;
      const s = g.pitch - g.road;
      if (x + s > g.coast) continue;
      out.push({ i, j, x, y, w: s, h: s });
    }
  }
  return out;
}

function drawSea(ctx, g, col, t, L, T, R, B) {
  if (R <= g.shore) return;
  const x0 = Math.max(L, g.shore);
  ctx.fillStyle = col.sea;
  ctx.fillRect(x0, T, R - x0, B - T);
  // shallow water at the sand, then the deep blue offshore, so the sea reads in bands
  const shallow = Math.min(R, g.shore + 46);
  if (shallow > x0) {
    ctx.fillStyle = col.seaShallow;
    ctx.fillRect(x0, T, shallow - x0, B - T);
  }
  const deep = Math.min(R, g.shore + 210);
  if (deep > x0) {
    ctx.fillStyle = col.seaDeep;
    ctx.fillRect(deep, T, R - deep, B - T);
  }
  // one soft highlight band sweeps the water and back, driven by the clock
  const bandW = 96;
  const seaW = Math.max(bandW + 40, g.size - g.shore);
  const phase = ((t * 0.32) % 2 + 2) % 2;
  const swing = phase < 1 ? phase : 2 - phase;
  const bandX = g.shore + 12 + swing * (seaW - bandW - 12);
  ctx.fillStyle = col.seaHighlight;
  for (let i = 0; i < 2; i += 1) {
    const bx = Math.max(x0, bandX + i * 26);
    const bx1 = Math.min(R, bandX + i * 26 + bandW - i * 52);
    if (bx1 <= bx) continue;
    ctx.globalAlpha = 0.1 + i * 0.05;
    ctx.fillRect(bx, T, bx1 - bx, B - T);
  }
  ctx.globalAlpha = 1;
  // crests drift with the clock, so the water keeps moving while nothing else does
  const span = Math.max(1, g.size - g.shore - 60);
  const step = 38;
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = col.seaHighlight;
  const y0 = Math.floor(T / step) * step;
  for (let y = y0; y < B; y += step) {
    const len = 16 + 16 * Math.abs(Math.cos(y * 0.017 + t * 0.6));
    const drift = Math.abs((t * 26 + y * 5.5) % span);
    const x = Math.max(g.shore + 8 + drift, x0);
    if (x > R) continue;
    const wobble = Math.sin(y * 0.011 + t * 0.9) * 5;
    ctx.fillRect(x, y + wobble, Math.min(len, R - x), 2);
  }
  ctx.globalAlpha = 1;
  // foam along the water line
  ctx.fillStyle = col.foam;
  for (let y = y0; y < B; y += 16) {
    const wobble = Math.sin(y * 0.02 + t * 0.7) * 3;
    ctx.fillRect(g.shore - 2 + wobble, y, 3, 9);
  }
}

function drawBeach(ctx, g, col, t, L, T, R, B) {
  const x0 = Math.max(L, g.coast);
  if (R <= x0 || x0 >= g.shore) return;
  const x1 = Math.min(R, g.shore);
  ctx.fillStyle = col.sand;
  ctx.fillRect(x0, T, x1 - x0, B - T);
  // damp sand toward the water, then the wet edge the tide keeps moving
  const damp = Math.max(x0, g.shore - 62);
  if (x1 > damp) {
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = col.sandWet;
    ctx.fillRect(damp, T, x1 - damp, B - T);
    ctx.globalAlpha = 1;
  }
  const wet = Math.max(x0, Math.min(x1, g.shore - 20 + Math.sin(t * 0.8) * 5));
  if (x1 > wet) {
    ctx.fillStyle = col.sandWet;
    ctx.fillRect(wet, T, x1 - wet, B - T);
  }
  ctx.fillStyle = col.foam;
  for (let y = Math.floor(T / 22) * 22; y < B; y += 22) {
    const wobble = Math.sin(y * 0.03 + t * 1.1) * 4;
    ctx.fillRect(wet - 3 + wobble, y, 2, 12);
  }
}

function drawRoads(ctx, g, col, L, T, R, B) {
  const right = Math.min(R, g.coast);
  if (right <= L) return;
  ctx.fillStyle = col.asphalt;
  for (let k = 0; k < g.grid; k += 1) {
    const x = k * g.pitch;
    if (x >= g.coast) break;
    box(ctx, x, 0, Math.min(g.road, g.coast - x), g.size, L, T, right, B);
  }
  for (let m = 0; m < g.grid; m += 1) {
    box(ctx, 0, m * g.pitch, g.coast, g.road, L, T, right, B);
  }
  // the seam where the two carriageways meet, a shade under the asphalt
  ctx.fillStyle = col.seam;
  for (let k = 0; k < g.grid; k += 1) {
    const x = k * g.pitch + g.road / 2 - 1;
    if (x >= g.coast || x + 2 < L || x > right) continue;
    box(ctx, x, 0, 2, g.size, L, T, right, B);
  }
  for (let m = 0; m < g.grid; m += 1) {
    const y = m * g.pitch + g.road / 2 - 1;
    if (y + 2 < T || y > B) continue;
    box(ctx, 0, y, g.coast, 2, L, T, right, B);
  }
}

function drawSidewalks(ctx, g, blocks, col, L, T, R, B) {
  for (const b of blocks) {
    if (b.x + b.w < L || b.x > R || b.y + b.h < T || b.y > B) continue;
    ctx.fillStyle = col.sidewalk;
    box(ctx, b.x, b.y, b.w, KERB, L, T, R, B);
    box(ctx, b.x, b.y + b.h - KERB, b.w, KERB, L, T, R, B);
    box(ctx, b.x, b.y, KERB, b.h, L, T, R, B);
    box(ctx, b.x + b.w - KERB, b.y, KERB, b.h, L, T, R, B);
    // the kerb itself, light concrete along the edge that faces the road
    ctx.fillStyle = col.kerb;
    box(ctx, b.x, b.y, b.w, 4, L, T, R, B);
    box(ctx, b.x, b.y + b.h - 4, b.w, 4, L, T, R, B);
    box(ctx, b.x, b.y, 4, b.h, L, T, R, B);
    box(ctx, b.x + b.w - 4, b.y, 4, b.h, L, T, R, B);
  }
}

function drawLanes(ctx, g, col, L, T, R, B) {
  const dash = 20;
  const span = 34;
  const wide = 5;
  ctx.fillStyle = col.lane;
  for (let k = 0; k < g.grid; k += 1) {
    const x = k * g.pitch + g.road / 2 - wide / 2;
    if (x < L - wide || x > R || x >= g.coast) continue;
    const y0 = Math.max(0, T);
    const y1 = Math.min(g.size, B);
    for (let y = Math.floor(y0 / span) * span; y < y1; y += span) {
      if (y % g.pitch < g.road) continue;
      box(ctx, x, y, wide, dash, L, T, R, B);
    }
  }
  for (let m = 0; m < g.grid; m += 1) {
    const y = m * g.pitch + g.road / 2 - wide / 2;
    if (y < T - wide || y > B) continue;
    const x0 = Math.max(0, L);
    const x1 = Math.min(g.coast, R);
    for (let x = Math.floor(x0 / span) * span; x < x1; x += span) {
      if (x % g.pitch < g.road) continue;
      box(ctx, x, y, dash, wide, L, T, R, B);
    }
  }
}

// A zebra on every one of the four approaches to an intersection: north and
// south of it across the vertical road, west and east across the horizontal one.
function drawCrosswalks(ctx, g, col, L, T, R, B) {
  const bar = 8, gap = 6, depth = 18, inset = 5;
  const span = bar + gap;
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = col.lane;
  for (let m = 0; m < g.grid; m += 1) {
    const iy = m * g.pitch;
    if (iy + g.road + depth < T || iy - depth > B) continue;
    for (let k = 0; k < g.grid; k += 1) {
      const ix = k * g.pitch;
      if (ix + g.road + inset + depth > g.coast) continue;
      if (ix + g.road + depth < L || ix - depth > R) continue;
      for (let b = 0; b * span + bar <= g.road - inset * 2; b += 1) {
        const along = inset + b * span;
        box(ctx, ix + along, iy - inset - depth, bar, depth, L, T, R, B);
        box(ctx, ix + along, iy + g.road + inset, bar, depth, L, T, R, B);
        box(ctx, ix - inset - depth, iy + along, depth, bar, L, T, R, B);
        box(ctx, ix + g.road + inset, iy + along, depth, bar, L, T, R, B);
      }
    }
  }
  ctx.globalAlpha = 1;
}

export function paint(ctx, world, state) {
  const g = geo(world);
  const view = viewRect(state);
  const t = (state && state.t) || 0;
  const night = nightAmount(state && state.dayPhase);
  const col = tones(night);
  const L = Math.max(0, view.x);
  const T = Math.max(0, view.y);
  const R = Math.min(g.size, view.x + view.w);
  const B = Math.min(g.size, view.y + view.h);
  if (R <= L || B <= T) return;

  ctx.fillStyle = col.grass;
  ctx.fillRect(L, T, R - L, B - T);

  drawBeach(ctx, g, col, t, L, T, R, B);
  drawSea(ctx, g, col, t, L, T, R, B);
  drawRoads(ctx, g, col, L, T, R, B);
  drawSidewalks(ctx, g, blocksOf(g, world), col, L, T, R, B);
  drawLanes(ctx, g, col, L, T, R, B);
  drawCrosswalks(ctx, g, col, L, T, R, B);
}
