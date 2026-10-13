// ================= TACTICAL BATTLE LAYER =================
// Real-time combined-arms combat: C4ISR drones, layered air defense (SHORAD/SAM),
// EW jamming, sensor-vs-concealment, smoke, MLRS/SEAD/loitering strikes,
// destructible urban terrain, capture zones, phase flow, NATO tac-view + UAV PiP.
import * as THREE from 'three';
import { getModel, makeLabelSprite, makeNatoSprite, factionRing } from './assets.js';
import { sfx } from './audio.js';

const V3 = (x, z) => new THREE.Vector3(x, 0, z);

export const UNIT_DEFS = {
  mbt:    { name: 'MBT',         model: 'tank',    glyph: '▬', hp: 130, range: 32, dmg: 15, cd: 2.4, speed: 7.5, sensor: 40, stealth: 1,   airOnly: false },
  ifv:    { name: 'IFV',         model: 'ifv',     glyph: '◧', hp: 85,  range: 28, dmg: 9,  cd: 1.7, speed: 8.5, sensor: 38, stealth: 1,   airOnly: false },
  inf:    { name: 'Inf Squad',   model: 'soldier', glyph: '✕', hp: 55,  range: 18, dmg: 7,  cd: 1.2, speed: 5,   sensor: 22, stealth: 0.5, airOnly: false },
  shorad: { name: 'SHORAD',      model: 'shorad',  glyph: '◈', hp: 75,  range: 34, dmg: 8,  cd: 1.1, speed: 7.5, sensor: 50, stealth: 1,   airOnly: false, aaBonus: 3 },
  ew:     { name: 'EW Vehicle',  model: 'ew',      glyph: '〜', hp: 60,  range: 0,  dmg: 0,  cd: 0,   speed: 7.5, sensor: 30, stealth: 1,   airOnly: false, jam: 30 },
  drone:  { name: 'Recon UAV',   model: 'drone',   glyph: '△', hp: 32,  range: 0,  dmg: 0,  cd: 0,   speed: 14,  sensor: 62, stealth: 1,   airOnly: false, air: true },
  sam:    { name: 'SAM Battery', model: 'sam',     glyph: '⬢', hp: 95,  range: 66, dmg: 34, cd: 4.5, speed: 0,   sensor: 72, stealth: 1,   airOnly: true },
  supply: { name: 'Supply Truck',model: 'supply',  glyph: '▣', hp: 50,  range: 0,  dmg: 0,  cd: 0,   speed: 8,   sensor: 16, stealth: 1,   airOnly: false, supply: 26 }
};

let UID = 1;

export function buildForces(playerStr, enemyGar, samDisabled) {
  const blue = [];
  const n = (base, per) => Math.max(1, Math.round(base / per));
  for (let i = 0; i < n(playerStr, 3); i++) blue.push('mbt');
  for (let i = 0; i < n(playerStr, 4); i++) blue.push('ifv');
  for (let i = 0; i < n(playerStr, 3); i++) blue.push('inf');
  blue.push('shorad', 'ew', 'drone', 'supply');
  const red = [];
  for (let i = 0; i < Math.ceil(enemyGar / 2); i++) red.push('mbt');
  for (let i = 0; i < Math.ceil(enemyGar / 2); i++) red.push('ifv');
  for (let i = 0; i < enemyGar; i++) red.push('inf');
  red.push('shorad');
  if (enemyGar >= 4) red.push('shorad');
  if (!samDisabled) red.push('sam');
  if (enemyGar >= 5) red.push('ew');
  red.push('drone');
  if (enemyGar >= 5) red.push('drone');
  red.push('supply');
  return { blue, red };
}

