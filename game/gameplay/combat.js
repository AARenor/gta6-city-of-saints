// City of Saints: fists and the pistol.
//
// Q punches: 40 px reach, 0.42 s cooldown, knockback, a hurt pedestrian or
// officer. The left button spends one of the 60 rounds in state.player.ammo and
// walks a 620 px ray from the muzzle toward the mouse that stops at the first
// pedestrian, officer, cruiser, mission rival or car; the tracer goes into
// state.bullets, blood or sparks into state.particles, and a kill counts
// stats.kills, pushes 'kill' and 'gunshot' so police.js raises state.wanted, and
// drops $25..$60 of cash into state.pickups for the player to walk over.
//
// A dead pedestrian leaves state.peds. Police units, rivals and cars stay for
// their own module. Peds get hp on the first hit; rivals and cars keep theirs,
// and rivals are read off state.mission.rivals. Mouse is canvas space, so the
// aim point is camera plus mouse, while both draws are world space.
//
// Exports: updateCombat, drawCombat.

import { PALETTE } from '../world/palette.js';
import { solidAt } from '../world/city.js';

const PUNCH_COOL = 0.42, PUNCH_RANGE = 40, PUNCH_DMG = 40, KNOCK = 16;
const SHOT_COOL = 0.19, SHOT_RANGE = 620, SHOT_DMG = 48, TRACER_TIME = 0.1;
const FLASH_TIME = 0.07, AMMO_MAX = 60, PED_HP = 60;
const CASH_MIN = 25, CASH_MAX = 60, PICK_RANGE = 40, DROP_LIFE = 30;
const MAX_BULLETS = 24, MAX_PARTS = 140, MAX_CASH = 24;
const BLOOD = '#8f1f20', SPARK = '#ffd166';

const RIGS = new WeakMap();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rngOf = (state) => (state && typeof state.rng === 'function' ? state.rng : Math.random);
const push = (state, e) => { if (Array.isArray(state.events)) state.events.push(e); };

// Case tolerant key lookup, so 'q' and 'Q' both read.
function on(set, name) {
  if (!set) return false;
  if (set.has(name)) return true;
  const want = name.toLowerCase();
  for (const k of set) if (typeof k === 'string' && k.toLowerCase() === want) return true;
  return false;
}

const held = (state, name) => on(state.input && state.input.keys, name);
const tapped = (state, name) => on(state.input && state.input.pressed, name);
const mouseOf = (state) => (state.input && state.input.mouse) || {};

function setHud(state, text, seconds) {
  if (!state.hud) return;
  state.hud.message = text; state.hud.messageUntil = (state.t || 0) + seconds;
}

// Per state timers, so no field of the player object is invented.
function rigOf(state) {
  let rig = RIGS.get(state);
  if (rig) return rig;
  rig = { punch: 0, shot: 0, flash: 0, aim: 0 }; RIGS.set(state, rig);
  return rig;
}

function onScreen(state, x, y, pad) {
  const cam = state.camera || { x: 0, y: 0 };
  const w = (state.canvas && state.canvas.w) || 1280, h = (state.canvas && state.canvas.h) || 720;
  return x > cam.x - pad && x < cam.x + w + pad && y > cam.y - pad && y < cam.y + h + pad;
}

export function updateCombat(state, dt) {
  if (!state || !state.player) return;
  const p = state.player;
  const step = clamp(dt || 1 / 60, 0, 0.05);
  const rig = rigOf(state);
  for (const k of ['punch', 'shot', 'flash']) rig[k] = Math.max(0, rig[k] - step);
  ageBullets(state, step);
  ageParticles(state, step);
  ageDrops(state, step);
  if (state.flags && state.flags.dead) return;
  if (!Number.isFinite(p.ammo)) p.ammo = AMMO_MAX;
  if (held(state, 'q') || tapped(state, 'q')) punch(state, p, rig);
  shoot(state, p, rig);
}

function punch(state, p, rig) {
  if (rig.punch > 0) return;
  rig.punch = PUNCH_COOL;
  push(state, { type: 'punch', x: p.x, y: p.y, by: 'player' });
  const hit = punchTarget(state, p);
  if (!hit) return;
  const dx = hit.x - p.x, dy = hit.y - p.y, d = Math.hypot(dx, dy) || 1;
  knock(state, hit.ref, (dx / d) * KNOCK, (dy / d) * KNOCK);
  blood(state, hit.x, hit.y, dx / d, dy / d, 5);
  if (hit.kind === 'officer') hurtUnit(state, hit.ref, PUNCH_DMG, hit.x, hit.y, 'officer');
  else hurtPed(state, hit.ref, PUNCH_DMG, hit.x, hit.y);
}

