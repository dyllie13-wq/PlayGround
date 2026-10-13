// ================= CALL TO DEFENSE — main =================
import * as THREE from 'three';
import { newGameState, createCampaign } from './campaign.js';
import { createBattle } from './battle.js';
import { preloadAll, loadAttribution, getAttribution } from './assets.js';
import { sfx, toggleMute, isMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  active?.onResize?.(innerWidth, innerHeight);
}
window.addEventListener('resize', resize);

let G = null;
let active = null;       // current screen {scene, camera, update, render?, ...}
let mode = 'menu';       // menu | campaign | battle
let campaignScreen = null;
const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);
  if (!active) return;
  const dt = Math.min(clock.getDelta(), 0.1);
  active.update?.(dt, clock.elapsedTime);
  if (active.render) active.render(renderer);
  else if (active.scene && active.camera) renderer.render(active.scene, active.camera);
}

// ---------- shared UI helpers ----------
function log(msg) {
  const el = document.createElement('div');
  el.textContent = `T${G?.turn ?? '–'} · ${msg}`;
  const box = $('log-lines');
  box.prepend(el);
  while (box.children.length > 60) box.lastChild.remove();
}
function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  $('toast-wrap').appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function refreshTop() {
  if (!G) return;
  $('r-budget').textContent = Math.max(0, Math.round(G.budget));
  $('r-supply').textContent = Math.max(0, Math.round(G.supplies));
  $('r-mun').textContent = Math.max(0, Math.round(G.munitions));
  $('r-intel').textContent = Math.max(0, Math.round(G.intel));
  $('r-turn').textContent = G.turn;
  $('esc-fill').style.width = G.escalation + '%';
  $('esc-val').textContent = Math.round(G.escalation) + '%';
}
function modal(title, html, buttons) {
  $('m-title').textContent = title;
  $('m-body').innerHTML = html;
  const box = $('m-btns'); box.innerHTML = '';
  for (const [label, cls, fn] of buttons) {
    const b = document.createElement('button');
    b.className = 'btn ' + (cls || ''); b.textContent = label;
    b.onclick = () => { $('modal').classList.add('hidden'); fn?.(); };
    box.appendChild(b);
  }
  $('modal').classList.remove('hidden');
}

function showOnly(...ids) {
  for (const id of ['menu', 'topbar', 'campaign-ui', 'battle-ui']) $(id).classList.add('hidden');
  for (const id of ids) $(id)?.classList.remove('hidden');
}

// ---------- flow ----------
async function newCampaign() {
  G = newGameState();
  showOnly('topbar', 'campaign-ui');
  $('btn-continue').disabled = false;
  mode = 'campaign';
  campaignScreen?.dispose?.();
  campaignScreen = createCampaign(renderer, G, {
    toast, log,
    refresh: refreshTop,
    attack: (region, auto) => startAttack(region, auto),
    gameOver: (won, reason) => gameOver(won, reason)
  });
  active = campaignScreen;
  resize(); refreshTop();
  log('Coalition command online. Secure 7 of 10 regions. Kestrel Command awaits orders.');
  mode = 'campaign';
}

function startAttack(region, auto) {
  const bgs = G.battlegroups.filter((b) => b.regionId === region.id);
  if (!bgs.length) { sfx.error(); toast('No battlegroup in ' + region.name); return; }
  const str = bgs.reduce((s, b) => s + b.str, 0);
  if (auto) {
    // instant resolution
    const atk = str * 10 + (G.samDisabled[region.id] ? 15 : 0) + Math.random() * 20;
    const def = region.garrison * 10 + Math.random() * 20;
    if (atk > def) {
      region.owner = 'blue'; region.garrison = 2;
      for (const b of bgs) b.str = Math.max(3, b.str - 2);
      delete G.samDisabled[region.id];
      G.escalation = Math.min(100, G.escalation + 6);
      log(`⚔ ${region.name} taken by auto-assault.`);
      sfx.win(); toast(`✅ ${region.name} captured (auto)`);
    } else {
      for (const b of [...bgs]) { b.str -= 4; if (b.str <= 0) G.battlegroups.splice(G.battlegroups.indexOf(b), 1); }
      region.garrison = Math.min(9, region.garrison + 1);
      G.escalation = Math.min(100, G.escalation + 3);
      log(`⚔ Auto-assault on ${region.name} repelled.`);
      sfx.lose(); toast(`❌ Assault on ${region.name} failed`);
    }
    // victory check inline
    const blue = G.regions.filter((r) => r.owner === 'blue').length;
    if (blue >= 7) return gameOver(true, `Coalition controls ${blue} of 10 regions. VICTORY.`);
    refreshTop();
    return;
  }
  modal(
    `⚔ Operation: ${region.name}`,
    `<p>Enemy garrison: <b>${G.satSweep > 0 || G.revealed[region.id] ? region.garrison : 'unknown (low intel)'}</b> ·
     Your force: <b>${bgs.map((b) => `${b.name} (STR ${b.str})`).join(', ')}</b></p>
     <p>${G.samDisabled[region.id] ? '💻 Enemy SAM network <b style="color:#5dff9d">DISABLED</b> by cyber op.' : '⚠ Enemy long-range SAM active — consider a 💻 cyberattack or SEAD (D) in battle.'}</p>
     <p>You will take direct tactical command. Phases: <b>Recon → SEAD & Shaping → Assault → Clearance</b>.</p>`,
    [
      ['▶ Take command', 'primary', () => enterBattle(region, bgs, str)],
      ['Cancel', '', null]
    ]
  );
}

