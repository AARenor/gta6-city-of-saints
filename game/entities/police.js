// City of Saints: the police, and the only writer of state.wanted (0..5).
//
// Escalation comes from state.events (gunshot, punch, a theft, a player crash, a
// kill) and from the stats.carsStolen delta, because main clears the events
// before the next frame and police runs before player. Each further star costs
// more heat, and 25 s unseen drops one. Cruisers keep to the road grid and
// re-plan only at intersections, so they never cut a 96 px corner; officers run
// the last seen line on foot. Both shoot inside 460 px with a clear line, and an
// officer inside 40 px for 3 s pushes 'arrest' and zeroes the level.
//
// Unit shape for hud, minimap and combat: {kind: 'cruiser' | 'officer', x, y,
// angle, speed, hp, maxHp, cool, muzzle, flash, walk, sees, plan, axis, decide,
// jam, fade}; hp 0 is down and the unit is gone after 8 s; stats.kills is combat's.
//
// Exports: updatePolice, drawPolice, PRECINCTS, nearestPrecinct.

import { PALETTE } from '../world/palette.js';
import { solidAt } from '../world/city.js';

const PITCH = 320, ROAD = 96;
const MAX_LEVEL = 5, SPAWN_COOL = 0.9, UNSEEN = 25;
const SIGHT = 460, ARREST_RANGE = 40, ARREST_TIME = 3;
const OFFICER_SPEED = 205, CRUISER_TOP = 470, PARK_OFF = 180;
const HEAT_DECAY = 0.5, HEAT_CAP = 9, THEFT_HEAT = 2.6;
const CRUISER_LEN = 36, CRUISER_WID = 17;
const GOLD_BADGE = PALETTE.neon[2];

export const PRECINCTS = [
  { x: 48, y: 48 }, { x: 3248, y: 48 }, { x: 48, y: 3248 }, { x: 3248, y: 3248 },
];

export function nearestPrecinct(x, y) {
  let best = PRECINCTS[0], bestD = Infinity;
  for (const q of PRECINCTS) {
    const d = (q.x - x) ** 2 + (q.y - y) ** 2;
    if (d < bestD) { best = q; bestD = d; }
  }
  return best;
}

const RIGS = new WeakMap();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rngOf = (state) => (state && typeof state.rng === 'function' ? state.rng : Math.random);
const cruiserTarget = (wanted) => (wanted <= 0 ? 0 : Math.min(MAX_LEVEL, wanted));
const officerTarget = (wanted) => (wanted <= 1 ? 0 : Math.min(8, (wanted - 1) * 2));

function rigOf(state) {
  const known = RIGS.get(state);
  if (known) return known;
  const p = state.player || { x: 0, y: 0 };
  const rig = { heat: 0, unseen: 0, spawnCool: 0, arrest: 0,
    stolen: (state.stats && state.stats.carsStolen) || 0, last: { x: p.x, y: p.y } };
  RIGS.set(state, rig);
  return rig;
}

const pushEvent = (state, e) => { if (Array.isArray(state.events)) state.events.push(e); };

const band = (v) => (((v % PITCH) + PITCH) % PITCH) < ROAD;

const lineOf = (v) => Math.round((v - ROAD / 2) / PITCH) * PITCH + ROAD / 2;

function angleDiff(a, b) {
  const d = (a - b) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : (d < -Math.PI ? d + Math.PI * 2 : d);
}

function nightAmount(dayPhase) {
  const p = (((dayPhase || 0) % 1) + 1) % 1;
  return 1 - Math.min(1, Math.max(0, (0.35 + 0.5 * Math.cos((p - 0.4) * Math.PI * 2)) / 0.75));
}

function onScreen(state, x, y, pad) {
  const cam = state.camera || { x: 0, y: 0 };
  const cw = (state.canvas && state.canvas.w) || 1280, ch = (state.canvas && state.canvas.h) || 720;
  return x > cam.x - pad && x < cam.x + cw + pad && y > cam.y - pad && y < cam.y + ch + pad;
}

// A disc of probes, so a walker cannot slip through the 14 px gaps between
// neighbouring buildings the way a four point cross can.
function footBlocked(world, x, y) {
  if (solidAt(world, x, y)) return true;
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    if (solidAt(world, x + Math.cos(a) * 7, y + Math.sin(a) * 7)) return true;
  }
  return false;
}

