// City of Saints: the man you play and the car he steals.
//
// createPlayer() puts him on the central avenue with $250 and 60 rounds. F takes
// or leaves an npc car within 60 px. W A S D moves, Shift sprints, Space is the
// handbrake, whose marks are particles {type:'tyre', x, y, a, life, max, w, h,
// color} capped at MAX_MARKS. updatePlayer() slides him and the car along walls
// one axis at a time, trails him with a camera that never leads the car, and
// kills him at zero health: 'death', then three seconds later he wakes at the
// hospital with $100 less.
//
// state.wanted is NOT written here: entering a car pushes 'enterCar' and counts
// state.stats.carsStolen, and police.js escalates from that delta, because main
// clears state.events after hud and audio, before police runs on the next frame.
//
// Exports: createPlayer, updatePlayer, drawPlayer.

import { PALETTE } from '../world/palette.js';
import { solidAt, randomRoadPoint } from '../world/city.js';
import { nearestPrecinct } from './police.js';

const WALK = 150, SPRINT = 260;
const CAR_TOP = 430, CAR_REVERSE = 150, CAR_ACCEL = 300, CAR_BRAKE = 560, HAND_DECEL = 640;
const TURN = 2.6, GRIP = 9.5, DRIFT_GRIP = 2.2, ROLL = 0.14;
const ENTER_RANGE = 60, BODY = 8;
const RESPAWN = 3, HOSPITAL = { x: 688, y: 2288 };
const MAX_MARKS = 240, MARK_EVERY = 0.045;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rngOf = (state) => (state && typeof state.rng === 'function' ? state.rng : Math.random);

// Case and alias tolerant key lookup, for 'w'/'W' and 'Shift'/'shift'.
function on(set, name) {
  if (!set) return false;
  if (set.has(name)) return true;
  const want = name.toLowerCase();
  for (const k of set) if (typeof k === 'string' && k.toLowerCase() === want) return true;
  return false;
}

const held = (state, name) => on(state.input && state.input.keys, name);
const tapped = (state, name) => on(state.input && state.input.pressed, name);

function nightAmount(dayPhase) {
  const p = (((dayPhase || 0) % 1) + 1) % 1;
  return 1 - Math.min(1, Math.max(0, (0.35 + 0.5 * Math.cos((p - 0.4) * Math.PI * 2)) / 0.75));
}

function eventOf(state, type) {
  const list = Array.isArray(state.events) ? state.events : [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i] && list[i].type === type) return list[i];
  return null;
}

const push = (state, e) => { if (Array.isArray(state.events)) state.events.push(e); };
const addDistance = (state, d) => { if (state.stats) state.stats.distance = (state.stats.distance || 0) + d; };

const wallAt = (world, x, y, r) => solidAt(world, x - r, y) || solidAt(world, x + r, y)
  || solidAt(world, x, y - r) || solidAt(world, x, y + r);

// True when a car body with this heading touches nothing solid at x, y.
function clearAt(world, x, y, hx, hy, len, wid) {
  const hl = len * 0.46, hw = wid * 0.44;
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    if (solidAt(world, x + hx * hl * a - hy * hw * b, y + hy * hl * a + hx * hw * b)) return false;
  }
  return true;
}

export function createPlayer(state) {
  const world = state && state.world;
  const pitch = (world && world.pitch) || 320, road = (world && world.road) || 96;
  return { x: pitch * 5 + road / 2, y: pitch * 6 + road / 2, angle: -Math.PI / 2, speed: 0,
    health: 100, cash: 250, ammo: 60, onFoot: true, car: null, walk: 0, deadAt: 0, markT: 0, bumpT: 0 };
}

export function updatePlayer(state, dt) {
  const p = state && state.player;
  if (!p) return;
  const step = Math.min(Math.max(dt || 1 / 60, 0), 0.05);
  if (p.markT > 0) p.markT -= step;
  if (p.bumpT > 0) p.bumpT -= step;
  if (state.flags && state.flags.dead) {
    if ((state.t || 0) >= p.deadAt) respawn(state, p);
    else follow(state, p, step);
    return;
  }
  if (eventOf(state, 'arrest')) { bail(state, p); return; }
  if (tapped(state, 'f')) takeOrLeave(state, p);
  if (p.car) drive(state, p, step);
  else walk(state, p, step);
  follow(state, p, step);
  if (p.health <= 0) die(state, p);
}

