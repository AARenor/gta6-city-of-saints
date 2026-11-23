// City of Saints: the boot, the input and the one loop.
//
// buildState() makes the single shared state object from the module contract,
// then calls each create in the order the data needs: world, player, camera,
// traffic and pedestrians (both place themselves around the player), the four
// jobs, the menu and the audio.
//
// The loop is a fixed 1/60 s accumulator with one draw per frame. A step runs
// menu, missions, traffic, pedestrians, combat, police, player. Particles age
// inside combat and the camera follows inside player, so neither has a call of
// its own. state.events lives for one frame: the modules read it while they
// run, the HUD and the audio read it after the draw, and the frame ends by
// emptying it.
//
// Every world module draws in world pixels, so the camera is applied once with
// translate() and the HUD, minimap and menu draw after restore() in screen
// pixels. drawMissions() translates back by the camera for its briefing card,
// which is why it is called inside the translated block.
//
// ?scene=chase|onfoot|mission|night builds the same state and then poses it
// through state only, never by faking a draw: chase is the central avenue at
// 330 px/s with three cruisers behind and a marker ahead, onfoot is a pavement
// above the beach with road, blocks, sand and sea in one frame, mission parks
// the car beside the job marker with the briefing card held open, and night
// drives the coast road at dayPhase 0.92 with one star. ?seed=<n> reseeds the
// city.
//
// Exports: none.

import { PALETTE } from './world/palette.js';
import { createWorld, drawWorld, isRoad } from './world/city.js';
import { createTraffic, updateTraffic, drawTraffic } from './world/traffic.js';
import { createPedestrians, updatePedestrians, drawPedestrians } from './world/pedestrians.js';
import { createPlayer, updatePlayer, drawPlayer } from './entities/player.js';
import { updatePolice, drawPolice } from './entities/police.js';
import { updateCombat, drawCombat } from './gameplay/combat.js';
import { createMissions, updateMissions, drawMissions, openBriefing } from './gameplay/missions.js';
import { drawHud } from './ui/hud.js';
import { drawMinimap } from './ui/minimap.js';
import { createMenu, updateMenu, drawMenu } from './ui/menu.js';
import { createAudio, updateAudio } from './audio/sfx.js';

const W = 1280, H = 720;
const STEP = 1 / 60, MAX_STEPS = 5, MAX_FRAME = 0.25;
const DAY_SECONDS = 900;            // one full day and night in fifteen minutes
const SEED = 20261123;
const PITCH = 320;                  // road grid, used to keep scene cars on lanes

// 0 at midday, 1 at midnight, the same curve palette.js uses for its tones.
function nightAmount(dayPhase) {
  const p = ((dayPhase || 0) % 1 + 1) % 1;
  const light = 0.5 + 0.5 * Math.cos((p - 0.4) * Math.PI * 2);
  return 1 - Math.min(1, Math.max(0, (light - 0.15) / 0.75));
}

let canvas = null;
let ctx = null;
let state = null;