function clearAt(world, x, y, hx, hy) {
  const hl = CRUISER_LEN * 0.46, hw = CRUISER_WID * 0.44;
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    if (solidAt(world, x + hx * hl * a - hy * hw * b, y + hy * hl * a + hx * hw * b)) return false;
  }
  return true;
}

// Sees the player through no wall inside 460 px, and hears him at 220 px.
function sight(state, u, p) {
  const dx = p.x - u.x, dy = p.y - u.y, d2 = dx * dx + dy * dy;
  if (d2 > SIGHT * SIGHT) return false;
  if (d2 < 220 * 220 || !state.world) return true;
  for (let i = 1; i <= 8; i += 1) if (solidAt(state.world, u.x + (dx * i) / 9, u.y + (dy * i) / 9)) return false;
  return true;
}

export function updatePolice(state, dt) {
  const p = state && state.player;
  if (!p) return;
  const step = Math.min(Math.max(dt || 1 / 60, 0), 0.05);
  if (!Array.isArray(state.police)) state.police = [];
  if (typeof state.wanted !== 'number') state.wanted = 0;
  const rig = rigOf(state);
  retire(state, step);
  if ((state.flags && state.flags.dead) || p.health <= 0) {
    state.wanted = 0; rig.heat = 0; rig.unseen = 0; rig.arrest = 0;
    return;
  }

  const stolen = (state.stats && state.stats.carsStolen) || 0;
  for (const e of Array.isArray(state.events) ? state.events : []) {
    if (!e || !e.type) continue;
    if (e.type === 'gunshot' && e.from !== 'police') rig.heat += 1;
    else if (e.type === 'punch') rig.heat += 0.8;
    else if (e.type === 'enterCar') { rig.heat += THEFT_HEAT; rig.stolen = stolen; }
    else if (e.type === 'crash' && e.by === 'player') rig.heat += 0.5;
    else if (e.type === 'kill') rig.heat += 2;
  }
  if (stolen > rig.stolen) { rig.heat += THEFT_HEAT * (stolen - rig.stolen); rig.stolen = stolen; }
  rig.heat = clamp(rig.heat - HEAT_DECAY * step, 0, HEAT_CAP);
  while (state.wanted < MAX_LEVEL && rig.heat >= 2 + state.wanted * 0.6) {
    rig.heat -= 2 + state.wanted * 0.6; state.wanted += 1;
    pushEvent(state, { type: 'wanted', level: state.wanted });
  }

  let seen = false;
  for (const u of state.police) {
    u.sightT -= step;
    if (u.hp > 0 && u.sightT <= 0) { u.sightT = 0.1; u.sees = sight(state, u, p); }
    seen = seen || (u.hp > 0 && u.sees);
  }
  if (seen) { rig.unseen = 0; rig.last.x = p.x; rig.last.y = p.y; } else rig.unseen += step;
  if (state.wanted > 0 && rig.unseen > UNSEEN) {
    state.wanted -= 1;
    rig.unseen = 0; rig.heat = 0;
    pushEvent(state, { type: 'wanted', level: state.wanted });
  }

  let cars = 0, feet = 0;
  for (const u of state.police) {
    if (u.hp <= 0) continue;
    if (u.muzzle > 0) u.muzzle -= step;
    u.flash = (u.flash + step) % 1;
    if (u.kind === 'cruiser') { cars += 1; driveUnit(state, u, rig.last, step); }
    else { feet += 1; walkUnit(state, u, rig.last, step); }
  }
  dropSurplus(state, p, cars, feet);
  rig.spawnCool -= step;
  spawnStep(state, rig, rngOf(state), cars, feet, p);
  arrestCheck(state, rig, p, step);
}

function retire(state, step) {
  for (let i = state.police.length - 1; i >= 0; i -= 1) {
    const u = state.police[i];
    u.fade = u.hp > 0 ? 0 : u.fade + step;
    if (u.fade > 8) state.police.splice(i, 1);
  }
}