function walk(state, p, step) {
  const dx = (held(state, 'd') ? 1 : 0) - (held(state, 'a') ? 1 : 0);
  const dy = (held(state, 's') ? 1 : 0) - (held(state, 'w') ? 1 : 0);
  if (!dx && !dy) { p.speed = 0; return; }
  const len = Math.hypot(dx, dy);
  const dist = (held(state, 'shift') ? SPRINT : WALK) * step;
  const x0 = p.x, y0 = p.y;
  if (!wallAt(state.world, p.x + (dx / len) * dist, p.y, BODY)) p.x += (dx / len) * dist;
  if (!wallAt(state.world, p.x, p.y + (dy / len) * dist, BODY)) p.y += (dy / len) * dist;
  const moved = Math.hypot(p.x - x0, p.y - y0);
  p.angle = Math.atan2(dy, dx);
  p.speed = step > 0 ? moved / step : 0;
  p.walk += moved * 0.055;
  addDistance(state, moved);
}

function drive(state, p, step) {
  const car = p.car;
  if (!Number.isFinite(car.vx) || !Number.isFinite(car.vy)) {
    car.vx = Math.cos(car.angle) * (car.speed || 0); car.vy = Math.sin(car.angle) * (car.speed || 0);
  }
  const steer = (held(state, 'd') ? 1 : 0) - (held(state, 'a') ? 1 : 0);
  const hand = held(state, ' ');
  const forward = car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
  if (steer !== 0) {
    const bite = Math.min(1, Math.abs(forward) / 140);
    car.angle += steer * TURN * step * bite * (forward < -2 ? -1 : 1);
  }
  const cos = Math.cos(car.angle), sin = Math.sin(car.angle);
  let vf = car.vx * cos + car.vy * sin;
  let vl = car.vy * cos - car.vx * sin;
  if (held(state, 'w')) vf = Math.min(CAR_TOP, vf + CAR_ACCEL * step);
  if (held(state, 's')) {
    if (vf > 4) vf = Math.max(0, vf - CAR_BRAKE * step);
    else vf = Math.max(-CAR_REVERSE, vf - CAR_ACCEL * 0.7 * step);
  }
  if (hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), HAND_DECEL * step);
  vf *= Math.exp(-ROLL * step);
  vl *= Math.exp(-(hand ? DRIFT_GRIP : GRIP) * step);
  car.vx = cos * vf - sin * vl;
  car.vy = sin * vf + cos * vl;
  car.speed = vf;
  slide(state, car, step);
  hitTraffic(state, car);
  if ((hand && (Math.abs(vf) > 90 || Math.abs(vl) > 60)) || Math.abs(vl) > 110) marks(state, car);
  p.x = car.x; p.y = car.y; p.angle = car.angle;
  p.speed = Math.hypot(car.vx, car.vy);
  addDistance(state, p.speed * step);
}

// Per-axis slide: a wall kills only the velocity into it, so the car scrubs along.
function slide(state, car, step) {
  const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
  const impact = Math.hypot(car.vx, car.vy);
  const nx = car.x + car.vx * step, ny = car.y + car.vy * step;
  if (clearAt(state.world, nx, car.y, hx, hy, car.len, car.wid)) car.x = nx;
  else { if (impact > 150) bump(state, car, Math.abs(car.vx)); car.vx *= -0.18; }
  if (clearAt(state.world, car.x, ny, hx, hy, car.len, car.wid)) car.y = ny;
  else { if (impact > 150) bump(state, car, Math.abs(car.vy)); car.vy *= -0.18; }
}

function bump(state, car, speed) {
  const p = state.player;
  if (p.bumpT > 0) return;
  p.bumpT = 0.5;
  car.hp = Math.max(0, (car.hp || 100) - speed * 0.08);
  p.health = Math.max(0, p.health - Math.max(0, speed - 170) * 0.07);
  push(state, { type: 'crash', x: car.x, y: car.y, force: Math.round(speed), by: 'player' });
}

function hitTraffic(state, car) {
  const cars = state.cars;
  if (!Array.isArray(cars)) return;
  for (const other of cars) {
    if (other === car || other.driver !== 'npc') continue;
    const dx = other.x - car.x, dy = other.y - car.y;
    if (Math.abs(dx) > 34 || Math.abs(dy) > 34) continue;
    const d = Math.hypot(dx, dy) || 0.01;
    const min = (car.len + other.len) * 0.46;
    if (d >= min) continue;
    const rel = Math.hypot(
      car.vx - Math.cos(other.angle) * other.speed,
      car.vy - Math.sin(other.angle) * other.speed,
    );
    const shove = (min - d) * 0.5, nx = dx / d, ny = dy / d;
    car.x -= nx * shove; car.y -= ny * shove;
    other.x += nx * shove * 0.5; other.y += ny * shove * 0.5;
    car.vx *= 0.55; car.vy *= 0.55;
    other.speed *= 0.35;
    other.hp = Math.max(0, other.hp - rel * 0.2);
    if (rel > 120) bump(state, car, rel);
  }
}