// mulberry32: small, fast, and identical on every load, so screenshots repeat.
function seeded(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function centreCamera(s) {
  const p = s.player, size = s.world.size;
  s.camera.x = Math.min(Math.max(0, p.x - W / 2), size - W);
  s.camera.y = Math.min(Math.max(0, p.y - H / 2), size - H);
}

function buildState(seed) {
  const s = {
    t: 0, dt: STEP, dayPhase: 0.34, rng: seeded(seed),
    canvas: { w: W, h: H },
    input: { keys: new Set(), pressed: new Set(), mouse: { x: W / 2, y: H / 2, down: false, clicked: false } },
    camera: { x: 0, y: 0 },
    world: null, player: null, cars: [], peds: [], police: [], bullets: [], particles: [], pickups: [],
    mission: null, wanted: 0, hud: { message: '', messageUntil: 0, cashFlashUntil: 0 },
    flags: { started: false, paused: false, dead: false, savedAt: 0 },
    events: [],
    stats: { kills: 0, carsStolen: 0, missionsDone: 0, distance: 0 },
  };
  s.world = createWorld(s.rng);
  s.player = createPlayer(s);
  centreCamera(s);
  createTraffic(s, 60);
  createPedestrians(s, 90);
  createMissions(s);
  createMenu(s);
  createAudio(s);
  return s;
}

// ---------------------------------------------------------------- scenes

// Puts a car on the lane it is standing in, so traffic code can drive it on.
function lanePlace(car, x, y, angle, speed) {
  const vertical = ((x % PITCH) + PITCH) % PITCH < 96;
  car.x = x; car.y = y; car.angle = angle;
  car.axis = vertical ? 'v' : 'h';
  car.dir = vertical ? (Math.sin(angle) >= 0 ? 1 : -1) : (Math.cos(angle) >= 0 ? 1 : -1);
  car.road = Math.floor((vertical ? x : y) / PITCH);
  car.turn = null; car.plan = 0; car.planKey = ''; car.bump = 0; car.stuck = 0;
  car.vx = Math.cos(angle) * speed;
  car.vy = Math.sin(angle) * speed;
  car.speed = speed;
  car.markX = x; car.markY = y;
  return car;
}

// Hands an npc car to the player, never the one the current job is about.
function takeCar(s, x, y, angle, speed) {
  const p = s.player, named = s.mission && s.mission.car;
  let car = null;
  for (const c of s.cars) if (c.driver === 'npc' && c !== named) { car = c; break; }
  if (!car) {
    car = { id: s.cars.length + 1, x, y, angle, speed, len: 34, wid: 16,
      colour: PALETTE.cars[1], driver: 'npc', hp: 100, cruise: 200,
      axis: 'v', dir: 1, road: 0, turn: null, plan: 0, planKey: '', bump: 0, stuck: 0,
      markX: x, markY: y };
    s.cars.push(car);
  }
  lanePlace(car, x, y, angle, speed);
  car.driver = 'player';
  car.hp = 100;
  p.car = car; p.onFoot = false;
  p.x = x; p.y = y; p.angle = angle; p.speed = speed;
  return car;
}

// A police unit in the shape police.js, hud.js, minimap.js and combat.js read.
function cruiser(x, y, angle, speed) {
  return { kind: 'cruiser', x, y, angle, speed, hp: 100, maxHp: 100,
    cool: 0.4, muzzle: 0, flash: 0, walk: 0, sees: true, sightT: 0.1,
    plan: 0, axis: null, decide: 0, jam: 0, fade: 0 };
}

// Poses the job on a stage whose marker is a fixed point, so the diamond stays
// where the scene put it instead of riding a car that traffic then drives away.
// The escape stage ignores its marker in updateMissions; armed keeps it from
// pushing a pursuit the scene did not ask for.
function pinStage(s, kind, marker) {
  const m = s.mission;
  if (!m || !Array.isArray(m.stages)) return;
  const found = m.stages.findIndex((q) => q.kind === kind);
  const stage = m.stages[found < 0 ? m.index : found];
  if (!stage) return;
  if (found >= 0) m.index = found;
  m.stage = stage; m.rivals = []; m.briefcase = null; m.car = null;
  stage.marker = { x: marker.x, y: marker.y };
  stage.armed = true; stage.calm = 0;
}

// Queued traffic stops a scene car dead, and a crossing car at an intersection
// does it too, so every npc car inside the chase corridor is moved to the far
// end of its own lane and drives back in from there.
function clearBox(s, x0, y0, x1, y1) {
  for (const car of s.cars) {
    if (car.driver !== 'npc') continue;
    if (car.x < x0 || car.x > x1 || car.y < y0 || car.y > y1) continue;
    if (car.axis === 'v') car.y = 160; else car.x = 160;
    car.markX = car.x; car.markY = car.y;
    car.speed = 0; car.turn = null; car.plan = 0;
  }
}

function sceneChase(s) {
  s.dayPhase = 0.32;
  // The central avenue: road line 5, southbound lane, so the shot has a whole
  // block of city ahead and the middle of the road under the car.
  const x = 5 * PITCH + 24, y = 1460;
  // Wide enough that no car can drive back into the corridor within a frame's
  // worth of screenshots: the nearest cross street traffic is 700 px away.
  clearBox(s, x - 700, y - 260, x + 700, y + 1320);
  takeCar(s, x, y, Math.PI / 2, 330);
  // Frame him centred, held inside the world bounds.
  const size = s.world.size;
  s.camera.x = Math.min(Math.max(0, s.player.x - 640), size - W);
  s.camera.y = Math.min(Math.max(0, s.player.y - 420), size - H);
  s.wanted = 3;
  pinStage(s, 'escape', { x, y: y + 320 });
  if (s.mission) s.mission.briefing = null;
  // The camera sits ahead of the car instead of trailing it, so he rides the
  // bottom of the frame and the pursuit fills the open band under the HUD
  // rather than running out of the top of the shot.
  s.camera.carLead = -90;
  // Three cruisers 95, 140 and 185 px behind, each on its own line of the road
  // so the formation reads as three cars and not one blur. Held by
  // holdFormation, because the unit AI brakes to a stop inside 180 px.
  for (const [dx, gap] of [[-22, 95], [22, 140], [0, 185]]) {
    const unit = cruiser(x + dx, y - gap, Math.PI / 2, 330);
    unit.pin = { dx, dy: -gap };
    s.police.push(unit);
  }
}

// Where pedestrians.js pointOn() puts a walker: distance t clockwise round the
// block kerb, lane px in from it, with the angle that walking direction faces.
// The scene uses it so a posed walker keeps walking from where it was put.
function kerbPoint(b, t, lane) {
  const w = b.w;
  if (t < w) return { x: b.x + t, y: b.y + lane, a: 0 };
  if (t < w + b.h) return { x: b.x + w - lane, y: b.y + (t - w), a: Math.PI / 2 };
  if (t < 2 * w + b.h) return { x: b.x + w - (t - w - b.h), y: b.y + b.h - lane, a: Math.PI };
  return { x: b.x + lane, y: b.y + b.h - (t - 2 * w - b.h), a: -Math.PI / 2 };
}

function sceneOnFoot(s) {
  s.dayPhase = 0.5;
  const p = s.player;
  // The south-west corner of block i10 j5, the last block column inland from the
  // beach: the coast road junction is at his feet, so the frame carries the two
  // zebras, buildings on the block behind him and across that road, and the sand
  // and sea past the block on the right. 18 px in from each kerb puts him on the
  // pavement, clear of the building line 4 px further in.
  const b = (s.world.blocks || []).find((q) => q.i === 10 && q.j === 5);
  p.car = null; p.onFoot = true;
  p.angle = Math.PI; p.speed = 0; p.walk = 0;
  if (b) {
    p.x = b.x + 18;
    p.y = b.y + b.h - 18;
  } else {
    p.x = 3314; p.y = 1902;
  }
  s.wanted = 0;
  if (s.mission) s.mission.briefing = null;
  if (!b) return;
  // Six walkers on his own kerb, three along the south edge and three up the
  // west one, every one of them within 120 px of him. Each walks away from the
  // corner rather than through the man, and slowly, so the pose still holds a
  // couple of seconds after load instead of walking out of the frame.
  const crowd = [[624, 7, -1], [598, 5, -1], [578, 8, -1], [716, 5, 1], [744, 8, 1], [770, 9, 1]];
  for (let i = 0; i < crowd.length; i += 1) {
    const ped = s.peds[i];
    if (!ped) break;
    const [t, lane, dir] = crowd[i];
    const spot = kerbPoint(b, t, lane);
    ped.block = b; ped.s = t; ped.lane = lane; ped.dir = dir;
    ped.crossing = null; ped.flee = 0; ped.panic = null;
    ped.speed = 12 + (i % 3) * 2;
    ped.x = spot.x; ped.y = spot.y; ped.angle = spot.a + (dir > 0 ? 0 : Math.PI);
  }
  // Three traffic cars on the two roads beside him, each on the right-hand lane
  // of its direction: one southbound on the coast road waiting at the light, one
  // eastbound crawling up to the crossing and one westbound leaving it, so both
  // arms of the junction carry traffic in the shot. Lane offsets follow
  // traffic.js laneX/laneY: 24 px from the kerb for dir 1 on a vertical road and
  // 72 for the same dir on a horizontal one.
  const lanes = [
    [10 * PITCH + 24, 1830, Math.PI / 2, 130],
    [3120, 6 * PITCH + 72, 0, 30],
    [3440, 6 * PITCH + 24, Math.PI, 70],
  ];
  let placed = 0;
  for (const car of s.cars) {
    if (placed >= lanes.length) break;
    if (car.driver !== 'npc' || (s.mission && car === s.mission.car)) continue;
    const [x, y, angle, speed] = lanes[placed];
    lanePlace(car, x, y, angle, speed);
    car.cruise = speed;
    placed += 1;
  }
  // The shot has to hold even if a spawn or a mission car landed inside those
  // lanes: four walkers stay within 140 px of him and two cars stay on the road
  // within 260 px, both by moving entries that are already in state rather than
  // by adding any.
  const near = (o, r) => Math.hypot(o.x - p.x, o.y - p.y) <= r;
  // the corner itself: two spots on the pavement behind him and two on the kerb
  // he stands beside, each one 10 to 45 px away and clear of the crowd above
  const spare = [[660, 6, 1], [648, 10, 1], [700, 12, 1], [734, 12, 1]];
  const close = s.peds.reduce((n, q) => n + (q && near(q, 140) ? 1 : 0), 0);
  // All four go down when the fixed pose missed, because a walker that happens
  // to start 135 px out is not a promise: these four are placed 10 to 45 px away
  // and slow, so they still hold the frame a few seconds after load.
  if (close < 4) {
    for (let i = 0; i < spare.length; i += 1) {
      const ped = s.peds[i];
      if (!ped) break;
      const [t, lane, dir] = spare[i];
      const spot = kerbPoint(b, t, lane);
      ped.block = b; ped.s = t; ped.lane = lane; ped.dir = dir;
      ped.crossing = null; ped.flee = 0; ped.panic = null;
      ped.speed = 12 + (i % 3) * 2;
      ped.x = spot.x; ped.y = spot.y; ped.angle = spot.a + (dir > 0 ? 0 : Math.PI);
    }
  }
  // Empty lanes either side of the junction, on the correct side for their
  // direction and slow enough, and pointed in far enough, to still be in frame
  // after a few seconds: 24 px from the kerb is dir 1 on a vertical road, 72 is
  // dir -1, and 72 is dir 1 on a horizontal one.
  const more = [
    [10 * PITCH + 24, 1740, Math.PI / 2, 35],
    [10 * PITCH + 72, 2100, -Math.PI / 2, 35],
    [3180, 6 * PITCH + 72, 0, 30],
  ];
  const rolling = () => s.cars.reduce((n, car) => n + (car.driver === 'npc'
    && !(s.mission && car === s.mission.car)
    && isRoad(s.world, car.x, car.y) && near(car, 260) ? 1 : 0), 0);
  let next = 0;
  for (const car of s.cars) {
    if (next >= more.length || rolling() >= 2) break;
    if (car.driver !== 'npc' || (s.mission && car === s.mission.car)) continue;
    if (isRoad(s.world, car.x, car.y) && near(car, 260)) continue;
    const [x, y, angle, speed] = more[next];
    lanePlace(car, x, y, angle, speed);
    car.cruise = speed;
    next += 1;
  }
}

function sceneMission(s) {
  s.dayPhase = 0.4;
  const p = s.player, m = s.mission, car = m && m.car;
  p.car = null; p.onFoot = true; p.angle = Math.PI; p.speed = 0; p.walk = 0;
  // A pavement kerb with the job's car parked in the lane beside it, and the
  // marker riding that car, which is where watchSteal puts it anyway.
  const kerb = { x: 2024, y: 2120 }, lane = { x: 1944, y: 2120 };
  p.x = kerb.x; p.y = kerb.y;
  if (car) {
    lanePlace(car, lane.x, lane.y, Math.PI / 2, 0);
    car.cruise = 0; car.speed = 0; car.vx = 0; car.vy = 0; car.turn = null;
    if (m.stage) m.stage.marker = { x: lane.x, y: lane.y };
  } else if (m && m.stage) {
    m.stage.marker = { x: lane.x, y: lane.y };
  }
  if (m && m.stage) {
    openBriefing(s, m);
    m.briefingUntil = (s.t || 0) + 600;      // the card is the point of the shot
  }
}

function sceneNight(s) {
  s.dayPhase = 0.92;
  // The coast road, southbound: the sea stays on the right of the frame, the
  // city on the left, and one cruiser holds its lights behind.
  const x = 10 * PITCH + 24, y = 1460;
  clearBox(s, x - 600, y - 200, x + 600, y + 1200);
  takeCar(s, x, y, Math.PI / 2, 250);
  s.wanted = 1;
  // The escape stage, pinned, so the shot carries a waypoint instead of the
  // steal stage hinting at the player that this is the wrong car every 4 s.
  pinStage(s, 'escape', { x, y: y + 300 });
  if (s.mission) s.mission.briefing = null;
  s.police.push(cruiser(x, y - 150, Math.PI / 2, 260));
}

const SCENES = { chase: sceneChase, onfoot: sceneOnFoot, mission: sceneMission, night: sceneNight };

// A scene can pin a unit to an offset from the player's car. The unit AI stops
// dead inside 180 px of the player, so a pinned unit is put back on its mark
// after the police update: that is what keeps a posed formation posed.
function holdFormation(s) {
  const car = s.player && s.player.car;
  if (!car) return;
  for (const unit of s.police) {
    if (!unit.pin) continue;
    unit.x = car.x + unit.pin.dx;
    unit.y = car.y + unit.pin.dy;
    unit.angle = car.angle;
    unit.speed = car.speed || 0;
    unit.jam = 0;
  }
}

function poseScene(s, name) {
  const scene = SCENES[name];
  if (!scene) return false;
  s.flags.started = true;
  s.flags.paused = false;
  scene(s);
  centreCamera(s);
  return true;
}

// ---------------------------------------------------------------- input

function keyName(event) {
  const k = typeof event.key === 'string' ? event.key : '';
  return k.toLowerCase() === 'spacebar' ? ' ' : k.toLowerCase();
}

function trackMouse(event) {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width ? canvas.width / rect.width : 1;
  const sy = rect.height ? canvas.height / rect.height : 1;
  const m = state.input.mouse;
  m.x = (event.clientX - rect.left) * sx;
  m.y = (event.clientY - rect.top) * sy;
}

function wireInput() {
  const input = state.input;
  const swallow = new Set([' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const name = keyName(event);
    if (!name) return;
    if (swallow.has(name)) event.preventDefault();
    input.keys.add(name);
    if (!event.repeat) input.pressed.add(name);
  });

  window.addEventListener('keyup', (event) => {
    const name = keyName(event);
    if (!name) return;
    if (swallow.has(name)) event.preventDefault();
    input.keys.delete(name);
  });

  // A window that loses focus never sends the keyups, so drop the held keys.
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.pressed.clear();
    input.mouse.down = false;
  });

  window.addEventListener('mousemove', trackMouse);
  window.addEventListener('mousedown', (event) => {
    trackMouse(event);
    if (event.button === 0) input.mouse.down = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) input.mouse.down = false;
  });
  window.addEventListener('click', (event) => {
    trackMouse(event);
    input.mouse.clicked = true;
  });
  window.addEventListener('contextmenu', (event) => {
    if (event.target === canvas) event.preventDefault();
  });
}

