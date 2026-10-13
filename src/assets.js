// Central model loading: Sketchfab GLBs with procedural primitive fallbacks.
// Every model keeps its CC-Attribution sidecar; credits surface in-game.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();

export const MODEL_INFO = {
  tank:    { file: 'models/tank.glb',    scale: 1.0,  lift: 0 },
  ifv:     { file: 'models/ifv.glb',     scale: 1.0,  lift: 0 },
  shorad:  { file: 'models/shorad.glb',  scale: 1.0,  lift: 0 },
  sam:     { file: 'models/sam.glb',     scale: 1.0,  lift: 0 },
  drone:   { file: 'models/drone.glb',   scale: 0.9,  lift: 0 },
  soldier: { file: 'models/soldier.glb', scale: 1.0,  lift: 0 }
};

let attribution = [];
export async function loadAttribution() {
  const keys = Object.keys(MODEL_INFO);
  attribution = [];
  for (const k of keys) {
    try {
      const r = await fetch(`./models/${k}.glb.attribution.json`);
      if (r.ok) attribution.push({ key: k, ...(await r.json()) });
    } catch { /* sidecar missing — still playable */ }
  }
  // Static credits that are not in sidecars:
  attribution.push({
    key: 'earth', name: 'Equirectangular Earth imagery', author: 'NASA SVS / Goddard Space Flight Center',
    license: 'Public Domain', modelUrl: 'https://svs.gsfc.nasa.gov/3615'
  });
  attribution.push({
    key: 'menu', name: 'Main-menu key art (reference photo)', author: 'via DuckDuckGo image search (image-search skill)',
    license: 'See source page — reference only', modelUrl: ''
  });
  return attribution;
}
export function getAttribution() { return attribution; }

// ---- procedural fallbacks (also used for EW trucks, supply, ATGM, rubble) ----
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.15, ...opts });
}

function fallbackModel(kind) {
  const g = new THREE.Group();
  const hull = mat(0x4a5d3a), dark = mat(0x2b2f26), accent = mat(0x777d84);
  if (kind === 'tank') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 3.6), hull); b.position.y = 0.65; g.add(b);
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.8), dark); t.position.set(0, 1.25, -0.2); g.add(t);
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.0, 8), dark);
    gun.rotation.x = Math.PI / 2; gun.position.set(0, 1.3, 1.9); g.add(gun);
  } else if (kind === 'ifv' || kind === 'shorad' || kind === 'sam' || kind === 'ew' || kind === 'supply') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 4.0), kind === 'supply' ? mat(0x6b5a2e) : hull);
    b.position.y = 0.9; g.add(b);
    for (const [x, z] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10), dark);
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.5, z); g.add(w);
    }
    if (kind === 'shorad') {
      const r = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), accent); r.position.y = 1.7; g.add(r);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, 1.2), accent);
      dish.position.y = 2.2; dish.rotation.x = -0.5; g.add(dish);
    }
    if (kind === 'sam' || kind === 'ew') {
      for (let i = 0; i < 4; i++) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.6, 8), dark);
        tube.rotation.x = Math.PI / 2 - 0.5; tube.position.set(-0.6 + (i % 2) * 0.55, 1.9, -0.4 - Math.floor(i / 2) * 0.6); g.add(tube);
      }
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), accent);
      mast.position.set(0.8, 2.2, -1.6); g.add(mast);
    }
  } else if (kind === 'drone') {
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 6), mat(0x30343a));
    body.rotation.x = Math.PI / 2; g.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 0.7), mat(0x3c4148));
    wing.position.z = -0.4; g.add(wing);
  } else { // soldier / infantry / atgm
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 3, 8), hull); b.position.y = 0.9; g.add(b);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat(0x8a7a5c)); h.position.y = 1.75; g.add(h);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; } });
  return g;
}

/** Load a model clone. Never rejects — falls back to primitives. */
export async function getModel(kind) {
  const info = MODEL_INFO[kind];
  if (!info) return { root: fallbackModel(kind), clips: [] };
  if (!cache.has(kind)) {
    cache.set(kind, (async () => {
      try {
        const gltf = await loader.loadAsync(`./${info.file}`);
        const root = gltf.scene;
        // Normalize: center + scale to ~4m footprint
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3(); box.getSize(size);
        const maxDim = Math.max(size.x, size.z, 0.001);
        const s = (4.2 / maxDim) * info.scale;
        root.scale.setScalar(s);
        const box2 = new THREE.Box3().setFromObject(root);
        root.position.y -= box2.min.y - info.lift;
        // Team tinting happens via ring + label; keep authored materials.
        // Enable radar/deploy animation if present (SAM, SHORAD)
        const clips = gltf.animations || [];
        return { root, clips };
      } catch (e) {
        console.warn(`Model ${kind} failed, using fallback:`, e.message);
        return { root: fallbackModel(kind), clips: [] };
      }
    })());
  }
  const entry = await cache.get(kind);
  return { root: entry.root.clone(true), clips: entry.clips };
}

/** Preload everything up-front (menu -> campaign transition hides latency). */
export function preloadAll(onStep) {
  const kinds = [...Object.keys(MODEL_INFO), 'ew', 'supply'];
  let done = 0;
  return Promise.all(kinds.map((k) =>
    getModel(k === 'ew' || k === 'supply' ? k : k).then(() => {
      done++;
      onStep?.(done, kinds.length);
    })
  ));
}

// ---- canvas label / NATO symbology sprites ----
export function makeLabelSprite(text, { bg = 'rgba(8,14,26,0.85)', fg = '#fff', size = 44 } = {}) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.beginPath(); x.roundRect(28, 8, 200, 64, 10); x.fill();
  x.fillStyle = fg; x.font = `bold ${size}px monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(7, 2.6, 1);
  sp.renderOrder = 50;
  return sp;
}

/** MIL-STD-2525-inspired NATO marker: blue rectangle / red diamond + unit glyph. */
export function makeNatoSprite(side, glyph) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.lineWidth = 7;
  x.strokeStyle = side === 'blue' ? '#4db2ff' : '#ff5a5a';
  x.fillStyle = side === 'blue' ? 'rgba(20,80,160,0.75)' : 'rgba(160,30,30,0.75)';
  x.beginPath();
  if (side === 'blue') x.rect(18, 30, 92, 68);
  else { x.moveTo(64, 12); x.lineTo(114, 64); x.lineTo(64, 116); x.lineTo(14, 64); x.closePath(); }
  x.fill(); x.stroke();
  x.fillStyle = '#fff'; x.font = 'bold 40px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(glyph, 64, 66);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(8, 8, 1);
  sp.renderOrder = 60;
  return sp;
}

export function factionRing(color = 0x3fa9ff, r = 3.0) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.35, r, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2; m.position.y = 0.15; m.renderOrder = 5;
  return m;
}
