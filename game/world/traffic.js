// City of Saints: the street traffic.
//
// Cars keep to the right-hand lane of the 96 px road grid, give way to whatever
// is ahead, wait at a four-way light that cycles every 14 s with a phase offset
// per intersection, turn at intersections on a real quarter-circle arc (a right
// turn sweeps 24 px, a left turn 72 px, which is what the lane geometry allows),
// and respawn off-screen when they leave the map or sit still for too long. A
// hard contact pushes one 'crash' event and damages both cars.
//
// Exports: createTraffic, updateTraffic, drawTraffic.

import { PALETTE } from './palette.js';
import { randomRoadPoint } from './city.js';

const PITCH = 320, ROAD = 96, SIZE = 3840, COAST = 3520;
const ROADS = 11;                       // road lines k, m = 0..10 sit inland
const LANE = 24;                        // lane centre offset from the road edge
const RIGHT_R = LANE, LEFT_R = LANE * 3;
const CAR_LEN = 34, CAR_WID = 16;
const ACCEL = 170, BRAKE = 400;
const CYCLE = 14, NS_GREEN = 6, YELLOW = 1, EW_GREEN = 5;
const CRASH_REL = 140;                  // px/s of closing speed that counts

const rngOf = (state) => (state && typeof state.rng === 'function' ? state.rng : Math.random);
const laneX = (k, dir) => k * PITCH + (dir < 0 ? LANE * 3 : LANE);
const laneY = (m, dir) => m * PITCH + (dir < 0 ? LANE : LANE * 3);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function heading(axis, dir) {
  if (axis === 'v') return dir < 0 ? -Math.PI / 2 : Math.PI / 2;
  return dir < 0 ? Math.PI : 0;
}

// Snaps a car onto the centre line of its lane; the road axis keeps its travel.
function syncCar(car) {
  car.angle = heading(car.axis, car.dir);
  if (car.axis === 'v') car.x = laneX(car.road, car.dir);
  else car.y = laneY(car.road, car.dir);
}

function makeCar(rand, id) {
  const colour = PALETTE.cars[Math.floor(rand() * PALETTE.cars.length) % PALETTE.cars.length];
  return {
    id, x: 0, y: 0, angle: 0, speed: 0, len: CAR_LEN, wid: CAR_WID,
    colour, driver: 'npc', hp: 100,
    cruise: 140 + rand() * 100, axis: 'v', dir: 1, road: 0,
    turn: null, plan: 0, planKey: '', bump: 0, stuck: 0, markX: 0, markY: 0,
  };
}

// Puts a car on a lane either inside the view (near) or outside it (respawn).
function placeCar(state, car, rand, near) {
  const cam = state.camera || { x: 0, y: 0 };
  const cw = (state.canvas && state.canvas.w) || 1280;
  const ch = (state.canvas && state.canvas.h) || 720;
  const p = state.player;
  const ox = p ? p.x - cw / 2 : cam.x;
  const oy = p ? p.y - ch / 2 : cam.y;
  let spot = null;
  for (let i = 0; i < 30 && !spot; i += 1) {
    const axis = rand() < 0.5 ? 'v' : 'h';
    const road = Math.floor(rand() * ROADS) % ROADS;
    const dir = rand() < 0.5 ? -1 : 1;
    // spawn inside the last controlled box, or the car drives off the map
    const along = ROAD + rand() * ((ROADS - 1) * PITCH - ROAD - 1);
    const x = axis === 'v' ? laneX(road, dir) : along;
    const y = axis === 'v' ? along : laneY(road, dir);
    const shown = x > ox - 60 && x < ox + cw + 60 && y > oy - 60 && y < oy + ch + 60;
    if (shown !== near) continue;
    spot = { axis, road, dir, x, y };
  }
  if (!spot) {
    const rp = randomRoadPoint(state.world, rand) || { x: SIZE / 2, y: SIZE / 2 };
    const hi = (ROADS - 1) * PITCH - 1;
    const x = clamp(rp.x, ROAD, hi), y = clamp(rp.y, ROAD, hi);
    const vertical = ((x % PITCH) + PITCH) % PITCH < ROAD;
    const road = clamp(Math.floor((vertical ? x : y) / PITCH), 0, ROADS - 1);
    spot = { axis: vertical ? 'v' : 'h', road, dir: rand() < 0.5 ? -1 : 1, x, y };
  }
  car.axis = spot.axis; car.road = spot.road; car.dir = spot.dir;
  car.x = spot.x; car.y = spot.y;
  car.speed = car.cruise * 0.5;
  car.turn = null; car.plan = 0; car.planKey = ''; car.bump = 0; car.stuck = 0;
  car.markX = car.x; car.markY = car.y;
  syncCar(car);
}

