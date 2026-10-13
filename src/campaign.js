// ================= CAMPAIGN LAYER =================
// 3D globe grand strategy: logistics, industry, escalation, hybrid warfare.
// Implements the STRATEGIC PILLAR of the design doc.
import * as THREE from 'three';
import { sfx } from './audio.js';

export const REGIONS = [
  { id: 0, name: 'Liberty Bay',  lat: 38,  lon: -75,  owner: 'blue', garrison: 4, industry: 3, unrest: 0, capital: true },
  { id: 1, name: 'Nordmark',     lat: 52,  lon: 10,   owner: 'blue', garrison: 3, industry: 2, unrest: 0 },
  { id: 2, name: 'Kestrel Isles',lat: 36,  lon: 138,  owner: 'blue', garrison: 3, industry: 2, unrest: 0 },
  { id: 3, name: 'Iron Steppe',  lat: 55,  lon: 60,   owner: 'red',  garrison: 6, industry: 3, unrest: 0, hq: true },
  { id: 4, name: 'Crimson Coast',lat: 30,  lon: 50,   owner: 'red',  garrison: 4, industry: 2, unrest: 0 },
  { id: 5, name: 'Vermilion Delta', lat: 20, lon: 105, owner: 'red', garrison: 4, industry: 2, unrest: 0 },
  { id: 6, name: 'Frost Harbor', lat: 68,  lon: 30,   owner: 'red',  garrison: 3, industry: 1, unrest: 0 },
  { id: 7, name: 'Aurelia',      lat: -12, lon: -50,  owner: 'neutral', garrison: 2, industry: 1, unrest: 0 },
  { id: 8, name: 'Tanjora',      lat: 15,  lon: 78,   owner: 'neutral', garrison: 2, industry: 1, unrest: 0 },
  { id: 9, name: 'Sahra Outpost',lat: 22,  lon: 12,   owner: 'neutral', garrison: 2, industry: 1, unrest: 0 }
];

const ADJ = {
  0: [1, 7], 1: [0, 2, 6, 9], 2: [1, 5], 3: [6, 4, 5], 4: [3, 9, 8],
  5: [2, 3, 8], 6: [1, 3], 7: [0, 9], 8: [4, 5, 9], 9: [1, 4, 7, 8]
};

const OWNER_COLOR = { blue: 0x3fa9ff, red: 0xff5a5a, neutral: 0xb8c4d4 };

export function newGameState() {
  return {
    turn: 1,
    budget: 900, supplies: 120, munitions: 60, intel: 40,
    escalation: 12,
    regions: REGIONS.map((r) => ({ ...r })),
    battlegroups: [
      { id: 'bg1', name: '1st Thunder BG', regionId: 0, str: 8 },
      { id: 'bg2', name: '2nd Shield BG', regionId: 1, str: 6 }
    ],
    bgSeq: 3,
    selectedRegion: null,
    selectedBG: 'bg1',
    revealed: {},      // regionId -> turns left of full intel
    samDisabled: {},   // regionId -> next battle SAM disabled (cyberattack)
    satSweep: 0,
    over: false
  };
}

function latLon(lat, lon, r) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

