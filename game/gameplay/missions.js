// City of Saints: four jobs, their markers and the card that introduces them.
//
// createMissions() builds one fixed job list around road points and starts the
// first unfinished stage. Every stage is {id, title, objective, brief,
// marker: {x, y}, reward, line} plus what that job needs: the named car, the
// three rivals of state.mission.rivals, a two star pursuit, or the briefcase.
// updateMissions() arms the stage, watches its completion, pays the reward into
// state.player.cash, counts stats.missionsDone, pushes a 'mission' event, opens
// the 8 s briefing card for the next stage, and after the fourth job shows the
// finale line.
//
// The rivals sit on state.mission.rivals as {x, y, hp, maxHp, angle} so that
// combat.js can shoot them without importing this file. The briefcase sits on
// state.mission.briefcase until the player stands on it, then the same marker
// turns into the walk home. The pursuit is armed by pushing 'gunshot' events,
// never by writing state.wanted, because police.js owns that number. Draws are
// world space except the two cards, which translate by the camera. The stage
// marker is a gold diamond on a thin beam, with the distance to the player in
// metres under it.
//
// Exports: createMissions, updateMissions, drawMissions, openBriefing.

import { PALETTE } from '../world/palette.js';
import { randomRoadPoint, solidAt } from '../world/city.js';

const JOBS = 4, BRIEF_TIME = 8, MARK_RANGE = 90, PICK_RANGE = 40;
const RIVALS = 3, RIVAL_HP = 100, FAR = 900, CALM = 2;
const REWARDS = [350, 520, 760, 900];
const NAMES = ['the Marisol Cab', 'the Cobalt Sedan', 'the Kask Coupe'];
const FINALE = 'Four jobs done. The pier smells of diesel and the city still owes you nothing.';
const COLOURS = { steal: '#ffd23f', crew: '#ff6b57', escape: '#38e8ff', case: '#7cff6b' };

const rngOf = (state) => (state && typeof state.rng === 'function' ? state.rng : Math.random);
const pick = (list, rand) => list[Math.floor(rand() * list.length) % list.length];
const push = (state, e) => { if (Array.isArray(state.events)) state.events.push(e); };

function setHud(state, text, seconds) {
  if (!state.hud) return;
  state.hud.message = text; state.hud.messageUntil = (state.t || 0) + seconds;
}

function hint(state, m, text) {
  const t = state.t || 0;
  if ((m.hintAt || 0) > t) return;
  m.hintAt = t + 4;
  setHud(state, text, 2);
}

// A road point, pushed away from `from` so two jobs never overlap.
function roadPoint(state, from) {
  const rnd = rngOf(state);
  let best = randomRoadPoint(state.world, rnd);
  let bestD = from ? Math.hypot(best.x - from.x, best.y - from.y) : Infinity;
  for (let i = 0; i < 10 && bestD < FAR; i += 1) {
    const q = randomRoadPoint(state.world, rnd);
    const d = from ? Math.hypot(q.x - from.x, q.y - from.y) : Infinity;
    if (d > bestD) { best = q; bestD = d; }
  }
  return { x: best.x, y: best.y };
}

function buildStages(state) {
  const carName = pick(NAMES, rngOf(state));
  const carPoint = roadPoint(state, null);
  const drop = roadPoint(state, carPoint), crew = roadPoint(state, drop);
  const hide = roadPoint(state, crew), casePoint = roadPoint(state, hide);
  const pier = state.world && state.world.pier;
  const home = pier ? { x: pier.x + pier.w / 2, y: pier.y + pier.h / 2 } : roadPoint(state, casePoint);
  return [
    { id: 'steal', kind: 'steal', title: carName, carName, marker: carPoint, drop, reward: REWARDS[0],
      objective: `Steal ${carName}`, brief: 'The buyer pays for the car itself, never for the paint.',
      line: 'No scratches. He counts them.' },
    { id: 'crew', kind: 'crew', title: 'The Corner Crew', marker: crew, reward: REWARDS[1],
      objective: `Take out the crew (${RIVALS} left)`,
      brief: 'Three of them hold that corner and none of them is polite.',
      line: 'The corner is yours now.' },
    { id: 'escape', kind: 'escape', title: 'Heat', marker: hide, reward: REWARDS[2],
      objective: 'Lose the two stars',
      brief: 'They have the plate. Get clear, stay clear, keep the car quiet.',
      line: 'Two stars gone. Do not give them a third.' },
    { id: 'case', kind: 'case', title: 'The Briefcase', marker: casePoint, home, reward: REWARDS[3],
      objective: 'Grab the briefcase',
      brief: 'It sits in the open with a nice brass lock. Bring it back whole.',
      line: 'The case goes home. So do you.' },
  ];
}