function marks(state, car) {
  const p = state.player;
  if (p.markT > 0) return;
  p.markT = MARK_EVERY;
  const list = Array.isArray(state.particles) ? state.particles : (state.particles = []);
  const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
  for (const side of [-1, 1]) {
    list.push({
      type: 'tyre', a: car.angle, life: 3.2, max: 3.2, w: 4, h: 8, color: 'rgba(20,20,22,0.5)',
      x: car.x - hx * car.len * 0.32 - hy * side * car.wid * 0.42,
      y: car.y - hy * car.len * 0.32 + hx * side * car.wid * 0.42,
    });
  }
  let tyres = 0;
  for (const q of list) if (q.type === 'tyre') tyres += 1;
  for (let i = 0; tyres > MAX_MARKS && i < list.length; i += 1) {
    if (list[i].type === 'tyre') { list.splice(i, 1); i -= 1; tyres -= 1; }
  }
}

function follow(state, p, step) {
  const cam = state.camera || (state.camera = { x: 0, y: 0 });
  const cw = (state.canvas && state.canvas.w) || 1280, ch = (state.canvas && state.canvas.h) || 720;
  const size = (state.world && state.world.size) || 3840;
  // The camera trails rather than leads: a lead pushes the car up the screen and
  // the pursuit behind it out of frame. Trailing keeps him in the lower half, and
  // the lag is bounded, so at 430 px/s he sits at screen y 456 and never lower.
  // A posed scene may override that offset with camera.carLead, negative to put
  // the camera ahead of the car so a chase reads from behind.
  const lead = Number(cam.carLead);
  const look = p.car ? (Number.isFinite(lead) ? lead : 0) : 32;
  const tx = clamp(p.x + Math.cos(p.angle) * look - cw / 2, 0, Math.max(0, size - cw));
  const ty = clamp(p.y + Math.sin(p.angle) * look - ch / 2, 0, Math.max(0, size - ch));
  const k = 1 - Math.exp(-4.5 * step);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

function takeOrLeave(state, p) {
  if (p.car) { leaveCar(state, p); return; }
  let best = null, bestD = ENTER_RANGE;
  for (const car of state.cars || []) {
    if (car.driver !== 'npc' || (car.hp || 0) <= 0) continue;
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d < bestD) { best = car; bestD = d; }
  }
  if (best) takeCar(state, p, best);
}

function takeCar(state, p, car) {
  car.driver = 'player';
  car.vx = Math.cos(car.angle) * (car.speed || 0);
  car.vy = Math.sin(car.angle) * (car.speed || 0);
  car.speed = 0; car.turn = null; car.plan = 0;
  p.car = car; p.onFoot = false;
  p.x = car.x; p.y = car.y; p.angle = car.angle;
  p.speed = Math.hypot(car.vx, car.vy);
  if (state.stats) state.stats.carsStolen = (state.stats.carsStolen || 0) + 1;
  push(state, { type: 'enterCar', x: car.x, y: car.y, colour: car.colour });
}

function leaveCar(state, p) {
  const car = p.car;
  if (!car || Math.hypot(car.vx, car.vy) > 40) return;
  const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
  const off = car.wid * 0.5 + 16;
  let x = car.x - hy * off, y = car.y + hx * off;
  if (wallAt(state.world, x, y, BODY)) { x = car.x + hy * off; y = car.y - hx * off; }
  if (wallAt(state.world, x, y, BODY)) return;
  p.x = x; p.y = y; p.angle = car.angle; p.speed = 0; p.walk = 0;
  p.onFoot = true; p.car = null;
  releaseCar(state, car);
  push(state, { type: 'exitCar', x: p.x, y: p.y });
}

// Hands a stolen car back to traffic: it rejoins the lane it stands on.
function releaseCar(state, car) {
  const world = state.world;
  const pitch = (world && world.pitch) || 320, road = (world && world.road) || 96;
  car.vx = 0; car.vy = 0; car.speed = 0; car.turn = null; car.plan = 0;
  const k = Math.floor(car.x / pitch), m = Math.floor(car.y / pitch);
  if (car.x - k * pitch < road) {
    car.axis = 'v'; car.road = k; car.dir = Math.sin(car.angle) < 0 ? -1 : 1;
  } else if (car.y - m * pitch < road) {
    car.axis = 'h'; car.road = m; car.dir = Math.cos(car.angle) < 0 ? -1 : 1;
  } else {
    const spot = randomRoadPoint(world, rngOf(state));
    car.x = spot.x; car.y = spot.y; car.axis = 'h'; car.dir = 1;
    car.road = Math.floor(spot.y / pitch);
  }
  car.angle = car.axis === 'v' ? (car.dir < 0 ? -Math.PI / 2 : Math.PI / 2) : (car.dir < 0 ? Math.PI : 0);
  car.driver = 'npc';
}