// Nearest pedestrian or officer in the 40 px reach, loose in front only.
function punchTarget(state, p) {
  const facing = Number.isFinite(p.angle) ? p.angle : 0;
  const fx = Math.cos(facing), fy = Math.sin(facing);
  let best = null, bestD = PUNCH_RANGE;
  const check = (x, y, kind, ref) => {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d >= bestD) return;
    if (d > 20 && ((x - p.x) * fx + (y - p.y) * fy) / d < -0.3) return;
    best = { kind, ref, x, y };
    bestD = d;
  };
  for (const ped of state.peds || []) check(ped.x, ped.y, 'ped', ped);
  for (const u of state.police || []) if (u.kind === 'officer' && u.hp > 0) check(u.x, u.y, 'officer', u);
  return best;
}

function knock(state, o, kx, ky) {
  if (!o) return;
  const nx = o.x + kx, ny = o.y + ky;
  if (!solidAt(state.world, nx, ny)) { o.x = nx; o.y = ny; return; }
  if (!solidAt(state.world, nx, o.y)) o.x = nx;
  else if (!solidAt(state.world, o.x, ny)) o.y = ny;
}

function shoot(state, p, rig) {
  const m = mouseOf(state);
  const clicked = m.clicked === true, down = m.down === true;
  if ((!clicked && !down) || rig.shot > 0) return;
  if (clicked) m.clicked = false;
  if (!(p.ammo > 0)) { setHud(state, 'Out of ammo', 1.6); return; }
  p.ammo -= 1;
  rig.shot = SHOT_COOL;
  rig.flash = FLASH_TIME;
  const cam = state.camera || { x: 0, y: 0 };
  const aim = Number.isFinite(m.x) && Number.isFinite(m.y)
    ? Math.atan2(cam.y + m.y - p.y, cam.x + m.x - p.x)
    : (Number.isFinite(p.angle) ? p.angle : 0);
  rig.aim = aim;
  const dx = Math.cos(aim), dy = Math.sin(aim);
  const mx = p.x + dx * 12, my = p.y + dy * 12;
  const hit = rayHit(state, mx, my, dx, dy);
  const bullets = Array.isArray(state.bullets) ? state.bullets : (state.bullets = []);
  bullets.push({ x: mx, y: my, dx, dy, len: hit.dist, life: TRACER_TIME, max: TRACER_TIME });
  if (bullets.length > MAX_BULLETS) bullets.shift();
  sparks(state, mx, my, 3, 0.5);
  push(state, { type: 'gunshot', x: p.x, y: p.y, from: 'player' });
  applyHit(state, hit);
}

// First thing the ray meets: nearest projection wins, nothing else is damaged.
function rayHit(state, ox, oy, dx, dy) {
  let best = null, bestT = SHOT_RANGE;
  const probe = (x, y, r, kind, ref) => {
    const t = (x - ox) * dx + (y - oy) * dy;
    if (t < 6 || t >= bestT || Math.hypot(x - (ox + dx * t), y - (oy + dy * t)) > r) return;
    bestT = t;
    best = { kind, ref, x: ox + dx * t, y: oy + dy * t };
  };
  for (const ped of state.peds || []) probe(ped.x, ped.y, 9, 'ped', ped);
  for (const u of state.police || []) if (u.hp > 0) probe(u.x, u.y, u.kind === 'cruiser' ? 18 : 10, u.kind, u);
  const rivals = state.mission && Array.isArray(state.mission.rivals) ? state.mission.rivals : [];
  for (const r of rivals) if (r && r.hp > 0) probe(r.x, r.y, 11, 'rival', r);
  const mine = state.player && state.player.car;
  for (const c of state.cars || []) {
    if (c && c !== mine && c.driver !== 'player') probe(c.x, c.y, 16, 'car', c);
  }
  if (best) return Object.assign(best, { dist: bestT });
  return { kind: 'none', x: ox + dx * SHOT_RANGE, y: oy + dy * SHOT_RANGE, dist: SHOT_RANGE };
}

function applyHit(state, hit) {
  if (!hit || hit.kind === 'none') return;
  if (hit.kind === 'ped') hurtPed(state, hit.ref, SHOT_DMG, hit.x, hit.y);
  else if (hit.kind === 'car') hurtCar(state, hit.ref, SHOT_DMG, hit.x, hit.y);
  else hurtUnit(state, hit.ref, SHOT_DMG, hit.x, hit.y, hit.kind);
}