export function createTraffic(state, count = 60) {
  const rand = rngOf(state);
  state.cars = [];
  const total = count > 0 ? count : 0;
  for (let i = 0; i < total; i += 1) {
    const car = makeCar(rand, i + 1);
    placeCar(state, car, rand, true);
    state.cars.push(car);
  }
  return state.cars;
}

// The intersection ahead of a car: k and m of the box, and the gap in px from
// the front bumper to the near edge of that box.
function nextCross(car) {
  if (car.axis === 'v') {
    const k = car.road;
    const m = car.dir < 0 ? Math.floor((car.y - ROAD) / PITCH) : Math.floor(car.y / PITCH) + 1;
    if (m < 0 || m >= ROADS) return { k, m, d: Infinity };
    const edge = m * PITCH + (car.dir < 0 ? ROAD : 0);
    return { k, m, d: (car.dir < 0 ? car.y - edge : edge - car.y) - car.len / 2 };
  }
  const m = car.road;
  const k = car.dir < 0 ? Math.floor((car.x - ROAD) / PITCH) : Math.floor(car.x / PITCH) + 1;
  if (k < 0 || k >= ROADS) return { k, m, d: Infinity };
  const edge = k * PITCH + (car.dir < 0 ? ROAD : 0);
  return { k, m, d: (car.dir < 0 ? car.x - edge : edge - car.x) - car.len / 2 };
}

// 0 straight, +1 right, -1 left. An exit is only allowed when the road it
// leads to reaches another intersection, so no car is sent off the map.
function sideAllowed(car, cross, side) {
  const v = car.axis === 'v';
  if (side === 0) {
    if (v) return car.dir < 0 ? cross.m - 1 >= 0 : cross.m + 1 < ROADS;
    return car.dir < 0 ? cross.k - 1 >= 0 : cross.k + 1 < ROADS;
  }
  if (v) {
    const east = (car.dir < 0) === side > 0;
    return east ? cross.k + 1 < ROADS : cross.k - 1 >= 0;
  }
  const south = (car.dir > 0) === side > 0;
  return south ? cross.m + 1 < ROADS : cross.m - 1 >= 0;
}

function planTurn(state, car, cross) {
  const key = cross.k + ',' + cross.m + ',' + car.axis + car.dir;
  if (car.planKey === key) return;
  car.planKey = key;
  const opts = [];
  if (sideAllowed(car, cross, 0)) opts.push(0, 0, 0);
  if (sideAllowed(car, cross, 1)) opts.push(1, 1);
  if (sideAllowed(car, cross, -1)) opts.push(-1);
  const rand = rngOf(state);
  car.plan = opts.length ? opts[Math.floor(rand() * opts.length) % opts.length] : 0;
}

// Starts the arc at the geometric entry of the box, then rides it in moveCar.
function startTurn(car, cross, side) {
  const v = car.axis === 'v';
  const ex = v ? laneX(cross.k, car.dir) : car.dir > 0 ? cross.k * PITCH : cross.k * PITCH + ROAD;
  const ey = v ? (car.dir < 0 ? cross.m * PITCH + ROAD : cross.m * PITCH) : laneY(cross.m, car.dir);
  const aIn = heading(car.axis, car.dir);
  const r = side > 0 ? RIGHT_R : LEFT_R;
  const out = aIn + (side * Math.PI) / 2;
  const nx = Math.cos(out), ny = Math.sin(out);
  car.turn = {
    cx: ex + nx * r, cy: ey + ny * r, r,
    a0: aIn - (side * Math.PI) / 2, sweep: (side * Math.PI) / 2,
    span: (r * Math.PI) / 2, done: 0,
    axis: Math.abs(nx) > 0.5 ? 'h' : 'v',
    dir: Math.abs(nx) > 0.5 ? (nx > 0 ? 1 : -1) : ny > 0 ? 1 : -1,
    road: v ? cross.m : cross.k,
  };
}

function lightPhase(state, k, m) {
  const off = (((k * 5 + m * 3) % 7) + 7) * 0.9;
  const p = ((((state.t || 0) + off) % CYCLE) + CYCLE) % CYCLE;
  if (p < NS_GREEN) return 1;
  if (p < NS_GREEN + YELLOW) return 2;
  if (p < NS_GREEN + YELLOW + 1) return 3;
  if (p < NS_GREEN + YELLOW + 1 + EW_GREEN) return 4;
  return 5;
}