function die(state, p) {
  p.health = 0;
  p.deadAt = (state.t || 0) + RESPAWN;
  p.speed = 0;
  if (p.car) {
    p.car.vx *= 0.1; p.car.vy *= 0.1; p.car.speed = 0;
    releaseCar(state, p.car);
    p.car = null; p.onFoot = true;
  }
  if (state.flags) state.flags.dead = true;
  push(state, { type: 'death', x: p.x, y: p.y });
}

function respawn(state, p) {
  p.health = 100;
  p.cash = Math.max(0, p.cash - 100);
  p.x = HOSPITAL.x; p.y = HOSPITAL.y; p.angle = -Math.PI / 2;
  p.speed = 0; p.walk = 0; p.deadAt = 0; p.car = null; p.onFoot = true;
  if (state.flags) state.flags.dead = false;
  follow(state, p, 1);
}

// Arrest: police zeroed the level and pushed the event; the man wakes at the
// nearest precinct station $100 lighter.
function bail(state, p) {
  if (p.car) { releaseCar(state, p.car); p.car = null; }
  const spot = nearestPrecinct(p.x, p.y) || HOSPITAL;
  p.onFoot = true; p.speed = 0; p.walk = 0;
  p.cash = Math.max(0, p.cash - 100);
  p.x = spot.x + 22; p.y = spot.y + 22; p.angle = Math.PI / 2;
  follow(state, p, 1);
}

export function drawPlayer(ctx, state) {
  const p = state && state.player;
  if (!p) return;
  const night = nightAmount(state.dayPhase);
  if (p.car) drawRide(ctx, p.car, night, p.car.speed || 0);
  else drawMan(ctx, p, night, !!(state.flags && state.flags.dead));
}