export function createBattle(renderer, G, region, opts, api) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9db4c8);
  scene.fog = new THREE.Fog(0x9db4c8, 120, 260);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);

  scene.add(new THREE.HemisphereLight(0xcfe5ff, 0x4a5540, 1.0));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(60, 90, 30); scene.add(sun);

  const MAP = 140, HALF = MAP / 2;
  const units = [], buildings = [], rubbles = [], projectiles = [], bursts = [], smokes = [];
  const zones = [
    { id: 'A', pos: V3(-20, -2), r: 9, blue: 0, red: 0 },
    { id: 'B', pos: V3(20, -2), r: 9, blue: 0, red: 0 }
  ];
  let simSpeed = 1, tacView = false, elapsed = 0, over = false;
  let pendingOrder = null; // {kind}
  let selected = new Set();
  let phase = 0, phaseNote = '';
  let blueKills = 0, redKills = 0, mlrsUsed = 0, seadUsed = 0;
  let loiterCD = 0, mlrsCD = 0, seadCD = 0, smokeCD = 0, mortarT = 40;
  let revealFlash = new Map(); // unitId -> time revealed until (fired)
  const jamCache = new Map();

  // ---------- terrain ----------
  function groundTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d');
    x.fillStyle = '#55613f'; x.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 9000; i++) {
      x.fillStyle = `rgba(${60 + Math.random() * 40 | 0},${80 + Math.random() * 40 | 0},${45 + Math.random() * 25 | 0},0.5)`;
      x.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3);
    }
    // city concrete core
    x.fillStyle = '#6e6e68'; x.fillRect(312, 312, 400, 400);
    x.strokeStyle = '#7d7d76'; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      x.beginPath(); x.moveTo(312 + i * 50, 312); x.lineTo(312 + i * 50, 712); x.stroke();
      x.beginPath(); x.moveTo(312, 312 + i * 50); x.lineTo(712, 312 + i * 50); x.stroke();
    }
    // roads
    x.fillStyle = '#3f3f3d';
    x.fillRect(0, 492, 1024, 40); x.fillRect(492, 0, 40, 1024);
    x.fillStyle = '#c9c9c9';
    for (let i = 0; i < 64; i++) { x.fillRect(i * 16, 510, 8, 2); x.fillRect(510, i * 16, 2, 8); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP, MAP),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2; ground.name = 'ground';
  scene.add(ground);
  // outer apron so map edges never show void
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0x2e3826, roughness: 1 })
  );
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.15;
  scene.add(apron);

  function buildingTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#8b8b84'; x.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 4; r++) for (let col = 0; col < 5; col++) {
      x.fillStyle = (r * 5 + col) % 3 ? '#2c3a4a' : '#d8c87a';
      x.fillRect(8 + col * 24, 10 + r * 30, 15, 18);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const bTex = buildingTexture();
  const bGeoCache = [];
  function addBuilding(x, z, w, h, d) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ map: bTex, roughness: 0.9 })
    );
    m.position.set(x, h / 2, z);
    m.userData.building = true;
    scene.add(m);
    buildings.push({ mesh: m, hp: 130, maxHp: 130, pos: new THREE.Vector3(x, 0, z), w, d, alive: true });
    bGeoCache.push(m);
  }
  // urban core: 3x3 blocks with jitter (streets between)
  const blockPos = [-30, -10, 10, 30];
  for (const bx of [-20, 0, 20]) for (const bz of [-22, -2, 18]) {
    if (Math.abs(bx) === 20 && Math.abs(bz + 2) < 11) continue; // keep zone plazas clear-ish
    if (Math.random() < 0.15) continue;
    addBuilding(bx + (Math.random() * 4 - 2), bz + (Math.random() * 4 - 2), 7 + Math.random() * 3, 6 + Math.random() * 9, 7 + Math.random() * 3);
  }
  // trees + rocks scatter (also concealment)
  const concealSpots = [];
  {
    const treeGeo = new THREE.ConeGeometry(1.6, 4.5, 7);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2e4a26, roughness: 1 });
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.35, 1.2, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3826 });
    for (let i = 0; i < 70; i++) {
      const x = (Math.random() * 2 - 1) * (HALF - 6), z = (Math.random() * 2 - 1) * (HALF - 6);
      if (Math.abs(x) < 42 && Math.abs(z) < 42) continue;
      const t = new THREE.Mesh(treeGeo, treeMat); t.position.set(x, 3, z); scene.add(t);
      const tr = new THREE.Mesh(trunkGeo, trunkMat); tr.position.set(x, 0.6, z); scene.add(tr);
      concealSpots.push(V3(x, z));
    }
  }
  // capture zone rings
  for (const z of zones) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(z.r - 0.7, z.r, 48),
      new THREE.MeshBasicMaterial({ color: 0xffcf6e, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(z.pos.x, 0.12, z.pos.z);
    scene.add(ring); z.ring = ring;
    const lbl = makeLabelSprite('ZONE ' + z.id, { bg: 'rgba(60,45,5,0.9)', fg: '#ffcf6e' });
    lbl.position.set(z.pos.x, 9, z.pos.z); scene.add(lbl);
  }

  // ---------- units ----------
  const sideColor = { blue: 0x3fa9ff, red: 0xff5a5a };
  function inJam(pos, againstSide) {
    // jammed if inside an enemy EW bubble
    for (const u of units) {
      if (!u.alive || u.side === againstSide || !u.cfg.jam || u.type === 'sam' && u.radarDead) continue;
      if (u.side !== (againstSide === 'blue' ? 'red' : 'blue')) continue;
      if (u.pos.distanceTo(pos) < u.cfg.jam) return true;
    }
    return false;
  }
  function inSmoke(pos) { return smokes.some((s) => s.life > 0 && s.pos.distanceTo(pos) < 7); }
  function inRubble(pos) { return rubbles.some((r) => r.pos.distanceTo(pos) < 5); }
  function inCover(pos) { return concealSpots.some((p) => p.distanceToSquared(pos) < 36); }

  async function spawnUnit(side, type, x, z) {
    const cfg = UNIT_DEFS[type];
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    const { root, clips } = await getModel(cfg.model);
    const holder = new THREE.Group();
    holder.add(root);
    if (cfg.air) holder.position.y = 17;
    if (type === 'inf') holder.scale.multiplyScalar(1.1);
    grp.add(holder);
    const ring = factionRing(sideColor[side], type === 'inf' ? 2.2 : 3.0);
    grp.add(ring);
    const label = makeLabelSprite(`${side === 'blue' ? 'B' : 'R'}·${cfg.name}`, {
      bg: side === 'blue' ? 'rgba(10,50,110,0.85)' : 'rgba(110,15,15,0.85)'
    });
    label.position.y = cfg.air ? 24 : 7.5;
    grp.add(label);
    const nato = makeNatoSprite(side, cfg.glyph);
    nato.position.y = cfg.air ? 24 : 8;
    nato.visible = false;
    grp.add(nato);
    scene.add(grp);
    let mixer = null;
    if (clips && clips.length) {
      mixer = new THREE.AnimationMixer(root);
      for (const c of clips.slice(0, 1)) { mixer.clipAction(c).play(); }
    }
    const u = {
      id: UID++, side, type, cfg, grp, holder, label, nato, ring, mixer,
      hp: cfg.hp, maxHp: cfg.hp, pos: grp.position, yaw: side === 'blue' ? Math.PI : 0,
      cd: Math.random(), order: null, alive: true, designated: 0,
      anchor: cfg.air ? V3(x, z) : null, orbitA: Math.random() * Math.PI * 2,
      revealUntil: 0, outOfSupply: false, selRing: null, hpCanvas: null
    };
    if (side === 'blue') u.yaw = Math.PI;
    grp.rotation.y = u.yaw;
    units.push(u);
    return u;
  }

  // muzzle / tracer / explosion helpers
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95 });
  function tracer(a, b, color = 0xffe08a) {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const l = new THREE.Line(g, tracerMat.clone());
    l.material.color.setHex(color);
    scene.add(l);
    bursts.push({ mesh: l, life: 0.12, max: 0.12, kind: 'fade' });
  }
  const boomLights = [new THREE.PointLight(0xffa040, 0, 40), new THREE.PointLight(0xffa040, 0, 40)];
  scene.add(boomLights[0], boomLights[1]);
  let boomIdx = 0;
  function explode(pos, big = 1) {
    const n = Math.floor(26 * big);
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), v = [];
    for (let i = 0; i < n; i++) {
      p.set([pos.x, pos.y + 1, pos.z], i * 3);
      v.push(new THREE.Vector3((Math.random() - 0.5) * 14 * big, Math.random() * 12 * big, (Math.random() - 0.5) * 14 * big));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff9040, size: 0.9 * big, transparent: true, opacity: 1 }));
    scene.add(pts);
    bursts.push({ mesh: pts, life: 0.7, max: 0.7, kind: 'boom', vel: v });
    const L = boomLights[boomIdx++ % 2];
    L.position.set(pos.x, 4, pos.z); L.intensity = 60 * big;
    bursts.push({ mesh: null, light: L, life: 0.25, max: 0.25, kind: 'light' });
    playThrottled('boom', () => sfx.boom());
  }
  const sndThrottle = {};
  function playThrottled(key, fn, ms = 120) {
    const t = performance.now();
    if (!sndThrottle[key] || t - sndThrottle[key] > ms) { sndThrottle[key] = t; fn(); }
  }
  function smokePuff(pos) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 4, 32, 32, 30);
    g.addColorStop(0, 'rgba(220,220,220,0.85)'); g.addColorStop(1, 'rgba(220,220,220,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sp.position.set(pos.x + (Math.random() * 6 - 3), 2.5, pos.z + (Math.random() * 6 - 3));
    sp.scale.set(7, 7, 1);
    scene.add(sp);
    smokes.push({ mesh: sp, life: 20, max: 20, pos: pos.clone() });
  }

  function damageUnit(u, dmg, from) {
    if (!u.alive || over) return;
    if (inRubble(u.pos)) dmg *= 0.8;
    u.hp -= dmg;
    u.revealUntil = elapsed + 6; // firing / being hit exposes you
    if (from) from.revealUntil = elapsed + 6;
    updateHpBar(u);
    if (u.hp <= 0) killUnit(u, from);
  }
  function updateHpBar(u) {
    // recolor label border by hp: recreate cheaply via material color on ring
    u.ring.material.color.setHex(u.hp / u.maxHp > 0.5 ? sideColor[u.side] : u.hp / u.maxHp > 0.25 ? 0xffb35a : 0xff3030);
  }
  function killUnit(u, from) {
    u.alive = false;
    explode(u.pos, u.type === 'inf' ? 0.7 : 1.4);
    u.grp.visible = false;
    if (u.side === 'red') { blueKills++; } else { redKills++; api.toast(u.side === 'blue' ? `✖ Lost ${u.cfg.name}` : `✔ Destroyed enemy ${u.cfg.name}`); }
    selected.delete(u);
    refreshCards();
  }
  function damageBuilding(b, dmg) {
    if (!b.alive) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      b.alive = false;
      explode(b.pos, 2.0);
      scene.remove(b.mesh);
      const r = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 0.9, 1.4, b.d * 0.9),
        new THREE.MeshStandardMaterial({ color: 0x4c4a44, roughness: 1 })
      );
      r.position.set(b.pos.x, 0.7, b.pos.z);
      r.rotation.y = Math.random();
      scene.add(r);
      rubbles.push({ mesh: r, pos: b.pos.clone() });
      api.log('🏚 Building collapsed — rubble now gives cover.');
    }
  }

  // ---------- detection ----------
  function detectFactor(observer, target) {
    let f = target.cfg.stealth;
    if (observer.type === 'drone') f = Math.max(f, 0.9); // aerial ISR sees through foliage
    if (inSmoke(target.pos) || inSmoke(observer.pos)) f *= 0.35;
    if (inRubble(target.pos) || inCover(target.pos)) f *= 0.7;
    if (inJam(target.pos, observer.side)) f *= 0.45; // EW screens signatures
    return f;
  }
  function canSee(observer, target) {
    if (!target.alive || target.cfg.air && observer.cfg.airOnly && false) return false;
    if (observer.cfg.airOnly && !target.cfg.air) return false; // SAM/SHORAD-AA only engage air... SHORAD has ground mode
    const d = observer.pos.distanceTo(target.pos);
    const eff = observer.cfg.sensor * detectFactor(observer, target);
    if (d > eff) return false;
    if (target.revealUntil > elapsed) return true;
    return true;
  }
  function visibleToPlayer(u) {
    if (u.side === 'blue') return true;
    if (u.revealUntil > elapsed) return true;
    for (const b of units) {
      if (!b.alive || b.side !== 'blue') continue;
      if (b.cfg.airOnly && !u.cfg.air && b.type === 'sam') continue;
      const d = b.pos.distanceTo(u.pos);
      if (d < b.cfg.sensor * detectFactor(b, u)) return true;
    }
    return false;
  }

  // ---------- combat tick ----------
  function acquireShooter(u) {
    if (u.cfg.range <= 0 || !u.alive) return null;
    let best = null, bestD = 1e9;
    for (const e of units) {
      if (!e.alive || e.side === u.side) continue;
      if (u.type === 'sam' && (u.radarDead || !e.cfg.air)) continue;
      if (u.type === 'sam' && inJam(e.pos, u.side)) continue; // jammed — no lock
      if (u.cfg.airOnly && !e.cfg.air) continue;
      if (!canSee(u, e)) continue;
      const d = u.pos.distanceTo(e.pos);
      const range = u.type === 'shorad' && e.cfg.air ? u.cfg.range + 8 : u.cfg.range;
      if (d < range && d < bestD) { best = e; bestD = d; }
    }
    // SHORAD ground fallback handled since airOnly false
    return best;
  }

  function fireAt(u, t) {
    u.cd = u.cfg.cd;
    u.revealUntil = elapsed + 6;
    const from = u.pos.clone(); from.y = u.cfg.air ? 17 : 2.5;
    const to = t.pos.clone(); to.y = t.cfg.air ? 17 : 1.5;
    const isAA = u.type === 'shorad' || u.type === 'sam';
    tracer(from, to, u.side === 'blue' ? 0x9adcff : 0xffb08a);
    playThrottled('shoot', () => sfx.shoot());
    if (u.type === 'sam') {
      playThrottled('sam', () => sfx.sam(), 800);
      projectiles.push({ kind: 'sam', from: from.clone(), target: t, speed: 40, life: 4, dmg: u.cfg.dmg, side: u.side, mesh: null });
      return;
    }
    let dmg = u.cfg.dmg * (0.8 + Math.random() * 0.4);
    if (u.type === 'shorad' && t.cfg.air) dmg *= u.cfg.aaBonus;
    if (u.type === 'shorad' && !t.cfg.air) dmg *= 0.6;
    if (t.designated > elapsed) dmg *= 1.35;
    if (u.side === 'blue' && u.outOfSupply) dmg *= 0.7;
    if (u.side === 'red' && redSupplyBad(u)) dmg *= 0.7;
    damageUnit(t, dmg, u);
    explode(to, 0.35);
    // splash vs buildings
    for (const b of buildings) {
      if (b.alive && b.pos.distanceTo(t.pos) < 5) damageBuilding(b, dmg * 0.5);
    }
  }
  function redSupplyBad(u) { return u.pos.z < -20 ? false : u.pos.z > 25; }

  // ---------- orders / abilities ----------
  function issueOrder(u, kind, point, targetUnit) {
    if (!u.alive || u.side !== 'blue') return;
    if (u.type === 'sam') return;
    if (kind === 'move' || kind === 'attackmove') {
      if (u.cfg.air) u.anchor = V3(THREE.MathUtils.clamp(point.x, -HALF, HALF), THREE.MathUtils.clamp(point.z, -HALF, HALF));
      else u.order = { kind, x: THREE.MathUtils.clamp(point.x, -HALF + 2, HALF - 2), z: THREE.MathUtils.clamp(point.z, -HALF + 2, HALF - 2), target: targetUnit || null };
      playThrottled('order', () => sfx.order());
    }
  }
  function ability(kind, point, targetUnit) {
    const sel = [...selected].filter((u) => u.alive);
    if (kind === 'smoke') {
      if (smokeCD > 0) return api.toast('Smoke recharging…');
      if (!sel.length) return api.toast('Select friendly vehicles first');
      smokeCD = 30;
      for (const u of sel) { if (!u.cfg.air) { smokePuff(u.pos); smokePuff(u.pos); } }
      api.log('💨 Smoke screen deployed — thermal/optical concealment.');
      return;
    }
    if (kind === 'mlrs') {
      if (mlrsCD > 0) return api.toast('MLRS reloading…');
      if (G.munitions < 20) { sfx.error(); return api.toast('Need 20 🚀 munitions'); }
      if (!point) { pendingOrder = { kind }; return api.toast('Click target area for MLRS barrage'); }
      G.munitions -= 20; mlrsCD = 40; mlrsUsed++;
      api.strikes.push({ kind: 'mlrs', pos: point.clone(), t: 4 });
      api.log('🚀 MLRS mission tasked — splash in 4s. Clear the grid!');
      sfx.sam(); pendingOrder = null; api.refresh();
      return;
    }
    if (kind === 'sead') {
      if (seadCD > 0) return api.toast('SEAD package regrouping…');
      if (G.munitions < 15) { sfx.error(); return api.toast('Need 15 🚀 munitions'); }
      const sam = units.find((u) => u.alive && u.side === 'red' && u.type === 'sam' && !u.radarDead);
      if (!sam) { sfx.error(); return api.toast('No active enemy SAM radar (need recon to reveal)'); }
      if (!visibleToPlayer(sam)) { sfx.error(); return api.toast('SAM not yet located — push recon forward'); }
      G.munitions -= 15; seadCD = 50; seadUsed++;
      api.strikes.push({ kind: 'sead', target: sam, t: 5 });
      api.log('✈ Wild-Weasel SEAD tasked against enemy SAM — impact in 5s.');
      sfx.sam(); api.refresh();
      return;
    }
    if (kind === 'loiter') {
      if (loiterCD > 0) return api.toast('Loitering munition re-arming…');
      const drone = units.find((u) => u.alive && u.side === 'blue' && u.type === 'drone');
      if (!drone) { sfx.error(); return api.toast('Your recon UAV is down'); }
      if (!targetUnit || targetUnit.side !== 'red') { pendingOrder = { kind }; return api.toast('Click a revealed enemy for the loitering strike'); }
      if (!visibleToPlayer(targetUnit)) { sfx.error(); return api.toast('Target not visible — no lock'); }
      if (inJam(targetUnit.pos, 'blue')) { sfx.error(); return api.toast('Target screened by enemy EW jamming'); }
      if (G.munitions < 10) { sfx.error(); return api.toast('Need 10 🚀 munitions'); }
      G.munitions -= 10; loiterCD = 45;
      projectiles.push({ kind: 'loiter', from: drone.pos.clone().setY(17), target: targetUnit, speed: 26, life: 8, dmg: 65, side: 'blue', mesh: null });
      api.log('🛩 Loitering munition away — guiding to target.');
      sfx.sam(); pendingOrder = null; api.refresh();
    }
  }

  // off-map strikes + red mortars
  api.strikes = [];
  function updateStrikes(dt) {
    for (let i = api.strikes.length - 1; i >= 0; i--) {
      const s = api.strikes[i];
      s.t -= dt;
      if (s.t <= 0) {
        api.strikes.splice(i, 1);
        if (s.kind === 'mlrs') {
          for (let k = 0; k < 8; k++) {
            const p = s.pos.clone(); p.x += Math.random() * 10 - 5; p.z += Math.random() * 10 - 5;
            setTimeout(() => {
              if (over) return;
              explode(p, 1.1);
              for (const u of units) if (u.alive && !u.cfg.air && u.pos.distanceTo(p) < 7) damageUnit(u, 26, null);
              for (const b of buildings) if (b.alive && b.pos.distanceTo(p) < 7) damageBuilding(b, 40);
            }, k * 160);
          }
          checkPhase();
        } else if (s.kind === 'sead') {
          if (s.target.alive && !s.target.radarDead) {
            s.target.radarDead = true;
            explode(s.target.pos, 2.2);
            api.log('💥 SEAD kill — enemy long-range SAM radar destroyed. Air corridor open.');
            api.toast('💥 Enemy SAM radar DESTROYED');
            checkPhase();
          }
        } else if (s.kind === 'mortar') {
          explode(s.pos, 1.0);
          for (const u of units) if (u.alive && u.side === 'blue' && !u.cfg.air && u.pos.distanceTo(s.pos) < 6.5) damageUnit(u, 22, null);
        }
      }
    }
  }

  // ---------- selection + input ----------
  const ray = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();
  let lDown = false, lStart = null, rDown = false;
  const dom = renderer.domElement;
  // camera rig
  const rig = { tx: 0, tz: 0, yaw: 0, pitch: 0.9, dist: 70 };

  function pickGround(e) {
    const rect = dom.getBoundingClientRect();
    mouseNDC.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(mouseNDC, camera);
    const hit = ray.intersectObject(ground, false)[0];
    return hit ? hit.point : null;
  }
  function pickUnit(e, side = 'blue') {
    const rect = dom.getBoundingClientRect();
    mouseNDC.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(mouseNDC, camera);
    const meshes = [];
    for (const u of units) {
      if (!u.alive) continue;
      if (u.side === 'red' && !visibleToPlayer(u)) continue;
      if (side !== 'any' && u.side !== side) continue;
      meshes.push(u.grp);
    }
    const hit = ray.intersectObjects(meshes, true)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && !units.some((u) => u.grp === o)) o = o.parent;
    return units.find((u) => u.grp === o) || null;
  }

  let boxEl = null;
  function onPointerDown(e) {
    if (over) return;
    if (e.button === 0) { lDown = true; lStart = { x: e.clientX, y: e.clientY }; }
    if (e.button === 2) { rDown = true; }
  }
  function onPointerMove(e) {
    if (rDown) { rig.yaw -= e.movementX * 0.005; rig.pitch = THREE.MathUtils.clamp(rig.pitch + e.movementY * 0.004, 0.25, 1.45); }
    if (lDown && lStart && (Math.abs(e.clientX - lStart.x) + Math.abs(e.clientY - lStart.y) > 8)) {
      if (!boxEl) {
        boxEl = document.createElement('div');
        boxEl.style.cssText = 'position:fixed;border:1px solid #ffcf6e;background:rgba(255,207,110,0.12);z-index:40;pointer-events:none;';
        document.body.appendChild(boxEl);
      }
      const x = Math.min(e.clientX, lStart.x), y = Math.min(e.clientY, lStart.y);
      boxEl.style.left = x + 'px'; boxEl.style.top = y + 'px';
      boxEl.style.width = Math.abs(e.clientX - lStart.x) + 'px';
      boxEl.style.height = Math.abs(e.clientY - lStart.y) + 'px';
    }
  }
  function onPointerUp(e) {
    if (e.button === 2) { rDown = false; return; }
    if (e.button !== 0) return;
    const wasBox = boxEl !== null;
    if (boxEl) { boxEl.remove(); boxEl = null; }
    lDown = false;
    if (over) return;
    if (wasBox && lStart) {
      selectBox(lStart.x, lStart.y, e.clientX, e.clientY, e.shiftKey);
    } else {
      handleClick(e, e.shiftKey);
    }
    lStart = null;
  }
  function selectBox(x0, y0, x1, y1, add) {
    const rx0 = Math.min(x0, x1), rx1 = Math.max(x0, x1), ry0 = Math.min(y0, y1), ry1 = Math.max(y0, y1);
    if (!add) selected.clear();
    const rect = dom.getBoundingClientRect();
    for (const u of units) {
      if (!u.alive || u.side !== 'blue') continue;
      const p = u.pos.clone(); p.y = 2;
      p.project(camera);
      const sx = rect.left + (p.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
      if (sx > rx0 && sx < rx1 && sy > ry0 && sy < ry1) selected.add(u);
    }
    if (selected.size) sfx.select();
    refreshCards();
  }
  function handleClick(e, add) {
    const redHit = pickUnit(e, 'any');
    // pending ability targeting
    if (pendingOrder) {
      const k = pendingOrder.kind;
      if (k === 'mlrs') { const p = pickGround(e); if (p) ability('mlrs', p); return; }
      if (k === 'loiter') {
        if (redHit && redHit.side === 'red') ability('loiter', null, redHit);
        else { api.toast('Click a visible enemy unit'); }
        return;
      }
      pendingOrder = null;
    }
    if (redHit && redHit.side === 'blue') {
      if (!add) selected.clear();
      selected.add(redHit); sfx.select(); refreshCards(); return;
    }
    if (redHit && redHit.side === 'red') {
      // attack order
      if (selected.size) {
        for (const u of selected) if (!u.cfg.air && u.cfg.range > 0) u.order = { kind: 'attack', target: redHit };
        else if (u.cfg.air) u.anchor = V3(redHit.pos.x, redHit.pos.z);
        playThrottled('order', () => sfx.order());
      }
      return;
    }
    const p = pickGround(e);
    if (p && selected.size && !pendingOrder) {
      for (const u of [...selected]) issueOrder(u, 'move', p);
      return;
    }
    if (p && selected.size && pendingOrder?.kind === 'attackmove') {
      for (const u of [...selected]) issueOrder(u, 'attackmove', p);
      pendingOrder = null;
      return;
    }
    if (!add) { selected.clear(); refreshCards(); }
  }
  function onContext(e) {
    e.preventDefault();
    if (over) return;
    const redHit = pickUnit(e, 'any');
    if (pendingOrder?.kind === 'mlrs') { const p = pickGround(e); if (p) ability('mlrs', p); return; }
    if (pendingOrder?.kind === 'loiter') {
      if (redHit?.side === 'red') ability('loiter', null, redHit);
      return;
    }
    const p = pickGround(e);
    if (pendingOrder?.kind === 'attackmove') {
      if (p && selected.size) {
        for (const u of [...selected]) issueOrder(u, 'attackmove', p);
        pendingOrder = null;
      }
      return;
    }
    if (redHit?.side === 'red' && selected.size) {
      for (const u of selected) {
        if (!u.cfg.air && u.cfg.range > 0) u.order = { kind: 'attack', target: redHit };
        else if (u.cfg.air && u.type === 'drone') u.anchor = V3(redHit.pos.x, redHit.pos.z);
      }
      playThrottled('order', () => sfx.order());
      return;
    }
    if (p && selected.size) for (const u of [...selected]) issueOrder(u, e.shiftKey ? 'attackmove' : 'move', p);
  }
  function onWheel(e) { e.preventDefault(); rig.dist = THREE.MathUtils.clamp(rig.dist + e.deltaY * 0.05, 18, 150); }
  const keys = {};
  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT') return;
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') { e.preventDefault(); toggleSpeed(); }
    if (e.key.toLowerCase() === 'a') pendingOrder = { kind: 'attackmove' }, api.toast('Attack-Move: right-click destination');
    if (e.key.toLowerCase() === 's') for (const u of selected) u.order = null;
    if (e.key.toLowerCase() === 't') toggleTac();
    if (e.key.toLowerCase() === 'm') ability('mlrs');
    if (e.key.toLowerCase() === 'd') ability('sead');
    if (e.key.toLowerCase() === 'l') ability('loiter');
    if (e.key.toLowerCase() === 'g') ability('smoke');
  }
  function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('contextmenu', onContext);
  dom.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // order buttons
  document.querySelectorAll('#orders [data-ord]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.ord;
      if (k === 'move') { pendingOrder = null; api.toast('Right-click to move'); }
      else if (k === 'attackmove') { pendingOrder = { kind: 'attackmove' }; api.toast('Attack-Move: right-click destination'); }
      else if (k === 'stop') { for (const u of selected) u.order = null; }
      else ability(k);
    };
  });
  function toggleSpeed() {
    simSpeed = simSpeed === 1 ? 2.5 : 1;
    document.getElementById('btn-speed').textContent = simSpeed === 1 ? '⏩ 1× [Space]' : '⏩ 2.5× [Space]';
  }
  function toggleTac() {
    tacView = !tacView;
    document.getElementById('btn-tacview').classList.toggle('active', tacView);
    for (const u of units) {
      u.holder.visible = !tacView;
      u.label.visible = !tacView;
      u.nato.visible = tacView || (u.side === 'red' && false);
      if (!tacView && u.side === 'blue') u.nato.visible = false;
    }
    api.toast(tacView ? '🗺 NATO blue-force tracker' : '🎥 Cinematic command view');
  }
  document.getElementById('btn-tacview').onclick = toggleTac;
  document.getElementById('btn-speed').onclick = toggleSpeed;

  // ---------- HUD cards ----------
  function refreshCards() {
    const el = document.getElementById('unit-cards');
    el.innerHTML = '';
    for (const u of units) {
      if (u.side !== 'blue') continue;
      const d = document.createElement('div');
      d.className = 'ucard' + (selected.has(u) ? ' sel' : '') + (!u.alive ? ' dead' : '');
      d.innerHTML = `<b>${u.cfg.name}</b><br><span class="dim">${u.outOfSupply ? '⚠ NO SUPPLY' : u.designated ? '' : ''}${u.type === 'drone' ? '🛩' : 'HP ' + Math.max(0, Math.ceil(u.hp))}</span><div class="hp"><div style="width:${Math.max(0, u.hp / u.maxHp * 100)}%"></div></div>`;
      d.onclick = () => { selected.clear(); selected.add(u); sfx.select(); refreshCards(); };
      el.appendChild(d);
    }
    const s = [...selected].filter((u) => u.alive);
    document.getElementById('sel-info').textContent = s.length ? `${s.length} selected` : '';
  }

  // ---------- enemy AI ----------
  let aiT = 0;
  function aiTick(dt) {
    aiT += dt;
    if (aiT < 0.6) return;
    aiT = 0;
    for (const u of units) {
      if (!u.alive || u.side !== 'red') continue;
      if (u.cfg.air) {
        // red drones harass: orbit nearest blue
        const tgt = nearestEnemy(u, 'blue');
        if (tgt) u.anchor = V3(tgt.pos.x + Math.sin(elapsed * 0.3) * 10, tgt.pos.z + Math.cos(elapsed * 0.3) * 10);
        // designate
        if (tgt && u.pos.distanceTo(tgt.pos) < 42 && !inJam(tgt.pos, 'red')) tgt.designated = elapsed + 2;
        continue;
      }
      if (u.type === 'sam' || u.type === 'supply') continue;
      const foe = nearestVisibleEnemy(u);
      if (foe) {
        // engage: close to 70% range, hold
        const d = u.pos.distanceTo(foe.pos);
        if (u.type === 'shorad') {
          // escort sam / hunt drones
          const drone = units.find((b) => b.alive && b.side === 'blue' && b.cfg.air && canSee(u, b));
          if (drone && u.pos.distanceTo(drone.pos) < u.cfg.range + 8) { u.order = { kind: 'attack', target: drone }; continue; }
        }
        if (d > u.cfg.range * 0.75 && !u.cfg.airOnly) u.order = { kind: 'attack', target: foe };
        else u.order = { kind: 'attack', target: foe };
      } else if (elapsed < 60) {
        // opening minute: red holds defensive ground, only drones roam
        if (!u.order || u.order.kind === 'attackmove') u.order = null;
      } else {
        // push to weakest zone / last known
        const z = zones[Math.random() < 0.5 ? 0 : 1];
        if (!u.order || u.order.kind === 'attack' && (!u.order.target || !u.order.target.alive)) {
          u.order = { kind: 'attackmove', x: z.pos.x + (Math.random() * 8 - 4), z: z.pos.z + (Math.random() * 8 - 4) };
        }
      }
    }
    // red mortar pressure every ~55s on blue clusters
    mortarT -= 0.6;
    if (mortarT <= 0) {
      mortarT = 50 + Math.random() * 20;
      const blues = units.filter((u) => u.alive && u.side === 'blue' && !u.cfg.air);
      if (blues.length >= 2) {
        const c = blues[Math.floor(Math.random() * blues.length)].pos.clone();
        api.strikes.push({ kind: 'mortar', pos: c, t: 3 });
        api.toast('⚠ Incoming enemy mortar fire! Disperse!');
        sfx.alarm();
      }
    }
  }
  function nearestEnemy(u, side) {
    let best = null, bd = 1e9;
    for (const e of units) {
      if (!e.alive || e.side !== side || e.cfg.air) continue;
      const d = u.pos.distanceTo(e.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function nearestVisibleEnemy(u) {
    let best = null, bd = 1e9;
    for (const e of units) {
      if (!e.alive || e.side === u.side) continue;
      if (!canSee(u, e)) continue;
      const d = u.pos.distanceTo(e.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---------- phases ----------
  function redTotal() { return units.filter((u) => u.side === 'red' && u.type !== 'supply').length; }
  function redRevealed() { return units.filter((u) => u.side === 'red' && u.type !== 'supply' && visibleToPlayer(u)).length; }
  function samDead() { return !units.some((u) => u.side === 'red' && u.type === 'sam' && u.alive && !u.radarDead); }
  function checkPhase() {
    if (phase === 0 && (redRevealed() >= redTotal() * 0.6 || elapsed > 120)) return setPhase(1);
    if (phase === 1 && (samDead() && (mlrsUsed > 0 || elapsed > 200))) return setPhase(2);
    if (phase === 2 && zones.some((z) => z.blue > 5)) return setPhase(3);
  }
  function setPhase(p) {
    phase = p;
    document.querySelectorAll('#phase-bar .phase').forEach((el, i) => {
      el.classList.toggle('done', i < p);
      el.classList.toggle('now', i === p);
    });
    const msgs = [
      '', 'Phase 2 — SEAD & Shaping: kill the SAM radar (D), shape with MLRS (M).',
      'Phase 3 — Combined-arms assault: push armor under SHORAD cover, use smoke (G).',
      'Phase 4 — Urban clearance: hold both plazas, clear block by block.'
    ];
    if (msgs[p]) { api.log(msgs[p]); api.toast(msgs[p]); sfx.capture(); }
  }

  // ---------- per-frame ----------
  function stepUnit(u, dt) {
    if (!u.alive) return;
    if (u.mixer) u.mixer.update(dt);
    // supply state (blue: tether to south edge + supply trucks)
    if (u.side === 'blue' && !u.cfg.air) {
      let ok = u.pos.z > 5; // forward logistics reach
      for (const s of units) if (s.alive && s.side === 'blue' && s.type === 'supply' && s.pos.distanceTo(u.pos) < s.cfg.supply) { ok = true; break; }
      u.outOfSupply = !ok;
    }
    // movement
    if (u.cfg.air) {
      u.orbitA += dt * 0.5;
      const t = V3(u.anchor.x + Math.cos(u.orbitA) * 9, u.anchor.z + Math.sin(u.orbitA) * 9);
      const cur = u.pos.clone(); cur.y = 0;
      const d = t.clone().sub(cur); d.y = 0;
      if (d.length() > 1) {
        d.normalize();
        const step = Math.min(d.length(), u.cfg.speed * dt);
        u.pos.x += d.x * step; u.pos.z += d.z * step;
        u.yaw = Math.atan2(d.x, d.z);
      }
      // auto-designate nearest visible red
      if (u.side === 'blue') {
        let best = null, bd = 1e9;
        for (const e of units) {
          if (!e.alive || e.side === 'blue' || e.cfg.air) continue;
          const dd = u.pos.distanceTo(e.pos);
          if (dd < 42 && dd < bd && canSee(u, e)) { bd = dd; best = e; }
        }
        if (best && !inJam(best.pos, 'blue')) best.designated = elapsed + 1.5;
      }
    } else if (u.order) {
      const o = u.order;
      let tx, tz, done = false;
      if (o.kind === 'attack' && o.target) {
        if (!o.target.alive) { u.order = null; }
        else {
          tx = o.target.pos.x; tz = o.target.pos.z;
          const d = Math.hypot(tx - u.pos.x, tz - u.pos.z);
          const want = u.cfg.range * 0.8;
          if (u.cfg.range <= 0 || d <= want) done = true;
          else { tx = u.pos.x + (tx - u.pos.x) * (1 - want / d); tz = u.pos.z + (tz - u.pos.z) * (1 - want / d); }
        }
      } else if (o.kind === 'move' || o.kind === 'attackmove') { tx = o.x; tz = o.z; }
      if (u.order && !done) {
        const dx = tx - u.pos.x, dz = tz - u.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) { if (o.kind === 'move') u.order = null; }
        else {
          let sp = u.cfg.speed * (u.outOfSupply ? 0.85 : 1);
          const step = Math.min(d, sp * dt);
          u.pos.x += (dx / d) * step; u.pos.z += (dz / d) * step;
          u.yaw = Math.atan2(dx, dz);
          // attackmove: halt to engage
          if (o.kind === 'attackmove') {
            const foe = nearestVisibleEnemy(u);
            if (foe && u.pos.distanceTo(foe.pos) < u.cfg.range * 0.9) u.order = { kind: 'attack', target: foe };
          }
        }
      }
    }
    u.pos.x = THREE.MathUtils.clamp(u.pos.x, -HALF + 1, HALF - 1);
    u.pos.z = THREE.MathUtils.clamp(u.pos.z, -HALF + 1, HALF - 1);
    u.grp.rotation.y = u.yaw;
    // firing
    if (u.cd > 0) u.cd -= dt;
    if (u.cd <= 0 && u.cfg.range > 0) {
      let tgt = null;
      if (u.order?.kind === 'attack' && u.order.target?.alive) {
        const t = u.order.target;
        const range = u.type === 'shorad' && t.cfg.air ? u.cfg.range + 8 : u.cfg.range;
        if (u.pos.distanceTo(t.pos) < range && canSee(u, t)) tgt = t;
        else if (u.side === 'red' || !t.cfg) tgt = acquireShooter(u);
        else tgt = acquireShooter(u);
      } else tgt = acquireShooter(u);
      if (tgt) fireAt(u, tgt);
    }
    // visibility to player
    if (u.side === 'red') {
      const vis = visibleToPlayer(u);
      u.grp.visible = vis;
      if (!vis && selected.has(u)) selected.delete(u);
    }
  }

  function updateFx(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.life -= dt;
      if (b.life <= 0) {
        if (b.mesh) { scene.remove(b.mesh); b.mesh.geometry?.dispose?.(); }
        if (b.light) b.light.intensity = 0;
        bursts.splice(i, 1); continue;
      }
      const k = b.life / b.max;
      if (b.kind === 'fade' && b.mesh) b.mesh.material.opacity = k;
      if (b.kind === 'boom' && b.mesh) {
        const p = b.mesh.geometry.attributes.position;
        for (let j = 0; j < p.count; j++) {
          p.array[j * 3] += b.vel[j].x * dt;
          p.array[j * 3 + 1] += b.vel[j].y * dt;
          p.array[j * 3 + 2] += b.vel[j].z * dt;
          b.vel[j].y -= 18 * dt;
        }
        p.needsUpdate = true;
        b.mesh.material.opacity = k;
      }
    }
    for (let i = smokes.length - 1; i >= 0; i--) {
      const s = smokes[i];
      s.life -= dt;
      if (s.life <= 0) { scene.remove(s.mesh); smokes.splice(i, 1); continue; }
      s.mesh.material.opacity = Math.min(1, s.life / 5);
      s.mesh.position.y += dt * 0.4;
    }
    // homing projectiles (SAM / loitering)
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      if (!p.target.alive || p.life <= 0) {
        if (p.target.alive && p.life <= 0) { damageUnit(p.target, p.dmg * 0.5, null); explode(p.target.pos, 0.8); }
        if (p.mesh) scene.remove(p.mesh);
        projectiles.splice(i, 1); continue;
      }
      if (!p.mesh) {
        p.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: p.kind === 'sam' ? 0xff6040 : 0x9adcff }));
        p.mesh.position.copy(p.from);
        scene.add(p.mesh);
      }
      const tp = p.target.pos.clone(); tp.y = p.target.cfg.air ? 17 : 1.5;
      const d = tp.clone().sub(p.mesh.position);
      const dist = d.length();
      if (dist < 1.6) {
        damageUnit(p.target, p.dmg, null);
        explode(tp, p.kind === 'sam' ? 1.0 : 1.5);
        for (const u of units) if (u.alive && u !== p.target && u.pos.distanceTo(p.target.pos) < 5 && !u.cfg.air) damageUnit(u, p.dmg * 0.4, null);
        scene.remove(p.mesh);
        projectiles.splice(i, 1); continue;
      }
      d.normalize();
      p.mesh.position.addScaledVector(d, p.speed * dt);
      if (Math.random() < 0.5) tracer(p.mesh.position.clone(), p.mesh.position.clone().addScaledVector(d, -2), 0xffcf6e);
    }
  }

  function updateZones(dt) {
    // plazas go "hot" after 45s — no cheap wins off the deployment line
    if (elapsed > 45) {
      for (const z of zones) {
        const blues = units.filter((u) => u.alive && u.side === 'blue' && !u.cfg.air && u.pos.distanceTo(z.pos) < z.r).length;
        const reds = units.filter((u) => u.alive && u.side === 'red' && !u.cfg.air && u.pos.distanceTo(z.pos) < z.r).length;
        if (blues > 0 && reds === 0) { z.blue += dt; if (Math.floor(z.blue) !== Math.floor(z.blue - dt)) playThrottled('cap', () => sfx.capture(), 900); }
        if (reds > 0 && blues === 0) z.red += dt;
        z.ring.material.color.setHex(z.blue > z.red ? 0x3fa9ff : z.red > z.blue ? 0xff5a5a : 0xffcf6e);
      }
    }
    document.getElementById('b-zones').innerHTML =
      `A ${zones[0].blue >= 30 ? '🔵' : zones[0].red >= 30 ? '🔴' : '◯'}&nbsp;&nbsp;B ${zones[1].blue >= 30 ? '🔵' : zones[1].red >= 30 ? '🔴' : '◯'}`;
  }

  function checkEnd() {
    if (over) return;
    const blueAlive = units.some((u) => u.alive && u.side === 'blue' && u.type !== 'supply');
    const redAlive = units.some((u) => u.alive && u.side === 'red' && u.type !== 'supply');
    const zoneWin = zones.every((z) => z.blue >= 30);
    const zoneLose = zones.every((z) => z.red >= 30);
    if ((!redAlive || zoneWin)) return finish(true, redAlive ? 'Both city plazas secured — enemy command collapses.' : 'Enemy battlegroup annihilated.');
    if (!blueAlive || zoneLose) return finish(false, !blueAlive ? 'Your battlegroup was wiped out.' : 'Enemy holds both plazas.');
    if (elapsed > 720) {
      const bh = units.filter((u) => u.alive && u.side === 'blue').reduce((s, u) => s + u.hp, 0);
      const rh = units.filter((u) => u.alive && u.side === 'red').reduce((s, u) => s + u.hp, 0);
      return finish(bh >= rh, 'Time expired — decision by remaining combat power.');
    }
  }
  function finish(won, detail) {
    over = true;
    const mins = Math.floor(elapsed / 60), secs = Math.floor(elapsed % 60);
    const report = `${detail} Time ${mins}:${String(secs).padStart(2, '0')} · Enemy destroyed: ${blueKills} · Own losses: ${redKills} · Munitions left: ${G.munitions} 🚀`;
    api.log(won ? `✅ BATTLE WON — ${region.name}: ${report}` : `❌ BATTLE LOST — ${region.name}: ${report}`);
    if (won) sfx.win(); else sfx.lose();
    setTimeout(() => api.onEnd(won, report), 1600);
  }

  // drone chase cam for PiP
  const droneCam = new THREE.PerspectiveCamera(40, 220 / 130, 0.5, 400);

  function updateCamera(dt) {
    const sp = 34 * dt * (rig.dist / 70);
    if (keys['arrowup']) rig.tz -= sp;
    if (keys['arrowdown']) rig.tz += sp;
    if (keys['arrowleft']) rig.tx -= sp;
    if (keys['arrowright']) rig.tx += sp;
    if (keys['q']) rig.yaw += dt * 1.2; if (keys['e']) rig.yaw -= dt * 1.2;
    rig.tx = THREE.MathUtils.clamp(rig.tx, -HALF, HALF);
    rig.tz = THREE.MathUtils.clamp(rig.tz, -HALF, HALF);
    if (tacView) {
      camera.position.set(rig.tx, 150, rig.tz + 0.01);
      camera.lookAt(rig.tx, 0, rig.tz);
    } else {
      const cp = Math.cos(rig.pitch), spp = Math.sin(rig.pitch);
      camera.position.set(
        rig.tx + Math.sin(rig.yaw) * rig.dist * cp,
        spp * rig.dist,
        rig.tz + Math.cos(rig.yaw) * rig.dist * cp
      );
      camera.lookAt(rig.tx, 0, rig.tz);
    }
  }

  function updateHud() {
    document.getElementById('b-blue').textContent = units.filter((u) => u.alive && u.side === 'blue').length;
    document.getElementById('b-red').textContent = units.filter((u) => u.alive && u.side === 'red' && visibleToPlayer(u)).length + ' (' +
      units.filter((u) => u.alive && u.side === 'red').length + ')';
    document.getElementById('b-mun').textContent = G.munitions;
    const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
    document.getElementById('b-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------- spawn forces ----------
  async function init() {
    const { blue, red } = buildForces(opts.playerStr, opts.enemyGar, opts.samDisabled);
    const bx = [-30, -18, -6, 6, 18, 30];
    let i = 0;
    for (const t of blue) {
      const cfg = UNIT_DEFS[t];
      const x = bx[i % bx.length] + (Math.random() * 4 - 2);
      const z = cfg.air ? 30 : 46 + Math.random() * 12;
      await spawnUnit('blue', t, x, z);
      i++;
    }
    i = 0;
    for (const t of red) {
      const cfg = UNIT_DEFS[t];
      let x = bx[(i * 2 + 1) % bx.length] + (Math.random() * 6 - 3);
      let z;
      if (cfg.air) z = -30;
      else if (t === 'sam') { x = 0; z = -52; }
      else z = -34 - Math.random() * 16;
      const u = await spawnUnit('red', t, t === 'sam' ? 8 : x, z);
      if (t === 'sam' && opts.samDisabled) { u.radarDead = true; }
      i++;
    }
    // hide unrevealed reds initially
    for (const u of units) if (u.side === 'red') u.grp.visible = visibleToPlayer(u);
    rig.tx = 0; rig.tz = 25;
    refreshCards();
    setPhase(0);
    document.querySelectorAll('#phase-bar .phase').forEach((el, idx) => {
      el.classList.toggle('now', idx === 0);
      el.classList.remove('done');
    });
    api.log(`⚔ Battle for ${region.name}: Phase 1 RECON — push UAV & scouts forward, find the enemy AD network.`);
    if (opts.samDisabled) api.log('💻 Friendly cyber op: enemy long-range SAM starts DISABLED.');
    updateHud();
  }

  let hudT = 0;
  const screen = {
    scene, camera,
    update(dtRaw) {
      const dt = Math.min(dtRaw, 0.1) * simSpeed;
      if (!over) {
        elapsed += dt;
        loiterCD = Math.max(0, loiterCD - dt); mlrsCD = Math.max(0, mlrsCD - dt);
        seadCD = Math.max(0, seadCD - dt); smokeCD = Math.max(0, smokeCD - dt);
        aiTick(dt);
        for (const u of units) stepUnit(u, dt);
        updateStrikes(dt);
        updateFx(dt);
        updateZones(dt);
        checkPhase();
        checkEnd();
      } else {
        updateFx(dtRaw);
      }
      updateCamera(dtRaw);
      hudT += dtRaw;
      if (hudT > 0.3) { hudT = 0; updateHud(); }
      // selection rings
      for (const u of units) {
        if (u.side !== 'blue') continue;
        if (selected.has(u) && !u.selRing) {
          const r = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.7, 32),
            new THREE.MeshBasicMaterial({ color: 0xffcf6e, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
          r.rotation.x = -Math.PI / 2; r.position.y = 0.2;
          u.grp.add(r); u.selRing = r;
        } else if (!selected.has(u) && u.selRing) {
          u.grp.remove(u.selRing); u.selRing = null;
        }
      }
    },
    render(renderer) {
      const w = renderer.domElement.clientWidth || window.innerWidth;
      const h = renderer.domElement.clientHeight || window.innerHeight;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.render(scene, camera);
      // UAV PiP feed
      const drone = units.find((u) => u.alive && u.side === 'blue' && u.type === 'drone');
      if (drone && !over) {
        const tgt = nearestEnemy(drone, 'red') || { pos: V3(0, 0) };
        droneCam.position.set(drone.pos.x, 19, drone.pos.z);
        droneCam.lookAt(tgt.pos.x, 0, tgt.pos.z);
        const pw = 220, ph = 130, px = w - 274 - 220, py = 12;
        if (px > 0) {
          renderer.setScissorTest(true);
          renderer.setScissor(px, py, pw, ph);
          renderer.setViewport(px, py, pw, ph);
          renderer.render(scene, droneCam);
          renderer.setScissorTest(false);
        }
      }
    },
    onResize(w, h) {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      droneCam.aspect = 220 / 130; droneCam.updateProjectionMatrix();
    },
    dispose() {
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('contextmenu', onContext);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      boxEl?.remove();
    },
    selectAll() { selected.clear(); for (const u of units) if (u.alive && u.side === 'blue') selected.add(u); refreshCards(); }
  };

  screen.ready = init();
  screen.issueAbility = ability;
  window.__btl = { units, zones, ability: (kind, x, z) => ability(kind, x === undefined ? null : V3(x, z)), get selected() { return [...selected]; } };
  return screen;
}