// Speed the light allows: a car already inside the box or committed on yellow
// keeps rolling, anything else brakes toward the stop line.
function lightLimit(state, car, cross) {
  if (cross.d === Infinity || cross.d < -car.len * 0.6) return Infinity;
  const ph = lightPhase(state, cross.k, cross.m);
  const v = car.axis === 'v';
  if (v ? ph === 1 : ph === 4) return Infinity;
  if (v ? ph === 2 : ph === 5) return cross.d < 26 ? Infinity : 0;
  return Math.max(0, cross.d - 2) * 3.2;
}

// Gap in px to the nearest car or pedestrian ahead in the same lane.
function gapAhead(state, car) {
  const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
  const reach = 96;
  let best = Infinity;
  for (const other of state.cars) {
    if (other === car || other.driver !== 'npc') continue;
    const dx = other.x - car.x, dy = other.y - car.y;
    const fwd = dx * hx + dy * hy;
    if (fwd <= 0 || fwd > reach) continue;
    if (Math.abs(dy * hx - dx * hy) > 24) continue;
    best = Math.min(best, fwd - (car.len + other.len) / 2);
  }
  const p = state.player;
  if (p) {
    const dx = p.x - car.x, dy = p.y - car.y;
    const fwd = dx * hx + dy * hy;
    if (fwd > 0 && fwd < reach && Math.abs(dy * hx - dx * hy) < 18) {
      best = Math.min(best, fwd - (car.len + 18) / 2);
    }
  }
  return best;
}

function driveCar(state, car, dt) {
  const cross = nextCross(car);
  let limit = car.hp < 30 ? car.cruise * 0.55 : car.cruise;
  const gap = gapAhead(state, car);
  if (gap < 70) limit = Math.min(limit, gap < 8 ? 0 : (gap - 8) * 4.5);
  limit = Math.min(limit, lightLimit(state, car, cross));
  car.speed = car.speed < limit
    ? Math.min(limit, car.speed + ACCEL * dt)
    : Math.max(limit, car.speed - BRAKE * dt);
  if (car.speed < 0.4) car.speed = 0;
  if (car.turn) return;
  if (cross.d < 130) planTurn(state, car, cross);
  const entry = cross.d + car.len / 2;
  if (car.plan !== 0 && entry <= car.speed * dt + 1 && entry > -car.len * 0.6) {
    startTurn(car, cross, car.plan);
  }
}

function moveCar(car, dt) {
  if (car.turn) {
    const t = car.turn;
    t.done += car.speed * dt;
    const p = Math.min(1, t.done / t.span);
    const a = t.a0 + t.sweep * p;
    car.x = t.cx + Math.cos(a) * t.r;
    car.y = t.cy + Math.sin(a) * t.r;
    car.angle = a + (t.sweep > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (p >= 1) {
      car.axis = t.axis; car.dir = t.dir; car.road = t.road;
      car.turn = null; car.plan = 0;
      syncCar(car);
    }
    return;
  }
  if (car.axis === 'v') car.y += car.dir * car.speed * dt;
  else car.x += car.dir * car.speed * dt;
}

// Overlaps separate along the contact line, then each car snaps back to its
// lane so the lane keeps its traffic. Hard contacts report one crash event.
function collide(state) {
  const cars = state.cars;
  for (let i = 0; i < cars.length; i += 1) {
    const a = cars[i];
    if (a.driver !== 'npc') continue;
    for (let j = i + 1; j < cars.length; j += 1) {
      const b = cars[j];
      if (b.driver !== 'npc') continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx > 34 || dx < -34 || dy > 34 || dy < -34) continue;
      const d = Math.hypot(dx, dy);
      const min = (a.len + b.len) * 0.46;
      if (d >= min || d < 0.01) continue;
      const push = (min - d) / 2, nx = dx / d, ny = dy / d;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      if (!a.turn) syncCar(a);
      if (!b.turn) syncCar(b);
      const rel = Math.hypot(
        Math.cos(a.angle) * a.speed - Math.cos(b.angle) * b.speed,
        Math.sin(a.angle) * a.speed - Math.sin(b.angle) * b.speed,
      );
      if (rel < CRASH_REL || a.bump > 0 || b.bump > 0) {
        a.speed *= 0.5; b.speed *= 0.4;
        continue;
      }
      a.bump = 0.8; b.bump = 0.8;
      a.speed *= 0.28; b.speed *= 0.28;
      a.hp = Math.max(0, a.hp - rel * 0.22);
      b.hp = Math.max(0, b.hp - rel * 0.22);
      if (Array.isArray(state.events)) {
        state.events.push({
          type: 'crash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
          force: Math.round(rel), a: a.id, b: b.id,
        });
      }
    }
  }
}