// Surplus units leave only once they are off the player's screen.
function dropSurplus(state, p, cars, feet) {
  const over = { cruiser: cars - cruiserTarget(state.wanted), officer: feet - officerTarget(state.wanted) };
  for (let i = state.police.length - 1; i >= 0; i -= 1) {
    const u = state.police[i];
    if (over[u.kind] <= 0 || u.hp <= 0) continue;
    if (Math.hypot(u.x - p.x, u.y - p.y) < 640) continue;
    state.police.splice(i, 1);
    over[u.kind] -= 1;
  }
}

function spawnStep(state, rig, rng, cars, feet, p) {
  const carGap = cruiserTarget(state.wanted) - cars, footGap = officerTarget(state.wanted) - feet;
  if (rig.spawnCool > 0 || (carGap <= 0 && footGap <= 0)) return;
  const spot = spawnSpot(state, rng, p);
  const cruiser = carGap > 0 && (footGap <= 0 || carGap * 2 >= footGap);
  state.police.push(cruiser ? makeCruiser(spot.x, spot.y, rng) : makeOfficer(spot.x, spot.y, rng));
  rig.spawnCool = SPAWN_COOL;
}

// Off-screen from a precinct, or from the farthest one when all four are in view.
function spawnSpot(state, rng, p) {
  const cam = state.camera || { x: 0, y: 0 };
  const cw = (state.canvas && state.canvas.w) || 1280, ch = (state.canvas && state.canvas.h) || 720;
  const off = PRECINCTS.filter((q) => q.x < cam.x - 40 || q.x > cam.x + cw + 40
    || q.y < cam.y - 40 || q.y > cam.y + ch + 40);
  const pool = off.length ? off : [nearestPrecinct(p.x < 1920 ? 3840 : 0, p.y < 1920 ? 3840 : 0)];
  const q = pool[Math.floor(rng() * pool.length) % pool.length];
  return { x: q.x + (rng() - 0.5) * 24, y: q.y + (rng() - 0.5) * 24 };
}

function makeCruiser(x, y, rng) {
  return { kind: 'cruiser', x, y, angle: Math.PI / 2, speed: 0, hp: 100, maxHp: 100,
    cool: 0, muzzle: 0, flash: rng() * 0.5, walk: 0, sees: false, sightT: 0,
    plan: 0, axis: null, decide: 0, jam: 0, fade: 0 };
}

function makeOfficer(x, y, rng) {
  return { kind: 'officer', x: x + (rng() - 0.5) * 18, y: y + (rng() - 0.5) * 18, angle: 0,
    speed: 0, hp: 70, maxHp: 70, muzzle: 0, cool: 0.6 + rng() * 0.5, flash: 0, walk: 0,
    sees: false, sightT: 0, plan: 0, axis: null, decide: 0, jam: 0, fade: 0 };
}

// Waypoint on the road grid: whole blocks, decided only inside intersections, so
// a cruiser never tries to cut a 96 px corner. null means park here.
function planFor(u, target, step) {
  const dx = target.x - u.x, dy = target.y - u.y;
  if (Math.hypot(dx, dy) < PARK_OFF) return null;
  const onV = band(u.x), onH = band(u.y);
  if (onV && onH && u.decide <= 0) {
    if (Math.abs(dx) > 36) u.axis = 'h';
    else if (Math.abs(dy) > 22) u.axis = 'v';
    u.decide = 0.35;
  } else if (u.decide > 0) {
    u.decide -= step;
  }
  if (!u.axis) u.axis = onV ? 'v' : 'h';
  if (u.axis === 'h' && !onH) u.axis = 'v';
  if (u.axis === 'v' && !onV) u.axis = 'h';
  if (u.axis === 'h') {
    u.plan = Math.abs(dx) > 20 ? Math.sign(dx) : (u.plan || 1);
    return { x: u.x + u.plan * 220, y: lineOf(u.y) };
  }
  if (!onV) return { x: lineOf(u.x), y: u.y };
  u.plan = Math.sign(dy) || (u.plan || 1);
  return { x: lineOf(u.x), y: u.y + u.plan * 220 };
}