async function enterBattle(region, bgs, str) {
  mode = 'battle';
  showOnly('topbar', 'battle-ui');
  campaignScreen.setLive(false);
  toast('Loading battlefield…');
  const battle = createBattle(renderer, G, region, {
    playerStr: str,
    enemyGar: region.garrison,
    samDisabled: !!G.samDisabled[region.id]
  }, {
    toast, log,
    refresh: refreshTop,
    onEnd: (won, report) => exitBattle(region, won, report)
  });
  active = battle;
  await battle.ready;
  resize(); refreshTop();
}

function exitBattle(region, won, report) {
  if (active && active !== campaignScreen && active.dispose) active.dispose();
  campaignScreen.api.afterBattle(region.id, won, report);
  if (G.over) return;
  mode = 'campaign';
  active = campaignScreen;
  campaignScreen.setLive(true);
  showOnly('topbar', 'campaign-ui');
  resize(); refreshTop();
}

function gameOver(won, reason) {
  if (G) G.over = true;
  modal(
    won ? '🏆 VICTORY' : '☠ DEFEAT',
    `<p>${reason}</p><p class="dim">Turns: ${G?.turn} · Regions held: ${G?.regions.filter((r) => r.owner === 'blue').length}/10 · Final escalation: ${Math.round(G?.escalation ?? 0)}%</p>`,
    [
      ['↻ New campaign', 'primary', () => newCampaign()],
      ['Return to menu', '', () => { active = null; mode = 'menu'; showOnly('menu'); }]
    ]
  );
  if (won) sfx.win(); else sfx.lose();
}

// ---------- menu wiring ----------
$('btn-new').onclick = async () => {
  $('btn-new').disabled = true;
  $('btn-new').textContent = '⏳ Mobilizing…';
  try {
    await preloadAll();
    await newCampaign();
  } finally {
    $('btn-new').disabled = false;
    $('btn-new').textContent = '▶ New Campaign';
  }
};
$('btn-continue').onclick = () => {
  if (!G || G.over) return;
  if (mode === 'battle') return; // battle in progress — finish it
  mode = 'campaign'; active = campaignScreen;
  showOnly('topbar', 'campaign-ui');
  resize();
};
$('btn-how').onclick = () => modal('📖 Field Manual', `
  <h3>Campaign (globe)</h3>
  <p>Click region markers. Raise <b>battlegroups</b>, build <b>industry</b>, and soften targets with
  <b>cyber / proxy / disinfo</b> ops before attacking. Every aggressive act raises <b>Escalation</b> — at 100% the war is lost.
  Attack red regions to fight the battle yourself or auto-resolve. Hold <b>7 of 10</b> regions to win.</p>
  <h3>Battle (real-time)</h3>
  <table>
    <tr><th>Control</th><th>Action</th></tr>
    <tr><td>Left-click / drag</td><td>Select units</td></tr>
    <tr><td>Right-click</td><td>Move · click enemy = attack · with pending order = execute</td></tr>
    <tr><td>Right-drag / wheel / arrows / Q·E</td><td>Rotate · zoom · pan</td></tr>
    <tr><td><kbd>A</kbd> <kbd>S</kbd> <kbd>G</kbd></td><td>Attack-move · halt · smoke screen</td></tr>
    <tr><td><kbd>D</kbd> <kbd>M</kbd> <kbd>L</kbd></td><td>SEAD strike · MLRS barrage · loitering-munition hit (cost 🚀)</td></tr>
    <tr><td><kbd>T</kbd> <kbd>Space</kbd></td><td>NATO tracker view · game speed</td></tr>
  </table>
  <h3>Doctrine</h3>
  <p>Enemies start <b>concealed</b> — push UAVs and scouts forward (Phase 1). Kill the <b>SAM radar</b> before flying freely (Phase 2).
  <b>SHORAD</b> eats drones, <b>EW vehicles</b> jam sensors and SAM locks, <b>smoke</b> blinds optics,
  rubble and forests conceal, and deep pushes outrun <b>supply</b>. Hold both plazas or annihilate the enemy.</p>`,
  [['Close', 'primary', null]]);
$('btn-credits').onclick = () => {
  const rows = getAttribution().map((a) =>
    `<tr><td>${a.key}</td><td>${a.name}</td><td>${a.author}</td><td>${a.license}</td></tr>`).join('');
  modal('© Credits & Attribution', `
    <p><b>Call to Defense</b> — a modern-era total-warfare prototype. 3D units via the
    <b>load-sketchfab-threejs</b> skill (downloaded GLBs, CC licences preserved beside each file);
    Earth imagery: NASA; menu art: web image search reference.</p>
    <table><tr><th>asset</th><th>model</th><th>author</th><th>licence</th></tr>${rows}</table>
    <p class="dim">Full sidecars: <code>public/models/*.attribution.json</code> · See ATTRIBUTION.md</p>`,
    [['Close', 'primary', null]]);
};
$('btn-quit').onclick = () => { active?.dispose?.(); active = null; mode = 'menu'; showOnly('menu'); };
$('btn-mute').onclick = (e) => { e.target.textContent = toggleMute() ? '🔇' : '🔊'; };

// ---------- boot ----------
resize();
requestAnimationFrame(loop);
loadAttribution();
// preload menu backdrop behind the menu immediately (non-blocking)
preloadAll().catch(() => {});
// test hook (used by automated browser verification)
window.__ctd = { get G() { return G; }, attack: (id, auto) => startAttack(G.regions[id], auto) };