export function createMissions(state, missionsDone = 0) {
  if (!state) return null;
  const stages = buildStages(state);
  const start = Math.max(0, Math.min(JOBS, Math.floor(Number(missionsDone)) || 0));
  const m = { stages, index: start, stage: null, done: start >= JOBS, rivals: [], briefcase: null,
    car: null, briefing: null, briefingUntil: 0, finale: '', finaleUntil: 0, hintAt: 0 };
  state.mission = m;
  if (m.done) { m.finale = FINALE; return m; }
  m.stage = stages[start]; beginStage(state, m); openBriefing(state, m);
  return m;
}

function beginStage(state, m) {
  const s = m.stage;
  m.rivals = []; m.briefcase = null; m.car = null;
  if (!s) return;
  if (s.kind === 'steal') {
    s.taken = false; m.car = pickCar(state, s.marker);
    if (m.car) s.marker = { x: m.car.x, y: m.car.y };
    s.objective = `Steal ${s.carName}`;
  } else if (s.kind === 'crew') {
    for (let i = 0; i < RIVALS; i += 1) m.rivals.push(rivalAt(state, s.marker, i));
    s.objective = `Take out the crew (${RIVALS} left)`;
  } else if (s.kind === 'escape') {
    s.armed = false; s.calm = 0;
    s.objective = 'Lose the two stars';
  } else if (s.kind === 'case') {
    m.briefcase = { x: s.marker.x, y: s.marker.y };
    s.objective = 'Grab the briefcase';
  }
}