// ---------------------------------------------------------------- loop

function step() {
  const s = state;
  updateMenu(s, s.dt);
  if (s.flags.paused) return;
  s.t += s.dt;
  s.dayPhase = (s.dayPhase + s.dt / DAY_SECONDS) % 1;
  updateMissions(s, s.dt);
  updateTraffic(s, s.dt);
  updatePedestrians(s, s.dt);
  updateCombat(s, s.dt);
  updatePolice(s, s.dt);
  updatePlayer(s, s.dt);
  holdFormation(s);
}

function draw() {
  const s = state;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = PALETTE.asphalt;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(-s.camera.x, -s.camera.y);
  drawWorld(ctx, s);
  drawTraffic(ctx, s);
  drawPedestrians(ctx, s);
  drawPolice(ctx, s);
  drawPlayer(ctx, s);
  drawMissions(ctx, s);
  // combat owns cash drops, tracers, blood, sparks and the muzzle flash in one
  // export, so its pickups land on this layer rather than under the traffic.
  drawCombat(ctx, s);
  ctx.restore();

  // Night is one even blue-black wash over the finished frame, at 35 percent at
  // midnight, so every layer dims by the same amount and nothing is left as a
  // warm patch: the lit windows and the lamp pools stay the only warm light.
  const night = nightAmount(s.dayPhase);
  if (night > 0.02) {
    ctx.fillStyle = `rgba(9, 15, 38, ${(0.35 * night).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }

  drawHud(ctx, s);
  drawMinimap(ctx, s);
  drawMenu(ctx, s);
}

// One animation frame: advance the fixed accumulator, draw once, retire events.
function frame(now) {
  const dt = Math.min(MAX_FRAME, Math.max(0, (now - frame.last) / 1000));
  frame.last = now;
  frame.acc += dt;
  let steps = 0;
  while (frame.acc >= STEP && steps < MAX_STEPS) {
    step();
    // A tap is one action: the first step of a catch-up burst consumes it.
    state.input.pressed.clear();
    state.input.mouse.clicked = false;
    frame.acc -= STEP;
    steps += 1;
  }
  if (steps >= MAX_STEPS) frame.acc = 0;
  draw();
  updateAudio(state, dt);
  state.events.length = 0;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot

function boot() {
  canvas = document.getElementById('game');
  if (!canvas) throw new Error('City of Saints: canvas#game is missing');
  ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('City of Saints: no 2d context on canvas#game');

  const params = new URLSearchParams(window.location.search);
  const seed = Number.parseInt(params.get('seed') || '', 10);
  state = buildState(Number.isFinite(seed) ? seed : SEED);
  if (params.get('scene')) poseScene(state, String(params.get('scene')));

  wireInput();
  window.game = state;

  frame.last = performance.now();
  frame.acc = 0;
  requestAnimationFrame(frame);
}

boot();