export function createCampaign(renderer, G, api) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04070d);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  camera.position.set(0, 6, 30);

  scene.add(new THREE.AmbientLight(0x8fb4e8, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(20, 8, 12); scene.add(sun);

  // starfield
  {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(220);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9db8dd, size: 0.6 })));
  }

  // globe
  const world = new THREE.Group(); scene.add(world);
  const R = 10;
  const earthTex = new THREE.TextureLoader().load('./textures/earth.jpg');
  earthTex.colorSpace = THREE.SRGBColorSpace;
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(R, 72, 48),
    new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.95, metalness: 0 })
  );
  world.add(globe);
  // atmosphere rim
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.03, 48, 32),
    new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.62 - dot(vN, vec3(0.,0.,1.)), 2.0); gl_FragColor = vec4(0.3,0.6,1.0,1.0)*i; }',
      blending: THREE.AdditiveBlending
    })
  );
  world.add(atmo);

  // region markers
  const markerGroup = new THREE.Group(); world.add(markerGroup);
  const markerMeshes = [];
  const labelSprites = [];
  function regionPos(r) { return latLon(r.lat, r.lon, R + 0.25); }

  for (const r of G.regions) {
    const grp = new THREE.Group();
    grp.position.copy(regionPos(r));
    grp.lookAt(grp.position.clone().multiplyScalar(2));
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 12),
      new THREE.MeshBasicMaterial({ color: OWNER_COLOR[r.owner] })
    );
    dot.userData.regionId = r.id;
    grp.add(dot);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 32),
      new THREE.MeshBasicMaterial({ color: OWNER_COLOR[r.owner], transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.userData.regionId = r.id;
    grp.add(ring);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(5.2, 1.3, 1); spr.position.y = 1.0; spr.renderOrder = 20;
    grp.add(spr);
    markerGroup.add(grp);
    markerMeshes.push(dot, ring);
    labelSprites.push({ regionId: r.id, canvas: cv, tex });
  }

  function drawLabels() {
    for (const l of labelSprites) {
      const r = G.regions[l.regionId];
      const x = l.canvas.getContext('2d');
      x.clearRect(0, 0, 512, 128);
      const col = r.owner === 'blue' ? '#4db2ff' : r.owner === 'red' ? '#ff5a5a' : '#cfd8e6';
      x.fillStyle = 'rgba(5,10,20,0.8)'; x.beginPath(); x.roundRect(36, 14, 440, 100, 16); x.fill();
      x.strokeStyle = col; x.lineWidth = 4; x.stroke();
      x.fillStyle = '#fff'; x.font = 'bold 40px monospace'; x.textAlign = 'center';
      const known = G.satSweep > 0 || (G.revealed[r.id] || 0) > 0 || r.owner === 'blue';
      x.fillText(r.name.toUpperCase(), 256, 58);
      x.fillStyle = col; x.font = 'bold 34px monospace';
      const info = r.owner === 'blue' ? `GAR ${r.garrison} · IND ${r.industry}`
        : known ? `GAR ${r.garrison} · IND ${r.industry}${r.unrest ? ' · UNREST!' : ''}`
        : '??? INTEL LOW';
      x.fillText(info, 256, 98);
      l.tex.needsUpdate = true;
    }
  }

  // supply-line arcs
  let arcGroup = null;
  function arc(a, b, color) {
    const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(R + 3.2);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
    return new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.8 }));
  }
  function drawArcs() {
    if (arcGroup) { world.remove(arcGroup); }
    arcGroup = new THREE.Group();
    const cap = regionPos(G.regions[0]), hq = regionPos(G.regions[3]);
    for (const r of G.regions) {
      if (r.owner === 'blue' && r.id !== 0) { const l = arc(cap, regionPos(r), 0x3fa9ff); l.computeLineDistances(); arcGroup.add(l); }
      if (r.owner === 'red' && r.id !== 3) { const l = arc(hq, regionPos(r), 0xff5a5a); l.computeLineDistances(); arcGroup.add(l); }
    }
    world.add(arcGroup);
  }

  function refreshMarkers() {
    for (const grp of markerGroup.children) {
      const dot = grp.children[0], ring = grp.children[1];
      const r = G.regions[dot.userData.regionId];
      dot.material.color.setHex(OWNER_COLOR[r.owner]);
      ring.material.color.setHex(OWNER_COLOR[r.owner]);
      const sel = G.selectedRegion === r.id;
      ring.scale.setScalar(sel ? 1.5 : 1);
    }
    drawLabels(); drawArcs();
  }

  // ---- camera: drag rotate + wheel zoom ----
  let dragging = false, px = 0, py = 0, dist = 30, tiltX = 0.25, live = true;
  const dom = renderer.domElement;
  function onDown(e) { if (!live) return; dragging = true; px = e.clientX; py = e.clientY; }
  function onMove(e) {
    if (!dragging) return;
    world.rotation.y += (e.clientX - px) * 0.005;
    tiltX = THREE.MathUtils.clamp(tiltX + (e.clientY - py) * 0.003, -0.6, 0.9);
    px = e.clientX; py = e.clientY;
  }
  function onUp(e) { dragging = false; }
  function onWheel(e) { if (!live) return; e.preventDefault(); dist = THREE.MathUtils.clamp(dist + e.deltaY * 0.02, 15, 55); }
  function onClick(e) {
    if (!live) return;
    if (Math.abs(e.clientX - px) > 4 || Math.abs(e.clientY - py) > 4) return;
    const rect = dom.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(m, camera);
    const hit = ray.intersectObjects(markerMeshes, false)[0];
    if (hit) { selectRegion(hit.object.userData.regionId); sfx.select(); }
  }
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('click', onClick);

  // ================= RULES / UI =================
  const $ = (id) => document.getElementById(id);

  function toast(msg) { api.toast(msg); }

  function selectRegion(id) {
    G.selectedRegion = id;
    refreshMarkers();
    renderRegionPanel();
  }

  function bgAt(regionId) { return G.battlegroups.filter((b) => b.regionId === regionId); }
  function adjacent(a, b) { return (ADJ[a] || []).includes(b); }

  function renderRegionPanel() {
    const r = G.regions[G.selectedRegion];
    if (!r) {
      $('rg-name').textContent = 'Select a region';
      $('rg-body').innerHTML = '<p class="dim">Click a glowing marker on the globe. Drag to rotate, wheel to zoom.</p>';
      $('rg-actions').innerHTML = '';
      return;
    }
    const known = G.satSweep > 0 || (G.revealed[r.id] || 0) > 0 || r.owner === 'blue';
    const bgs = bgAt(r.id);
    $('rg-name').textContent = `${r.name} ${r.capital ? '★' : ''} ${r.hq ? '☠' : ''}`;
    $('rg-body').innerHTML = `
      <div class="stat-grid">
        <span>Control</span><b style="color:${r.owner === 'blue' ? '#4db2ff' : r.owner === 'red' ? '#ff5a5a' : '#cfd8e6'}">${r.owner.toUpperCase()}</b>
        <span>Garrison</span><b>${known ? r.garrison : '???'}</b>
        <span>Industry</span><b>${r.industry}</b>
        <span>Unrest</span><b>${r.unrest ? 'HIGH ⚠' : 'stable'}</b>
        <span>Battlegroups</span><b>${bgs.length ? bgs.map((b) => b.name).join(', ') : '—'}</b>
        ${G.samDisabled[r.id] ? '<span>Air defense</span><b style="color:#5dff9d">DISABLED (cyber) 💻</b>' : ''}
      </div>`;
    const A = $('rg-actions'); A.innerHTML = '';
    const mk = (label, fn, title = '') => {
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = label; b.title = title;
      b.onclick = fn; A.appendChild(b);
    };
    // move selected BG here
    const sel = G.battlegroups.find((b) => b.id === G.selectedBG);
    if (sel && sel.regionId !== r.id && adjacent(sel.regionId, r.id)) {
      mk(`➡ Move ${sel.name} here`, () => moveBG(sel, r.id), 'Battlegroups move to adjacent regions');
    }
    if (r.owner === 'red' && bgs.length) {
      mk('⚔ Attack — fight battle', () => api.attack(r, false), 'Drop into real-time tactical command');
      mk('⚔ Attack — auto-resolve', () => api.attack(r, true), 'Resolve instantly (no tactical control)');
    }
    if (r.owner === 'neutral' && bgs.length && adjacentAnyBlue(r.id)) {
      mk('⚑ Secure region', () => secureNeutral(r), 'Neutral regions fall without a fight if you arrive in force');
    }
    if (r.owner === 'red') {
      mk('💻 Cyberattack $200', () => cyber(r), 'Disable SAM radar + reveal garrison. +3% escalation');
      mk('🥷 Fund proxy $150', () => proxy(r), 'Sabotage supplies & garrison. +4% escalation');
      mk('📡 Disinfo $100', () => disinfo(r), 'Sow unrest, trigger desertion. +2% escalation');
    }
    if (r.owner === 'blue') {
      mk('🏭 Build industry $300', () => buildIndustry(r), '+1 industry here (more income & faster recruits)');
    }
  }

  function adjacentAnyBlue(id) { return ADJ[id].some((n) => G.regions[n].owner === 'blue'); }

  function moveBG(bg, toId) {
    const dest = G.regions[toId];
    if (G.supplies < 10) { sfx.error(); toast('Not enough supplies to move (need 10 🛢)'); return; }
    G.supplies -= 10;
    bg.regionId = toId;
    sfx.order();
    api.log(`${bg.name} redeployed to ${dest.name}.`);
    if (dest.owner === 'neutral' && adjacentAnyBlue(toId)) secureNeutral(dest);
    else if (dest.owner === 'red') { api.attack(dest, false); return; }
    api.refresh(); renderRegionPanel(); renderBGList();
  }

  function secureNeutral(r) {
    r.owner = 'blue';
    api.log(`${r.name} secured — welcome to the coalition.`);
    sfx.capture(); toast(`⚑ ${r.name} joined your coalition`);
    checkVictory(); api.refresh(); refreshMarkers(); renderRegionPanel(); renderBGList();
  }

  function spend(cost, intel = 0) {
    if (G.budget < (cost.$ || 0) || G.intel < intel) { sfx.error(); toast('Insufficient funds / intel'); return false; }
    G.budget -= cost.$ || 0; G.intel -= intel;
    return true;
  }
  function addEsc(n) {
    G.escalation = Math.min(100, G.escalation + n);
    if (G.escalation >= 100) api.gameOver(false, 'Escalation hit 100% — nuclear deterrence deadlock. The world forces a ceasefire on enemy terms.');
  }

  function cyber(r) {
    if (!spend({ $: 200 })) return;
    G.samDisabled[r.id] = true; G.revealed[r.id] = 3;
    addEsc(3);
    api.log(`💻 Cyber op against ${r.name}: air-defense network blinded, garrison exposed.`);
    sfx.coin(); toast(`💻 ${r.name} air defenses DISABLED for your next battle`);
    api.refresh(); renderRegionPanel();
  }
  function proxy(r) {
    if (!spend({ $: 150 })) return;
    r.garrison = Math.max(1, r.garrison - 2); r.unrest = 1;
    addEsc(4);
    api.log(`🥷 Proxy militia hits ${r.name} supply convoys: garrison weakened.`);
    sfx.coin(); api.refresh(); renderRegionPanel();
  }
  function disinfo(r) {
    if (!spend({ $: 100 }, 10)) return;
    r.unrest = 1;
    if (Math.random() < 0.5) { r.garrison = Math.max(1, r.garrison - 1); api.log(`📡 Disinfo sparks desertions in ${r.name}.`); }
    else api.log(`📡 Disinfo destabilizes ${r.name} (unrest rising).`);
    addEsc(2);
    sfx.coin(); api.refresh(); renderRegionPanel();
  }
  function buildIndustry(r) {
    if (!spend({ $: 300 })) return;
    r.industry++;
    api.log(`🏭 New assembly plant online in ${r.name} (industry ${r.industry}).`);
    sfx.coin(); api.refresh(); renderRegionPanel();
  }

  function renderBGList() {
    const el = $('bg-list'); el.innerHTML = '';
    for (const b of G.battlegroups) {
      const r = G.regions[b.regionId];
      const d = document.createElement('div');
      d.className = 'bg-item' + (G.selectedBG === b.id ? ' sel' : '');
      d.innerHTML = `<b>${b.name}</b> <span class="dim">STR ${b.str} · ${r.name}</span>`;
      d.onclick = () => { G.selectedBG = b.id; G.selectedRegion = b.regionId; sfx.select(); refreshMarkers(); renderRegionPanel(); renderBGList(); };
      el.appendChild(d);
    }
  }

  // ---- strategic action buttons ----
  $('a-recruit').onclick = () => {
    const ind = G.regions.filter((r) => r.owner === 'blue').reduce((s, r) => s + r.industry, 0);
    if (G.budget < 400) { sfx.error(); toast('Need $400 to raise a battlegroup'); return; }
    if (ind < 4) { sfx.error(); toast('Need total industry ≥ 4 in blue regions'); return; }
    G.budget -= 400;
    const bg = { id: 'bg' + G.bgSeq, name: `${G.bgSeq}${['st', 'nd', 'rd'][G.bgSeq - 1] || 'th'} Thunder BG`, regionId: 0, str: 6 };
    G.bgSeq++;
    G.battlegroups.push(bg); G.selectedBG = bg.id;
    api.log(`＋ ${bg.name} mustered at Liberty Bay.`);
    sfx.coin(); api.refresh(); renderBGList();
  };
  $('a-industry').onclick = () => {
    const r = G.regions[G.selectedRegion];
    if (!r || r.owner !== 'blue') { sfx.error(); toast('Select one of YOUR regions first'); return; }
    buildIndustry(r);
  };
  $('a-cyber').onclick = () => {
    const r = G.regions[G.selectedRegion];
    if (!r || r.owner !== 'red') { sfx.error(); toast('Select an ENEMY region first'); return; }
    cyber(r);
  };
  $('a-proxy').onclick = () => {
    const r = G.regions[G.selectedRegion];
    if (!r || r.owner !== 'red') { sfx.error(); toast('Select an ENEMY region first'); return; }
    proxy(r);
  };
  $('a-disinfo').onclick = () => {
    const r = G.regions[G.selectedRegion];
    if (!r || r.owner !== 'red') { sfx.error(); toast('Select an ENEMY region first'); return; }
    disinfo(r);
  };
  $('a-satsweep').onclick = () => {
    if (G.intel < 15) { sfx.error(); toast('Need 15 intel'); return; }
    G.intel -= 15; G.satSweep = 2;
    api.log('🛰 Satellite sweep: full battlefield intelligence for 2 turns.');
    sfx.coin(); api.refresh(); refreshMarkers(); renderRegionPanel();
  };

  $('btn-endturn').onclick = () => endTurn();

  function endTurn() {
    if (G.over) return;
    // income
    const blue = G.regions.filter((r) => r.owner === 'blue');
    const ind = blue.reduce((s, r) => s + r.industry, 0);
    G.budget += 150 + 60 * ind;
    G.supplies += 40 + 8 * blue.length;
    G.munitions += 20 + 4 * ind;
    G.intel += 10 + (G.satSweep > 0 ? 10 : 0);
    G.budget -= G.battlegroups.length * 40; // upkeep
    G.supplies -= G.battlegroups.length * 8;
    if (G.supplies < 0) { G.supplies = 0; for (const b of G.battlegroups) b.str = Math.max(2, b.str - 1); api.log('⚠ Supply crisis! Battlegroups weakened.'); }
    // timers
    for (const k of Object.keys(G.revealed)) { G.revealed[k]--; if (G.revealed[k] <= 0) delete G.revealed[k]; }
    if (G.satSweep > 0) G.satSweep--;
    G.escalation = Math.max(0, G.escalation + 1);
    // ---- enemy AI ----
    const reds = G.regions.filter((r) => r.owner === 'red');
    for (const r of reds) {
      if (Math.random() < 0.6) r.garrison = Math.min(9, r.garrison + 1);
      r.unrest = 0;
    }
    // red attack: weakest blue neighbor of a strong red region
    const candidates = [];
    for (const r of reds) {
      if (r.garrison < 4) continue;
      for (const n of ADJ[r.id]) {
        const t = G.regions[n];
        if (t.owner === 'blue') {
          const def = t.garrison + bgAt(n).reduce((s, b) => s + b.str, 0);
          candidates.push({ from: r, to: t, def });
        }
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => a.def - b.def);
      const c = candidates[0];
      const atk = c.from.garrison * 10 + 10;
      const def = c.to.garrison * 10 + bgAt(c.to.id).reduce((s, b) => s + b.str * 10, 0);
      if (atk > def * (0.8 + Math.random() * 0.5)) {
        // red wins — auto-resolved against player
        const lost = bgAt(c.to.id);
        for (const b of lost) { b.str -= 3; if (b.str <= 0) G.battlegroups.splice(G.battlegroups.indexOf(b), 1); }
        c.to.garrison = Math.max(1, c.to.garrison - 2);
        c.from.garrison = Math.max(1, c.from.garrison - 1);
        if (!bgAt(c.to.id).length && c.to.garrison <= 1 && !c.to.capital) {
          c.to.owner = 'red';
          api.log(`🔴 ${c.to.name} has FALLEN to a Crimson offensive!`);
          sfx.alarm(); toast(`🔴 ${c.to.name} has fallen!`);
        } else {
          api.log(`🔴 Crimson assault on ${c.to.name} repelled with losses.`);
          sfx.alarm();
        }
        if (c.to.capital && !bgAt(c.to.id).length && c.to.garrison <= 1) {
          c.to.owner = 'red';
          api.gameOver(false, 'Liberty Bay has fallen. The coalition collapses.');
          return;
        }
      } else {
        c.from.garrison = Math.max(1, c.from.garrison - 1);
        api.log(`🛡 Crimson probe against ${c.to.name} defeated.`);
      }
    } else {
      api.log('Quiet on all fronts — Crimson forces regroup.');
    }
    G.turn++;
    api.log(`—— Turn ${G.turn} ——`);
    checkVictory();
    api.refresh(); refreshMarkers(); renderRegionPanel(); renderBGList();
  }

  function checkVictory() {
    if (G.over) return;
    const blue = G.regions.filter((r) => r.owner === 'blue').length;
    if (blue >= 7) api.gameOver(true, `Coalition controls ${blue} of 10 regions. Crimson command sues for peace — VICTORY.`);
    else if (G.regions[0].owner !== 'blue') api.gameOver(false, 'Liberty Bay has fallen. The coalition collapses.');
  }

  // expose for battle callbacks
  const screenApi = {
    afterBattle(regionId, won, report) {
      const r = G.regions[regionId];
      if (won) {
        r.owner = 'blue'; r.garrison = 2;
        for (const b of bgAt(regionId)) b.str = Math.max(3, b.str - 2);
        delete G.samDisabled[regionId];
        api.log(`⚔ ${r.name} CAPTURED. ${report}`);
        sfx.win(); addEsc(8);
      } else {
        for (const b of [...bgAt(regionId)]) {
          b.str -= 4;
          if (b.str <= 0) { G.battlegroups.splice(G.battlegroups.indexOf(b), 1); api.log(`✖ ${b.name} destroyed in the retreat.`); }
        }
        r.garrison = Math.min(9, r.garrison + 1);
        api.log(`⚔ Defeat at ${r.name}. ${report}`);
        sfx.lose(); addEsc(4);
      }
      checkVictory();
      api.refresh(); refreshMarkers(); renderRegionPanel(); renderBGList();
    }
  };

  refreshMarkers(); renderRegionPanel(); renderBGList();

  let pulse = 0;
  return {
    scene, camera, api: screenApi,
    setLive(v) { live = v; },
    update(dt) {
      pulse += dt;
      world.rotation.y += dt * 0.008;
      camera.position.set(0, Math.sin(tiltX) * dist, Math.cos(tiltX) * dist);
      camera.lookAt(0, 0, 0);
      // pulse selection ring + sat sweep shimmer
      for (const grp of markerGroup.children) {
        const ring = grp.children[1];
        const r = G.regions[grp.children[0].userData.regionId];
        if (G.selectedRegion === r.id) ring.scale.setScalar(1.4 + Math.sin(pulse * 5) * 0.15);
      }
      globe.rotation.y += dt * 0.004;
    },
    onResize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('click', onClick);
    }
  };
}