// The nearest healthy npc car to the pick up point is the one that is named.
function pickCar(state, near) {
  const cars = Array.isArray(state.cars) ? state.cars : [];
  let best = null, bestD = Infinity;
  for (const car of cars) {
    if (!car || car.driver !== 'npc') continue;
    if (Number.isFinite(car.hp) && car.hp <= 0) continue;
    const d = Math.hypot(car.x - near.x, car.y - near.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function rivalAt(state, spot, i) {
  const rnd = rngOf(state);
  const a = (i / RIVALS) * Math.PI * 2 + rnd() * 0.5, r = 34 + rnd() * 20;
  let x = spot.x + Math.cos(a) * r, y = spot.y + Math.sin(a) * r;
  for (let k = 0; k < 10 && solidAt(state.world, x, y); k += 1) {
    x += Math.cos(a) * 9; y += Math.sin(a) * 9;
  }
  return { x, y, hp: RIVAL_HP, maxHp: RIVAL_HP, angle: Math.atan2(spot.y - y, spot.x - x) };
}

// Exported for the posed scenes: ?scene=mission opens the card and holds it.
export function openBriefing(state, m) {
  const s = m.stage;
  if (!s) return;
  m.briefing = { title: s.title, objective: s.objective, brief: s.brief, line: s.line,
    lines: wrap(s.brief, 62).slice(0, 2), reward: s.reward, job: m.index + 1, kind: s.kind };
  const t = state.t || 0;
  m.briefingStart = t;
  m.briefingUntil = t + BRIEF_TIME;
}

export function updateMissions(state, dt) {
  if (!state) return;
  const m = state.mission;
  if (!m) return;
  const step = Math.min(Math.max(dt || 1 / 60, 0), 0.05), t = state.t || 0;
  if (m.briefing && t >= m.briefingUntil) m.briefing = null;
  if (m.finaleUntil && t >= m.finaleUntil) m.finaleUntil = 0;
  if (m.done || !m.stage) return;
  const s = m.stage;
  let done = false;
  if (s.kind === 'steal') done = watchSteal(state, m, s);
  else if (s.kind === 'crew') done = watchCrew(state, m, s);
  else if (s.kind === 'escape') done = watchEscape(state, m, s, step);
  else done = watchCase(state, m, s);
  if (done) finishStage(state, m, s);
}

// The marker rides the named car until the player takes it, then moves to the drop.
function watchSteal(state, m, s) {
  const p = state.player;
  if (!p) return false;
  const car = p.car || null;
  if (!s.taken) {
    if (m.car && Number.isFinite(m.car.hp) && m.car.hp <= 0) m.car = null;
    if (m.car) { s.marker.x = m.car.x; s.marker.y = m.car.y; }
    if (car && (car === m.car || !m.car)) {
      s.taken = true; s.marker = { x: s.drop.x, y: s.drop.y };
      s.objective = `Deliver ${s.carName} to the drop`;
      setHud(state, s.objective, 3.5);
    } else if (car) hint(state, m, `Not this one. ${s.carName} is waiting.`);
    return false;
  }
  const x = car ? car.x : p.x, y = car ? car.y : p.y;
  if (Math.hypot(x - s.drop.x, y - s.drop.y) >= MARK_RANGE) return false;
  return (car ? Math.hypot(car.vx || 0, car.vy || 0) : p.speed || 0) < 60;
}

function watchCrew(state, m, s) {
  let left = 0;
  for (const r of m.rivals) if (r && r.hp > 0) left += 1;
  s.objective = left > 0 ? `Take out the crew (${left} left)` : 'The crew is down';
  return m.rivals.length === RIVALS && left === 0;
}

// The pursuit is pushed once, then only real stars count: two calm seconds.
function watchEscape(state, m, s, step) {
  if (!s.armed) { s.armed = true; s.calm = 0; armPursuit(state); }
  const level = state.wanted || 0;
  s.calm = level === 0 ? (s.calm || 0) + step : 0;
  s.objective = level > 0 ? `Lose the police (${level} star${level === 1 ? '' : 's'})` : 'Stay clear';
  return s.calm >= CALM;
}

function armPursuit(state) {
  const p = state.player || { x: 0, y: 0 };
  for (let i = 0; i < 6; i += 1) push(state, { type: 'gunshot', x: p.x, y: p.y, from: 'mission' });
  setHud(state, 'Two stars. Lose them.', 3);
}

function watchCase(state, m, s) {
  const p = state.player;
  if (!p) return false;
  if (m.briefcase) {
    if (Math.hypot(p.x - m.briefcase.x, p.y - m.briefcase.y) > PICK_RANGE) return false;
    m.briefcase = null; s.marker = { x: s.home.x, y: s.home.y };
    s.objective = 'Bring the briefcase back';
    setHud(state, 'Briefcase taken. Bring it back.', 3.5);
    push(state, { type: 'pickup', kind: 'case', x: p.x, y: p.y });
    return false;
  }
  return Math.hypot(p.x - s.home.x, p.y - s.home.y) < MARK_RANGE;
}

function finishStage(state, m, s) {
  const t = state.t || 0, reward = Math.max(0, s.reward || 0), p = state.player;
  if (p) p.cash = (Number.isFinite(p.cash) ? p.cash : 0) + reward;
  if (state.stats) state.stats.missionsDone = (state.stats.missionsDone || 0) + 1;
  if (state.hud) state.hud.cashFlashUntil = t + 2;
  push(state, { type: 'mission', stage: s.id, title: s.title, reward, index: m.index });
  setHud(state, `${s.title} done  +$${reward}`, 4.5);
  m.index += 1; m.rivals = []; m.briefcase = null; m.car = null;
  if (m.index >= JOBS) { endMissions(state, m, t); return; }
  m.stage = m.stages[m.index]; beginStage(state, m); openBriefing(state, m);
}

function endMissions(state, m, t) {
  m.done = true; m.stage = null; m.finale = FINALE;
  m.finaleStart = t; m.finaleUntil = t + BRIEF_TIME;
  push(state, { type: 'mission', stage: 'finale', reward: 0, index: JOBS });
  setHud(state, 'All four jobs done.', 6);
}

function onScreen(state, x, y, pad) {
  const cam = state.camera || { x: 0, y: 0 };
  const w = (state.canvas && state.canvas.w) || 1280, h = (state.canvas && state.canvas.h) || 720;
  return x > cam.x - pad && x < cam.x + w + pad && y > cam.y - pad && y < cam.y + h + pad;
}

export function drawMissions(ctx, state) {
  if (!ctx || !state) return;
  const m = state.mission;
  if (!m) return;
  const t = state.t || 0;
  if (!m.done && m.stage) {
    drawMarker(ctx, state, m.stage, t);
    if (m.stage.kind === 'crew') drawRivals(ctx, m, t);
    if (m.briefcase) drawBriefcase(ctx, m.briefcase, t);
  }
  if (m.briefing) drawBriefing(ctx, state, m, t);
  else if (m.done && m.finaleUntil) drawFinale(ctx, state, m, t);
}

// A gold diamond on a thin beam, hung over the spot, with the distance to the
// player written under it in metres. Drawn in world space above the roads and
// under the HUD, because main calls drawMissions inside the camera translate
// and before drawHud.
const MARK_GOLD = PALETTE.neon[2];
const METRES_PER_PX = 0.1;             // 3840 px city reads as 384 m across
const MARK_LIFT = 46;                  // diamond centre above the ground point

function drawMarker(ctx, state, s, t) {
  const mk = s.marker;
  if (!mk) return;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  const lift = MARK_LIFT + pulse * 5;
  const cy = mk.y - lift;
  const p = state.player;
  ctx.save();
  // the beam: two thin pixels from the street up to the diamond
  ctx.globalAlpha = 0.42 + pulse * 0.24;
  ctx.fillStyle = MARK_GOLD;
  ctx.fillRect(mk.x - 1, cy + 10, 2, lift - 10);
  // ground ring where the beam lands
  ctx.globalAlpha = 0.5 + pulse * 0.2;
  ctx.strokeStyle = MARK_GOLD;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(mk.x, mk.y, 13, 5.2, 0, 0, Math.PI * 2); ctx.stroke();
  // the diamond
  ctx.globalAlpha = 0.96;
  ctx.beginPath();
  ctx.moveTo(mk.x, cy - 12); ctx.lineTo(mk.x + 9, cy); ctx.lineTo(mk.x, cy + 12); ctx.lineTo(mk.x - 9, cy);
  ctx.closePath();
  ctx.fillStyle = MARK_GOLD; ctx.fill();
  ctx.strokeStyle = 'rgba(48, 32, 0, 0.9)'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(mk.x, cy - 7); ctx.lineTo(mk.x + 4.6, cy); ctx.lineTo(mk.x, cy + 7);
  ctx.strokeStyle = 'rgba(255, 250, 220, 0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
  if (p) {
    const metres = Math.max(1, Math.round(Math.hypot(mk.x - p.x, mk.y - p.y) * METRES_PER_PX));
    // Under the whole marker and clear of a car body standing on it, which is
    // 34 to 36 px long and so reaches 18 px either side of the point.
    drawDistance(ctx, mk.x, mk.y + 22, `${metres} m`);
  }
  ctx.restore();
  if (!onScreen(state, mk.x, mk.y, 0)) drawArrow(ctx, state, mk, MARK_GOLD);
}

// A small pill under the diamond, so the number stays legible on sand or paint.
function drawDistance(ctx, x, y, text) {
  ctx.save();
  ctx.font = '700 11px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 12;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = 'rgba(9, 12, 17, 0.78)';
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + 4, y);
  ctx.arcTo(x + w / 2, y, x + w / 2, y + 16, 4);
  ctx.arcTo(x + w / 2, y + 16, x - w / 2, y + 16, 4);
  ctx.arcTo(x - w / 2, y + 16, x - w / 2, y, 4);
  ctx.arcTo(x - w / 2, y, x + w / 2, y, 4);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = MARK_GOLD;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 8.5);
  ctx.restore();
}

// A chevron on the canvas edge pointing at a marker that is out of view.
function drawArrow(ctx, state, mk, colour) {
  const cam = state.camera || { x: 0, y: 0 };
  const w = (state.canvas && state.canvas.w) || 1280, h = (state.canvas && state.canvas.h) || 720;
  const sx = mk.x - cam.x, sy = mk.y - cam.y, inset = 42;
  const x = Math.min(w - inset, Math.max(inset, sx)), y = Math.min(h - inset, Math.max(inset, sy));
  ctx.save();
  ctx.translate(cam.x + x, cam.y + y);
  ctx.rotate(Math.atan2(sy - h / 2, sx - w / 2));
  ctx.globalAlpha = 0.9; ctx.fillStyle = colour;
  ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-9, 7); ctx.lineTo(-9, -7);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawRivals(ctx, m, t) {
  for (const r of m.rivals) {
    if (!r) continue;
    const down = r.hp <= 0, bob = down ? 0 : Math.sin(t * 2 + r.x * 0.05) * 0.7;
    ctx.save();
    ctx.translate(r.x, r.y + bob);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(1, 3, down ? 12 : 8, down ? 7 : 5.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(down ? (r.angle || 0) + Math.PI / 2 : r.angle || 0);
    if (down) {
      ctx.fillStyle = '#4a2626'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = '#2a1a1a'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-1, -3); ctx.lineTo(4, -3.6); ctx.moveTo(-1, 3); ctx.lineTo(4, 3.6); ctx.stroke();
      ctx.fillStyle = '#5c2b2b'; ctx.beginPath(); ctx.arc(0, 0, 6.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PALETTE.skins[2]; ctx.beginPath(); ctx.arc(2.4, 0, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#22262c'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(2, 3.2); ctx.lineTo(9.5, 2.6); ctx.stroke();
    }
    ctx.restore();
    if (down) continue;
    const k = Math.max(0, Math.min(1, r.hp / (r.maxHp || RIVAL_HP)));
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(r.x - 11, r.y - 17, 22, 3);
    ctx.fillStyle = '#d9453c'; ctx.fillRect(r.x - 11, r.y - 17, 22 * k, 3);
  }
}

function drawBriefcase(ctx, b, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.4);
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.fillStyle = `rgba(255,214,120,${(0.08 + pulse * 0.12).toFixed(3)})`;
  ctx.beginPath(); ctx.arc(0, 0, 26 + pulse * 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(1, 6, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a2b1c'; ctx.fillRect(-11, -7, 22, 14);
  ctx.fillStyle = '#d8b13a'; ctx.fillRect(-11, -1.6, 22, 2); ctx.fillRect(-3.4, -3.4, 6.8, 4.6);
  ctx.strokeStyle = '#221911'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, -8.4, 3.6, Math.PI, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function wrap(text, max) {
  const lines = []; let line = '';
  for (const word of String(text || '').split(' ')) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= max) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function panel(ctx, x, y, w, h) {
  ctx.beginPath(); ctx.moveTo(x + 10, y);
  ctx.arcTo(x + w, y, x + w, y + h, 10); ctx.arcTo(x + w, y + h, x, y + h, 10);
  ctx.arcTo(x, y + h, x, y, 10); ctx.arcTo(x, y, x + w, y, 10);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,14,20,0.88)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,120,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
}

// Fades in over the third of a second after it opens and out over the last
// 0.6 s. The fade in is measured from the open, never from the remaining time,
// so a card held open for a posed scene stays fully drawn.
function cardAlpha(t, start, until) {
  const left = until - t;
  const shown = t - (start == null ? until - BRIEF_TIME : start);
  return Math.min(1, Math.max(0, left) / 0.6, Math.max(0, Math.min(1, shown / 0.35)));
}

function drawBriefing(ctx, state, m, t) {
  const cam = state.camera || { x: 0, y: 0 }, w = (state.canvas && state.canvas.w) || 1280;
  const b = m.briefing, x = Math.round((w - 560) / 2), y = 92, ch = 178, colour = COLOURS[b.kind] || PALETTE.neon[2];
  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.globalAlpha = cardAlpha(t, m.briefingStart, m.briefingUntil);
  panel(ctx, x, y, 560, ch);
  ctx.fillStyle = colour; ctx.fillRect(x + 1, y + 12, 4, ch - 24);
  ctx.font = '700 12px system-ui, sans-serif'; ctx.fillText(`JOB ${b.job} OF ${JOBS}`, x + 22, y + 30);
  ctx.font = '700 24px system-ui, sans-serif'; ctx.fillStyle = '#f4efe2';
  ctx.fillText(b.title, x + 22, y + 58);
  ctx.font = '600 15px system-ui, sans-serif'; ctx.fillStyle = '#dcd6c6';
  ctx.fillText(b.objective, x + 22, y + 84);
  ctx.font = '400 13px system-ui, sans-serif'; ctx.fillStyle = '#9aa3ae';
  b.lines.forEach((line, i) => ctx.fillText(line, x + 22, y + 108 + i * 18));
  ctx.font = 'italic 13px system-ui, sans-serif'; ctx.fillStyle = '#ffd786';
  ctx.fillText(`"${b.line}"`, x + 22, y + 158);
  ctx.font = '700 18px system-ui, sans-serif'; ctx.fillStyle = '#9be0a8';
  ctx.textAlign = 'right';
  ctx.fillText(`+$${b.reward}`, x + 538, y + 58);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawFinale(ctx, state, m, t) {
  const cam = state.camera || { x: 0, y: 0 }, w = (state.canvas && state.canvas.w) || 1280;
  const x = Math.round((w - 520) / 2), y = 112, paid = m.stages.reduce((sum, s) => sum + (s.reward || 0), 0);
  ctx.save(); ctx.translate(cam.x, cam.y);
  ctx.globalAlpha = cardAlpha(t, m.finaleStart, m.finaleUntil);
  panel(ctx, x, y, 520, 136);
  ctx.font = '700 12px system-ui, sans-serif'; ctx.fillStyle = PALETTE.neon[2];
  ctx.fillText('FINALE', x + 22, y + 30);
  ctx.font = '700 22px system-ui, sans-serif'; ctx.fillStyle = '#f4efe2';
  ctx.fillText(`All four jobs done  +$${paid}`, x + 22, y + 60);
  ctx.font = '400 13px system-ui, sans-serif'; ctx.fillStyle = '#9aa3ae';
  wrap(m.finale, 58).slice(0, 3).forEach((line, i) => ctx.fillText(line, x + 22, y + 84 + i * 18));
  ctx.restore();
}