// The man on foot, read from above and slightly behind: a soft shadow, the cream
// chevron at his feet pointing where he looks, two legs that alternate with the
// walk phase, a dark jacket across the torso, both arms swinging against the legs
// on their side, and a hair-coloured head forward of the shoulders with a sliver
// of face at the front. Every limb is one dark stroke under a thinner coloured
// one, so the outline stays thinner than the part it wraps and the figure still
// reads against pavement paint at 1280x720. He is about 30 px long, against a
// 34 px car, and the chevron is the only cream on him.
function drawMan(ctx, p, night, dead) {
  const skin = dead ? '#8d7a68' : PALETTE.skins[0];
  const hair = dead ? '#2b2723' : '#221a16';
  const hairLight = dead ? '#3a332c' : PALETTE.trunk;
  const gait = dead ? 0 : Math.sin(p.walk);
  const coat = dead ? '#4a4f57' : (night > 0.35 ? '#26323d' : '#3b5568');
  const pants = dead ? '#3a3f46' : '#39434f';
  const OUTLINE = '#0a0e14';
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(1.5, 4, dead ? 15 : 13, dead ? 8.5 : 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(dead ? p.angle + Math.PI / 2 : p.angle);
  ctx.lineCap = 'round';
  // the facing chevron: small, at his feet and under every other part, so it
  // marks the direction without becoming a second body
  if (!dead) {
    ctx.beginPath();
    ctx.moveTo(10.5, -5.4); ctx.lineTo(17, 0); ctx.lineTo(10.5, 5.4);
    ctx.lineTo(13, 0); ctx.closePath();
    ctx.fillStyle = '#f4efe2'; ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.1; ctx.stroke();
  }
  // legs from the hips, the two feet swinging out of phase with each other
  for (const side of [-1, 1]) {
    const foot = -11.5 + gait * 5.2 * side;
    ctx.beginPath();
    ctx.moveTo(-1, side * 4.2); ctx.lineTo(foot, side * 6.4);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 7.8; ctx.stroke();
    ctx.strokeStyle = pants; ctx.lineWidth = 3.8; ctx.stroke();
  }
  // arms off the shoulders, set outboard of the torso so they read as arms, and
  // swinging against the leg on their own side
  for (const side of [-1, 1]) {
    const hand = -4.5 - gait * 4 * side;
    ctx.beginPath();
    ctx.moveTo(1.6, side * 6.6); ctx.lineTo(hand, side * 9.6);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 6.9; ctx.stroke();
    ctx.strokeStyle = coat; ctx.lineWidth = 2.9; ctx.stroke();
  }
  // the torso: a rounded rectangle across the shoulders, deeper than it is wide,
  // with the one 2 px outline the whole figure shares
  rounded(ctx, -6.6, -6.8, 11.4, 13.6, 4.4);
  ctx.fillStyle = coat; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2; ctx.stroke();
  // the head forward of the shoulders, hair round the back of it and a sliver of
  // face where he looks
  ctx.beginPath(); ctx.arc(4.6, 0, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = hair; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2; ctx.stroke();
  // a second, lighter hair tone across the crown behind the face, so the head is
  // not one flat dark dot at a glance
  ctx.beginPath(); ctx.arc(3.3, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = hairLight; ctx.fill();
  if (!dead) {
    ctx.beginPath(); ctx.ellipse(7.4, 0, 2.4, 3.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin; ctx.fill();
  }
  ctx.restore();
}

// The player's car is a traffic car in cream: the same rounded body, roof panel
// and glazing as traffic.js draws, but a black windscreen and a chrome bumper at
// each end so it is never mistaken for a civilian sedan on the same street. The
// shadow is tight and there is no pool of light around the body.
const CREAM = '#efe4c4';

function drawRide(ctx, car, night, speed) {
  const L = car.len || 34, W = car.wid || 16;
  const lit = night > 0.35;
  const body = lit ? shade(CREAM, night * 0.22) : CREAM;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.beginPath(); ctx.ellipse(1.5, 2.5, L * 0.44, W * 0.54, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = body;
  rounded(ctx, -L / 2, -W / 2, L, W, 4); ctx.fill();
  // roof panel, a shade of the same cream rather than a second colour
  ctx.fillStyle = shade(CREAM, lit ? 0.36 : 0.16);
  rounded(ctx, -L * 0.22, -W / 2 + 2.4, L * 0.42, W - 4.8, 2); ctx.fill();
  // black windscreen ahead of the roof, dark rear glass behind it
  ctx.fillStyle = '#12171d';
  rounded(ctx, L * 0.22, -W / 2 + 2.6, L * 0.15, W - 5.2, 1.6); ctx.fill();
  ctx.fillStyle = 'rgba(150, 190, 210, 0.22)';
  rounded(ctx, L * 0.22, -W / 2 + 2.6, L * 0.15, 2.4, 1.2); ctx.fill();
  ctx.fillStyle = lit ? '#3c4e5a' : '#2a3239';
  rounded(ctx, -L * 0.38, -W / 2 + 2.8, L * 0.12, W - 5.6, 1.4); ctx.fill();
  // chrome bumpers, a hair proud of the paint at each end
  ctx.fillStyle = '#c8ced6';
  ctx.fillRect(L / 2 - 2.6, -W / 2 + 0.8, 2.6, W - 1.6);
  ctx.fillRect(-L / 2, -W / 2 + 0.8, 2.4, W - 1.6);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillRect(L / 2 - 2.6, -W / 2 + 0.8, 0.9, W - 1.6);
  ctx.fillRect(-L / 2, -W / 2 + 0.8, 0.9, W - 1.6);
  ctx.fillStyle = '#ffe6a6';
  ctx.fillRect(L / 2 - 6, -W / 2 + 2, 2.4, 3.6);
  ctx.fillRect(L / 2 - 6, W / 2 - 5.6, 2.4, 3.6);
  ctx.fillStyle = speed < 2 ? '#ff5a48' : shade('#c23f34', night * 0.4);
  ctx.fillRect(-L / 2 + 2.6, -W / 2 + 2, 2.4, 3.6);
  ctx.fillRect(-L / 2 + 2.6, W / 2 - 5.6, 2.4, 3.6);
  if (lit) {
    ctx.fillStyle = 'rgba(255,236,176,0.10)';
    ctx.beginPath();
    ctx.moveTo(L / 2, -W / 2 + 1); ctx.lineTo(L / 2 + 26, -W / 2 - 7);
    ctx.lineTo(L / 2 + 26, W / 2 + 7); ctx.lineTo(L / 2, W / 2 - 1);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
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

function shade(hex, amount) {
  const value = parseInt(String(hex).slice(1), 16);
  const r = Math.round(((value >> 16) & 255) * (1 - amount));
  const g = Math.round(((value >> 8) & 255) * (1 - amount));
  const b = Math.round((value & 255) * (1 - amount));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
