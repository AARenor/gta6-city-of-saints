// City of Saints: the people on the sidewalks.
//
// Every walker follows the kerb of one block, clockwise or counterclockwise, so
// two directions of foot traffic share each 14 px band. At a corner a walker may
// step across the road to the corner of the block opposite, which is where the
// crosswalks are painted. A gunshot or an active wanted level empties the
// pavements for six seconds of running.
//
// Exports: createPedestrians, updatePedestrians, drawPedestrians.

import { PALETTE } from './palette.js';

const CLOTHES = ['#3f4d63', '#8d4a4a', '#6c7a52', '#b98b3e', '#4a6f86', '#8a6a9c', '#c9c3b4', '#2f3a41'];
const HAIR = ['#221a16', '#4a2f22', '#6d4526', '#c9b07a', '#8d8d92', '#1a1a1e'];
const FLEE_TIME = 6, RUN_SPEED = 128;
const CROSS_CHANCE = 0.3, PANIC_CROSS_CHANCE = 0.55;

// corner index 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
// Per corner and direction: [step in i, step in j, corner landed on].
const CROSS = {
  1: { 0: [0, -1, 3], 1: [1, 0, 0], 2: [0, 1, 1], 3: [-1, 0, 2] },
  [-1]: { 0: [-1, 0, 1], 1: [0, -1, 2], 2: [1, 0, 3], 3: [0, 1, 0] },
};

const GRIDS = new WeakMap();
const rngOf = (state) => (state && typeof state.rng === 'function' ? state.rng : Math.random);
const perim = (b) => (b.w + b.h) * 2;
const vertsOf = (b) => [0, b.w, b.w + b.h, 2 * b.w + b.h];

function blocksOf(state) {
  const world = state.world;
  if (!world || !Array.isArray(world.blocks)) return [];
  return world.blocks;
}

function gridOf(state) {
  const world = state.world;
  if (!world || !Array.isArray(world.blocks)) return null;
  let map = GRIDS.get(world);
  if (!map) {
    map = new Map();
    for (const b of world.blocks) map.set(b.i + ',' + b.j, b);
    GRIDS.set(world, map);
  }
  return map;
}

// Where the kerb sits for a distance travelled clockwise from the top-left
// corner, and which way that puts the walker.
function pointOn(b, s, lane) {
  const w = b.w;
  if (s < w) return { x: b.x + s, y: b.y + lane, a: 0 };
  if (s < w + b.h) return { x: b.x + w - lane, y: b.y + (s - w), a: Math.PI / 2 };
  if (s < 2 * w + b.h) return { x: b.x + w - (s - w - b.h), y: b.y + b.h - lane, a: Math.PI };
  return { x: b.x + lane, y: b.y + b.h - (s - 2 * w - b.h), a: -Math.PI / 2 };
}

function place(ped) {
  const p = pointOn(ped.block, ped.s % perim(ped.block), ped.lane);
  ped.x = p.x;
  ped.y = p.y;
  ped.angle = ped.dir > 0 ? p.a : p.a + Math.PI;
}

function cornerPoint(b, corner, lane) {
  const x = corner === 1 || corner === 2 ? b.x + b.w - lane : b.x + lane;
  const y = corner === 2 || corner === 3 ? b.y + b.h - lane : b.y + lane;
  return { x, y };
}

