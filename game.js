// game.js — Alt Life playable prototype: Neon District + Del Mar Beach + Vinewood Hills (Canvas2D).
// GTA-structured open world: districts + traffic/ped graphs + crime/wanted + weapons +
// mission chain + vehicle variety + weather + BlackSpace nods (dynamic sun/moon lighting,
// wind field shared with foliage, reactive mist, cloud shadows, wet reflections).
// Controls: WASD/arrows move/drive, MOUSE aim + CLICK shoot (on foot, with pistol),
// SHIFT sprint, E enter-exit car, SPACE handbrake (car) / shove (foot), R reset, P pause.
// Controls: WASD/arrows move/drive, SHIFT sprint/boost, E enter-exit car,
// SPACE handbrake (car) / shove (foot), R respawn, P pause. Touch buttons included.
(function () {
  'use strict';

  // ---------------- utils (deterministic, no allocs in hot path) ----------------
  function hash(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function angLerp(a, b, t) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  // Shared wind field (same 3-layer recipe as WindManager.h / app.js demo).
  var windT = 0;
  function windAt(x, z) {
    var front = Math.sin(x * 0.012 + windT * 0.7) * Math.cos(z * 0.009 - windT * 0.5);
    var gust = front * 2.2;
    var turb = Math.sin((x + z) * 0.05 + windT * 1.7) * 0.8;
    var s = 1 + gust * 0.3 + turb * 0.3;
    return { x: 0.8 * s * 6, z: 0.6 * s * 6, gust: gust };
  }

  // ---------------- world gen (sectors, roads, blocks, buildings, trees) ----------------
  var WORLD = 3600, BLOCK = 300, ROAD = 72, SECTOR = 128;
  var NBLK = Math.floor(WORLD / BLOCK); // 12x12 blocks
  var buildings = []; // {x,y,w,h,base:[r,g,b],seed,tall,neon,house,ware}
  var trees = [];     // {x,y,phase,s,palm}
  var roadLines = []; // for minimap: grid lines
  var canal = { x: WORLD * 0.5 - 40, w: 80 }; // vertical water canal
  var SAND_W = 200, WATER_X = WORLD - 140; // Del Mar beach: sand strip, then open ocean
  var dropOff = { x: WORLD * 0.5, y: 120 };
  var station = { x: WORLD * 0.5, y: WORLD - 140 }; // police station / respawn
  var gunSpots = [];  // {x,y,taken}
  var clouds = [];    // {x,y,rx,spd} drifting shadow blobs
  var stars = [];     // {fx,fy,r,tw} screen-space night sky
  var landmarks = []; // {x,y,label}
  var NEON = ['#ff2d95', '#00e5ff', '#b6ff00', '#ffae00', '#c26bff'];

  function districtAt(x, y) {
    if (x > WORLD - 460) return 'Del Mar Beach';
    var gx = Math.floor(x / BLOCK), gy = Math.floor(y / BLOCK);
    if (gx >= 4 && gx <= 7 && gy >= 4 && gy <= 7) return 'Downtown';
    if (gy >= 10) return 'Harbor Industrial';
    if (gx < 4 && gy < 4) return 'Vinewood Hills';
    return 'Suburbs';
  }
  function inWater(x) { return x > WATER_X; }

  function isRoad(x, y) {
    var bx = x % BLOCK, by = y % BLOCK;
    if (bx < 0) bx += BLOCK; if (by < 0) by += BLOCK;
    return bx < ROAD || by < ROAD;
  }
  function inCanal(x) { return Math.abs(x - canal.x) < canal.w / 2; }
  function collideBuilding(x, y, r) {
    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      var cx = clamp(x, b.x, b.x + b.w), cy = clamp(y, b.y, b.y + b.h);
      if (dist2(x, y, cx, cy) < r * r) return b;
    }
    return null;
  }
  function slideMove(e, nx, ny, r) {
    if (!collideBuilding(nx, e.y, r)) e.x = nx;
    if (!collideBuilding(e.x, ny, r)) e.y = ny;
    e.x = clamp(e.x, 20, WORLD - 20); e.y = clamp(e.y, 20, WORLD - 20);
    if (inCanal(e.x) && !e.swims) { // canal blocks cars/peds; player wades slowly
      if (e.kind === 'car') { e.x -= (nx - e.x); }
    }
  }

  function slideMove(e, nx, ny, r) {
    var car = (e.kind === 'car');
    var blockedX = collideBuilding(nx, e.y, r) || (car && (inWater(nx) || inCanal(nx)));
    if (!blockedX) e.x = nx;
    var blockedY = collideBuilding(e.x, ny, r) || (car && (inWater(ny) || inCanal(ny)));
    if (!blockedY) e.y = ny;
    e.x = clamp(e.x, 20, WORLD - 20); e.y = clamp(e.y, 20, WORLD - 20);
  }

  function genWorld() {
    buildings.length = 0; trees.length = 0; roadLines.length = 0;
    gunSpots.length = 0; landmarks.length = 0;
    for (var gx = 0; gx < NBLK; gx++) for (var gy = 0; gy < NBLK; gy++) {
      var ox = gx * BLOCK + ROAD, oy = gy * BLOCK + ROAD;
      var iw = BLOCK - ROAD, ih = BLOCK - ROAD;
      var seed = gx * 73.7 + gy * 91.3;
      var cx = ox + iw / 2;
      // ---- beach blocks: sand + palms, no buildings ----
      if (cx > WORLD - 460) {
        for (var p = 0; p < 8; p++) {
          var px = ox + 20 + hash(seed + p * 3.3) * (iw - 40);
          var py = oy + 20 + hash(seed + p * 8.1) * (ih - 40);
          if (px < WATER_X - 12) trees.push({ x: px, y: py, phase: hash(p + seed) * 6.28, s: 0.9, palm: true });
        }
        continue;
      }
      var downtown = gx >= 4 && gx <= 7 && gy >= 4 && gy <= 7;
      var hills = gx < 4 && gy < 4;
      var harbor = gy >= 10;
      // ---- forest blocks (Vinewood Hills) ----
      if (hills && hash(seed) < 0.6) {
        for (var t = 0; t < 22; t++) {
          var tx = ox + 14 + hash(seed + t * 3.1) * (iw - 28);
          var ty = oy + 14 + hash(seed + t * 7.7) * (ih - 28);
          if (!inCanal(tx)) trees.push({ x: tx, y: ty, phase: hash(t + seed) * 6.28, s: 0.9 + hash(t * 1.7 + seed) * 1.1 });
        }
        continue;
      }
      // ---- park blocks ----
      if (!downtown && !harbor && hash(seed) < 0.16) {
        for (var q = 0; q < 14; q++) {
          var qx = ox + 20 + hash(seed + q * 3.1) * (iw - 40);
          var qy = oy + 20 + hash(seed + q * 7.7) * (ih - 40);
          if (!inCanal(qx)) trees.push({ x: qx, y: qy, phase: hash(q + seed) * 6.28, s: 0.7 + hash(q * 1.7 + seed) * 0.9 });
        }
        continue;
      }
      if (downtown) {
        // ---- downtown towers with neon ----
        var nt = 1 + Math.floor(hash(seed + 2.2) * 2); // 1-2 towers
        for (var b = 0; b < nt; b++) {
          var tw = 110 + hash(seed + b * 3) * 60, th = 130 + hash(seed + b * 7) * 50;
          var tx2 = ox + 14 + b * (iw - tw - 28);
          var ty2 = oy + 14 + hash(seed + b) * (ih - th - 28);
          if (inCanal(tx2 + tw / 2)) continue;
          buildings.push({ x: tx2, y: ty2, w: tw, h: th, base: [104, 116, 148], seed: seed + b * 5, tall: true, neon: NEON[Math.floor(hash(seed + b * 11) * NEON.length) % NEON.length] });
        }
      } else if (harbor) {
        // ---- warehouses ----
        var ww = iw - 40, wh = ih * 0.45;
        buildings.push({ x: ox + 20, y: oy + 16, w: ww, h: wh, base: [102, 102, 108], seed: seed, ware: true });
        buildings.push({ x: ox + 20, y: oy + 30 + wh, w: ww * 0.7, h: ih - wh - 48, base: [96, 98, 104], seed: seed + 9, ware: true });
      } else {
        // ---- suburb houses with lawns ----
        for (var h = 0; h < 4; h++) {
          var hw = 56 + hash(seed + h * 3) * 34, hh = 46 + hash(seed + h * 7) * 26;
          var hx = ox + 12 + (h % 2) * (iw / 2), hy = oy + 10 + Math.floor(h / 2) * (ih / 2);
          if (inCanal(hx + hw / 2)) continue;
          var pal = [[168, 132, 110], [150, 150, 140], [140, 160, 150], [170, 150, 120]];
          buildings.push({ x: hx, y: hy, w: hw, h: hh, base: pal[Math.floor(hash(seed + h) * 4) % 4], seed: seed + h * 5, house: true });
        }
      }
      // street trees (fewer downtown)
      var nst = downtown ? 2 : 4;
      for (var k = 0; k < nst; k++) {
        trees.push({ x: ox - 12, y: oy + 20 + k * (ih / nst), phase: hash(seed + k) * 6.28, s: 0.8 });
        trees.push({ x: ox + 20 + k * (iw / nst), y: oy - 12, phase: hash(seed + k + 9) * 6.28, s: 0.8 });
      }
    }
    // ---- landmarks ----
    var tox = 6 * BLOCK + ROAD, toy = 6 * BLOCK + ROAD; // downtown core block
    buildings.push({ x: tox + 40, y: toy + 28, w: 150, h: 172, base: [96, 110, 150], seed: 777, tall: true, neon: '#00e5ff' });
    landmarks.push({ x: tox + 115, y: toy + 190, label: 'MAZE TOWER' });
    landmarks.push({ x: WATER_X - 60, y: 8 * BLOCK + 150, label: 'DEL MAR PIER' });
    landmarks.push({ x: station.x, y: station.y - 44, label: 'POLICE' });
    // gun pickups: downtown alley road + beach near pier
    gunSpots.push({ x: 6 * BLOCK + ROAD / 2 + 8, y: 5 * BLOCK + 200, taken: false });
    gunSpots.push({ x: WATER_X - 120, y: 8 * BLOCK + 190, taken: false });
    // clouds + stars (fixed randoms)
    clouds.length = 0; stars.length = 0;
    for (var c = 0; c < 9; c++) clouds.push({ x: hash(c * 3.7) * WORLD, y: hash(c * 9.2) * WORLD, rx: 220 + hash(c) * 200, spd: 9 + hash(c * 2) * 9 });
    for (var st = 0; st < 110; st++) stars.push({ fx: hash(st * 1.3), fy: hash(st * 2.9), r: 0.6 + hash(st * 7) * 1.4, tw: hash(st * 3) * 6.28 });
    for (var i = 0; i <= NBLK; i++) roadLines.push(i * BLOCK + ROAD / 2);
  }

  // ---------------- state ----------------
  var player, cars, peds, cops, pickups, parts, mists, cashDrops, tracers;
  var cash = 0, delivered = 0, wanted = 0, heat = 0, hideT = 0, bustT = 0;
  var clock = 9.5; // 24h, starts morning (mist!)
  var running = true, msg = '', msgT = 0, bustedFlash = 0;
  var cam = { x: WORLD / 2, y: WORLD / 2 };
  var missionTarget = null;
  var weather = { mode: 'clear', t: 60, wet: 0, over: 0 }; // clear|clouds|rain|fog
  var mDone = [false, false, false], heatSeen = false; // mission chain
  var curDistrict = '';
  // Vehicle roster: GTA-style classes with distinct handling (accel/top/grip/cruise).
  var SPECS = {
    sedan:  { name: 'Sedan',  accel: 260, maxV: 420, grip: 1.7, cruise: 150 },
    taxi:   { name: 'Taxi',   accel: 280, maxV: 440, grip: 1.7, cruise: 155 },
    sports: { name: 'Sports', accel: 350, maxV: 530, grip: 2.0, cruise: 175 },
    truck:  { name: 'Truck',  accel: 175, maxV: 335, grip: 1.4, cruise: 118 }
  };

  function say(t) { msg = t; msgT = 4; }
  function addWanted(n, why) {
    if (n <= 0) return;
    heat = clamp(heat + n, 0, 3); wanted = Math.ceil(heat);
    hideT = 0;
    if (why) say(why + '  +' + n + '★');
  }

  function spawnPickups() {
    pickups = [];
    var placed = 0, guard = 0;
    while (placed < 4 && guard++ < 700) {
      var x = 100 + hash(guard * 1.37) * (WORLD - 700);
      var y = 100 + hash(guard * 2.91) * (WORLD - 200);
      if (isRoad(x, y) || collideBuilding(x, y, 20) || inCanal(x) || inWater(x)) continue;
      pickups.push({ x: x, y: y, taken: false, delivered: false });
      placed++;
    }
    missionTarget = pickups[0] || null;
  }

  function reset(full) {
    genWorld();
    // Spawn on a road (not inside a building): snap to the central vertical road.
    var roadC = Math.floor(NBLK / 2) * BLOCK + ROAD / 2;
    player = { kind: 'player', x: roadC + 8, y: roadC + 120, a: 0, v: 0, vx: 0, vy: 0, speed: 0, inCar: null, hp: 100, punchT: 0, swims: true, gun: false, mag: 0, reserve: 0, reloadT: 0, district: '' };
    cars = [];
    var roster = ['sedan', 'taxi', 'sports', 'sedan', 'truck', 'sports', 'taxi', 'sedan', 'sports', 'truck'];
    var cols = { sedan: ['#e74c3c', '#3498db', '#ecf0f1'], taxi: ['#f1c40f'], sports: ['#9b59b6', '#e67e22', '#1abc9c'], truck: ['#7f8c8d', '#5d6d7e'] };
    for (var i = 0; i < 10; i++) {
      var type = roster[i % roster.length];
      var spec = SPECS[type];
      var cx = 60 + hash(i * 3.3) * (WORLD - 700), cy = 60 + hash(i * 7.1) * (WORLD - 200);
      // snap to road
      cx = Math.floor(cx / BLOCK) * BLOCK + ROAD / 2; cy = clamp(cy, 60, WORLD - 60);
      var palette = cols[type];
      cars.push({ kind: 'car', x: cx, y: cy, a: (i % 2 ? 0 : Math.PI / 2), v: 0, color: palette[i % palette.length], spec: spec, hp: 100, wreck: false, driver: i < 6 ? 'traffic' : null, throttle: 0, wpA: (i % 2 ? 0 : 1), stopT: 0, surf: 1, bump: 0 });
    }
    peds = [];
    for (var j = 0; j < 18; j++) {
      var px = 100 + hash(j * 5.7) * (WORLD - 700), py = 100 + hash(j * 9.2) * (WORLD - 200);
      // Nudge out of buildings so peds never spawn stuck (slide to nearest road).
      var guard = 0;
      while (collideBuilding(px, py, 10) && guard++ < 40) px += 12;
      peds.push({ kind: 'ped', x: px, y: py, a: hash(j) * 6.28, speed: 30 + hash(j * 2) * 25, state: 'walk', t: hash(j) * 5, down: 0, flee: 0 });
    }
    cops = [
      { kind: 'car', x: station.x - 40, y: station.y, a: 0, v: 0, color: '#2c3eff', spec: SPECS.sedan, hp: 9999, wreck: false, driver: 'police', throttle: 0, wpA: 0, stopT: 0, surf: 1, bump: 0, police: true, cool: 0 },
      { kind: 'car', x: station.x + 40, y: station.y, a: 0, v: 0, color: '#2c3eff', spec: SPECS.sedan, hp: 9999, wreck: false, driver: 'police', throttle: 0, wpA: 1, stopT: 0, surf: 1, bump: 0, police: true, cool: 0 }
    ];
    parts = []; mists = []; cashDrops = []; tracers = [];
    for (var m = 0; m < 34; m++) mists.push({ x: hash(m * 1.9) * WORLD, y: hash(m * 4.4) * WORLD, r: 60 + hash(m) * 90, a: 0.10 });
    weather = { mode: 'clear', t: 75, wet: 0, over: 0 };
    if (full) { cash = 0; delivered = 0; wanted = 0; heat = 0; clock = 9.5; mDone = [false, false, false]; heatSeen = false; }
    curDistrict = '';
    spawnPickups();
    say(full ? 'ALT LIFE — grab a briefcase. New: pistols, missions, weather. Click to shoot.' : 'Reset. Stay frosty.');
  }

  // ---------------- input ----------------
  var keys = {};
  var mouse = { x: 0, y: 0, inside: false };
  function screenToWorld(mx, my) {
    if (!cv) return { x: cam.x, y: cam.y };
    var r = cv.getBoundingClientRect();
    var sx = (mx - r.left) / Math.max(1, r.width) * cv.width;
    var sy = (my - r.top) / Math.max(1, r.height) * cv.height;
    var vw = cv.width / 1.6, vh = cv.height / 1.6;
    return { x: cam.x - vw / 2 + sx / 1.6, y: cam.y - vh / 2 + sy / 1.6 };
  }
  function initInput(canvas, opts) {
    window.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k === ' ' ? ' ' : k) >= 0 || k === ' ') e.preventDefault();
      keys[k] = true;
      if (k === 'e') tryEnterExit();
      if (k === 'r') reset(false);
      if (k === 'p') { running = !running; opts.onPause(running); }
    });
    window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
    // touch buttons
    var map = { btnUp: 'w', btnDown: 's', btnLeft: 'a', btnRight: 'd', btnGo: 'e', btnBrake: ' ' };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var k = map[id];
      el.addEventListener('pointerdown', function (e) { e.preventDefault(); keys[k] = true; if (k === 'e') tryEnterExit(); });
      el.addEventListener('pointerup', function () { keys[k] = false; });
      el.addEventListener('pointerleave', function () { keys[k] = false; });
    });
    var pauseBtn = document.getElementById('gamePause');
    if (pauseBtn) pauseBtn.addEventListener('click', function () { running = !running; opts.onPause(running); });
    var resetBtn = document.getElementById('gameReset');
    if (resetBtn) resetBtn.addEventListener('click', function () { reset(false); });
    // mouse aim + shoot (twin-stick on foot)
    if (canvas) {
      canvas.addEventListener('mousemove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; });
      canvas.addEventListener('mouseleave', function () { mouse.inside = false; });
      canvas.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true;
        if (running && !player.inCar) fireBullet();
      });
    }
  }
  function input() {
    return {
      up: keys['w'] || keys['arrowup'], down: keys['s'] || keys['arrowdown'],
      left: keys['a'] || keys['arrowleft'], right: keys['d'] || keys['arrowright'],
      sprint: keys['shift'], brake: keys[' ']
    };
  }

  function nearestCar(x, y, maxD) {
    var best = null, bd = maxD * maxD;
    var all = cars.concat(cops);
    for (var i = 0; i < all.length; i++) {
      var d = dist2(x, y, all[i].x, all[i].y);
      if (d < bd) { bd = d; best = all[i]; }
    }
    return best;
  }
  function tryEnterExit() {
    if (!running) return;
    if (player.inCar) {
      var c = player.inCar; player.inCar = null;
      player.x = c.x + Math.cos(c.a + Math.PI / 2) * 26; player.y = c.y + Math.sin(c.a + Math.PI / 2) * 26;
      c.driver = null; c.v = 0;
      say('On foot. (E near a car to drive)');
    } else {
      var car = nearestCar(player.x, player.y, 46);
      if (car && !car.police && !car.wreck) {
        if (car.driver === 'traffic') {
          car.driver = null;
          var d = { kind: 'ped', x: car.x + 24, y: car.y, a: 0, speed: 90, state: 'flee', t: 0, down: 0, flee: 5 };
          peds.push(d);
          addWanted(1, 'Grand theft auto!');
        }
        player.inCar = car; car.driver = 'player';
        say('Whipping a ' + car.spec.name + '. HP ' + Math.max(0, Math.round(car.hp)) + '%');
      }
    }
  }

  // ---------------- combat (hitscan pistol, twin-stick aim) ----------------
  function pointLineDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len2 = dx * dx + dy * dy || 1;
    var t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
    return Math.sqrt(dist2(px, py, x1 + dx * t, y1 + dy * t));
  }
  function fireBullet() {
    if (!player.gun || player.reloadT > 0) return;
    if (player.mag <= 0) {
      if (player.reserve > 0) { player.reloadT = 0.9; say('Reloading…'); }
      else say('Out of ammo — find another pistol.');
      return;
    }
    player.mag--;
    var w = screenToWorld(mouse.x, mouse.y);
    var a = Math.atan2(w.y - player.y, w.x - player.x);
    player.a = a;
    var spread = (Math.random() - 0.5) * 0.06;
    a += spread;
    var range = 560;
    var ex = player.x + Math.cos(a) * range, ey = player.y + Math.sin(a) * range;
    // nearest building hit along stepped ray (cheap ray-march nod)
    var wallD = range;
    for (var s = 20; s < range; s += 20) {
      if (collideBuilding(player.x + Math.cos(a) * s, player.y + Math.sin(a) * s, 2)) { wallD = s; break; }
    }
    // targets: peds, then cars (traffic + police)
    var best = null, bestD = wallD, bestKind = '';
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (p.down > 0) continue;
      var d = pointLineDist(p.x, p.y, player.x, player.y, player.x + Math.cos(a) * wallD, player.y + Math.sin(a) * wallD);
      var along = (p.x - player.x) * Math.cos(a) + (p.y - player.y) * Math.sin(a);
      if (d < 12 && along > 0 && along < bestD) { bestD = along; best = p; bestKind = 'ped'; }
    }
    var all = cars.concat(cops);
    for (var k = 0; k < all.length; k++) {
      var c = all[k];
      if (c.wreck) continue;
      var dd = pointLineDist(c.x, c.y, player.x, player.y, player.x + Math.cos(a) * wallD, player.y + Math.sin(a) * wallD);
      var aa = (c.x - player.x) * Math.cos(a) + (c.y - player.y) * Math.sin(a);
      if (dd < 18 && aa > 0 && aa < bestD) { bestD = aa; best = c; bestKind = c.police ? 'cop' : 'car'; }
    }
    ex = player.x + Math.cos(a) * bestD; ey = player.y + Math.sin(a) * bestD;
    tracers.push({ x1: player.x, y1: player.y, x2: ex, y2: ey, life: 0.12, col: '#ffe9a8' });
    burst(player.x + Math.cos(a) * 14, player.y + Math.sin(a) * 14, 4, '#ffb400'); // muzzle
    addWanted(0.2, 'Shots fired!');
    if (bestKind === 'ped') {
      best.down = 8; best.state = 'walk';
      burst(best.x, best.y, 10, '#f00');
      cashDrops.push({ x: best.x, y: best.y, amt: 10 + Math.floor(hash(best.x + best.y) * 20) });
      addWanted(0.8, 'Shooting!');
    } else if (bestKind === 'car') {
      burst(ex, ey, 8, '#fd0');
      if (best.driver === 'traffic') {
        best.driver = null; best.v = 0;
        peds.push({ kind: 'ped', x: best.x + 24, y: best.y, a: 0, speed: 110, state: 'flee', t: 0, down: 0, flee: 6 });
        addWanted(0.6, 'You shot up a ride!');
      } else { best.hp -= 30; if (best.hp <= 0) wreckCar(best); }
    } else if (bestKind === 'cop') {
      burst(ex, ey, 10, '#fd0');
      addWanted(1, 'Cop under fire!');
    } else {
      burst(ex, ey, 5, '#aaa'); // wall chip
    }
  }
  function wreckCar(c) {
    c.wreck = true; c.v = 0;
    burst(c.x, c.y, 22, '#555');
    if (player.inCar === c) {
      player.inCar = null; c.driver = null;
      player.x = c.x + 26; player.y = c.y;
      say('Your ride is wrecked! Bail out on foot.');
    }
  }

  // ---------------- weather (clear/clouds/rain/fog cycle + wet roads) ----------------
  function updateWeather(dt) {
    weather.t -= dt;
    if (weather.t <= 0) {
      var r = hash(windT * 0.37 + clock * 7.1);
      weather.mode = r < 0.42 ? 'clear' : r < 0.66 ? 'clouds' : r < 0.86 ? 'rain' : 'fog';
      weather.t = 55 + hash(windT + clock) * 60;
    }
    var targetWet = weather.mode === 'rain' ? 1 : 0;
    weather.wet += clamp(targetWet - weather.wet, -dt * 0.05, dt * 0.25);
    var targetOver = (weather.mode === 'rain' || weather.mode === 'clouds') ? 1 : 0;
    weather.over += clamp(targetOver - weather.over, -dt * 0.2, dt * 0.2);
    // clouds drift with the wind
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      c.x += (10 + c.spd) * dt; c.y += 4 * dt;
      if (c.x - c.rx > WORLD) c.x = -c.rx; if (c.y > WORLD + 200) c.y = -200;
    }
  }

  // ---------------- crime/traffic AI ----------------
  function update(dt) {
    windT += dt;
    if (!running) return;
    var inp = input();
    clock = (clock + dt * (24 / 300)) % 24; // full day ~5 min
    if (msgT > 0) msgT -= dt;
    if (bustedFlash > 0) bustedFlash -= dt;
    updateWeather(dt);

    var focus = player.inCar || player;
    cam.x = lerp(cam.x, focus.x, 1 - Math.pow(0.001, dt));
    cam.y = lerp(cam.y, focus.y, 1 - Math.pow(0.001, dt));

    // district tracking (GTA-style welcome popups)
    var dz = districtAt(focus.x, focus.y);
    if (dz !== curDistrict) { curDistrict = dz; player.district = dz; if (msgT <= 0) say(dz); }

    // ---- player ----
    if (player.inCar) updatePlayerCar(dt, inp);
    else updatePlayerFoot(dt, inp);

    // ---- traffic ----
    for (var i = 0; i < cars.length; i++) if (cars[i].driver === 'traffic') updateTraffic(cars[i], dt);

    // ---- peds ----
    for (var p = 0; p < peds.length; p++) updatePed(peds[p], dt);

    // ---- police ----
    updateCops(dt);

    // ---- pickups / dropoff ----
    checkMission();

    // ---- particles / mist (reactive: pushed by focus velocity) ----
    for (var k = parts.length - 1; k >= 0; k--) {
      var q = parts[k]; q.life -= dt;
      if (q.life <= 0) { parts.splice(k, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.98; q.vy *= 0.98;
    }
    for (var tr = tracers.length - 1; tr >= 0; tr--) {
      tracers[tr].life -= dt;
      if (tracers[tr].life <= 0) tracers.splice(tr, 1);
    }
    // reload timer
    if (player.reloadT > 0) {
      player.reloadT -= dt;
      if (player.reloadT <= 0 && player.reserve > 0) {
        var need = 12 - player.mag, take = Math.min(need, player.reserve);
        player.mag += take; player.reserve -= take;
        say('Locked and loaded (' + player.mag + ' + ' + player.reserve + ').');
      }
    }
    // ambient leaves/dust riding the wind (cap for perf)
    if (parts.length < 130 && hash(windT * 13.7) < 0.25) {
      var w0 = windAt(focus.x, focus.y);
      parts.push({ x: focus.x + (hash(windT * 7) - 0.5) * 700, y: focus.y + (hash(windT * 3) - 0.5) * 500, vx: w0.x * 3, vy: w0.z * 3, life: 2.5, col: hash(windT) < 0.5 ? '#6a8f4f' : '#b8a05a' });
    }
    // rain streaks around the camera
    if (weather.mode === 'rain' && parts.length < 260) {
      for (var rd = 0; rd < 4; rd++) {
        parts.push({ x: focus.x + (hash(windT * 31 + rd) - 0.5) * 700, y: focus.y + (hash(windT * 17 + rd * 3) - 0.5) * 500, vx: -60, vy: 520, life: 0.5, col: '#9db6ff' });
      }
    }
    var w = windAt(focus.x, focus.y);
    for (var m = 0; m < mists.length; m++) {
      var mi = mists[m];
      mi.x += (w.x * 2 + Math.sin(windT + m) * 4) * dt;
      mi.y += (w.z * 2 + Math.cos(windT * 0.7 + m * 2) * 4) * dt;
      // entity displaces mist (volumetric reaction): carve a hole around player
      var d2 = dist2(mi.x, mi.y, focus.x, focus.y);
      if (d2 < 120 * 120) { var d = Math.sqrt(d2) || 1; mi.x += (mi.x - focus.x) / d * 60 * dt; mi.y += (mi.y - focus.y) / d * 60 * dt; }
      if (mi.x < 0) mi.x += WORLD; if (mi.x > WORLD) mi.x -= WORLD;
      if (mi.y < 0) mi.y += WORLD; if (mi.y > WORLD) mi.y -= WORLD;
    }

    // ---- wanted decay (hide when far from cops) ----
    if (heat > 0) {
      var seen = false;
      var all = cops;
      for (var c = 0; c < all.length; c++) {
        var cop = all[c];
        if (dist2(cop.x, cop.y, player.x, player.y) < 500 * 500) { seen = true; break; }
      }
      if (!seen) { hideT += dt; if (hideT > 8) { heat = Math.max(0, heat - dt * 0.4); wanted = Math.ceil(heat); if (heat === 0) say('Clean. Cops lost you.'); } }
      else hideT = 0;
    }
    // ---- mission stage 2: raise heat, then lose it ----
    if (mDone[0] && !mDone[1]) {
      if (wanted >= 1) heatSeen = true;
      if (heatSeen && wanted === 0) {
        mDone[1] = true; cash += 200;
        say('Heat dodged! +$200. New job: GETAWAY — deliver a package while driving.');
        burst(player.x, player.y, 20, '#7dff8a');
      }
    }
  }

  function updatePlayerFoot(dt, inp) {
    var sp = (inp.sprint ? 200 : 128);
    var mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    var my = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    // twin-stick: legs follow WASD, torso faces the mouse when armed
    var aimed = player.gun && mouse.inside;
    if (aimed) {
      var wa = screenToWorld(mouse.x, mouse.y);
      player.a = Math.atan2(wa.y - player.y, wa.x - player.x);
    } else if (mx || my) {
      player.a = Math.atan2(my, mx);
    }
    if (mx || my) {
      var l = Math.hypot(mx, my); mx /= l; my /= l;
      var nx = player.x + mx * sp * dt, ny = player.y + my * sp * dt;
      var slow = (inCanal(player.x) || inWater(player.x)) ? 0.45 : 1;
      nx = player.x + (nx - player.x) * slow; ny = player.y + (ny - player.y) * slow;
      slideMove(player, nx, ny, 10);
      player.speed = sp * slow;
    } else player.speed = 0;
    if (inp.brake && player.punchT <= 0) {
      player.punchT = 0.5;
      burst(player.x + Math.cos(player.a) * 16, player.y + Math.sin(player.a) * 16, 6, '#fff');
      for (var i = 0; i < peds.length; i++) {
        var p = peds[i];
        if (dist2(p.x, p.y, player.x, player.y) < 40 * 40 && !p.down) { p.state = 'flee'; p.flee = 4; addWanted(0.4, 'Assault!'); }
      }
    }
    if (player.punchT > 0) player.punchT -= dt;
    // gun pickups (pistol + ammo)
    for (var gi = 0; gi < gunSpots.length; gi++) {
      var gs = gunSpots[gi];
      if (!gs.taken && dist2(player.x, player.y, gs.x, gs.y) < 30 * 30) {
        gs.taken = true; player.gun = true; player.mag = 12; player.reserve += 48;
        say('Pistol acquired — aim with MOUSE, CLICK to fire. (' + player.mag + ' + ' + player.reserve + ')');
        burst(gs.x, gs.y, 14, '#c0c0c0');
      }
    }
    // car collisions with player on foot
    var all = cars.concat(cops);
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (Math.abs(c.v) > 60 && dist2(c.x, c.y, player.x, player.y) < 24 * 24) {
        player.hp -= 25; burst(player.x, player.y, 10, '#f00');
        say('Hit by a car! HP ' + Math.max(0, Math.round(player.hp)));
        if (player.hp <= 0) { player.hp = 100; player.x = station.x; player.y = station.y - 60; player.inCar = null; cash = Math.max(0, cash - 50); say('Wasted. $50 hospital bill.'); }
        break;
      }
    }
  }

  function updatePlayerCar(dt, inp) {
    var c = player.inCar;
    if (c.wreck) { player.inCar = null; return; }
    // arcade Pacejka-lite per class: throttle/brake/steer + surface mu + wet grip
    var spec = c.spec || SPECS.sedan;
    var surf = isRoad(c.x, c.y) ? 1 : 0.55;
    if (inWater(c.x)) surf = 0.3;
    var wetGrip = 1 - weather.wet * 0.25;
    var th = (inp.up ? 1 : 0) - (inp.down ? 0.7 : 0);
    var accel = spec.accel * surf, maxV = spec.maxV * (surf > 0.9 ? 1 : 0.6), drag = 0.9;
    c.v += (th * accel - c.v * drag - Math.sign(c.v) * 20) * dt;
    c.v = clamp(c.v, -140, maxV);
    if (inp.brake) c.v *= (1 - 2.2 * dt); // handbrake
    var steer = ((inp.left ? 1 : 0) - (inp.right ? 1 : 0)) * (inp.brake ? 2.4 : spec.grip);
    var grip = (inp.brake ? 0.55 : 1) * wetGrip; // drift + wet slide!
    c.a += steer * clamp(c.v / 200, -1, 1) * 2.6 * grip * dt * (c.v < 0 ? -1 : 1);
    var nx = c.x + Math.cos(c.a) * c.v * dt, ny = c.y + Math.sin(c.a) * c.v * dt;
    var hit = collideBuilding(nx, ny, 16);
    if (hit) {
      if (Math.abs(c.v) > 180) {
        burst(c.x, c.y, 12, '#fd0'); addWanted(0.3, 'Reckless driving!');
        c.hp -= 12; c.bump = 1;
        if (c.hp <= 0) { wreckCar(c); return; }
      }
      c.v *= -0.35; nx = c.x; ny = c.y;
      c.bump = 1;
    }
    if (inCanal(nx)) { c.v *= 0.9; }
    c.x = clamp(nx, 20, WORLD - 20); c.y = clamp(ny, 20, WORLD - 20);
    c.bump = Math.max(0, c.bump - dt * 3);
    c.surf = surf;
    player.x = c.x; player.y = c.y; player.a = c.a; player.speed = Math.abs(c.v);
    // wreck smoke + dust when drifting / offroad
    if (c.hp < 40 && hash(windT * 60 + c.x) < 0.5) parts.push({ x: c.x, y: c.y - 6, vx: -20, vy: -46, life: 0.9, col: '#555' });
    // dust when drifting / offroad
    if ((inp.brake && Math.abs(c.v) > 120) || (surf < 0.9 && Math.abs(c.v) > 200)) {
      if (hash(windT * 60 + c.x) < 0.4) parts.push({ x: c.x, y: c.y, vx: -Math.cos(c.a) * 40, vy: -Math.sin(c.a) * 40, life: 0.7, col: surf < 0.9 ? '#8a7a5a' : '#aaa' });
    }
    // run over peds?
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (!p.down && dist2(p.x, p.y, c.x, c.y) < 22 * 22 && Math.abs(c.v) > 50) {
        p.down = 8; burst(p.x, p.y, 10, '#f00');
        cashDrops.push({ x: p.x, y: p.y, amt: 10 + Math.floor(hash(p.x + p.y) * 20) });
        addWanted(1, 'Vehicular assault!');
      }
    }
    // speeding near cops?
    if (Math.abs(c.v) > 330) for (var k = 0; k < cops.length; k++) {
      if (dist2(cops[k].x, cops[k].y, c.x, c.y) < 300 * 300) { heat = clamp(heat + dt * 0.25, 0, 3); wanted = Math.ceil(heat); }
    }
  }

  function updateTraffic(c, dt) {
    // waypoint cruise along road grid; yield to player/peds ahead
    if (c.stopT > 0) { c.stopT -= dt; c.v = lerp(c.v, 0, dt * 6); }
    else {
      c.v = lerp(c.v, (c.spec || SPECS.sedan).cruise, dt * 1.2);
      // intersection? randomly turn
      var bx = c.x % BLOCK, by = c.y % BLOCK;
      if (bx < 0) bx += BLOCK; if (by < 0) by += BLOCK;
      var nearX = bx < ROAD + 8 && bx > ROAD - 14, nearY = by < ROAD + 8 && by > ROAD - 14;
      if (nearX && nearY && hash(c.x * 0.13 + c.y * 0.29 + windT * 0.05) < 0.012) c.a += (hash(c.x + c.y) < 0.5 ? 1 : -1) * Math.PI / 2;
      // snap drift correction: prefer axis headings
      var snap = Math.round(c.a / (Math.PI / 2)) * (Math.PI / 2);
      c.a = angLerp(c.a, snap, dt * 2);
    }
    // obstacle ahead?
    var ax = c.x + Math.cos(c.a) * 60, ay = c.y + Math.sin(c.a) * 60;
    var all = cars.concat(cops, [player.inCar || { x: -9999, y: -9999 }]);
    for (var i = 0; i < all.length; i++) {
      var o = all[i]; if (!o || o === c) continue;
      if (dist2(ax, ay, o.x, o.y) < 34 * 34) { c.stopT = 0.6; break; }
    }
    for (var j = 0; j < peds.length; j++) {
      var p = peds[j];
      if (!p.down && dist2(ax, ay, p.x, p.y) < 26 * 26) { c.stopT = 0.8; break; }
    }
    var nx = c.x + Math.cos(c.a) * c.v * dt, ny = c.y + Math.sin(c.a) * c.v * dt;
    if (collideBuilding(nx, ny, 16)) { c.a += Math.PI / 2; c.v = 0; }
    else { c.x = nx; c.y = ny; }
    // keep on roads loosely: steer back if fully offroad in a block
    if (!isRoad(c.x, c.y) && hash(c.x + c.y * 2) < 0.01) c.a += Math.PI / 2;
    c.x = clamp(c.x, 20, WORLD - 20); c.y = clamp(c.y, 20, WORLD - 20);
  }

  function updatePed(p, dt) {
    if (p.down > 0) { p.down -= dt; return; }
    if (p.flee > 0) {
      p.flee -= dt;
      var dx = p.x - player.x, dy = p.y - player.y, l = Math.hypot(dx, dy) || 1;
      slideMove(p, p.x + dx / l * 110 * dt, p.y + dy / l * 110 * dt, 8);
      p.a = Math.atan2(dy, dx);
      return;
    }
    p.t -= dt;
    if (p.t <= 0) { p.t = 2 + hash(p.x + windT) * 4; p.a = hash(p.y + p.t) * 6.28; }
    // flee fast player car
    var f = player.inCar || player;
    var pv = player.inCar ? Math.abs(player.inCar.v) : player.speed;
    if (pv > 200 && dist2(p.x, p.y, f.x, f.y) < 130 * 130) { p.flee = 2.5; p.state = 'flee'; return; }
    p.state = 'walk';
    slideMove(p, p.x + Math.cos(p.a) * p.speed * dt, p.y + Math.sin(p.a) * p.speed * dt, 8);
  }

  function updateCops(dt) {
    if (wanted <= 0) {
      // return to station
      for (var i = 0; i < cops.length; i++) {
        var c = cops[i];
        var d = Math.hypot(station.x - c.x, station.y - c.y);
        if (d > 60) { c.a = angLerp(c.a, Math.atan2(station.y - c.y, station.x - c.x), dt * 3); c.v = lerp(c.v, 160, dt * 2); }
        else c.v = lerp(c.v, 0, dt * 4);
        c.x += Math.cos(c.a) * c.v * dt; c.y += Math.sin(c.a) * c.v * dt;
      }
      return;
    }
    var target = player.inCar || player;
    for (var k = 0; k < cops.length; k++) {
      var cop = cops[k];
      if (cop.cool > 0) cop.cool -= dt;
      var want = Math.atan2(target.y - cop.y, target.x - cop.x);
      cop.a = angLerp(cop.a, want, dt * (2 + wanted));
      cop.v = lerp(cop.v, 230 + wanted * 60, dt * 2);
      var nx = cop.x + Math.cos(cop.a) * cop.v * dt, ny = cop.y + Math.sin(cop.a) * cop.v * dt;
      if (collideBuilding(nx, ny, 16)) { cop.a += 1.2; nx = cop.x; ny = cop.y; }
      cop.x = nx; cop.y = ny;
      // drive-by: cops fire when close (tracer + damage, car takes it first)
      var cd = dist2(cop.x, cop.y, player.x, player.y);
      if (cd < 430 * 430 && cop.cool <= 0) {
        cop.cool = 1.3;
        var miss = (Math.random() - 0.5) * 40;
        tracers.push({ x1: cop.x, y1: cop.y, x2: player.x + miss * 0.3, y2: player.y + miss, life: 0.14, col: '#ff6a5e' });
        if (player.inCar && player.inCar.hp > 0) {
          player.inCar.hp -= 12;
          burst(player.x, player.y, 6, '#fd0');
          if (player.inCar.hp <= 0) wreckCar(player.inCar);
        } else {
          player.hp -= 6;
          burst(player.x, player.y, 5, '#f00');
          if (player.hp <= 0) { player.hp = 100; player.x = station.x; player.y = station.y - 60; cash = Math.max(0, cash - 50); say('Wasted by LSPD. $50 hospital bill.'); }
        }
      }
      // bust check
      if (dist2(cop.x, cop.y, player.x, player.y) < 34 * 34) {
        bustT += dt;
        if (bustT > 1.2) {
          bustT = 0; heat = 0; wanted = 0; bustedFlash = 2;
          var fine = Math.min(cash, 100 + delivered * 20);
          cash -= fine;
          player.x = station.x; player.y = station.y - 60;
          if (player.inCar) { player.inCar.driver = null; player.inCar = null; }
          say('BUSTED! Fine $' + fine + '. (R to keep playing)');
        }
      }
    }
    if (wanted > 0 && dist2(cops[0].x, cops[0].y, player.x, player.y) > 34 * 34) bustT = Math.max(0, bustT - dt);
  }

  function checkMission() {
    var f = player; // pickup allowed on foot or driving over
    for (var i = 0; i < pickups.length; i++) {
      var pk = pickups[i];
      if (!pk.taken && dist2(f.x, f.y, pk.x, pk.y) < 34 * 34) {
        pk.taken = true; cash += 25;
        say('Briefcase secured +$25. Deliver to the yellow drop (north canal).');
        burst(pk.x, pk.y, 14, '#6cb8ff');
      }
    }
    var carried = pickups.filter(function (p) { return p.taken && !p.delivered; }).length;
    if (carried > 0 && dist2(f.x, f.y, dropOff.x, dropOff.y) < 60 * 60) {
      var n = 0;
      pickups.forEach(function (p) { if (p.taken && !p.delivered) { p.delivered = true; n++; } });
      var pay = n * 150;
      cash += pay; delivered += n;
      say('Delivered ' + n + ' package(s) +$' + pay + '  (' + delivered + ' total)');
      burst(dropOff.x, dropOff.y, 20, '#ffd76c');
      // mission chain hooks
      if (!mDone[0]) { mDone[0] = true; cash += 100; say('JOB 1/3 done: FIRST HUSTLE +$100 bonus. Now raise some heat (★), then lose it.'); }
      else if (mDone[1] && !mDone[2] && player.inCar) { mDone[2] = true; cash += 300; say('JOB 3/3 done: GETAWAY +$300. You run this town. Free roam!'); }
      if (pickups.every(function (p) { return p.delivered; })) {
        spawnPickups();
        if (mDone[2]) say('New shipment on the streets. Rank: ' + rank());
      }
    }
    // cash drops
    for (var k = cashDrops.length - 1; k >= 0; k--) {
      if (dist2(f.x, f.y, cashDrops[k].x, cashDrops[k].y) < 30 * 30) {
        cash += cashDrops[k].amt; say('+$' + cashDrops[k].amt);
        cashDrops.splice(k, 1);
      }
    }
  }
  function rank() {
    if (delivered >= 12) return 'KINGPIN';
    if (delivered >= 6) return 'HUSTLER';
    if (delivered >= 3) return 'RUNNER';
    return 'PUNK';
  }
  // Current story objective + GPS target (null = no beacon).
  function objective() {
    var f = player;
    if (!mDone[0]) {
      var carried = 0, i, best = null, bd = Infinity;
      for (i = 0; i < pickups.length; i++) {
        if (pickups[i].taken && !pickups[i].delivered) carried++;
        if (!pickups[i].taken) {
          var d = dist2(f.x, f.y, pickups[i].x, pickups[i].y);
          if (d < bd) { bd = d; best = pickups[i]; }
        }
      }
      if (carried > 0) return { text: 'JOB 1/3 FIRST HUSTLE: deliver to the $ drop', tx: dropOff.x, ty: dropOff.y };
      if (best) return { text: 'JOB 1/3 FIRST HUSTLE: grab a glowing briefcase', tx: best.x, ty: best.y };
      return { text: 'JOB 1/3 FIRST HUSTLE: deliver to the $ drop', tx: dropOff.x, ty: dropOff.y };
    }
    if (!mDone[1]) return { text: heatSeen ? 'JOB 2/3 HEAT: lose the cops!' : 'JOB 2/3 HEAT: raise ★ (crime), then lose it', tx: null, ty: null };
    if (!mDone[2]) return { text: 'JOB 3/3 GETAWAY: deliver a package while driving', tx: dropOff.x, ty: dropOff.y };
    return { text: 'Free roam — stack cash · rank ' + rank(), tx: null, ty: null };
  }
  function burst(x, y, n, col) {
    for (var i = 0; i < n; i++) {
      var a = hash(x + y + i * 7 + windT) * 6.28;
      parts.push({ x: x, y: y, vx: Math.cos(a) * (60 + hash(i) * 120), vy: Math.sin(a) * (60 + hash(i) * 120), life: 0.5 + hash(i * 3) * 0.4, col: col });
    }
  }

  // ---------------- lighting ----------------
  function sunState() {
    // clock 6=sunrise, 12=noon, 18=sunset, 0=midnight
    var el = Math.sin((clock - 6) / 12 * Math.PI); // -1..1
    var day = clamp(el * 2 + 0.25, 0, 1);
    var dusk = clamp(1 - Math.abs(el) * 3, 0, 1) * (clock > 11 && clock < 19 ? 1 : 0.4);
    var night = 1 - clamp(el * 3 + 0.4, 0, 1);
    day *= (1 - weather.over * 0.35); // overcast dims the sun
    var sunA = ((clock - 6) / 12) * Math.PI; // for shadow dir
    return { el: el, day: day, dusk: dusk, night: night, sx: Math.cos(sunA), sy: 0.4, wet: weather.wet, over: weather.over, mode: weather.mode };
  }

  // ---------------- render ----------------
  var cv, ctx, mini, mctx, hud = {};
  function initRender() {
    cv = document.getElementById('gameCanvas'); if (!cv) return false;
    ctx = cv.getContext('2d');
    mini = document.getElementById('miniMap'); if (mini) mctx = mini.getContext('2d');
    ['hudCash', 'hudStars', 'hudSpeed', 'hudClock', 'hudMission', 'hudMsg', 'hudGun'].forEach(function (id) { hud[id] = document.getElementById(id); });
    return true;
  }
  function draw() {
    var W = cv.width, H = cv.height;
    var s = sunState();
    var vw = W / 1.6, vh = H / 1.6; // zoom
    var x0 = cam.x - vw / 2, y0 = cam.y - vh / 2;
    ctx.save();
    ctx.fillStyle = nightGround(s); ctx.fillRect(0, 0, W, H);
    ctx.scale(1.6, 1.6); ctx.translate(-x0, -y0);

    drawGrass(x0, y0, vw, vh, s);
    drawRoads(x0, y0, vw, vh, s);
    drawCanal(x0, y0, vw, vh, s);
    drawOcean(x0, y0, vw, vh, s);
    drawDropAndStation(s);
    drawLandmarks(s);
    drawBuildings(x0, y0, vw, vh, s);
    drawTrees(x0, y0, vw, vh, s);
    drawPickups(s);
    drawGuns(s);
    drawCashDrops();
    var all = cars.concat(cops);
    for (var i = 0; i < all.length; i++) drawCar(all[i], s, x0, y0, vw, vh);
    for (var j = 0; j < peds.length; j++) drawPed(peds[j], s);
    drawPlayer(s);
    drawTracers();
    drawParts();
    drawCloudShadows(x0, y0, vw, vh, s);
    drawBeaconGps();
    drawMist(x0, y0, vw, vh, s);
    ctx.restore();
    drawSkyBodies(W, H, s);
    drawLightingOverlay(W, H, s);
    drawMinimap();
    updateHud(s);
  }
  function nightGround(s) {
    // base ground tints with time of day (GI nod: sky bounce -> ground albedo)
    var r = Math.round(lerp(16, 46, s.day) + s.dusk * 20);
    var g = Math.round(lerp(22, 52, s.day) + s.dusk * 8);
    var b = Math.round(lerp(30, 44, s.day));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function drawGrass(x0, y0, vw, vh, s) {
    ctx.fillStyle = s.day > 0.5 ? '#2a4a2e' : '#16241a';
    ctx.fillRect(x0, y0, vw, vh);
    // district ground tints (read like GTA neighborhoods from the air)
    for (var gx = 0; gx < NBLK; gx++) for (var gy = 0; gy < NBLK; gy++) {
      var bx = gx * BLOCK + ROAD, by = gy * BLOCK + ROAD;
      if (bx > x0 + vw || bx + BLOCK < x0 || by > y0 + vh || by + BLOCK < y0) continue;
      if (bx + BLOCK > WORLD - 460) continue; // sand handled by drawOcean
      var downtown = gx >= 4 && gx <= 7 && gy >= 4 && gy <= 7;
      var harbor = gy >= 10;
      var hills = gx < 4 && gy < 4;
      if (downtown) { ctx.fillStyle = s.day > 0.5 ? '#3d4148' : '#22252b'; }
      else if (harbor) { ctx.fillStyle = s.day > 0.5 ? '#4a4a44' : '#26261f'; }
      else if (hills) { ctx.fillStyle = s.day > 0.5 ? 'rgba(40,100,50,0.6)' : 'rgba(16,36,22,0.7)'; }
      else { ctx.fillStyle = s.day > 0.5 ? 'rgba(70,130,70,0.45)' : 'rgba(24,44,28,0.55)'; }
      ctx.fillRect(bx, by, BLOCK - ROAD, BLOCK - ROAD);
    }
  }
  function drawRoads(x0, y0, vw, vh, s) {
    ctx.fillStyle = s.night > 0.5 ? '#23262c' : '#3a3f47';
    for (var i = 0; i <= NBLK; i++) {
      var rx = i * BLOCK, ry = i * BLOCK;
      if (rx + ROAD > x0 && rx < x0 + vw) ctx.fillRect(rx, 0, ROAD, WORLD);
      if (ry + ROAD > y0 && ry < y0 + vh) ctx.fillRect(0, ry, WORLD, ROAD);
    }
    // lane dashes
    ctx.fillStyle = s.night > 0.5 ? 'rgba(220,200,120,0.5)' : 'rgba(240,230,150,0.9)';
    for (var k = 0; k <= NBLK; k++) {
      var cy = k * BLOCK + ROAD / 2;
      for (var x = 0; x < WORLD; x += 46) if (x > x0 - 46 && x < x0 + vw) ctx.fillRect(x, cy - 2, 22, 4);
      var cx = k * BLOCK + ROAD / 2;
      for (var y = 0; y < WORLD; y += 46) if (y > y0 - 46 && y < y0 + vh) ctx.fillRect(cx - 2, y, 4, 22);
    }
  }
  function drawCanal(x0, y0, vw, vh, s) {
    var g = ctx.createLinearGradient(canal.x - 40, 0, canal.x + 40, 0);
    var base = s.night > 0.5 ? '#0e2233' : '#2a6a8a';
    g.addColorStop(0, base); g.addColorStop(0.5, s.day > 0.5 ? '#6cc4e8' : '#1c3f55'); g.addColorStop(1, base);
    ctx.fillStyle = g;
    ctx.fillRect(canal.x - 40, 0, 80, WORLD);
    // SDF-march nod: animated shimmer lines (far-field reflection shimmer)
    ctx.fillStyle = 'rgba(255,255,255,' + (0.10 + s.day * 0.12).toFixed(2) + ')';
    for (var y = 0; y < WORLD; y += 34) {
      if (y < y0 - 34 || y > y0 + vh) continue;
      var off = Math.sin(y * 0.08 + windT * 2.4) * 18;
      ctx.fillRect(canal.x - 24 + off * 0.4, y + (windT * 30 % 34), 48, 3);
    }
  }
  function drawOcean(x0, y0, vw, vh, s) {
    var sandX = WORLD - 460;
    if (sandX < x0 + vw && WATER_X > x0) {
      // sand strip
      ctx.fillStyle = s.day > 0.5 ? '#c2a878' : '#5a4f3a';
      ctx.fillRect(Math.max(sandX, x0), 0, Math.min(WATER_X, x0 + vw) - Math.max(sandX, x0), WORLD);
      // wet sand band near waterline
      ctx.fillStyle = s.day > 0.5 ? 'rgba(120,100,70,0.6)' : 'rgba(40,36,26,0.6)';
      ctx.fillRect(Math.max(WATER_X - 40, x0), 0, Math.min(WATER_X, x0 + vw) - Math.max(WATER_X - 40, x0), WORLD);
    }
    if (WATER_X > x0 + vw) return;
    // open water with sun/moon glint
    var g = ctx.createLinearGradient(WATER_X, 0, WORLD, 0);
    var lift = s.day > 0.5 ? '#4fb6dd' : '#14384e';
    var deep = s.night > 0.5 ? '#0a1a2e' : '#1a5a7a';
    g.addColorStop(0, lift); g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.fillRect(Math.max(WATER_X, x0), 0, WORLD - Math.max(WATER_X, x0), WORLD);
    // animated foam edge + drifting shimmer
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (var y = 0; y < WORLD; y += 26) {
      if (y < y0 - 26 || y > y0 + vh) continue;
      var off = Math.sin(y * 0.05 + windT * 2) * 10;
      ctx.fillRect(WATER_X - 6 + off, y + (windT * 24 % 26), 12, 3);
    }
    ctx.fillStyle = 'rgba(255,255,255,' + (0.06 + s.day * 0.10).toFixed(2) + ')';
    for (var y2 = 0; y2 < WORLD; y2 += 60) {
      if (y2 < y0 - 60 || y2 > y0 + vh) continue;
      ctx.fillRect(WATER_X + 20 + hash(y2) * 90, y2, 30, 3);
    }
  }
  function drawLandmarks(s) {
    // Del Mar pier (walkable boards, no collision)
    var pierY = 8 * BLOCK + 150;
    ctx.fillStyle = s.day > 0.5 ? '#7a5c3d' : '#3a2f22';
    ctx.fillRect(WATER_X - 190, pierY - 14, 300, 28);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (var px = WATER_X - 190; px < WATER_X + 110; px += 24) ctx.fillRect(px, pierY - 14, 3, 28);
    for (var i = 0; i < landmarks.length; i++) {
      var lm = landmarks[i];
      if (dist2(cam.x, cam.y, lm.x, lm.y) > 700 * 700) continue;
      ctx.fillStyle = s.night > 0.4 ? '#ffd76c' : 'rgba(10,14,20,0.75)';
      ctx.font = 'bold 13px system-ui';
      ctx.fillText(lm.label, lm.x - 44, lm.y - 12);
    }
  }
  function drawDropAndStation(s) {
    // drop-off pulsing
    var pu = 1 + Math.sin(windT * 4) * 0.15;
    ctx.fillStyle = '#ffd76c';
    ctx.save(); ctx.translate(dropOff.x, dropOff.y); ctx.scale(pu, pu);
    ctx.fillRect(-22, -22, 44, 44); ctx.fillStyle = '#111'; ctx.font = 'bold 22px system-ui';
    ctx.fillText('$', -7, 8); ctx.restore();
    ctx.fillStyle = 'rgba(255,215,108,0.25)';
    ctx.beginPath(); ctx.arc(dropOff.x, dropOff.y, 60, 0, 6.29); ctx.fill();
    // police station
    ctx.fillStyle = '#20365e'; ctx.fillRect(station.x - 60, station.y - 30, 120, 60);
    ctx.fillStyle = '#6cb8ff'; ctx.font = 'bold 13px system-ui'; ctx.fillText('POLICE', station.x - 28, station.y + 5);
  }
  function inView(b, x0, y0, vw, vh) { return b.x < x0 + vw && b.x + b.w > x0 && b.y < y0 + vh && b.y + b.h > y0; }
  function drawBuildings(x0, y0, vw, vh, s) {
    var neonCount = 0;
    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      if (!inView(b, x0, y0, vw, vh)) continue; // sector LOD cull
      var near = dist2(cam.x, cam.y, b.x + b.w / 2, b.y + b.h / 2) < 520 * 520;
      // shadow shifts with sun (towers throw further; long at dawn/dusk)
      var shLen = clamp(2 + (1 - Math.abs(s.el)) * 22, 2, 24) * (b.tall ? 1.7 : 1);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(b.x + s.sx * shLen, b.y + 6 + shLen * 0.4, b.w, b.h);
      var light = 0.45 + s.day * 0.55;
      var r = Math.round(b.base[0] * light + s.dusk * 30);
      var g = Math.round(b.base[1] * light + s.dusk * 12);
      var bl = Math.round(b.base[2] * light);
      ctx.fillStyle = 'rgb(' + clamp(r, 0, 255) + ',' + clamp(g, 0, 255) + ',' + clamp(bl, 0, 255) + ')';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (b.house && near) {
        // pitched-roof read: dark cap + door + two windows
        ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(b.x, b.y, b.w, 10);
        ctx.fillStyle = s.night > 0.4 ? '#ffd98a' : '#1d2a3a';
        ctx.fillRect(b.x + 8, b.y + 16, 12, 10); ctx.fillRect(b.x + b.w - 20, b.y + 16, 12, 10);
        ctx.fillStyle = '#3a2a1a'; ctx.fillRect(b.x + b.w / 2 - 7, b.y + b.h - 20, 14, 20);
      } else if (b.ware && near) {
        // warehouse: loading doors + skylight strips
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(b.x + 14, b.y + b.h - 26, 30, 26); ctx.fillRect(b.x + b.w - 44, b.y + b.h - 26, 30, 26);
        ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(b.x, b.y + 8, b.w, 5);
      } else if (near) {
        // windows: lit warm at night, dark glass by day
        var cols = Math.max(2, Math.floor(b.w / 26)), rows = Math.max(2, Math.floor(b.h / 26));
        for (var cx = 0; cx < cols; cx++) for (var cy = 0; cy < rows; cy++) {
          var lit = hash(b.seed + cx * 7 + cy * 13) < (0.15 + s.night * 0.6);
          ctx.fillStyle = lit ? '#ffd98a' : (s.day > 0.5 ? '#1d2a3a' : '#0e141d');
          ctx.fillRect(b.x + 8 + cx * ((b.w - 16) / cols), b.y + 8 + cy * ((b.h - 16) / rows), (b.w - 16) / cols * 0.6, (b.h - 16) / rows * 0.55);
        }
      } else {
        // far LOD: flat imposter tint only
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(b.x, b.y, b.w, 8);
      }
      // neon signage: capped bloom so SwiftShader stays fast
      if (b.neon && s.night > 0.25 && neonCount < 12) {
        neonCount++;
        ctx.save();
        ctx.shadowColor = b.neon; ctx.shadowBlur = 16;
        ctx.fillStyle = b.neon;
        ctx.fillRect(b.x + b.w / 2 - 26, b.y - 8, 52, 7);
        ctx.restore();
        ctx.globalAlpha = 0.14; ctx.fillStyle = b.neon;
        ctx.fillRect(b.x, b.y, b.w, 14); ctx.globalAlpha = 1;
      }
    }
  }
  function drawTrees(x0, y0, vw, vh, s) {
    for (var i = 0; i < trees.length; i++) {
      var t = trees[i];
      if (t.x < x0 - 30 || t.x > x0 + vw + 30 || t.y < y0 - 30 || t.y > y0 + vh + 30) continue;
      var w = windAt(t.x, t.y);
      var sway = Math.sin(windT * 1.6 + t.phase) * 3 + w.x * 0.5 * t.s;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(t.x + 3, t.y + 4, 10 * t.s, 5 * t.s, 0, 0, 6.29); ctx.fill();
      var trunkH = (t.palm ? 16 : 10) * t.s;
      ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x + sway * 0.3, t.y - trunkH); ctx.stroke();
      if (t.palm) {
        var pg = 110 + Math.round(s.day * 70);
        ctx.fillStyle = 'rgb(46,' + pg + ',70)';
        ctx.beginPath(); ctx.arc(t.x + sway, t.y - trunkH - 4, 12 * t.s, 0, 6.29); ctx.fill();
        ctx.fillStyle = 'rgba(217,224,33,0.55)';
        ctx.beginPath(); ctx.arc(t.x + sway - 4, t.y - trunkH - 8, 5 * t.s, 0, 6.29); ctx.fill();
      } else {
        var g = 90 + Math.round(s.day * 80);
        ctx.fillStyle = 'rgb(30,' + g + ',50)';
        ctx.beginPath(); ctx.arc(t.x + sway, t.y - 14 * t.s, 11 * t.s, 0, 6.29); ctx.fill();
        ctx.fillStyle = 'rgba(120,220,130,0.5)';
        ctx.beginPath(); ctx.arc(t.x + sway - 3, t.y - 17 * t.s, 5 * t.s, 0, 6.29); ctx.fill();
      }
    }
  }
  function drawPickups(s) {
    for (var i = 0; i < pickups.length; i++) {
      var p = pickups[i]; if (p.taken && p.delivered) continue;
      if (p.taken) continue; // carried
      var bob = Math.sin(windT * 3 + i) * 3;
      ctx.fillStyle = 'rgba(108,184,255,0.3)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#6cb8ff'; ctx.fillRect(p.x - 10, p.y - 10 + bob, 20, 15);
      ctx.fillStyle = '#0b0e13'; ctx.fillRect(p.x - 10, p.y - 4 + bob, 20, 3);
    }
  }
  function drawGuns(s) {
    for (var i = 0; i < gunSpots.length; i++) {
      var gs = gunSpots[i];
      if (gs.taken) continue;
      var bob = Math.sin(windT * 3 + i * 2) * 3;
      ctx.fillStyle = 'rgba(220,220,230,0.25)';
      ctx.beginPath(); ctx.arc(gs.x, gs.y, 24, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillRect(gs.x - 11, gs.y - 4 + bob, 22, 7); // slide
      ctx.fillRect(gs.x + 2, gs.y + 1 + bob, 6, 9);  // grip
      ctx.fillStyle = '#888'; ctx.fillRect(gs.x - 11, gs.y - 4 + bob, 22, 2);
    }
  }
  function drawTracers() {
    for (var i = 0; i < tracers.length; i++) {
      var t = tracers[i];
      ctx.globalAlpha = clamp(t.life * 8, 0, 1);
      ctx.strokeStyle = t.col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawCloudShadows(x0, y0, vw, vh, s) {
    // drifting cloud shadows: the sky modulating the ground (cheap volumetrics nod)
    var a = 0.05 + s.over * 0.10;
    if (a <= 0.01) return;
    ctx.fillStyle = 'rgba(0,0,10,' + a.toFixed(3) + ')';
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      if (c.x + c.rx < x0 || c.x - c.rx > x0 + vw || c.y + c.rx > y0 + vh + 400 || c.y - c.rx < y0 - 400) {
        if (c.x + c.rx < x0 || c.x - c.rx > x0 + vw) continue;
      }
      ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.rx * 0.45, 0, 0, 6.29); ctx.fill();
    }
  }
  function drawBeaconGps() {
    var obj = objective();
    if (obj.tx === null || obj.tx === undefined) return;
    // GPS route: dashed line from player to target
    ctx.save();
    ctx.strokeStyle = 'rgba(255,215,108,0.65)'; ctx.lineWidth = 3;
    ctx.setLineDash([12, 9]);
    ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(obj.tx, obj.ty); ctx.stroke();
    ctx.setLineDash([]);
    // beacon cylinder at target
    var pu = 1 + Math.sin(windT * 4) * 0.12;
    ctx.fillStyle = 'rgba(255,215,108,0.20)';
    ctx.beginPath(); ctx.arc(obj.tx, obj.ty, 44 * pu, 0, 6.29); ctx.fill();
    ctx.fillStyle = 'rgba(255,215,108,0.85)';
    ctx.fillRect(obj.tx - 4, obj.ty - 60 * pu, 8, 60 * pu);
    ctx.restore();
  }
  function drawSkyBodies(W, H, s) {
    // stars with twinkle + moon glow (screen space, before the night grade)
    if (s.night > 0.15) {
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        var tw = 0.5 + 0.5 * Math.sin(windT * 2 + st.tw);
        ctx.fillStyle = 'rgba(255,255,255,' + (s.night * tw * 0.8).toFixed(2) + ')';
        ctx.fillRect(st.fx * W, st.fy * H * 0.7, st.r, st.r);
      }
      var mx = W * 0.82, my = H * 0.16;
      var mg = ctx.createRadialGradient(mx, my, 4, mx, my, 70);
      mg.addColorStop(0, 'rgba(230,238,255,' + (0.9 * s.night).toFixed(2) + ')');
      mg.addColorStop(0.25, 'rgba(200,215,245,' + (0.35 * s.night).toFixed(2) + ')');
      mg.addColorStop(1, 'rgba(200,215,245,0)');
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 70, 0, 6.29); ctx.fill();
    }
  }
  function drawCashDrops() {
    ctx.fillStyle = '#7dff8a';
    for (var i = 0; i < cashDrops.length; i++) {
      var c = cashDrops[i];
      ctx.fillRect(c.x - 5, c.y - 5 + Math.sin(windT * 5 + i) * 2, 10, 8);
    }
  }
  function drawCar(c, s, x0, y0, vw, vh) {
    if (c.x < x0 - 60 || c.x > x0 + vw + 60 || c.y < y0 - 60 || c.y > y0 + vh + 60) return;
    ctx.save(); ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-16 + s.sx * 6, -9 + 5, 34, 20); // shadow
    ctx.rotate(c.a);
    if (c.bump > 0) ctx.translate(-c.bump * 3, 0);
    if (c.wreck) {
      ctx.fillStyle = '#232323'; ctx.fillRect(-17, -9, 34, 18); // burnt shell
      ctx.fillStyle = '#0c0c0c'; ctx.fillRect(-4, -9, 10, 18);
    } else {
      ctx.fillStyle = c.police ? '#2743e8' : c.color;
      ctx.fillRect(-17, -9, 34, 18);
      ctx.fillStyle = c.police ? '#9db6ff' : 'rgba(0,0,0,0.45)';
      ctx.fillRect(-4, -9, 10, 18); // cabin
    }
    if (c.police) { ctx.fillStyle = (Math.floor(windT * 4) % 2 ? '#f00' : '#00f'); ctx.fillRect(-14, -11, 8, 4); ctx.fillRect(6, -11, 8, 4); }
    // wheels
    ctx.fillStyle = '#111';
    ctx.fillRect(-11, -12, 7, 3); ctx.fillRect(-11, 9, 7, 3); ctx.fillRect(6, -12, 7, 3); ctx.fillRect(6, 9, 7, 3);
    // headlights at night (hybrid RT nod: near cone + far glow)
    if (s.night > 0.25 && !c.wreck) {
      ctx.fillStyle = 'rgba(255,240,180,' + (0.25 + s.night * 0.5).toFixed(2) + ')';
      ctx.beginPath(); ctx.moveTo(17, -7); ctx.lineTo(17 + 70 * s.night + 30, -20); ctx.lineTo(17 + 70 * s.night + 30, 20); ctx.lineTo(17, 7); ctx.fill();
    }
    ctx.restore();
    // suspension telemetry bounce (bump visual)
    if (c.bump > 0.05) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(c.x - 2, c.y - 22, 4, 4); }
  }
  function drawPed(p, s) {
    if (p.down > 0) {
      ctx.fillStyle = '#7a1f1f';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 10, 6, p.a, 0, 6.29); ctx.fill();
      return;
    }
    var w = windAt(p.x, p.y);
    var bob = Math.sin(windT * 8 + p.x) * (p.state === 'flee' ? 2.5 : 1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + 3, 7, 3.5, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = p.state === 'flee' ? '#ff9a6c' : '#e8c39e';
    ctx.beginPath(); ctx.arc(p.x, p.y + bob * 0.4, 6, 0, 6.29); ctx.fill();
    // cloth coat flutters with wind (cloth nod)
    ctx.fillStyle = p.state === 'flee' ? '#c0392b' : '#34618f';
    ctx.save(); ctx.translate(p.x, p.y + 4);
    ctx.rotate(w.x * 0.03 + bob * 0.1);
    ctx.fillRect(-5, 0, 10, 9); ctx.restore();
  }
  function drawPlayer(s) {
    if (player.inCar) return;
    var w = windAt(player.x, player.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(player.x + 2, player.y + 4, 8, 4, 0, 0, 6.29); ctx.fill();
    ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(player.a);
    ctx.fillStyle = '#ffd76c'; ctx.fillRect(-3, -6, 6, 3); // visor cap
    ctx.fillStyle = '#2ecc71'; ctx.fillRect(-7, -5, 14, 12); // jacket
    ctx.fillStyle = '#e8c39e'; ctx.fillRect(5, -3, 6, 6);
    // coat tail in wind
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(-7 - Math.abs(w.x) * 0.4, -4, 4, 8);
    // pistol in hands when armed
    if (player.gun) { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(6, -2, 10, 4); }
    ctx.restore();
    // aim line (short, subtle) when armed
    if (player.gun) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(player.x, player.y);
      ctx.lineTo(player.x + Math.cos(player.a) * 46, player.y + Math.sin(player.a) * 46); ctx.stroke();
    }
    // interact hint
    var car = nearestCar(player.x, player.y, 46);
    if (car && !car.police) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui';
      ctx.fillText('E: drive', player.x - 24, player.y - 18);
    }
  }
  function drawParts() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.col; ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }
  function drawMist(x0, y0, vw, vh, s) {
    // morning mist strongest 7-10h; night fog light
    var amt = clamp(1 - Math.abs(clock - 8.5) / 3.5, 0, 1) * 0.16 + s.night * 0.05;
    if (amt <= 0.01) return;
    ctx.fillStyle = 'rgba(190,205,225,' + amt.toFixed(3) + ')';
    for (var i = 0; i < mists.length; i++) {
      var m = mists[i];
      if (m.x < x0 - m.r || m.x > x0 + vw + m.r || m.y < y0 - m.r || m.y > y0 + vh + m.r) continue;
      ctx.beginPath(); ctx.ellipse(m.x, m.y, m.r, m.r * 0.45, 0, 0, 6.29); ctx.fill();
    }
  }
  function drawLightingOverlay(W, H, s) {
    // day: subtle warm; dusk: orange grade; night: dark blue + light pools
    if (s.dusk > 0.05 && s.day > 0.1) {
      ctx.fillStyle = 'rgba(255,120,40,' + (s.dusk * 0.10).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    // rain grade: cold + dark
    if (s.mode === 'rain') {
      ctx.fillStyle = 'rgba(10,16,28,0.28)';
      ctx.fillRect(0, 0, W, H);
    }
    if (s.night > 0.03) {
      ctx.fillStyle = 'rgba(8,12,34,' + (s.night * 0.55).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      // streetlight pools along grid
      var vw = W / 1.6, x0 = cam.x - vw / 2, y0 = cam.y - (H / 1.6) / 2;
      for (var i = 0; i <= NBLK; i++) for (var j = 0; j <= NBLK; j += 2) {
        var lx = i * BLOCK + ROAD / 2, ly = j * BLOCK + ROAD / 2;
        var sx = (lx - x0) * 1.6, sy = (ly - y0) * 1.6;
        if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;
        var g = ctx.createRadialGradient(sx, sy, 4, sx, sy, 90);
        g.addColorStop(0, 'rgba(255,200,120,' + (0.20 * s.night).toFixed(2) + ')');
        g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 90, 0, 6.29); ctx.fill();
      }
      // player flashlight / car glow
      var f = player.inCar || player;
      var px = (f.x - x0) * 1.6, py = (f.y - y0) * 1.6;
      var pg = ctx.createRadialGradient(px, py, 4, px, py, 110);
      pg.addColorStop(0, 'rgba(255,240,200,' + (0.22 * s.night + 0.08).toFixed(2) + ')');
      pg.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, 110, 0, 6.29); ctx.fill();
      // wet asphalt: vertical light streaks under lamps (fake planar reflection)
      if (s.wet > 0.35) {
        ctx.fillStyle = 'rgba(255,205,130,' + (0.07 * s.wet * s.night + 0.02 * s.wet).toFixed(3) + ')';
        for (var wi = 0; wi <= NBLK; wi++) for (var wj = 0; wj <= NBLK; wj += 2) {
          var wx = (wi * BLOCK + ROAD / 2 - x0) * 1.6, wy = (wj * BLOCK + ROAD / 2 - y0) * 1.6;
          if (wx < -20 || wx > W + 20 || wy < -60 || wy > H + 60) continue;
          ctx.fillRect(wx - 5, wy, 10, 64);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (bustedFlash > 0) { ctx.fillStyle = 'rgba(40,60,255,' + (bustedFlash * 0.2).toFixed(2) + ')'; ctx.fillRect(0, 0, W, H); }
    // vignette
    var v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }
  function drawMinimap() {
    if (!mctx) return;
    var S = mini.width, k = S / WORLD;
    mctx.fillStyle = '#0b0e13'; mctx.fillRect(0, 0, S, S);
    mctx.fillStyle = '#2c333e';
    for (var i = 0; i < roadLines.length; i++) {
      mctx.fillRect(roadLines[i] * k - 1, 0, 2, S);
      mctx.fillRect(0, roadLines[i] * k - 1, S, 2);
    }
    mctx.fillStyle = '#2a6a8a'; mctx.fillRect(canal.x * k - 2, 0, 4, S);
    mctx.fillStyle = '#1a5a9a'; mctx.fillRect(WATER_X * k - 2, 0, WORLD * k - WATER_X * k + 2, S); // ocean
    mctx.fillStyle = '#ffd76c'; mctx.fillRect(dropOff.x * k - 3, dropOff.y * k - 3, 6, 6);
    mctx.fillStyle = '#6cb8ff';
    for (var j = 0; j < pickups.length; j++) if (!pickups[j].taken) mctx.fillRect(pickups[j].x * k - 2, pickups[j].y * k - 2, 4, 4);
    mctx.fillStyle = '#fff';
    for (var gi = 0; gi < gunSpots.length; gi++) if (!gunSpots[gi].taken) mctx.fillRect(gunSpots[gi].x * k - 2, gunSpots[gi].y * k - 2, 4, 4);
    // mission target blip (blinks)
    var obj = objective();
    if (obj.tx !== null && obj.tx !== undefined && Math.floor(windT * 2) % 2 === 0) {
      mctx.fillStyle = '#ff0';
      mctx.fillRect(obj.tx * k - 3, obj.ty * k - 3, 6, 6);
    }
    mctx.fillStyle = '#f00';
    for (var c = 0; c < cops.length; c++) mctx.fillRect(cops[c].x * k - 2, cops[c].y * k - 2, 4, 4);
    // player arrow
    mctx.save(); mctx.translate(player.x * k, player.y * k); mctx.rotate(player.a);
    mctx.fillStyle = '#2ecc71'; mctx.fillRect(-4, -2, 8, 4);
    mctx.fillStyle = '#fff'; mctx.fillRect(2, -1, 3, 2); mctx.restore();
  }
  function updateHud(s) {
    if (hud.hudCash) hud.hudCash.textContent = '$' + cash;
    if (hud.hudStars) hud.hudStars.textContent = wanted > 0 ? '★'.repeat(wanted) + '☆'.repeat(3 - wanted) : 'clean';
    if (hud.hudSpeed) {
      var v = player.inCar ? Math.abs(player.inCar.v) : player.speed;
      var ride = player.inCar ? ' · ' + player.inCar.spec.name + ' ' + Math.max(0, Math.round(player.inCar.hp)) + '%' : ' · foot';
      hud.hudSpeed.textContent = Math.round(v * 0.28) + ' km/h' + ride + ' · HP ' + Math.max(0, Math.round(player.hp));
    }
    if (hud.hudClock) {
      var hh = Math.floor(clock), mm = Math.floor((clock - hh) * 60);
      var wicon = s.mode === 'rain' ? '🌧' : s.mode === 'fog' ? '🌫' : s.mode === 'clouds' ? '☁' : '☀';
      hud.hudClock.textContent = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + wicon + (s.night > 0.5 ? ' night' : s.day > 0.6 ? ' day' : ' dusk');
    }
    if (hud.hudMission) hud.hudMission.textContent = curDistrict + ' · ' + objective().text;
    if (hud.hudGun) {
      hud.hudGun.textContent = player.gun ? (player.reloadT > 0 ? 'reloading…' : '🔫 ' + player.mag + '+' + player.reserve) : 'fists';
    }
    if (hud.hudMsg) hud.hudMsg.textContent = msgT > 0 ? msg : (player.inCar ? 'WASD drive · SPACE handbrake · E exit' : (player.gun ? 'WASD move · MOUSE aim · CLICK shoot · E drive' : 'WASD walk · E drive nearby car · grab briefcases + pistols'));
  }

  // ---------------- boot ----------------
  function boot() {
    if (!initRender()) return;
    reset(true);
    cam.x = player.x; cam.y = player.y;
    initInput(cv, { onPause: function (r) { say(r ? 'Resumed.' : 'Paused. (P to resume)'); } });
    var last = performance.now();
    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      try { update(dt); draw(); } catch (e) { if (hud.hudMsg) hud.hudMsg.textContent = 'Error: ' + e.message; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // expose for smoke tests: window.__altlife = {reset, state}
  window.__altlife = { boot: boot, get state() { return { cash: cash, wanted: wanted, delivered: delivered, clock: clock, px: player ? player.x : 0, py: player ? player.y : 0, district: curDistrict, missions: (mDone[0] ? 1 : 0) + (mDone[1] ? 1 : 0) + (mDone[2] ? 1 : 0), weather: weather.mode }; } };
  document.addEventListener('DOMContentLoaded', boot);
})();