// Off the map, into the sea, or parked in place for eight seconds: respawn.
function keepInWorld(state, car, dt) {
  car.stuck += dt;
  if (car.x < -40 || car.y < -40 || car.x > COAST + 20 || car.y > SIZE + 40) {
    placeCar(state, car, rngOf(state), false);
    return;
  }
  if (car.stuck < 8) return;
  const moved = Math.abs(car.x - car.markX) + Math.abs(car.y - car.markY);
  car.stuck = 0; car.markX = car.x; car.markY = car.y;
  if (moved < 14) placeCar(state, car, rngOf(state), false);
}

export function updateTraffic(state, dt) {
  const cars = state.cars;
  if (!Array.isArray(cars) || cars.length === 0) return;
  const step = Math.min(dt || 1 / 60, 0.05);
  for (const car of cars) {
    if (car.driver !== 'npc') continue;
    if (car.bump > 0) car.bump -= step;
    driveCar(state, car, step);
    moveCar(car, step);
    keepInWorld(state, car, step);
  }
  collide(state);
}

function shade(hex, amount) {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.round(((v >> 16) & 255) * (1 - amount));
  const g = Math.round(((v >> 8) & 255) * (1 - amount));
  const b = Math.round((v & 255) * (1 - amount));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function nightAmount(dayPhase) {
  const p = ((((dayPhase || 0) % 1) + 1) % 1);
  const light = 0.5 + 0.5 * Math.cos((p - 0.4) * Math.PI * 2);
  return 1 - Math.min(1, Math.max(0, (light - 0.15) / 0.75));
}

function onScreen(state, x, y, pad) {
  const cam = state.camera || { x: 0, y: 0 };
  const cw = (state.canvas && state.canvas.w) || 1280;
  const ch = (state.canvas && state.canvas.h) || 720;
  return x > cam.x - pad && x < cam.x + cw + pad && y > cam.y - pad && y < cam.y + ch + pad;
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCar(ctx, car, night) {
  const L = car.len, W = car.wid;
  const body = night > 0.35 ? shade(car.colour, night * 0.5) : car.colour;
  const lit = night > 0.35;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(2, 3, L * 0.48, W * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = body;
  rounded(ctx, -L / 2, -W / 2, L, W, 4);
  ctx.fill();
  // roof panel, then the glazing in front of and behind it
  ctx.fillStyle = shade(body, 0.2);
  rounded(ctx, -L * 0.2, -W / 2 + 2.5, L * 0.4, W - 5, 2);
  ctx.fill();
  ctx.fillStyle = lit ? 'rgba(120, 168, 190, 0.7)' : 'rgba(176, 222, 240, 0.9)';
  rounded(ctx, L * 0.22, -W / 2 + 3, L * 0.13, W - 6, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(126, 172, 196, 0.75)';
  rounded(ctx, -L * 0.36, -W / 2 + 3, L * 0.12, W - 6, 2);
  ctx.fill();
  ctx.fillStyle = '#ffe6a6';
  ctx.fillRect(L / 2 - 2.5, -W / 2 + 2, 2.5, 4);
  ctx.fillRect(L / 2 - 2.5, W / 2 - 6, 2.5, 4);
  ctx.fillStyle = car.speed < 30 ? '#ff5a48' : shade('#c23f34', night * 0.4);
  ctx.fillRect(-L / 2, -W / 2 + 2, 2.5, 4);
  ctx.fillRect(-L / 2, W / 2 - 6, 2.5, 4);
  if (lit) {
    ctx.fillStyle = 'rgba(255, 236, 176, 0.10)';
    ctx.beginPath();
    ctx.moveTo(L / 2, -W / 2 + 1);
    ctx.lineTo(L / 2 + 26, -W / 2 - 7);
    ctx.lineTo(L / 2 + 26, W / 2 + 7);
    ctx.lineTo(L / 2, W / 2 - 1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawTraffic(ctx, state) {
  const cars = state.cars;
  if (!Array.isArray(cars) || cars.length === 0) return;
  const night = nightAmount(state.dayPhase);
  for (const car of cars) {
    if (car.driver !== 'npc') continue;
    if (!onScreen(state, car.x, car.y, 80)) continue;
    drawCar(ctx, car, night);
  }
}