function driveUnit(state, u, target, step) {
  const way = planFor(u, target, step);
  if (!way) {
    u.speed = Math.max(0, u.speed - 1100 * step);
  } else {
    const err = angleDiff(Math.atan2(way.y - u.y, way.x - u.x), u.angle);
    u.angle += clamp(err, -2.5 * step, 2.5 * step);
    const top = Math.abs(err) > 0.45 ? 150 : CRUISER_TOP;
    u.speed = u.speed < top ? Math.min(top, u.speed + 300 * step) : Math.max(top, u.speed - 620 * step);
  }
  const hx = Math.cos(u.angle), hy = Math.sin(u.angle);
  const nx = u.x + hx * u.speed * step, ny = u.y + hy * u.speed * step;
  if (clearAt(state.world, nx, u.y, hx, hy)) u.x = nx; else u.speed *= 0.35;
  if (clearAt(state.world, u.x, ny, hx, hy)) u.y = ny; else u.speed *= 0.35;
  u.jam = way && u.speed < 40 ? u.jam + step : 0;
  if (u.jam > 1.4) tow(u);
}

const tow = (u) => {
  u.x = lineOf(u.x); u.y = lineOf(u.y);
  u.speed = 0; u.jam = 0; u.decide = 0; u.axis = null; u.plan = 0;
};

function walkUnit(state, u, target, step) {
  const dx = target.x - u.x, dy = target.y - u.y;
  const d = Math.hypot(dx, dy) || 1;
  const way = u.sees || d < 150 ? target : (planFor(u, target, step) || target);
  const aim = Math.atan2(way.y - u.y, way.x - u.x);
  u.angle = aim;
  if (d > 34) moveFoot(state, u, Math.cos(aim), Math.sin(aim), d, step);
  else u.speed = 0;
  if (u.sees && state.wanted > 0 && d > 90) shoot(state, u, state.player, d, step);
}

function moveFoot(state, u, dx, dy, d, step) {
  const dist = OFFICER_SPEED * step;
  const nx = u.x + dx * dist, ny = u.y + dy * dist;
  const a = footBlocked(state.world, nx, u.y), b = footBlocked(state.world, u.x, ny);
  if (!a) u.x = nx;
  if (!b) u.y = ny;
  const moved = (a ? 0 : 1) + (b ? 0 : 1);
  u.walk += moved * dist * 0.06;
  u.speed = moved ? OFFICER_SPEED : 0;
  u.jam = moved ? 0 : u.jam + step;
  if (u.jam > 1.2) rescue(u, d > 200);
}

// A walker wedged in a 14 px gap while still far from the target is put back on
// the nearest road centre; one held at a wall near the target stays there.
function rescue(u, far) {
  u.jam = 0;
  if (!far) return;
  u.x = lineOf(u.x); u.y = lineOf(u.y);
}

function shoot(state, u, p, d, step) {
  u.cool -= step;
  if (d > SIGHT || u.cool > 0) return;
  const rng = rngOf(state);
  u.cool = 0.8 + rng() * 0.45;
  u.muzzle = 0.07;
  if (rng() < 0.8 - d / 1600) p.health = Math.max(0, p.health - (5 + (1 - d / SIGHT) * 4));
  pushEvent(state, { type: 'gunshot', x: u.x, y: u.y, tx: p.x, ty: p.y, from: 'police', target: 'player' });
}

function arrestCheck(state, rig, p, step) {
  const rolling = p.car && Math.hypot(p.car.vx, p.car.vy) > 12;
  let close = false;
  for (const u of state.police) {
    if (u.kind !== 'officer' || u.hp <= 0 || rolling) continue;
    if (Math.hypot(u.x - p.x, u.y - p.y) < ARREST_RANGE) { close = true; break; }
  }
  rig.arrest = close ? rig.arrest + step : 0;
  if (rig.arrest < ARREST_TIME) return;
  rig.arrest = 0;
  rig.heat = 0;
  rig.unseen = 0;
  state.wanted = 0;
  for (const u of state.police) u.cool = 1.2;
  pushEvent(state, { type: 'arrest', x: p.x, y: p.y });
}

export function drawPolice(ctx, state) {
  const list = state.police;
  if (!Array.isArray(list) || list.length === 0) return;
  const night = nightAmount(state.dayPhase), t = state.t || 0;
  for (const u of list) {
    if (!onScreen(state, u.x, u.y, 140)) continue;
    if (u.kind === 'cruiser') drawCruiser(ctx, u, night, t); else drawOfficer(ctx, u, night);
  }
}