function hurtPed(state, ped, dmg, x, y) {
  if (!ped) return false;
  ped.hp = (Number.isFinite(ped.hp) ? ped.hp : PED_HP) - dmg;
  ped.flee = 6;
  if (ped.hp > 0) return false;
  const list = Array.isArray(state.peds) ? state.peds : [];
  const i = list.indexOf(ped);
  if (i >= 0) list.splice(i, 1);
  blood(state, ped.x, ped.y, 0, 0, 10);
  killOf(state, x, y, 'ped');
  return true;
}

function hurtUnit(state, u, dmg, x, y, kind) {
  if (!u || !(u.hp > 0)) return false;
  u.hp = Math.max(0, u.hp - dmg);
  if (u.hp > 0) return false;
  if (kind === 'cruiser') sparks(state, x, y, 8, 0.9); else blood(state, u.x, u.y, 0, 0, 10);
  killOf(state, x, y, kind);
  return true;
}

function hurtCar(state, car, dmg, x, y) {
  car.hp = Math.max(0, (Number.isFinite(car.hp) ? car.hp : 100) - dmg);
  car.bump = Math.max(car.bump || 0, 0.3);
  sparks(state, x, y, 8, 0.8);
}

// One kill: the counter, the heat that police reads, and the pocket money.
function killOf(state, x, y, kind) {
  if (state.stats) state.stats.kills = (state.stats.kills || 0) + 1;
  push(state, { type: 'kill', x, y, kind });
  push(state, { type: 'gunshot', x, y, from: 'player' });
  if (kind !== 'officer' && kind !== 'cruiser') dropCash(state, x, y);
}

function dropCash(state, x, y) {
  const list = Array.isArray(state.pickups) ? state.pickups : (state.pickups = []);
  let cash = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!list[i] || list[i].type !== 'cash') continue;
    cash += 1;
    if (cash >= MAX_CASH) list.splice(i, 1);
  }
  const rnd = rngOf(state);
  const amount = CASH_MIN + Math.floor(rnd() * (CASH_MAX - CASH_MIN + 1));
  const a = rnd() * Math.PI * 2;
  list.push({ type: 'cash', x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6, amount,
    life: DROP_LIFE, max: DROP_LIFE, spin: rnd() * 6.283 });
}

function blood(state, x, y, dx, dy, n) {
  const rnd = rngOf(state);
  const base = dx || dy ? Math.atan2(dy, dx) : rnd() * 6.283;
  for (let i = 0; i < n; i += 1) {
    const a = base + (rnd() - 0.5) * 1.9, sp = 40 + rnd() * 140;
    addParticle(state, { type: 'blood', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.28 + rnd() * 0.3, max: 0.58, size: 1.6 + rnd() * 2.2 });
  }
}

function sparks(state, x, y, n, spread) {
  const rnd = rngOf(state);
  for (let i = 0; i < n; i += 1) {
    const a = rnd() * 6.283, sp = 60 + rnd() * 200 * (spread || 1);
    addParticle(state, { type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.1 + rnd() * 0.18, max: 0.28, size: 1 + rnd() * 1.4 });
  }
}

function addParticle(state, part) {
  const list = Array.isArray(state.particles) ? state.particles : (state.particles = []);
  list.push(part);
  if (list.length > MAX_PARTS) list.splice(0, list.length - MAX_PARTS);
}

function ageBullets(state, step) {
  const list = state.bullets;
  if (!Array.isArray(list)) return;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!list[i]) { list.splice(i, 1); continue; }
    if ((list[i].life -= step) <= 0) list.splice(i, 1);
  }
}

function ageParticles(state, step) {
  const list = state.particles;
  if (!Array.isArray(list)) return;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const q = list[i];
    if (!q) { list.splice(i, 1); continue; }
    if (q.type !== 'blood' && q.type !== 'spark') continue;
    q.x += (q.vx || 0) * step;
    q.y += (q.vy || 0) * step;
    q.vx *= 0.86; q.vy *= 0.86;
    q.life -= step;
    if (q.life <= 0) list.splice(i, 1);
  }
}

// Cash ages out and is collected by the player's own feet within 40 px.
function ageDrops(state, step) {
  const list = state.pickups;
  if (!Array.isArray(list)) return;
  const p = state.player, dead = !!(state.flags && state.flags.dead);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const d = list[i];
    if (!d || d.type !== 'cash') continue;
    d.life -= step;
    let gone = d.life <= 0;
    if (!gone && p && !dead && Math.hypot(p.x - d.x, p.y - d.y) <= PICK_RANGE) {
      collect(state, d);
      gone = true;
    }
    if (gone) list.splice(i, 1);
  }
}