function cornerAt(b, s) {
  const vs = vertsOf(b);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const d = Math.abs(vs[i] - s);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// The kerb position ahead in the travel direction, wrapping the block.
function aheadOf(b, s, dir) {
  const vs = vertsOf(b);
  if (dir > 0) {
    for (const v of vs) if (v > s + 0.001) return v;
    return perim(b);
  }
  for (let i = vs.length - 1; i >= 0; i -= 1) if (vs[i] < s - 0.001) return vs[i];
  return 0;
}

function makePed(state, blocks, rand) {
  const block = blocks[Math.floor(rand() * blocks.length) % blocks.length];
  const dir = rand() < 0.5 ? 1 : -1;
  const ped = {
    x: 0, y: 0, angle: 0,
    speed: 46 + rand() * 34,
    walk: rand() * 6.283,
    colour: CLOTHES[Math.floor(rand() * CLOTHES.length) % CLOTHES.length],
    hair: HAIR[Math.floor(rand() * HAIR.length) % HAIR.length],
    skin: PALETTE.skins[Math.floor(rand() * PALETTE.skins.length) % PALETTE.skins.length],
    block, s: rand() * perim(block), dir,
    lane: 4 + rand() * 6,
    crossing: null, flee: 0, panic: null,
  };
  place(ped);
  return ped;
}

export function createPedestrians(state, count = 90) {
  const blocks = blocksOf(state);
  state.peds = [];
  if (blocks.length === 0) return state.peds;
  const rand = rngOf(state);
  for (let i = 0; i < count; i += 1) state.peds.push(makePed(state, blocks, rand));
  return state.peds;
}

// At a corner: step across the road, or walk on round the block.
function tryCross(state, ped, block, corner) {
  const plan = CROSS[ped.dir > 0 ? 1 : -1][corner];
  if (!plan) return false;
  const grid = gridOf(state);
  const nb = grid && grid.get(block.i + plan[0] + ',' + (block.j + plan[1]));
  if (!nb) return false;
  const chance = ped.flee > 0 ? PANIC_CROSS_CHANCE : CROSS_CHANCE;
  if (rngOf(state)() >= chance) return false;
  const to = cornerPoint(nb, plan[2], ped.lane);
  const d = Math.max(1, Math.hypot(to.x - ped.x, to.y - ped.y));
  ped.crossing = {
    x0: ped.x, y0: ped.y, x1: to.x, y1: to.y, d, left: d,
    a: Math.atan2(to.y - ped.y, to.x - ped.x),
    block: nb, s: vertsOf(nb)[plan[2]],
  };
  return true;
}

// Returns true once the walker has landed on the far pavement.
function crossStep(ped, dist) {
  const c = ped.crossing;
  c.left -= dist;
  ped.angle = c.a;
  if (c.left > 0) {
    const p = 1 - c.left / c.d;
    ped.x = c.x0 + (c.x1 - c.x0) * p;
    ped.y = c.y0 + (c.y1 - c.y0) * p;
    return false;
  }
  const P = perim(c.block);
  ped.block = c.block;
  ped.s = (c.s + ped.dir * 1.5 + P) % P;
  ped.crossing = null;
  place(ped);
  return true;
}

function walkStep(state, ped, dist) {
  let left = dist, guard = 0;
  while (left > 0 && guard < 4) {
    guard += 1;
    const b = ped.block, P = perim(b);
    const next = aheadOf(b, ped.s, ped.dir);
    const gap = ped.dir > 0 ? next - ped.s : ped.s - next;
    if (left < gap) {
      ped.s += ped.dir * left;
      left = 0;
      break;
    }
    ped.s = next % P;
    left -= gap;
    place(ped);
    if (tryCross(state, ped, b, cornerAt(b, ped.s))) return;
    ped.s = (ped.s + ped.dir * 0.6 + P) % P;
    left -= 0.6;
  }
  place(ped);
}

// Run away from the shot instead of into it.
function faceAway(ped) {
  const p = ped.panic;
  if (!p) return;
  const fx = Math.cos(ped.angle), fy = Math.sin(ped.angle);
  if ((p.x - ped.x) * fx + (p.y - ped.y) * fy > 0) ped.dir = -ped.dir;
}

export function updatePedestrians(state, dt) {
  const peds = state.peds;
  if (!Array.isArray(peds) || peds.length === 0) return;
  const step = Math.min(dt || 1 / 60, 0.05);
  // combat runs after this module, so a gunshot frame is only visible when the
  // caller orders the update differently; state.wanted is the reliable path.
  let shot = null;
  if (Array.isArray(state.events)) {
    for (const e of state.events) if (e.type === 'gunshot') shot = e;
  }
  const alarm = (state.wanted || 0) > 0;
  for (const ped of peds) {
    if (shot) { ped.flee = FLEE_TIME; ped.panic = { x: shot.x, y: shot.y }; }
    if (alarm) ped.flee = Math.max(ped.flee, 1.5);
    if (ped.flee > 0) ped.flee -= step;
    const run = ped.flee > 0;
    const speed = run ? RUN_SPEED : ped.speed;
    const dist = speed * step;
    if (ped.crossing) crossStep(ped, dist);
    else {
      if (run) faceAway(ped);
      walkStep(state, ped, dist);
    }
    ped.walk += dist * 0.09;
  }
}

function shade(hex, amount) {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.round(((v >> 16) & 255) * (1 - amount));
  const g = Math.round(((v >> 8) & 255) * (1 - amount));
  const b = Math.round((v & 255) * (1 - amount));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function nightAmount(dayPhase) {
  const p = (((dayPhase || 0) % 1) + 1) % 1;
  const light = 0.5 + 0.5 * Math.cos((p - 0.4) * Math.PI * 2);
  return 1 - Math.min(1, Math.max(0, (light - 0.15) / 0.75));
}

function onScreen(state, x, y, pad) {
  const cam = state.camera || { x: 0, y: 0 };
  const cw = (state.canvas && state.canvas.w) || 1280;
  const ch = (state.canvas && state.canvas.h) || 720;
  return x > cam.x - pad && x < cam.x + cw + pad && y > cam.y - pad && y < cam.y + ch + pad;
}

function drawPed(ctx, ped, night) {
  const swing = Math.sin(ped.walk) * 3.2;
  const body = night > 0.4 ? shade(ped.colour, night * 0.5) : ped.colour;
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.rotate(ped.angle - Math.PI / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.beginPath();
  ctx.ellipse(1, 1.5, 5, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // feet swing in step, arms against them
  ctx.strokeStyle = night > 0.4 ? '#22262c' : '#2f343a';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-2, -1); ctx.lineTo(-2 - swing * 0.4, 2.2 + Math.abs(swing) * 0.2);
  ctx.moveTo(2, -1); ctx.lineTo(2 + swing * 0.4, 2.2 - Math.abs(swing) * 0.2);
  ctx.stroke();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, 4.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(body, 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-3.4, 0.4); ctx.lineTo(-3.4 + swing * 0.3, 2.4);
  ctx.moveTo(3.4, 0.4); ctx.lineTo(3.4 - swing * 0.3, 2.4);
  ctx.stroke();
  ctx.fillStyle = ped.hair;
  ctx.beginPath();
  ctx.arc(0, 0.2, 2.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(0, 1.5, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawPedestrians(ctx, state) {
  const peds = state.peds;
  if (!Array.isArray(peds) || peds.length === 0) return;
  const night = nightAmount(state.dayPhase);
  for (const ped of peds) {
    if (!onScreen(state, ped.x, ped.y, 24)) continue;
    drawPed(ctx, ped, night);
  }
}