// The liveried sedan with a two lamp light bar on the roof. The glow is a small
// radial bleed of 26 px, so a cruiser reads as a lit car and never as a disc
// smeared across the road.
function drawCruiser(ctx, u, night, t) {
  const L = CRUISER_LEN, W = CRUISER_WID;
  const down = u.hp <= 0;
  const beat = Math.floor(t * 6) % 2 === 0;
  ctx.save();
  ctx.translate(u.x, u.y);
  ctx.rotate(u.angle);
  if (!down) {
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    glow.addColorStop(0, beat ? 'rgba(255, 96, 80, 0.34)' : 'rgba(96, 148, 255, 0.34)');
    glow.addColorStop(0.45, beat ? 'rgba(255, 96, 80, 0.13)' : 'rgba(96, 148, 255, 0.13)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath(); ctx.ellipse(2, 3, L * 0.5, W * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = down ? '#5b6168' : (night > 0.35 ? '#a9b0b6' : '#e4e7ea');
  rounded(ctx, -L / 2, -W / 2, L, W, 4); ctx.fill();
  ctx.fillStyle = down ? '#3c4653' : (night > 0.35 ? '#22354c' : '#24486f');
  ctx.fillRect(-L * 0.16, -W / 2, L * 0.32, W);
  ctx.fillStyle = 'rgba(126,172,196,0.85)';
  ctx.fillRect(L * 0.2, -W / 2 + 3, L * 0.14, W - 6);
  ctx.fillStyle = '#ffe6a6';
  ctx.fillRect(L / 2 - 2.6, -W / 2 + 2, 2.6, 4);
  ctx.fillRect(L / 2 - 2.6, W / 2 - 6, 2.6, 4);
  if (!down) {
    // the bar itself: a dark base, then red on one side and blue on the other
    ctx.fillStyle = '#1c2028';
    rounded(ctx, -4, -W / 2 + 2.2, 8, W - 4.4, 2); ctx.fill();
    ctx.fillStyle = beat ? '#ff5a48' : '#5b2320';
    rounded(ctx, -3.4, -W / 2 + 2.8, 6.8, W / 2 - 3.4, 1.4); ctx.fill();
    ctx.fillStyle = beat ? '#2a4a8c' : '#8fc6ff';
    rounded(ctx, -3.4, 0.6, 6.8, W / 2 - 3.4, 1.4); ctx.fill();
  }
  ctx.restore();
}

// A foot officer: a smaller body than the player, in navy, under a peaked cap
// whose crown and brim read from above.
function drawOfficer(ctx, u, night) {
  const down = u.hp <= 0;
  const gait = down ? 0 : Math.sin(u.walk);
  const jacket = down ? '#3d4653' : (night > 0.35 ? '#1d2c3e' : '#24486f');
  ctx.save();
  ctx.translate(u.x, u.y);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(1, 3, down ? 11 : 7.6, down ? 6.5 : 5.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(down ? u.angle + Math.PI / 2 : u.angle);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1b2430'; ctx.lineWidth = 2.8;
  for (const side of [-1, 1]) {
    const step = gait * 4 * side;
    ctx.beginPath();
    ctx.moveTo(-1, side * 2.6);
    ctx.lineTo(-3.2 + step, side * 3.8);
    ctx.stroke();
  }
  ctx.fillStyle = jacket;
  ctx.beginPath(); ctx.arc(0, 0, 5.7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(6, 10, 16, 0.5)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = PALETTE.skins[1]; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(0.6, -4.4); ctx.lineTo(4.6, -1.6); ctx.moveTo(0.6, 4.4); ctx.lineTo(4.6, 1.6); ctx.stroke();
  // cap: a crown over the back of the head and a brim across the front
  ctx.fillStyle = PALETTE.skins[1];
  ctx.beginPath(); ctx.arc(2.2, 0, 3.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = night > 0.35 ? '#101a26' : '#16202e';
  ctx.beginPath(); ctx.arc(1.1, 0, 3.4, Math.PI * 0.56, Math.PI * 1.44); ctx.fill();
  ctx.fillStyle = '#0b1119';
  ctx.fillRect(4.4, -2.9, 1.7, 5.8);
  ctx.fillStyle = GOLD_BADGE;
  ctx.fillRect(3.5, -1.1, 1.3, 2.2);
  if (u.muzzle > 0) {
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(9.4, 0, 4.2, 0, Math.PI * 2); ctx.fill();
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