function collect(state, d) {
  const amount = Math.max(0, Math.round(d.amount || 0));
  const p = state.player;
  p.cash = (Number.isFinite(p.cash) ? p.cash : 0) + amount;
  if (state.hud) {
    state.hud.cashFlashUntil = (state.t || 0) + 1.2;
    setHud(state, `+$${amount}`, 1.4);
  }
  push(state, { type: 'pickup', kind: 'cash', amount, x: d.x, y: d.y });
}

export function drawCombat(ctx, state) {
  if (!ctx || !state) return;
  drawDrops(ctx, state);
  drawTracers(ctx, state);
  drawParts(ctx, state);
  drawFlash(ctx, state);
}

function drawDrops(ctx, state) {
  const list = state.pickups;
  if (!Array.isArray(list)) return;
  const t = state.t || 0, p = state.player;
  for (const d of list) {
    if (!d || d.type !== 'cash' || !onScreen(state, d.x, d.y, 30)) continue;
    const bob = Math.sin(t * 3 + d.spin) * 1.8;
    const fade = Math.min(1, Math.max(0, d.life / 1.5));
    const glow = 0.5 + 0.5 * Math.sin(t * 4 + d.spin);
    const near = p && Math.hypot(p.x - d.x, p.y - d.y) < 170;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(d.x, d.y + bob);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(1, 4, 9, 4.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(126,220,150,${(0.1 + glow * 0.12).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
    if (near) {
      ctx.fillStyle = '#dff3d9';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`$${d.amount}`, 0, -17);
    }
    ctx.rotate(Math.sin(d.spin + t) * 0.25);
    ctx.fillStyle = '#2f7d4a'; ctx.fillRect(-7, -4.4, 14, 8.8);
    ctx.fillStyle = '#9be0a8'; ctx.fillRect(-7, -4.4, 14, 1.6);
    ctx.fillStyle = '#dff3d9'; ctx.fillRect(-2.2, -2.6, 4.4, 5.4);
    ctx.fillStyle = '#20563a'; ctx.font = '700 7px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 0.4);
    ctx.restore();
  }
}

function drawTracers(ctx, state) {
  const list = state.bullets;
  if (!Array.isArray(list)) return;
  ctx.lineCap = 'round';
  for (const b of list) {
    if (!b || !onScreen(state, b.x, b.y, 700)) continue;
    const k = Math.max(0, Math.min(1, (b.life || 0) / (b.max || TRACER_TIME)));
    const x2 = b.x + b.dx * b.len, y2 = b.y + b.dy * b.len;
    ctx.globalAlpha = 0.25 + 0.7 * k;
    ctx.strokeStyle = PALETTE.lamp;
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.globalAlpha = 0.95 * k;
    ctx.fillStyle = '#fffdf0';
    ctx.beginPath(); ctx.arc(x2, y2, 2.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawParts(ctx, state) {
  const list = state.particles;
  if (!Array.isArray(list)) return;
  for (const q of list) {
    if (!q || !onScreen(state, q.x, q.y, 24)) continue;
    if (q.type === 'blood') {
      const k = Math.max(0, q.life / (q.max || 0.6));
      ctx.globalAlpha = 0.35 + 0.6 * k; ctx.fillStyle = BLOOD;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (0.5 + k * 0.7), 0, Math.PI * 2); ctx.fill();
    } else if (q.type === 'spark') {
      const k = Math.max(0, q.life / (q.max || 0.28));
      ctx.globalAlpha = 0.4 + 0.6 * k;
      ctx.strokeStyle = SPARK; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - (q.vx || 0) * 0.02, q.y - (q.vy || 0) * 0.02); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawFlash(ctx, state) {
  const rig = RIGS.get(state), p = state.player;
  if (!rig || rig.flash <= 0 || !p) return;
  const k = rig.flash / FLASH_TIME;
  const mx = p.x + Math.cos(rig.aim) * 13, my = p.y + Math.sin(rig.aim) * 13;
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 1.2);
  ctx.fillStyle = 'rgba(255,226,150,0.22)'; ctx.beginPath(); ctx.arc(mx, my, 26 * (0.6 + k), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PALETTE.lamp; ctx.beginPath(); ctx.arc(mx, my, 6.5 * k + 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff9e2';
  for (let i = 0; i < 6; i += 1) {
    const a = rig.aim + (i / 6) * Math.PI * 2 + k, len = (i % 2 === 0 ? 15 : 8) * (0.5 + k);
    ctx.beginPath(); ctx.moveTo(mx + Math.cos(a - 0.16) * 3, my + Math.sin(a - 0.16) * 3);
    ctx.lineTo(mx + Math.cos(a) * len, my + Math.sin(a) * len);
    ctx.lineTo(mx + Math.cos(a + 0.16) * 3, my + Math.sin(a + 0.16) * 3);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
