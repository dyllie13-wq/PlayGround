import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/* =====================================================================
   PROJECT I.G.I. — MODERN OPERATION (fan tribute, 100% original assets)
   Tactical stealth FPS: infiltration / hack / intel / exfil.
   Modern pillars: ultrawide FOV+safe zones, procedural PBR retexture,
   ACES + soft shadows + fog + floodlights, quality scaler.
   ===================================================================== */

const $ = id => document.getElementById(id);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=>a+(b-a)*t;

// ---------------- SETTINGS ----------------
const settings = Object.assign({
  quality:'ULTRA', resScale:100, fov:75, autoFov:true,
  shadows:true, hudSafe:true, sens:1.0, invertY:false, vol:0.7, showFps:true,
  primary:'rifle', aspectSim:'native'
}, JSON.parse(localStorage.getItem('igi_modern_settings')||'{}'));
function saveSettings(){ localStorage.setItem('igi_modern_settings', JSON.stringify(settings)); }

// ---------------- AUDIO (procedural, original) ----------------
const AudioSys = {
  ctx:null, master:null,
  init(){ if(this.ctx) return; try{
    this.ctx = new (window.AudioContext||window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = settings.vol;
    this.master.connect(this.ctx.destination);
    // generated-impulse reverb: gunshots get a depot slap-back tail
    const len=Math.floor(this.ctx.sampleRate*1.1), imp=this.ctx.createBuffer(2,len,this.ctx.sampleRate);
    for(let ch=0;ch<2;ch++){ const d=imp.getChannelData(ch);
      for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.4)*0.6; }
    this.verb=this.ctx.createConvolver(); this.verb.buffer=imp;
    this.wet=this.ctx.createGain(); this.wet.gain.value=0.33;
    this.verb.connect(this.wet); this.wet.connect(this.master);
    this.wind(); this.heliInit();
  }catch(e){} },
  setVol(v){ if(this.master) this.master.gain.value = v; },
  now(){ return this.ctx?this.ctx.currentTime:0; },
  env(g,t0,a,peak,dur){ g.gain.setValueAtTime(0.0001,t0); g.gain.linearRampToValueAtTime(peak,t0+a); g.gain.exponentialRampToValueAtTime(0.0001,t0+dur); },
  noise(dur,filterFreq,type='lowpass',peak=0.5){ if(!this.ctx)return;
    const n=Math.floor(this.ctx.sampleRate*dur), buf=this.ctx.createBuffer(1,n,this.ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
    const s=this.ctx.createBufferSource(); s.buffer=buf;
    const f=this.ctx.createBiquadFilter(); f.type=type; f.frequency.value=filterFreq;
    const g=this.ctx.createGain(); this.env(g,this.now(),0.004,peak,dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); },
  tone(freq,dur,peak=0.25,type='square',slide=0){ if(!this.ctx)return;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain(); o.type=type; o.frequency.setValueAtTime(freq,this.now());
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(30,freq+slide),this.now()+dur);
    this.env(g,this.now(),0.005,peak,dur); o.connect(g); g.connect(this.master); o.start(); o.stop(this.now()+dur+0.02); },
  bus(node, wet=0.5){ node.connect(this.master); if(this.verb&&wet>0){ const s=this.ctx.createGain(); s.gain.value=wet; node.connect(s); s.connect(this.verb); } },
  shot(kind, dist=0){ if(!this.ctx) return;
    // distance model: quieter + duller far away (enemy fire across the depot)
    const att=1/(1+dist/28), dull=Math.max(400, 3200-dist*28);
    const crackF=Math.min(6000, dull*2.2);
    if(kind==='rifle'||!kind){ this.noiseHit(0.09,crackF,'highpass',0.75*att+0.08); this.noiseHit(0.24,750,'lowpass',0.95*att+0.1); this.tone(120,0.16,0.5*att+0.08,'sine',-60); }
    else if(kind==='smg'){ this.noiseHit(0.07,crackF,'highpass',0.6*att+0.06); this.noiseHit(0.15,1100,'lowpass',0.7*att+0.08); this.tone(190,0.1,0.35*att+0.06,'triangle',-90); }
    else if(kind==='dmr'){ this.noiseHit(0.12,crackF,'highpass',0.85*att+0.08); this.noiseHit(0.4,480,'lowpass',1.0*att+0.1); this.tone(85,0.3,0.6*att+0.08,'sine',-40); }
    else if(kind==='pistol'){ this.noiseHit(0.07,crackF,'highpass',0.65*att+0.06); this.noiseHit(0.18,950,'lowpass',0.8*att+0.08); this.tone(160,0.12,0.4*att+0.06,'triangle',-80); }
    else { this.noiseHit(0.1,Math.min(4000,dull),'highpass',0.4*att); this.noiseHit(0.22,650,'lowpass',0.5*att); }
    // slap-back echoes off the warehouses (quieter when far — already loud by nature)
    if(dist<90){ setTimeout(()=>this.noiseHit(0.16,500,'lowpass',0.16*att+0.02),170); setTimeout(()=>this.noiseHit(0.2,380,'lowpass',0.09*att+0.01),330); }
    if(dist<8) setTimeout(()=>this.casing(),95);
  },
  // routes through reverb send; replaces raw noise() for one-shots
  noiseHit(dur,freq,type,peak){ if(!this.ctx)return;
    const n=Math.floor(this.ctx.sampleRate*dur), buf=this.ctx.createBuffer(1,n,this.ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,1.4);
    const s=this.ctx.createBufferSource(); s.buffer=buf;
    const f=this.ctx.createBiquadFilter(); f.type=type; f.frequency.value=freq;
    const g=this.ctx.createGain(); this.env(g,this.now(),0.003,peak,dur);
    s.connect(f); f.connect(g); this.bus(g, type==='lowpass'?0.7:0.35); s.start(); },
  dry(){ this.tone(1200,0.05,0.15,'square'); },
  reload(){ this.tone(500,0.06,0.2,'square'); setTimeout(()=>this.tone(700,0.06,0.2,'square'),140); setTimeout(()=>this.tone(900,0.08,0.25,'square'),300); },
  step(crouch, x=0, z=0){ // surface-aware footsteps: asphalt road / concrete pad / grass
    let surf='grass';
    if(Math.abs(x)<16) surf='asphalt';
    else if(x>-45&&x<105&&z>-115&&z<-5) surf='concrete';
    if(surf==='grass') this.noise(0.08, crouch?260:420,'lowpass', crouch?0.05:0.1);
    else { this.noise(0.06, crouch?350:600,'lowpass', crouch?0.05:0.1);
      if(!crouch){ const t=this.now(); try{
        const o=this.ctx.createOscillator(), g=this.ctx.createGain();
        o.type='triangle'; o.frequency.value=surf==='asphalt'?950:1250;
        this.env(g,t,0.002,0.05,0.045); o.connect(g); g.connect(this.master); o.start(); o.stop(t+0.07);
      }catch(e){} } } },
  casing(){ if(!this.ctx) return; const t=this.now(); // brass tink on concrete
    try{ const o=this.ctx.createOscillator(), g=this.ctx.createGain();
      o.type='square'; o.frequency.setValueAtTime(3400+Math.random()*800,t);
      o.frequency.exponentialRampToValueAtTime(2200,t+0.03);
      this.env(g,t,0.001,0.06,0.05); o.connect(g); g.connect(this.master); o.start(); o.stop(t+0.07);
    }catch(e){} },
  crack(){ this.noiseHit(0.05,4500,'highpass',0.3); }, // supersonic snap as missed rounds pass close
  radio(){ if(!this.ctx) return; // squelch + blip before HQ messages
    this.noiseHit(0.1,1900,'bandpass',0.2); setTimeout(()=>this.tone(1180,0.06,0.14,'sine'),110); },
  heart(){ this.tone(58,0.14,0.5,'sine'); setTimeout(()=>this.tone(52,0.16,0.4,'sine'),210); },
  uiClick(){ this.tone(700,0.05,0.12,'sine'); },
  heliInit(){ try{ const ctx=this.ctx;
    const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=13;
    const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=160;
    this.heliGain=ctx.createGain(); this.heliGain.gain.value=0;
    o.connect(f); f.connect(this.heliGain); this.heliGain.connect(this.master); o.start();
    const n=ctx.sampleRate, buf=ctx.createBuffer(1,n,ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=Math.random()*2-1;
    const s=ctx.createBufferSource(); s.buffer=buf; s.loop=true;
    const bf=ctx.createBiquadFilter(); bf.type='bandpass'; bf.frequency.value=300;
    const chop=ctx.createGain(); chop.gain.value=0.5;
    const lfo=ctx.createOscillator(); lfo.frequency.value=13; const lg=ctx.createGain(); lg.gain.value=0.5;
    lfo.connect(lg); lg.connect(chop.gain);
    s.connect(bf); bf.connect(chop); chop.connect(this.heliGain); s.start(); lfo.start();
  }catch(e){} },
  heliSet(dist, spool){ if(this.heliGain) this.heliGain.gain.value=clamp(0.5/(1+dist/45),0,0.4)*(0.25+spool*0.75); },
  hit(){ this.tone(1000,0.08,0.3,'sine',200); },
  hurt(){ this.noise(0.25,300,'lowpass',0.6); this.tone(90,0.3,0.5,'sawtooth',-40); },
  hackTick(){ this.tone(880+Math.random()*440,0.05,0.12,'sine'); },
  alarm(){ for(let i=0;i<3;i++) setTimeout(()=>{this.tone(660,0.25,0.25,'sawtooth');},i*350); },
  objective(){ this.radio(); setTimeout(()=>{ this.tone(523,0.15,0.28,'sine'); },160); setTimeout(()=>this.tone(784,0.25,0.28,'sine'),320); },
  wind(){ const ctx=this.ctx; if(!ctx) return; const n=ctx.sampleRate*2, buf=ctx.createBuffer(1,n,ctx.sampleRate), d=buf.getChannelData(0);
    let v=0; for(let i=0;i<n;i++){ v=(v+(Math.random()*2-1)*0.02)*0.998; d[i]=v*3; }
    const s=ctx.createBufferSource(); s.buffer=buf; s.loop=true;
    const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=400;
    const g=ctx.createGain(); g.gain.value=0.05; s.connect(f); f.connect(g); g.connect(this.master); s.start(); }
};

// ---------------- PROCEDURAL PBR TEXTURES (retexturing pillar) ----------------
function canvasTex(size, painter, repeat=1){
  const c=document.createElement('canvas'); c.width=c.height=size;
  painter(c.getContext('2d'),size);
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(repeat,repeat);
  t.anisotropy=8; t.colorSpace=THREE.SRGBColorSpace;
  return t;
}
function grain(ctx,s,n,alpha){ for(let i=0;i<n;i++){ ctx.fillStyle=`rgba(${Math.random()>0.5?255:0},${Math.random()>0.5?255:0},${Math.random()>0.5?255:0},${Math.random()*alpha})`; ctx.fillRect(Math.random()*s,Math.random()*s,1+Math.random()*2,1+Math.random()*2);} }
const Tex = {};
// CC0 upgrade: ambientCG 1K PBR sets stream in over the procedural fallbacks.
const CC0 = { ready:false };
function cc0Set(base){
  const L=new THREE.TextureLoader();
  const col=L.load(`textures/${base}_Color.jpg`); col.colorSpace=THREE.SRGBColorSpace;
  const nrm=L.load(`textures/${base}_NormalGL.jpg`);
  const rgh=L.load(`textures/${base}_Roughness.jpg`);
  for(const t of [col,nrm,rgh]){ t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=8; }
  return {col,nrm,rgh};
}
function upgradeGroundTextures(){
  try{
    const grass=cc0Set('Grass001_1K-JPG'), asph=cc0Set('Asphalt006_1K-JPG'),
          conc=cc0Set('Concrete008_1K-JPG'), metal=cc0Set('MetalPlates008_1K-JPG');
    grass.col.repeat.set(60,60); grass.nrm.repeat.set(60,60); grass.rgh.repeat.set(60,60);
    // keep square texel density per mesh: road1 is 30x400, road2 is 300x22
    scene.traverse(o=>{ if(!o.isMesh||!o.material||!o.material.map) return;
      const m=o.material;
      if(m.map===Tex.grass){ m.map=grass.col; m.normalMap=grass.nrm; m.roughnessMap=grass.rgh;
        m.color.setHex(0x8f9a80); m.needsUpdate=true; }
      else if(m.map===Tex.asphalt){
        const rep=o.geometry.parameters.width>100?[20,2]:[2,26];
        m.map=asph.col.clone(); m.normalMap=asph.nrm.clone(); m.roughnessMap=asph.rgh.clone();
        for(const t of [m.map,m.normalMap,m.roughnessMap]){ t.needsUpdate=true; t.repeat.set(rep[0],rep[1]); }
        m.color.setHex(0xd8c0a8); // warm grade against the blue dusk ambient
        m.needsUpdate=true; }
      else if(m.map===Tex.concrete){ m.map=conc.col; m.normalMap=conc.nrm; m.roughnessMap=conc.rgh; m.needsUpdate=true; } });
    CC0.ready=true; CC0.metal=metal;
    buildContainers(metal);
  }catch(err){ console.warn('[IGI] CC0 texture upgrade skipped:', err.message); }
}
function buildTextures(){
  Tex.grass = canvasTex(512,(x,s)=>{ x.fillStyle='#3d5a2e';x.fillRect(0,0,s,s);
    for(let i=0;i<9000;i++){ const g=60+Math.random()*70; x.fillStyle=`rgb(${g*0.55|0},${g|0},${g*0.45|0})`; x.fillRect(Math.random()*s,Math.random()*s,1,2+Math.random()*3);}
    grain(x,s,1500,0.05); },60);
  Tex.asphalt = canvasTex(512,(x,s)=>{ x.fillStyle='#33363b';x.fillRect(0,0,s,s);
    for(let i=0;i<7000;i++){ const v=40+Math.random()*40; x.fillStyle=`rgb(${v},${v},${v+4})`; x.fillRect(Math.random()*s,Math.random()*s,2,2);}
    x.strokeStyle='rgba(0,0,0,.35)';x.lineWidth=2; for(let i=0;i<8;i++){x.beginPath();x.moveTo(Math.random()*s,0);x.lineTo(Math.random()*s,s);x.stroke();} },20);
  Tex.concrete = canvasTex(512,(x,s)=>{ x.fillStyle='#8a8d90';x.fillRect(0,0,s,s);
    for(let i=0;i<5000;i++){ const v=110+Math.random()*50; x.fillStyle=`rgba(${v},${v},${v},.5)`; x.fillRect(Math.random()*s,Math.random()*s,3,3);}
    x.strokeStyle='rgba(60,60,60,.4)'; for(let i=0;i<=4;i++){x.beginPath();x.moveTo(i*s/4,0);x.lineTo(i*s/4,s);x.stroke();x.beginPath();x.moveTo(0,i*s/4);x.lineTo(s,i*s/4);x.stroke();} },2);
  Tex.metal = canvasTex(512,(x,s)=>{ const g=x.createLinearGradient(0,0,0,s); g.addColorStop(0,'#6d7681');g.addColorStop(.5,'#565e68');g.addColorStop(1,'#454c55');
    x.fillStyle=g;x.fillRect(0,0,s,s); x.fillStyle='rgba(255,255,255,.06)'; for(let i=0;i<s;i+=8) x.fillRect(0,i,s,2);
    x.fillStyle='rgba(120,60,20,.25)'; for(let i=0;i<40;i++) x.fillRect(Math.random()*s,Math.random()*s,4+Math.random()*20,2+Math.random()*6); },1);
  Tex.roof = canvasTex(512,(x,s)=>{ x.fillStyle='#5a3b2a';x.fillRect(0,0,s,s); x.fillStyle='rgba(0,0,0,.3)';
    for(let i=0;i<s;i+=32) x.fillRect(i,0,3,s); grain(x,s,2000,0.06); },2);
  Tex.crate = canvasTex(256,(x,s)=>{ x.fillStyle='#7a5c33';x.fillRect(0,0,s,s);
    for(let i=0;i<40;i++){x.fillStyle=`rgba(60,40,15,${Math.random()*0.3})`;x.fillRect(0,Math.random()*s,s,2);}
    x.strokeStyle='#4a3517';x.lineWidth=14;x.strokeRect(0,0,s,s);x.beginPath();x.moveTo(0,0);x.lineTo(s,s);x.moveTo(s,0);x.lineTo(0,s);x.stroke(); },1);
  Tex.camo = canvasTex(256,(x,s)=>{ x.fillStyle='#4c5238';x.fillRect(0,0,s,s);
    const cols=['#3a4030','#5d6440','#2e3325','#6b6f4a'];
    for(let i=0;i<60;i++){x.fillStyle=cols[i%4];x.beginPath();x.ellipse(Math.random()*s,Math.random()*s,10+Math.random()*30,8+Math.random()*20,Math.random()*3,0,7);x.fill();} },1);
  Tex.fence = canvasTex(128,(x,s)=>{ x.clearRect(0,0,s,s); x.strokeStyle='rgba(180,190,200,.9)';x.lineWidth=2;
    for(let i=-s;i<s*2;i+=12){x.beginPath();x.moveTo(i,0);x.lineTo(i+s,s);x.stroke();x.beginPath();x.moveTo(i+s,0);x.lineTo(i,s);x.stroke();} },8);
  Tex.fence.transparent=true;
  Tex.terminal = canvasTex(256,(x,s)=>{ x.fillStyle='#06110c';x.fillRect(0,0,s,s); x.fillStyle='#39ff88';x.font='14px monospace';
    for(let r=0;r<14;r++) x.fillText(Array.from({length:20},()=>'01'[Math.random()*2|0]).join(''),8,20+r*16); },1);
  Tex.hazard = canvasTex(256,(x,s)=>{ x.fillStyle='#c9a227';x.fillRect(0,0,s,s); x.fillStyle='#111';
    for(let i=-2;i<8;i++){x.save();x.translate(i*40,0);x.rotate(0.6);x.fillRect(0,-20,20,s+40);x.restore();} },1);
  // soft round smoke puff
  { const c=document.createElement('canvas'); c.width=c.height=128; const x=c.getContext('2d');
    const g=x.createRadialGradient(64,64,4,64,64,62); g.addColorStop(0,'rgba(255,255,255,.85)');g.addColorStop(.55,'rgba(255,255,255,.38)');g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.fillRect(0,0,128,128);
    Tex.smoke=new THREE.CanvasTexture(c); }
  // cloud blob (multi-puff)
  { const c=document.createElement('canvas'); c.width=256; c.height=128; const x=c.getContext('2d');
    for(let i=0;i<26;i++){ const px=40+Math.random()*176, py=45+Math.random()*40, r=14+Math.random()*26;
      const g=x.createRadialGradient(px,py,2,px,py,r); g.addColorStop(0,'rgba(255,235,225,.20)');g.addColorStop(1,'rgba(255,235,225,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill(); }
    Tex.cloud=new THREE.CanvasTexture(c); }
  // warm light pool (additive ground glow)
  { const c=document.createElement('canvas'); c.width=c.height=128; const x=c.getContext('2d');
    const g=x.createRadialGradient(64,64,2,64,64,62); g.addColorStop(0,'rgba(255,220,150,.55)');g.addColorStop(.6,'rgba(255,200,120,.18)');g.addColorStop(1,'rgba(255,200,120,0)');
    x.fillStyle=g; x.fillRect(0,0,128,128);
    Tex.pool=new THREE.CanvasTexture(c); }
  // objective diamond marker
  { const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d');
    x.translate(32,32); x.rotate(Math.PI/4); x.fillStyle='#ffb454'; x.fillRect(-13,-13,26,26);
    x.fillStyle='#231200'; x.fillRect(-7,-7,14,14);
    Tex.diamond=new THREE.CanvasTexture(c); }
}

// ---------------- GLOBALS ----------------
let renderer, scene, camera, sunLight, hemi, flashLight, muzzleLight;
let clock, canvas=$('game-canvas');
const colliders=[]; // {min:Vector3,max:Vector3}
const enemies=[], tracers=[], particles=[], pickups=[];
const terminals=[], enemyBullets=[];
let gameState='menu'; // menu|playing|paused|dead|win
let keys={}, player, weapons, currentWeapon=0;
let objectives, startTime=0, elapsed=0, kills=0, shotsFired=0, shotsHit=0, alarmsRaised=0;
let interactTarget=null, hackProgress=0, hacking=false;
let compassMarkers=[];
let minimapCtx=$('minimap').getContext('2d');

const WEAPON_DEFS = {
  rifle:{name:'AK-TACTICAL // AUTO',kind:'rifle',mag:30,reserve:120,dmg:34,rpm:600,spread:0.014,auto:true,zoom:1.4,recoil:0.011,range:220},
  smg:{name:'VK-SMG // RAPID',kind:'smg',mag:40,reserve:160,dmg:24,rpm:800,spread:0.022,auto:true,zoom:1.25,recoil:0.008,range:150},
  dmr:{name:'FALCON DMR // PRECISION',kind:'dmr',mag:15,reserve:60,dmg:85,rpm:220,spread:0.003,auto:false,zoom:2.6,recoil:0.02,range:400},
  pistol:{name:'P9 SIDEARM // SEMI',kind:'pistol',mag:12,reserve:48,dmg:28,rpm:380,spread:0.012,auto:false,zoom:1.3,recoil:0.012,range:120}
};

function addCollider(x,y,z,w,h,d){
  colliders.push({min:new THREE.Vector3(x-w/2,y,z-d/2),max:new THREE.Vector3(x+w/2,y+h,z+d/2)});
}
function collideCircle(px,pz,r,py,ph){
  for(const c of colliders){
    if(py+ph<c.min.y||py>c.max.y) continue;
    const cx=clamp(px,c.min.x,c.max.x), cz=clamp(pz,c.min.z,c.max.z);
    const dx=px-cx,dz=pz-cz,d2=dx*dx+dz*dz;
    if(d2<r*r){ const d=Math.sqrt(d2)||0.001; const push=(r-d)/d;
      px+=dx*push; pz+=dz*push; }
  }
  px=clamp(px,-190,190); pz=clamp(pz,-190,190);
  return [px,pz];
}

// ---------------- WORLD ----------------
function mat(opts){ return new THREE.MeshStandardMaterial(Object.assign({roughness:0.85,metalness:0.08},opts)); }
function buildWorld(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1626);
  scene.fog = new THREE.FogExp2(0x2a3a55, 0.004);

  camera = new THREE.PerspectiveCamera(settings.fov, innerWidth/innerHeight, 0.08, 1200);
  camera.rotation.order='YXZ';

  renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = settings.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  hemi = new THREE.HemisphereLight(0x8fb8ff, 0x3a3226, 0.95);
  scene.add(hemi);
  // Dusk sun — warm low angle for "pretty" long shadows
  sunLight = new THREE.DirectionalLight(0xffb36b, 2.6);
  sunLight.position.set(-120, 55, -60);
  sunLight.castShadow = settings.shadows;
  sunLight.shadow.mapSize.set(2048,2048);
  sunLight.shadow.camera.left=-160; sunLight.shadow.camera.right=160;
  sunLight.shadow.camera.top=160; sunLight.shadow.camera.bottom=-160;
  sunLight.shadow.camera.far=500; sunLight.shadow.bias=-0.0004;
  scene.add(sunLight); scene.add(sunLight.target);
  const fill = new THREE.DirectionalLight(0x4a6fa5, 0.35); fill.position.set(80,60,120); scene.add(fill);

  // --- Sky dome (gradient shader, original) ---
  const skyGeo = new THREE.SphereGeometry(900, 24, 16);
  const skyMat = new THREE.ShaderMaterial({ side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{ top:{value:new THREE.Color(0x0b1e3a)}, mid:{value:new THREE.Color(0x35507a)}, low:{value:new THREE.Color(0xff9a56)} },
    vertexShader:'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec3 vP; uniform vec3 top,mid,low;
      void main(){ float h=normalize(vP).y; vec3 c=h>0.25?mix(mid,top,smoothstep(0.25,0.9,h)):mix(low,mid,smoothstep(-0.08,0.25,h));
      float sun=pow(max(dot(normalize(vP),normalize(vec3(-0.75,0.28,-0.4))),0.0),180.0); c+=vec3(1.0,0.6,0.3)*sun*1.4;
      float hs=pow(max(dot(normalize(vP),normalize(vec3(-0.75,0.28,-0.4))),0.0),8.0); c+=vec3(1.0,0.55,0.25)*hs*0.25;
      gl_FragColor=vec4(c,1.0);}`});
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  // stars
  { const g=new THREE.BufferGeometry(), pts=[]; for(let i=0;i<500;i++){ const a=Math.random()*Math.PI*2,e=Math.random()*0.9+0.15,r=880;
      pts.push(Math.cos(a)*Math.cos(e)*r,Math.sin(e)*r,Math.sin(a)*Math.cos(e)*r); }
    g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
    scene.add(new THREE.Points(g,new THREE.PointsMaterial({color:0xaac8ff,size:1.6,sizeAttenuation:false,transparent:true,opacity:0.6,fog:false}))); }
  // drifting dusk clouds + low moon
  window._clouds=[];
  for(let i=0;i<9;i++){ const sm=new THREE.SpriteMaterial({map:Tex.cloud,transparent:true,opacity:0.5+Math.random()*0.3,depthWrite:false,fog:false});
    const sp=new THREE.Sprite(sm); const a=Math.random()*Math.PI*2, r=450+Math.random()*250;
    sp.position.set(Math.cos(a)*r,150+Math.random()*110,Math.sin(a)*r);
    sp.scale.set(220+Math.random()*160,70+Math.random()*40,1);
    scene.add(sp); window._clouds.push({sp,v:0.9+Math.random()*1.2}); }
  { const mc=document.createElement('canvas'); mc.width=mc.height=128; const mx=mc.getContext('2d');
    const mg=mx.createRadialGradient(64,64,8,64,64,62); mg.addColorStop(0,'rgba(240,244,255,1)');mg.addColorStop(0.35,'rgba(220,230,250,.9)');mg.addColorStop(0.45,'rgba(180,200,240,.25)');mg.addColorStop(1,'rgba(180,200,240,0)');
    mx.fillStyle=mg; mx.fillRect(0,0,128,128);
    const moon=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(mc),transparent:true,depthWrite:false,fog:false}));
    moon.position.set(-480,300,-260); moon.scale.set(90,90,1); scene.add(moon); }
  // floating objective beacon (pulsing diamond over the current target)
  window._beacon=new THREE.Sprite(new THREE.SpriteMaterial({map:Tex.diamond,transparent:true,depthWrite:false,depthTest:false}));
  window._beacon.scale.set(2.6,2.6,1); window._beacon.renderOrder=5; scene.add(window._beacon);

  // --- Ground (PBR retexture pillar) ---
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(420,420),
    new THREE.MeshStandardMaterial({map:Tex.grass,roughness:0.95,metalness:0}));
  gnd.rotation.x=-Math.PI/2; gnd.receiveShadow=true; scene.add(gnd);
  // asphalt roads / pads
  const roadMat = mat({map:Tex.asphalt,roughness:0.9});
  const road1 = new THREE.Mesh(new THREE.PlaneGeometry(30,400), roadMat);
  road1.rotation.x=-Math.PI/2; road1.position.set(0,0.02,0); road1.receiveShadow=true; scene.add(road1);
  const road2 = new THREE.Mesh(new THREE.PlaneGeometry(300,22), roadMat.clone());
  road2.rotation.x=-Math.PI/2; road2.position.set(0,0.02,10); road2.receiveShadow=true; scene.add(road2);
  const padMat = mat({map:Tex.concrete,roughness:0.8});
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(150,110), padMat);
  pad.rotation.x=-Math.PI/2; pad.position.set(30,0.03,-60); pad.receiveShadow=true; scene.add(pad);

  // lane markings
  const lineMat = new THREE.MeshBasicMaterial({color:0xd8b93a});
  for(let z=-190;z<190;z+=12){ const l=new THREE.Mesh(new THREE.PlaneGeometry(0.5,5),lineMat);
    l.rotation.x=-Math.PI/2; l.position.set(0,0.05,z); scene.add(l); }

  // --- Mountains backdrop ---
  const mMat = mat({color:0x2b3a52,roughness:1});
  for(let i=0;i<14;i++){ const h=60+Math.random()*90, r=60+Math.random()*60;
    const m=new THREE.Mesh(new THREE.ConeGeometry(r,h,5),mMat);
    const a=(i/14)*Math.PI*2; m.position.set(Math.cos(a)*330,h/2-4,Math.sin(a)*330);
    m.rotation.y=Math.random()*3; scene.add(m);
    const cap=new THREE.Mesh(new THREE.ConeGeometry(r*0.35,h*0.35,5),mat({color:0xdde8f5,roughness:0.9}));
    cap.position.set(m.position.x,h*0.82-4,m.position.z); cap.rotation.y=m.rotation.y; scene.add(cap); }

  buildBase(padMat);
  buildVegetation();
  buildLightingProps();
}

function box(w,h,d,m,x,y,z,ry=0,shadow=true){
  const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);
  o.position.set(x,y,z); o.rotation.y=ry; o.castShadow=shadow; o.receiveShadow=true; scene.add(o); return o;
}

function buildBase(padMat){
  const wallMat=mat({map:Tex.concrete,roughness:0.75,color:0xbfc3c7});
  const metalMat=mat({map:Tex.metal,roughness:0.45,metalness:0.7});
  const roofM=mat({map:Tex.roof,roughness:0.9});
  const crateM=mat({map:Tex.crate,roughness:0.85});

  // Perimeter fence (south gate = infiltration point)
  const fenceM=new THREE.MeshStandardMaterial({map:Tex.fence,transparent:true,alphaTest:0.3,side:THREE.DoubleSide,roughness:0.5,metalness:0.6});
  const F=140, H=4;
  function fenceRun(x1,z1,x2,z2,gapAt=null,gapW=0){
    const dx=x2-x1,dz=z2-z1,len=Math.hypot(dx,dz),ang=Math.atan2(dx,dz);
    const segs=Math.ceil(len/8);
    for(let i=0;i<segs;i++){ const t=(i+0.5)/segs, cx=x1+dx*t, cz=z1+dz*t;
      if(gapAt!==null){ const d=(t-gapAt)*len; if(Math.abs(d)<gapW/2) continue; }
      const p=new THREE.Mesh(new THREE.PlaneGeometry(8,H),fenceM);
      p.position.set(cx,H/2,cz); p.rotation.y=ang; scene.add(p);
      const post=box(0.25,H+0.6,0.25,metalMat,cx,0,cz); post.castShadow=false;
      const alongX=Math.abs(dx)>=Math.abs(dz);
      if(alongX) addCollider(cx,0,cz,8,H,0.7); else addCollider(cx,0,cz,0.7,H,8); }
  }
  fenceRun(-F,-F,F,-F); fenceRun(-F,F,F,F,0.42,14); // south gate gap
  fenceRun(-F,-F,-F,F); fenceRun(F,-F,F,F);

  // Warehouses (command warehouse = intel)
  const warehouses=[
    {x:-40,z:-70,w:36,d:22,name:'WAREHOUSE A'},
    {x:30,z:-80,w:44,d:26,name:'COMMAND WAREHOUSE',intel:true},
    {x:95,z:-45,w:30,d:20,name:'WAREHOUSE C'},
    {x:-95,z:-30,w:28,d:18,name:'MOTOR POOL'},
  ];
  warehouses.forEach((wh,i)=>{
    const h=9;
    const body=box(wh.w,h,wh.d,wallMat,wh.x,h/2,wh.z); body.receiveShadow=true;
    const roof=new THREE.Mesh(new THREE.CylinderGeometry(0.1,wh.w*0.62,h*0.35,4,1),roofM);
    roof.position.set(wh.x,h+h*0.16,wh.z); roof.rotation.y=Math.PI/4; roof.scale.z=wh.d/wh.w; roof.castShadow=true; scene.add(roof);
    // big door
    const door=box(wh.w*0.35,6,0.4,metalMat,wh.x,3,wh.z+wh.d/2+0.1); door.castShadow=false;
    if(wh.intel){ // command warehouse door slides open once all uplinks are hacked
      const spill=new THREE.PointLight(0xffc46b,0,22); spill.position.set(wh.x,4,wh.z+wh.d/2+2); scene.add(spill);
      window._cmdDoor={mesh:door,baseX:wh.x,open:false,t:0,spill}; }
    // hazard stripe above door
    const hz=new THREE.Mesh(new THREE.PlaneGeometry(wh.w*0.4,1.2),new THREE.MeshBasicMaterial({map:Tex.hazard}));
    hz.position.set(wh.x,7.4,wh.z+wh.d/2+0.15); scene.add(hz);
    // windows glow
    const winM=new THREE.MeshBasicMaterial({color:0xffd28a});
    for(let k=-2;k<=2;k++){ const w=new THREE.Mesh(new THREE.PlaneGeometry(2,1.4),winM);
      w.position.set(wh.x+k*6,h-2,wh.z+wh.d/2+0.06); scene.add(w); }
    addCollider(wh.x,0,wh.z,wh.w,h,wh.d);
    wh.roofY=h; wh.bounds={x:wh.x,z:wh.z,w:wh.w,d:wh.d};
    if(wh.intel) buildIntel(wh);
  });

  // Control tower
  const tw=box(10,26,10,wallMat,-70,13,-95); addCollider(-70,0,-95,10,26,10);
  box(16,4,16,metalMat,-70,28,-95); addCollider(-70,26,-95,16,4,16);
  const glassM=new THREE.MeshStandardMaterial({color:0x9fd8ff,emissive:0xffc46b,emissiveIntensity:0.9,roughness:0.2,metalness:0.4});
  const cab=new THREE.Mesh(new THREE.BoxGeometry(14,3,14),glassM); cab.position.set(-70,32,-95); scene.add(cab);
  const beacon=new THREE.Mesh(new THREE.SphereGeometry(0.5,10,10),new THREE.MeshBasicMaterial({color:0xff3333}));
  beacon.position.set(-70,35,-95); beacon.userData.blink=true; scene.add(beacon); pickups.push(beacon);

  // Guard towers x3
  [[-110,60],[110,60],[110,-110]].forEach(([x,z])=>{
    const legM=mat({color:0x4a3b28,roughness:0.9});
    [[-2,-2],[2,-2],[-2,2],[2,2]].forEach(([ox,oz])=>box(0.5,12,0.5,legM,x+ox,6,z+oz));
    box(7,1,7,legM,x,12,z); box(6,3,6,wallMat,x,14,z);
    const r=box(8,0.5,8,roofM,x,16,z);
    addCollider(x,0,z,7,16,7);
  });

  // Panning CCTV cameras on the warehouses (IGI Origins-style surveillance)
  window._cctvs=[];
  [[-58,-58,0.6],[52,-66,-0.5],[110,-34,-1.2],[-81,-20,1.1]].forEach(([x,z,ry],i)=>{
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.12,3.4,6),metalMat);
    pole.position.set(x,7.5,z); scene.add(pole);
    const head=new THREE.Group(); head.position.set(x,9.2,z); head.rotation.y=ry;
    const cam=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.35,1.1),mat({color:0x14181e,roughness:0.4,metalness:0.6}));
    head.add(cam);
    const lens=new THREE.Mesh(new THREE.CircleGeometry(0.1,10),new THREE.MeshBasicMaterial({color:0x331111}));
    lens.position.set(0,0,0.56); head.add(lens);
    const led=new THREE.Mesh(new THREE.SphereGeometry(0.06,6,6),new THREE.MeshBasicMaterial({color:0xff2222}));
    led.position.set(0,0.25,0.3); led.userData.blink=true; head.add(led);
    scene.add(head); window._cctvs.push({head,phase:i*1.7,base:ry});
  });

  // Rotating radar on the control tower + waving depot flag
  { const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.2,3,6),metalMat);
    mast.position.set(-70,36.5,-95); scene.add(mast);
    const bar=new THREE.Group(); bar.position.set(-70,38,-95);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(5,0.25,0.5),metalMat); bar.add(arm);
    scene.add(bar); window._radar=bar; }
  { const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.16,9,8),metalMat);
    pole.position.set(54,4.5,-58); pole.castShadow=true; scene.add(pole);
    const fg=new THREE.PlaneGeometry(3.4,2,12,6);
    const flag=new THREE.Mesh(fg,new THREE.MeshStandardMaterial({color:0x8a2f28,roughness:0.9,side:THREE.DoubleSide}));
    flag.position.set(55.8,7.6,-58); scene.add(flag);
    window._flag={mesh:flag,base:fg.attributes.position.array.slice()}; }

  // Crates (cover + east climb route)
  const crateSpots=[[-20,-20,3],[0,-25,2],[25,-30,4],[-50,20,2],[60,30,3],[80,-10,2],[-80,30,3],[40,60,2],[-10,50,2],[120,20,2]];
  crateSpots.forEach(([x,z,n])=>{
    for(let i=0;i<n;i++){ const s=2.4, ox=(Math.random()-0.5)*4, oz=(Math.random()-0.5)*4;
      const lvl=Math.floor(i/2), px=x+ox+(lvl%2)*1.2, pz=z+oz;
      box(s,s,s,crateM,px,s/2+lvl*s,pz,Math.random()*0.4);
      if(i===0) addCollider(px,0,pz,s+0.4,s,s+0.4); }
  });

  // Barrels (explosive! red)
  const barrelM=mat({color:0x8a2a22,roughness:0.5,metalness:0.4});
  const barrelM2=mat({color:0x2a5a3a,roughness:0.5,metalness:0.4});
  window._barrels=[];
  for(let i=0;i<26;i++){ const x=(Math.random()-0.5)*220, z=-110+Math.random()*160;
    if(Math.hypot(x-30,z+80)<30) continue;
    const b=new THREE.Mesh(new THREE.CylinderGeometry(0.9,0.9,2.2,14),Math.random()>0.4?barrelM:barrelM2);
    b.position.set(x,1.1,z); b.castShadow=true; b.receiveShadow=true; scene.add(b);
    b.userData.explosive=true; b.userData.hp=20; window._barrels.push(b);
    addCollider(x,0,z,1.8,2.2,1.8); }

  // Trucks (simple but shaded)
  window._trucks=[];
  function truck(x,z,ry,col=0x3c4a2a){
    const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry;
    const bed=new THREE.Mesh(new THREE.BoxGeometry(4,2,9),mat({color:col,roughness:0.6,metalness:0.3}));
    bed.position.y=2; bed.castShadow=true; g.add(bed);
    const cabM=new THREE.Mesh(new THREE.BoxGeometry(3.6,2.4,2.6),mat({color:0x22282e,roughness:0.35,metalness:0.5}));
    cabM.position.set(0,2.1,5.4); cabM.castShadow=true; g.add(cabM);
    const wg=new THREE.CylinderGeometry(0.9,0.9,0.7,12); wg.rotateZ(Math.PI/2);
    const wm=mat({color:0x111111,roughness:0.9});
    [[-1.9,3],[1.9,3],[-1.9,-2.5],[1.9,-2.5],[-1.9,-0.5],[1.9,-0.5]].forEach(([ox,oz])=>{
      const w=new THREE.Mesh(wg,wm); w.position.set(ox,0.9,oz); g.add(w); });
    scene.add(g); addCollider(x,0,z,5,4,11); window._trucks.push(g); }
  truck(-60,-40,0.4); truck(60,-55,-0.3,0x4a3c2a); truck(-30,40,1.2,0x2a3c4a);

  // Train (IGI trainyard nod — boxcars on rails)
  const railM=mat({color:0x333940,roughness:0.4,metalness:0.8});
  [-124.5,-123].forEach(rz=>{ box(200,0.25,0.3,railM,-20,0.15,rz,0,false); });
  for(let i=0;i<4;i++){ const cx=-70+i*22;
    box(18,5,4,mat({color:[0x7a2f28,0x2f4a6b,0x4a5a2f,0x555a60][i],roughness:0.55,metalness:0.35}),cx,3,-117);
    addCollider(cx,0,-117,18,5,4); }

  // Uplink terminals (hack objectives) — glowing green kiosks
  const termSpots=[[-40,-52],[30,-62],[95,-30]];
  termSpots.forEach(([x,z],i)=>{
    const k=box(1.6,2.2,0.8,mat({color:0x1a222c,roughness:0.4,metalness:0.6}),x,1.1,z);
    const scr=new THREE.Mesh(new THREE.PlaneGeometry(1.2,1.4),
      new THREE.MeshBasicMaterial({map:Tex.terminal}));
    scr.position.set(x,1.5,z+0.42); scene.add(scr);
    const glow=new THREE.PointLight(0x39ff88,6,12); glow.position.set(x,2,z+1); scene.add(glow);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(2.2,0.08,8,32),
      new THREE.MeshBasicMaterial({color:0x39ff88}));
    ring.rotation.x=Math.PI/2; ring.position.set(x,0.1,z); scene.add(ring);
    terminals.push({pos:new THREE.Vector3(x,0,z),mesh:k,screen:scr,ring,light:glow,hacked:false,idx:i});
  });

  // LZ (exfil) — north-east
  const lz=new THREE.Group(); lz.position.set(120,0,120);
  const circ=new THREE.Mesh(new THREE.CircleGeometry(10,32),mat({map:Tex.concrete,color:0x9aa0a6}));
  circ.rotation.x=-Math.PI/2; circ.position.y=0.05; lz.add(circ);
  const ringH=new THREE.Mesh(new THREE.RingGeometry(7,8.4,32),new THREE.MeshBasicMaterial({color:0xffb454,side:THREE.DoubleSide}));
  ringH.rotation.x=-Math.PI/2; ringH.position.y=0.08; lz.add(ringH);
  const hTxt=new THREE.Mesh(new THREE.PlaneGeometry(6,6),new THREE.MeshBasicMaterial({color:0xffb454,transparent:true,opacity:0.9}));
  hTxt.rotation.x=-Math.PI/2; hTxt.position.y=0.09; lz.add(hTxt);
  // helicopter (low-poly, original)
  const heli=new THREE.Group();
  const hb=new THREE.Mesh(new THREE.CapsuleGeometry(1.4,4,6,12),mat({color:0x2b343c,roughness:0.4,metalness:0.5}));
  hb.rotation.z=Math.PI/2; hb.castShadow=true; heli.add(hb);
  const tail=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.7,7,8),mat({color:0x2b343c,roughness:0.5}));
  tail.rotation.z=Math.PI/2; tail.position.x=-5.5; heli.add(tail);
  const rotor=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.1,14),mat({color:0x111111})); rotor.position.y=1.8; heli.add(rotor);
  heli.userData.rotor=rotor;
  heli.position.set(120,1.6,120); scene.add(heli); lz.add(new THREE.PointLight(0xffb454,20,30).translateY(4));
  scene.add(lz); window._heli=heli;
  const lzLight=new THREE.PointLight(0xffb454,30,40); lzLight.position.set(120,6,120); scene.add(lzLight);
  terminals.lzPos=new THREE.Vector3(120,0,120);
}

function buildIntel(wh){
  const g=new THREE.Group(); g.position.set(wh.x,1.2,wh.z-4);
  const cs=new THREE.Mesh(new THREE.BoxGeometry(1.4,0.9,1),mat({color:0x14181e,roughness:0.3,metalness:0.7}));
  g.add(cs);
  const glow=new THREE.Mesh(new THREE.BoxGeometry(1.0,0.15,0.7),new THREE.MeshBasicMaterial({color:0xff3344}));
  glow.position.y=0.55; g.add(glow);
  const l=new THREE.PointLight(0xff3344,10,14); l.position.y=1.5; g.add(l);
  scene.add(g);
  terminals.intel={pos:new THREE.Vector3(wh.x,0,wh.z-4),mesh:g,taken:false};
  const doc=new THREE.Mesh(new THREE.PlaneGeometry(0.7,0.9),new THREE.MeshBasicMaterial({color:0xfff2c4,side:THREE.DoubleSide}));
  doc.position.y=0.75; doc.rotation.x=-0.4; g.add(doc); terminals.intel.doc=doc;
}

function buildContainers(metal){
  // shipping-container cover stacks (CC0 corrugated metal), placed clear of patrol lanes
  const contMat=new THREE.MeshStandardMaterial({roughness:0.55,metalness:0.55});
  if(metal){ contMat.map=metal.col; contMat.normalMap=metal.nrm;
    contMat.roughnessMap=metal.rgh; contMat.metalnessMap=CC0MetalMap();
    for(const t of [contMat.map,contMat.normalMap,contMat.roughnessMap]) t.repeat.set(3,1.5); }
  else contMat.map=Tex.metal;
  function CC0MetalMap(){ try{ const t=new THREE.TextureLoader().load('textures/MetalPlates008_1K-JPG_Metalness.jpg');
    t.wrapS=t.wrapT=THREE.RepeatWrapping; return t; }catch(e){ return null; } }
  const cols=[0x7a3b28,0x2f4a6b,0x4a5a2f,0x555a60];
  const spots=[[58,-20,0.3,0],[62,-20,0.3,1],[-58,8,-0.4,2],[-62,8,-0.4,3],[60,-17.4,0.3,1]];
  window._containers=[];
  spots.forEach(([x,z,ry,ci],i)=>{
    const lvl=i===4?1:0;
    const c=new THREE.Mesh(new THREE.BoxGeometry(6.1,2.6,2.5),contMat.clone());
    c.material.color.setHex(cols[ci]); c.position.set(x,1.3+lvl*2.6,z); c.rotation.y=ry;
    c.castShadow=true; c.receiveShadow=true; scene.add(c);
    if(lvl===0){ addCollider(x,0,z,6.4,2.6,2.8); window._containers.push({x,z,w:6.4,d:2.8}); }
  });
}

// Orientation tunables for Sketchfab GLBs (verified via A/B screenshots, refined in-game)
const RIFLE_YAW=Math.PI;     // AK viewmodel: muzzle toward -Z
const SOLDIER_YAW=0;         // skinned enemy facing offset inside wrapper
const SOLDIER_GLOW={y:1.58,f:0.30}; // alert-visor glow dot (head height / forward)
const HELI_YAW=0.6;

const Assets={ak:null,soldier:null,nh90:null,truck:null,done:false};
async function loadExternalAssets(){
  try{
    const loader=new GLTFLoader();
    const [ak,sol,nh,tr]=await Promise.all([
      loader.loadAsync('models/ak47.glb'), loader.loadAsync('models/soldier.glb'),
      loader.loadAsync('models/nh90.glb'), loader.loadAsync('models/truck.glb')]);
    Assets.ak=ak; Assets.soldier=sol; Assets.nh90=nh; Assets.truck=tr;
    upgradeRifleViewmodel(); upgradeEnemiesToSkinned(); upgradeHeli(); upgradeTrucks();
    Assets.done=true;
    toast('HD ASSETS ONLINE — Sketchfab detail streamed in.');
    console.log('[IGI] external assets integrated');
  }catch(err){ console.warn('[IGI] external assets skipped:', err&&err.message); }
}
function fitScale(obj,targetLen){
  const bb=new THREE.Box3().setFromObject(obj), size=bb.getSize(new THREE.Vector3());
  return {s:targetLen/Math.max(size.x,size.y,size.z),bb,size};
}
function upgradeRifleViewmodel(){
  const g=weapons.models.rifle;
  g.children.slice().forEach(c=>g.remove(c));
  const ak=Assets.ak.scene, {s}=fitScale(ak,0.95);
  ak.scale.setScalar(s);
  const holder=new THREE.Group(); holder.add(ak);
  const bb=new THREE.Box3().setFromObject(ak), c=bb.getCenter(new THREE.Vector3());
  ak.position.x-=c.x; ak.position.z-=c.z; ak.position.y-=bb.min.y;
  holder.rotation.y=RIFLE_YAW;
  holder.position.set(0,0.02,-0.15);
  g.add(holder);
  ak.traverse(o=>{ if(o.isMesh) o.castShadow=false; });
  const mz=new THREE.Object3D(); mz.position.set(0,0.12,-0.55); g.add(mz);
  g.userData.muzzle=mz; g.userData.mag=null;
  // keep ADS framing for the longer hero gun
  weapons.rig.position.set(0.28,-0.28,-0.5);
}
function setAnim(e,name){
  if(!e.acts||e.curAnim===name) return; e.curAnim=name;
  const to=name==='walk'?e.acts.walk:e.acts.pose;
  const from=name==='walk'?e.acts.pose:e.acts.walk;
  to.enabled=true; to.reset(); to.setEffectiveWeight(1);
  to.crossFadeFrom(from,0.25,true); to.play();
}
function upgradeEnemiesToSkinned(){
  const src=Assets.soldier.scene;
  const bb=new THREE.Box3().setFromObject(src);
  const s=1.78/bb.getSize(new THREE.Vector3()).y;
  const clips=Assets.soldier.animations;
  const walk=clips.find(c=>/walk/i.test(c.name))||clips[0];
  const pose=clips.find(c=>/pose|idle|default/i.test(c.name))||clips[0];
  for(const e of enemies){
    scene.remove(e.mesh);
    const clone=cloneSkinned(src);
    const mats=[];
    clone.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.material=o.material.clone(); mats.push({m:o.material,c:o.material.color.getHex()}); }});
    clone.scale.setScalar(s);
    clone.rotation.y=SOLDIER_YAW;
    const wrap=new THREE.Group();
    wrap.position.set(e.mesh.position.x,0,e.mesh.position.z);
    wrap.rotation.y=e.yaw; wrap.add(clone);
    const glow=new THREE.Mesh(new THREE.SphereGeometry(0.05,6,6),new THREE.MeshBasicMaterial({color:0xff2222}));
    glow.position.set(0,SOLDIER_GLOW.y,SOLDIER_GLOW.f); glow.visible=false; clone.add(glow);
    scene.add(wrap);
    e.mesh=wrap; e.skinned=true; e.headH=1.5; e.flashMats=mats; e.glow=glow;
    e.mixer=new THREE.AnimationMixer(clone);
    const aW=e.mixer.clipAction(walk); aW.setLoop(THREE.LoopRepeat,Infinity); aW.play();
    const aP=e.mixer.clipAction(pose); aP.play(); aP.weight=0;
    e.acts={walk:aW,pose:aP}; e.curAnim='walk';
  }
}
function upgradeHeli(){
  const heli=window._heli; if(!heli) return;
  heli.children.slice().forEach(c=>heli.remove(c));
  const src=Assets.nh90.scene, {s,bb,size}=fitScale(src,13);
  const inner=new THREE.Group(); inner.add(src);
  src.scale.setScalar(s);
  const b2=new THREE.Box3().setFromObject(src);
  src.position.y-=b2.min.y; inner.position.y=-1.2; inner.rotation.y=HELI_YAW;
  heli.add(inner);
  src.traverse(o=>{ if(o.isMesh){ o.castShadow=true; }});
  // blur blades: crossed quads sized to the rotor disc, spun by the existing spool logic
  const r=Math.max(size.x,size.z)*s*0.52;
  const blades=new THREE.Group();
  const bm=new THREE.MeshBasicMaterial({color:0x111418,transparent:true,opacity:0.55,side:THREE.DoubleSide,depthWrite:false});
  const b1=new THREE.Mesh(new THREE.BoxGeometry(r*2,0.06,0.5),bm); blades.add(b1);
  const b2m=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.06,r*2),bm); blades.add(b2m);
  const disc=new THREE.Mesh(new THREE.CircleGeometry(r,28),
    new THREE.MeshBasicMaterial({color:0x222630,transparent:true,opacity:0.16,side:THREE.DoubleSide,depthWrite:false}));
  disc.rotation.x=-Math.PI/2; blades.add(disc);
  blades.position.y=(b2.max.y-b2.min.y)+0.35;
  heli.add(blades); heli.userData.rotor=blades;
}
function upgradeTrucks(){
  if(!window._trucks) return;
  const src=Assets.truck.scene, {s}=fitScale(src,7.5);
  for(const g of window._trucks){
    g.children.slice().forEach(c=>g.remove(c));
    const clone=src.clone(true);
    clone.scale.setScalar(s);
    const bb=new THREE.Box3().setFromObject(clone);
    clone.position.y-=bb.min.y;
    clone.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
    g.add(clone);
  }
}
function buildVegetation(){
  const trunkM=mat({color:0x4a3826,roughness:1}), leafM=mat({color:0x2e4a26,roughness:1});
  for(let i=0;i<70;i++){ const x=(Math.random()-0.5)*380, z=(Math.random()-0.5)*380;
    if(Math.abs(x)<90&&Math.abs(z+40)<80) continue; if(Math.hypot(x-120,z-120)<25) continue;
    const h=4+Math.random()*5;
    const t=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.4,h,6),trunkM);
    t.position.set(x,h/2,z); t.castShadow=true; scene.add(t);
    const c=new THREE.Mesh(new THREE.ConeGeometry(2+Math.random()*2,4+Math.random()*3,7),leafM);
    c.position.set(x,h+2,z); c.castShadow=true; scene.add(c); }
  // grass tufts (instanced feel via merged small cones, cheap)
  const tuftG=new THREE.ConeGeometry(0.12,0.7,4), tuftM=mat({color:0x557a35,roughness:1});
  const inst=new THREE.InstancedMesh(tuftG,tuftM,600);
  const d=new THREE.Object3D();
  for(let i=0;i<600;i++){ d.position.set((Math.random()-0.5)*360,0.3,(Math.random()-0.5)*360);
    d.rotation.y=Math.random()*3; d.updateMatrix(); inst.setMatrixAt(i,d.matrix); }
  scene.add(inst);
}

function buildLightingProps(){
  // Floodlight poles — 2 real SpotLights + emissive fakes (perf)
  const poleM=mat({color:0x22282e,roughness:0.5,metalness:0.6});
  const spots=[[-60,-60],[40,-40],[0,40],[-40,80],[90,40]];
  window._floodHeads=[];
  spots.forEach(([x,z],i)=>{
    const p=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.4,16,8),poleM);
    p.position.set(x,8,z); p.castShadow=true; scene.add(p);
    const head=new THREE.Mesh(new THREE.BoxGeometry(2.4,1,1),new THREE.MeshBasicMaterial({color:0xfff3c4}));
    head.position.set(x,16,z); head.lookAt(30,0,-60); scene.add(head);
    window._floodHeads.push(head);
    if(i<3){ const s=new THREE.SpotLight(0xffe6b0,900,90,0.6,0.45,1.6);
      s.position.set(x,16,z); s.target.position.set(x*0.4,0,z*0.4);
      s.castShadow=settings.quality!=='LOW'; scene.add(s); scene.add(s.target);
      if(i===1) window._sweep={light:s,target:s.target,cx:x,cz:z,r:38,t:Math.random()*6}; }
    // warm pool on the ground beneath each mast
    const pool=new THREE.Mesh(new THREE.CircleGeometry(11,24),
      new THREE.MeshBasicMaterial({map:Tex.pool,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
    pool.rotation.x=-Math.PI/2; pool.position.set(x*0.7,0.06,z*0.7); scene.add(pool);
    // visible cone (fake volumetric)
    const cone=new THREE.Mesh(new THREE.ConeGeometry(7,16,16,1,true),
      new THREE.MeshBasicMaterial({color:0xffe6b0,transparent:true,opacity:0.05,side:THREE.DoubleSide,depthWrite:false}));
    cone.position.set(x*0.7,8,z*0.7); scene.add(cone);
    addCollider(x,0,z,0.8,16,0.8);
  });
}

// ---------------- PLAYER ----------------
function initPlayer(){
  player={ pos:new THREE.Vector3(0,1.7,152), vel:new THREE.Vector3(), yaw:0, pitch:0,
    hp:100, crouch:false, sprint:false, ads:0, onGround:true, vy:0, bob:0, stepT:0,
    alive:true, torch:false, noise:0, lastShot:0 };
  camera.position.copy(player.pos);
  // viewmodel rig
  const rig=new THREE.Group(); camera.add(rig); scene.add(camera); rig.position.set(0.28,-0.28,-0.5); rig.scale.setScalar(0.62);
  // small fill so viewmodel is never pitch black
  const vmFill=new THREE.PointLight(0xbfd8ff,0.5,2.5); vmFill.position.set(-0.25,0.35,0.5); rig.add(vmFill);
  const vmKey=new THREE.PointLight(0xffd9a8,2.2,4); vmKey.position.set(0.25,0.5,-0.7); rig.add(vmKey);
  weapons={ rig, models:{}, state:{} };
  for(const k of ['rifle','smg','dmr','pistol']){
    const g=buildGunMesh(k); g.visible=false; rig.add(g); weapons.models[k]=g;
    weapons.state[k]={mag:WEAPON_DEFS[k].mag,reserve:WEAPON_DEFS[k].reserve,reloading:false,last:0};
  }
  equipWeapon(settings.primary in WEAPON_DEFS?settings.primary:'rifle');
  equipWeapon2('pistol');
  // torch
  flashLight=new THREE.SpotLight(0xfff2d0,0,60,0.45,0.4,1.2);
  camera.add(flashLight); flashLight.position.set(0.1,-0.1,0);
  flashLight.target.position.set(0,0,-5); camera.add(flashLight.target);
  muzzleLight=new THREE.PointLight(0xffb36b,0,18); camera.add(muzzleLight); muzzleLight.position.set(0.3,-0.2,-1);
}
let secondary='pistol';
function equipWeapon2(k){ secondary=k; }
function currentDef(){ const order=[weapons.primary,secondary]; return WEAPON_DEFS[order[currentWeapon]]; }
function currentKey(){ return [weapons.primary,secondary][currentWeapon]; }
function equipWeapon(k){ weapons.primary=weapons.primary||k; if(WEAPON_DEFS[k]&&k!=='pistol'){weapons.primary=k;} refreshGunVis(); }
function switchSlot(i){ if(i===currentWeapon) return; currentWeapon=i;
  const s=weapons.state[currentKey()]; if(s.reloading){s.reloading=false;}
  drawT=0; refreshGunVis(); AudioSys.reload(); updateAmmoHUD();
  document.querySelectorAll('#weapon-slots button').forEach((b,j)=>b.classList.toggle('active',j===currentWeapon)); }
function refreshGunVis(){
  const order=[weapons.primary,secondary];
  for(const k in weapons.models) weapons.models[k].visible=(k===order[currentWeapon]);
  $('weapon-name').textContent=currentDef().name;
  updateAmmoHUD();
}
function buildGunMesh(kind){
  const g=new THREE.Group();
  const dark=mat({color:0x16191d,roughness:0.35,metalness:0.75});
  const mid=mat({color:0x3a4148,roughness:0.45,metalness:0.6});
  const wood=mat({color:0x5a3d22,roughness:0.7});
  const glow=new THREE.MeshBasicMaterial({color:kind==='dmr'?0x7de7ff:0xffb454});
  const L=(w,h,d,m,x,y,z)=>{const q=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);q.position.set(x,y,z);g.add(q);return q;};
  if(kind==='rifle'){ L(0.09,0.13,0.75,dark,0,0,-0.2); L(0.07,0.1,0.3,wood,0,-0.02,0.15);
    L(0.06,0.16,0.09,mid,0,-0.13,0.05); L(0.03,0.06,0.25,dark,0,0.09,-0.35);
    L(0.02,0.05,0.02,glow,0,0.1,-0.62); const mag=L(0.07,0.18,0.1,mid,0,-0.13,-0.15); mag.rotation.x=0.25;
    g.userData.mag=mag; g.userData.magY=-0.13; }
  else if(kind==='smg'){ L(0.08,0.11,0.5,dark,0,0,-0.1); L(0.05,0.05,0.2,dark,0,0.02,-0.4);
    const mag=L(0.06,0.2,0.08,mid,0,-0.14,0); g.userData.mag=mag; g.userData.magY=-0.14;
    L(0.02,0.04,0.02,glow,0,0.07,-0.45); }
  else if(kind==='dmr'){ L(0.09,0.12,0.95,dark,0,0,-0.3); L(0.08,0.08,0.35,wood,0,-0.01,0.25);
    const sc=L(0.07,0.07,0.3,dark,0,0.12,-0.1); L(0.02,0.02,0.05,glow,0,0.12,-0.28);
    const mag=L(0.06,0.16,0.09,mid,0,-0.12,0.05); g.userData.mag=mag; g.userData.magY=-0.12;
    L(0.02,0.3,0.02,dark,0,-0.02,-0.3); }
  else { L(0.07,0.1,0.3,dark,0,0,-0.05); const mag=L(0.06,0.14,0.08,mid,0,-0.1,0.08);
    g.userData.mag=mag; g.userData.magY=-0.1; L(0.015,0.03,0.015,glow,0,0.06,-0.18); }
  // sight dot
  const dot=new THREE.Mesh(new THREE.SphereGeometry(0.008,6,6),new THREE.MeshBasicMaterial({color:0x7dffb2}));
  dot.position.set(0,0.1,-0.3); g.add(dot);
  // muzzle tip ref
  g.userData.muzzle=new THREE.Object3D(); g.userData.muzzle.position.set(0,0.02,-0.75); g.add(g.userData.muzzle);
  return g;
}

// ---------------- ENEMIES ----------------
const ENEMY_SPOTS=[[-30,-40,0],[10,-60,1],[60,-70,2],[-70,-60,3],[90,-20,0],[0,0,1],[-50,40,2],[50,50,3],[-90,0,0],[20,-90,1],[110,90,2],[-20,90,3]];
function spawnEnemies(){
  const bodyM=mat({map:Tex.camo,roughness:0.9});
  const skinM=mat({color:0xc8a080,roughness:0.7});
  const darkM=mat({color:0x1c1f22,roughness:0.7});
  const pantsM=mat({color:0x2e3325,roughness:0.9});
  ENEMY_SPOTS.forEach(([x,z],i)=>{
    const g=new THREE.Group(); g.position.set(x,0,z);
    // legs pivoted at the hip so the walk cycle swings them
    function limb(w,h,d,m,px,py,pz){
      const pivot=new THREE.Group(); pivot.position.set(px,py,pz);
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);
      mesh.position.y=-h/2; mesh.castShadow=true; pivot.add(mesh); g.add(pivot); return pivot; }
    const legL=limb(0.24,0.9,0.32,pantsM,-0.15,0.9,0);
    const legR=limb(0.24,0.9,0.32,pantsM,0.15,0.9,0);
    const torso=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.85,0.42),bodyM.clone()); torso.position.y=1.3; torso.castShadow=true; g.add(torso);
    const vest=new THREE.Mesh(new THREE.BoxGeometry(0.74,0.4,0.46),darkM); vest.position.y=1.35; g.add(vest);
    const pack=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.55,0.25),pantsM); pack.position.set(0,1.35,-0.33); g.add(pack);
    const armL=limb(0.18,0.7,0.22,bodyM,-0.45,1.68,0);
    const armR=limb(0.18,0.7,0.22,bodyM,0.45,1.68,0);
    armR.rotation.x=-1.1; // right arm raised, holding rifle
    const head=new THREE.Mesh(new THREE.SphereGeometry(0.26,12,12),skinM); head.position.y=1.98; head.castShadow=true; g.add(head);
    const helm=new THREE.Mesh(new THREE.CylinderGeometry(0.29,0.3,0.18,10),darkM); helm.position.y=2.14; g.add(helm);
    // status visor: dark on patrol, amber when suspicious, red in combat
    const visorMat=new THREE.MeshStandardMaterial({color:0x0a0f14,emissive:0x000000,emissiveIntensity:1.6,roughness:0.3});
    const visor=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.09,0.06),visorMat);
    visor.position.set(0,2.0,0.23); g.add(visor);
    const gun=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.12,0.9),mat({color:0x111111,roughness:0.4,metalness:0.6})); gun.position.set(0.3,1.35,0.4); g.add(gun);
    scene.add(g);
    const e={mesh:g,hp:100,alive:true,dying:false,deathT:0,state:'patrol',yaw:Math.random()*6.28,wpIdx:0,
      wps:patrolRoute(x,z),alert:0,lastSeen:null,shootCd:0,searchT:0,speed:2.2,
      legL,legR,armL,armR,torso,visorMat,phase:Math.random()*6.28,walkAmt:0,headH:1.7,head,gund:gun,flash:0};
    enemies.push(e);
  });
}
function patrolRoute(x,z){
  const r=[]; for(let i=0;i<4;i++) r.push(new THREE.Vector3(
    clamp(x+(Math.random()-0.5)*60,-130,130),0,clamp(z+(Math.random()-0.5)*60,-120,120)));
  return r;
}
function damageEnemy(e,dmg,headshot,dir){
  if(!e.alive) return;
  e.hp-=dmg*(headshot?2.5:1); shotsHit++;
  spawnBlood(e.mesh.position.clone().add(new THREE.Vector3(0,1.5,0)),headshot?14:8);
  e.flash=0.1;
  if(e.hp<=0){ e.alive=false; e.dying=true; e.deathT=0; e.deathDir=Math.random()>0.45?-1:1; kills++;
    setTimeout(()=>{ if(!e.mesh.parent) return; scene.remove(e.mesh); },20000);
    hitmarker(true); feed(`☠ Hostile down ${headshot?'(HEADSHOT)':''}`);
    AudioSys.hit();
    if(objectives.kills!==undefined) objectives.kills++;
  } else { hitmarker(false); AudioSys.hit();
    e.state='alert'; e.lastSeen=player.pos.clone(); e.alert=1; }
}
function feed(t){ const d=document.createElement('div'); d.textContent=t; $('killfeed').prepend(d);
  while($('killfeed').children.length>5) $('killfeed').lastChild.remove();
  setTimeout(()=>d.remove(),5000); }

// ---------------- PARTICLES / TRACERS ----------------
function spawnBlood(p,n){ for(let i=0;i<n;i++){ const m=new THREE.Mesh(new THREE.SphereGeometry(0.05,5,5),
    new THREE.MeshBasicMaterial({color:0xa01313})); m.position.copy(p);
  particles.push({m,v:new THREE.Vector3((Math.random()-0.5)*4,Math.random()*4,(Math.random()-0.5)*4),life:0.6}); scene.add(m);} }
function spawnSpark(p,n,col=0xffcf7d){ for(let i=0;i<n;i++){ const m=new THREE.Mesh(new THREE.SphereGeometry(0.035,5,5),
    new THREE.MeshBasicMaterial({color:col})); m.position.copy(p);
  particles.push({m,v:new THREE.Vector3((Math.random()-0.5)*7,Math.random()*5,(Math.random()-0.5)*7),life:0.4}); scene.add(m);} }
function spawnTracer(a,b,col=0xffe2a8){ const g=new THREE.BufferGeometry().setFromPoints([a,b]);
  const l=new THREE.Line(g,new THREE.LineBasicMaterial({color:col,transparent:true,opacity:0.9}));
  tracers.push({m:l,life:0.07}); scene.add(l); }
// exfil signal smoke: orange puffs rising over the LZ
const smokePuffs=[];
let smokeT=0, lastBeat=0;
function puffSmoke(){
  const m=new THREE.SpriteMaterial({map:Tex.smoke,color:0xff7a2a,transparent:true,opacity:0.75,depthWrite:false});
  const s=new THREE.Sprite(m);
  s.position.set(120+(Math.random()-0.5)*7,0.6,120+(Math.random()-0.5)*7);
  const sc=2+Math.random()*2; s.scale.set(sc,sc,1);
  scene.add(s); smokePuffs.push({s,life:2.6+Math.random(),max:3});
}
function updateSmoke(dt){
  for(let i=smokePuffs.length-1;i>=0;i--){ const p=smokePuffs[i]; p.life-=dt;
    if(p.life<=0){ scene.remove(p.s); p.s.material.dispose(); smokePuffs.splice(i,1); continue; }
    p.s.position.y+=dt*2.4; p.s.position.x+=dt*0.9;
    const g=p.s.scale.x+dt*2.2; p.s.scale.set(g,g,1);
    p.s.material.opacity=0.7*(p.life/p.max); }
}
function muzzleFlash(){
  const gun=weapons.models[currentKey()]; if(!gun) return;
  const tip=new THREE.Vector3(); gun.userData.muzzle.getWorldPosition(tip);
  spawnSpark(tip,9); muzzleLight.intensity=60;
  setTimeout(()=>muzzleLight.intensity=0,45);
  // ejecting brass: pops right of the chamber, tinks on concrete ~90ms later (see AudioSys.casing)
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
  const fwd=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  const brass=new THREE.Mesh(new THREE.SphereGeometry(0.02,5,5),new THREE.MeshBasicMaterial({color:0xd8a93a}));
  brass.position.copy(camera.position).addScaledVector(right,0.18); brass.position.y-=0.12;
  particles.push({m:brass,v:new THREE.Vector3().addScaledVector(right,1.6).addScaledVector(fwd,0.4).add(new THREE.Vector3(0,2.2,0)),life:0.7});
  scene.add(brass);
  // viewmodel kick
  weapons.rig.position.z+=0.06; weapons.rig.rotation.x+=currentDef().recoil;
}

// ---------------- SHOOTING ----------------
const ray=new THREE.Raycaster();
function shoot(){
  const st=weapons.state[currentKey()], def=currentDef();
  if(!player.alive||gameState!=='playing') return;
  const t=performance.now()/1000;
  if(st.reloading||t-st.last<60/def.rpm||st.mag<=0){ if(st.mag<=0&&t-st.last>0.3){AudioSys.dry();st.last=t;} return; }
  st.last=t; st.mag--; shotsFired++; AudioSys.shot(def.kind); muzzleFlash();
  player.noise=Math.min(1,player.noise+(def.kind==='dmr'?0.8:0.4));
  // spread
  const sp=def.spread*(player.sprint?2.2:1)*(player.crouch?0.6:1)*(player.ads>0.5?0.45:1)*(player.vel.length()>1?1.6:1);
  ray.setFromCamera({x:(Math.random()-0.5)*sp*2,y:(Math.random()-0.5)*sp*2},camera);
  ray.far=def.range;
  // test barrels
  const bHit=ray.intersectObjects(window._barrels.filter(b=>b.visible!==false),false)[0];
  const eHit=ray.intersectObjects(enemies.filter(e=>e.alive).map(e=>e.mesh),true)[0];
  let end=ray.ray.at(def.range,new THREE.Vector3());
  let blocked=false;
  // walls: colliders raycast via three? approximate: check building boxes
  if(bHit&&(!eHit||bHit.distance<eHit.distance)){
    end=bHit.point.clone(); blocked=true;
    spawnSpark(end,10,0xff9040);
    bHit.object.userData.hp-=def.dmg;
    if(bHit.object.userData.hp<=0) explodeBarrel(bHit.object);
  }
  if(!blocked&&eHit){
    end=eHit.point.clone();
    let root=eHit.object; while(root.parent&&root.parent!==scene) root=root.parent;
    const e=enemies.find(x=>x.mesh===root);
    // headshot: upper head band (GLB) or the head sphere (procedural fallback)
    const headshot=e?((eHit.point.y-e.mesh.position.y)>(e.headH||1.7)):false;
    if(e) damageEnemy(e,def.dmg,headshot);
    spawnSpark(end,4,0xff2222);
  }
  const tip=new THREE.Vector3(); weapons.models[currentKey()].userData.muzzle.getWorldPosition(tip);
  spawnTracer(tip.clone(),end.clone());
  updateAmmoHUD();
  if(st.mag===0) setTimeout(()=>reload(),400);
}
function explodeBarrel(b){
  spawnSpark(b.position.clone().add(new THREE.Vector3(0,1,0)),40,0xff7020);
  spawnSpark(b.position.clone(),20,0x333333);
  AudioSys.noise(0.6,200,'lowpass',1.0); AudioSys.tone(60,0.5,0.8,'sawtooth',-30);
  const bl=new THREE.PointLight(0xff7020,200,30); bl.position.copy(b.position).y+=1; scene.add(bl);
  setTimeout(()=>scene.remove(bl),300);
  // damage nearby
  [...enemies].forEach(e=>{ if(e.alive&&e.mesh.position.distanceTo(b.position)<9) damageEnemy(e,120,false); });
  if(player.pos.distanceTo(b.position)<9) hurtPlayer(45);
  scene.remove(b); b.visible=false;
  const i=window._barrels.indexOf(b); if(i>=0) window._barrels.splice(i,1);
  // remove its collider approx: skip (small)
}
function reload(){
  const st=weapons.state[currentKey()], def=currentDef();
  if(st.reloading||st.mag>=def.mag||st.reserve<=0) return;
  st.reloading=true; st.reloadT=0; st.reloadDur=def.kind==='dmr'?1.9:1.5;
  AudioSys.reload(); $('ammo-wrap').classList.add('reloading');
  setTimeout(()=>{ const need=def.mag-st.mag, take=Math.min(need,st.reserve);
    st.mag+=take; st.reserve-=take; st.reloading=false;
    $('ammo-wrap').classList.remove('reloading'); updateAmmoHUD(); },st.reloadDur*1000);
}
function hurtPlayer(d){
  if(!player.alive||gameState!=='playing') return;
  player.hp-=d; AudioSys.hurt();
  $('damage-vignette').style.opacity=clamp(0.3+d/120,0,0.95);
  setTimeout(()=>$('damage-vignette').style.opacity=0,220);
  updateHealthHUD();
  if(player.hp<=0){ player.hp=0; player.alive=false; gameOver(false); }
}
function updateHealthHUD(){ $('health-num').textContent=Math.max(0,Math.ceil(player.hp));
  $('health-fill').style.width=player.hp+'%'; $('health-ghost').style.width=player.hp+'%'; }
function updateAmmoHUD(){ const st=weapons.state[currentKey()];
  $('ammo-mag').textContent=st.mag; $('ammo-reserve').textContent=st.reserve; }
function hitmarker(kill){ const h=$('hitmarker'); h.classList.remove('show','kill'); void h.offsetWidth;
  if(kill) h.classList.add('kill'); h.classList.add('show'); }

// ---------------- OBJECTIVES ----------------
function initObjectives(){
  objectives={infiltrated:false,hacks:0,intel:false,exfil:false,kills:0,
    list:[
      {id:'infil',text:'Infiltrate the depot (south gate / east crates)'},
      {id:'hack',text:'Hack 3 uplinks (0/3)'},
      {id:'intel',text:'Recover intel — Command Warehouse'},
      {id:'exfil',text:'Exfiltrate to LZ helicopter (NE)'},
    ]};
  renderObjectives();
  toast('Infiltrate the depot. Stay out of the floodlights.');
  subtitle('“Eagle Sentry, you are weapons-free. No one can know we were here.”',4000);
}
function renderObjectives(){
  const el=$('obj-list'); el.innerHTML='';
  const stage=!objectives.infiltrated?0:objectives.hacks<3?1:!objectives.intel?2:3;
  objectives.list.forEach((o,i)=>{
    const d=document.createElement('div');
    d.className=i<stage?'done':i===stage?'active':'locked';
    let t='○ '+o.text;
    if(o.id==='hack'&&objectives.hacks>0&&objectives.hacks<3) t='◐ Hack uplinks ('+objectives.hacks+'/3)';
    if(i<stage) t='● '+o.text;
    d.textContent=t; el.appendChild(d);
  });
}
function currentTarget(){
  if(!objectives.infiltrated) return new THREE.Vector3(-22,0,138); // south gate gap
  if(objectives.hacks<3){ const t=terminals.find(t=>!t.hacked); return t?t.pos.clone():new THREE.Vector3(); }
  if(!objectives.intel) return terminals.intel.pos.clone();
  return terminals.lzPos.clone();
}
function toast(t){ const d=document.createElement('div'); d.className='toast'; d.textContent=t;
  $('toast-wrap').appendChild(d); setTimeout(()=>d.remove(),4200); }
let subT=null;
function subtitle(t,ms=3000){ $('subtitle').textContent=t; clearTimeout(subT); subT=setTimeout(()=>$('subtitle').textContent='',ms); }

// ---------------- ENEMY AI ----------------
function updateEnemies(dt){
  let maxAlert=0;
  for(const e of enemies){
    if(e.dying){ // 0.55s fall: ease back (or forward), settle, limbs relax
      e.deathT+=dt; const k=Math.min(1,e.deathT/0.55), ez=1-Math.pow(1-k,3);
      e.mesh.rotation.x=e.deathDir*-Math.PI/2*ez;
      e.mesh.position.y=0.3*ez;
      e.legL.rotation.x*=0.9; e.legR.rotation.x*=0.9; e.armL.rotation.x*=0.9; e.armR.rotation.x=-1.1*(1-ez);
      e.visorMat.emissive.setHex(0x000000);
      if(k>=1) e.dying=false;
      continue; }
    if(!e.alive) continue;
    const toP=player.pos.clone().sub(e.mesh.position); toP.y=0; const dist=toP.length();
    // vision: range 55 (35 crouched), fov 70°, needs LOS
    const eye=e.mesh.position.clone().add(new THREE.Vector3(0,1.9,0));
    const dir=new THREE.Vector3(Math.sin(e.yaw),0,Math.cos(e.yaw));
    const ang=dir.angleTo(toP.clone().normalize());
    let sees=false;
    if(player.alive&&dist<(player.crouch?32:58)&&ang<1.1){
      ray.set(eye,toP.clone().normalize()); ray.far=dist;
      const hits=ray.intersectObjects(scene.children.filter(o=>o.isMesh&&o.geometry&&o.geometry.type==='BoxGeometry'&&o!==e.mesh),false);
      // cheap LOS: only if no building mesh very close before player — use distance check on colliders
      sees=!hits.some(h=>h.distance<dist-1.5&&h.object.position.y>2);
      if(player.noise>0.5&&dist<25) sees=true;
      if(!player.torch&&dist>40&&isDarkSide(e.mesh.position)) sees=sees&&Math.random()>0.3;
    }
    if(sees){ e.alert=Math.min(1,e.alert+dt*2.2); e.lastSeen=player.pos.clone();
      if(e.alert>0.6) e.state='combat'; else if(e.state==='patrol') e.state='suspicious';
    } else e.alert=Math.max(0,e.alert-dt*0.25);

    maxAlert=Math.max(maxAlert,e.alert);
    const sp=e.state==='combat'?4.6:e.state==='alert'?3.4:2.2;
    let mv=new THREE.Vector3();
    if(e.state==='patrol'){
      const wp=e.wps[e.wpIdx]; mv=wp.clone().sub(e.mesh.position); mv.y=0;
      if(mv.length()<3) e.wpIdx=(e.wpIdx+1)%e.wps.length;
      mv.normalize().multiplyScalar(sp*dt);
      e.yaw=lerpAngle(e.yaw,Math.atan2(mv.x,mv.z)||e.yaw,dt*4);
    } else if(e.state==='suspicious'){
      if(e.lastSeen){ mv=e.lastSeen.clone().sub(e.mesh.position); mv.y=0;
        if(mv.length()<2){ e.searchT+=dt; e.yaw+=dt*1.5; if(e.searchT>5){e.state='patrol';e.searchT=0;} }
        else { mv.normalize().multiplyScalar(sp*dt); e.yaw=lerpAngle(e.yaw,Math.atan2(mv.x,mv.z),dt*5);} }
      else e.state='patrol';
    } else if(e.state==='combat'||e.state==='alert'){
      if(!player.alive){ e.state='patrol'; continue; }
      const tgt=e.lastSeen||player.pos;
      const d=tgt.clone().sub(e.mesh.position); d.y=0;
      if(dist>22){ mv=d.clone().normalize().multiplyScalar(sp*dt); }
      else if(dist<8){ mv=d.clone().normalize().multiplyScalar(-sp*0.6*dt); }
      else { e.yaw=lerpAngle(e.yaw,Math.atan2(d.x,d.z),dt*8); }
      if(sees) e.yaw=lerpAngle(e.yaw,Math.atan2(toP.x,toP.z),dt*10);
      // shoot
      e.shootCd-=dt;
      if(sees&&dist<60&&e.shootCd<=0){
        e.shootCd=0.9+Math.random()*0.9-(alarmsRaised>0?0.3:0);
        enemyShoot(e,dist);
      }
      if(!sees){ e.searchT+=dt; if(e.searchT>8){e.state='alert';e.searchT=0;} }
      else e.searchT=0;
    }
    if(e.state==='alert'&&e.lastSeen){
      mv=e.lastSeen.clone().sub(e.mesh.position); mv.y=0;
      if(mv.length()<2.5){ e.state='suspicious'; e.searchT=0; }
      else { mv.normalize().multiplyScalar(sp*dt); e.yaw=lerpAngle(e.yaw,Math.atan2(mv.x,mv.z),dt*5); }
    }
    if(mv.lengthSq()>0){
      let nx=e.mesh.position.x+mv.x, nz=e.mesh.position.z+mv.z;
      [nx,nz]=collideCircle(nx,nz,0.6,0,1.8);
      e.mesh.position.x=nx; e.mesh.position.z=nz;
      e.walkAmt=Math.min(1,e.walkAmt+dt*4);
    } else e.walkAmt=Math.max(0,e.walkAmt-dt*5);
    // procedural locomotion: swinging legs/arms, torso lean, visor status colour
    e.mesh.rotation.y=e.yaw;
    if(e.skinned){
      e.mixer.update(dt);
      setAnim(e, e.walkAmt>0.15?'walk':'pose');
      const alerted=e.state==='combat'||e.state==='suspicious'||e.state==='alert';
      e.glow.visible=alerted;
      if(alerted) e.glow.material.color.setHex(e.state==='combat'?0xff2222:0xffaa22);
      if(e.flash>0){ e.flash-=dt; for(const f of e.flashMats) f.m.color.setHex(0xff5555); }
      else for(const f of e.flashMats) f.m.color.setHex(f.c);
    } else {
    const nowS=performance.now()/1000, sw=Math.sin(nowS*9+e.phase)*0.62*e.walkAmt;
    e.legL.rotation.x=sw; e.legR.rotation.x=-sw;
    e.armL.rotation.x=-sw*0.8;
    e.torso.rotation.x=e.state==='combat'?0.14:e.walkAmt*0.06;
    e.torso.position.y=1.3+Math.abs(Math.sin(nowS*9+e.phase))*0.035*e.walkAmt;
    const wantVisor=e.state==='combat'?0xff2222:e.state==='suspicious'||e.state==='alert'?0xffaa22:0x000000;
    e.visorMat.emissive.setHex(e.flash>0?0xff4444:wantVisor);
    if(e.flash>0){ e.flash-=dt; e.torso.material.emissive=new THREE.Color(0x661111); }
    else e.torso.material.emissive=new THREE.Color(0x000000);
    }
  }
  // detection HUD
  const dm=$('detection-meter');
  if(maxAlert>0.15&&player.alive){ dm.classList.remove('hidden'); dm.querySelector('i').style.width=(maxAlert*100)+'%';
    dm.querySelector('span').textContent=maxAlert>0.6?'👁 DETECTED — CONTACT!':'◉ SUSPICION RISING…';
  } else dm.classList.add('hidden');
  return maxAlert;
}
function lerpAngle(a,b,t){ let d=b-a; while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return a+d*Math.min(1,t); }
function isDarkSide(){ return false; }
const _es=new THREE.Vector3();
function enemyShoot(e,dist){
  AudioSys.shot('rifle', dist);
  const from=e.mesh.position.clone().add(new THREE.Vector3(0,1.5,0.5));
  const noisy=player.sprint||!player.crouch;
  const acc=alarmsRaised>0?0.55:0.4;
  const hitCh=clamp(acc*(1-dist/70)*(player.crouch?0.7:1)*(player.sprint?0.7:1),0.05,0.6);
  const target=player.pos.clone(); target.y-=0.15;
  if(Math.random()<hitCh){ hurtPlayer(6+Math.random()*10); spawnTracer(from,target.clone(),0xff5555); }
  else { target.x+=(Math.random()-0.5)*3; target.y+=(Math.random()-0.5)*2; target.z+=(Math.random()-0.5)*3;
    spawnTracer(from,target,0xff8855); spawnSpark(target,2);
    if(dist<25) AudioSys.crack(); }
}

// ---------------- INTERACT / HACK ----------------
function updateInteract(dt){
  interactTarget=null; let label='';
  if(objectives.hacks<3&&objectives.infiltrated){
    for(const t of terminals){ if(t.hacked) continue;
      if(player.pos.distanceTo(t.pos)<3.4){ interactTarget={type:'hack',t}; label=`Hack uplink ${t.idx+1}/3`; break; } }
  }
  if(objectives.hacks>=3&&!objectives.intel&&terminals.intel){
    if(player.pos.distanceTo(terminals.intel.pos)<3.2){ interactTarget={type:'intel'}; label='Recover the intel'; }
  }
  if(objectives.intel&&!objectives.exfil){
    if(player.pos.distanceTo(terminals.lzPos)<11){ interactTarget={type:'exfil'}; label='Board the helicopter — EXFIL'; }
  }
  const pr=$('interact-prompt');
  if(interactTarget){ pr.classList.remove('hidden'); $('interact-text').textContent=label+(interactTarget.type==='hack'?' (hold E)':' (press E)'); }
  else pr.classList.add('hidden');
  // hold-E hack
  if(interactTarget&&interactTarget.type==='hack'&&keys['KeyE']){
    hacking=true; hackProgress+=dt/3.2; AudioSys.hackTick();
    if(Math.random()<dt*8) spawnSpark(interactTarget.t.pos.clone().add(new THREE.Vector3(0,1.5,0)),1,0x39ff88);
    if(hackProgress>=1){ hackProgress=0; hacking=false;
      interactTarget.t.hacked=true; interactTarget.t.screen.material.color=new THREE.Color(0x1a552e);
      interactTarget.t.ring.material.color=new THREE.Color(0x225533);
      interactTarget.t.light.intensity=1.5; objectives.hacks++;
      AudioSys.objective(); toast(`Uplink ${objectives.hacks}/3 hacked.`);
      if(objectives.hacks>=3){ toast('All uplinks down. Get the intel in the Command Warehouse.'); subtitle('“Good. Now the package. Command warehouse, red glow.”'); }
      renderObjectives();
    }
  } else { if(hacking&&hackProgress>0.02) toast('Hack interrupted — hold E to resume.'); hacking=false; hackProgress=Math.max(0,hackProgress-dt*0.2); }
  // press-E others handled in keydown
}

// ---------------- PLAYER UPDATE ----------------
function updatePlayer(dt){
  const speedBase=player.crouch?2.4:player.sprint?7.4:4.6;
  const f=(keys['KeyW']?1:0)-(keys['KeyS']?1:0), s=(keys['KeyD']?1:0)-(keys['KeyA']?1:0);
  const sin=Math.sin(player.yaw), cos=Math.cos(player.yaw);
  const wish=new THREE.Vector3(-sin*f+cos*s,0,-cos*f-sin*s);
  const moving=wish.lengthSq()>0;
  if(moving) wish.normalize().multiplyScalar(speedBase*(player.ads>0.5?0.55:1));
  player.vel.lerp(wish,1-Math.pow(0.0001,dt));
  let nx=player.pos.x+player.vel.x*dt, nz=player.pos.z+player.vel.z*dt;
  const eyeH=player.crouch?1.15:1.7;
  [nx,nz]=collideCircle(nx,nz,0.55,0,1.8);
  player.pos.x=nx; player.pos.z=nz;
  // gravity/jump
  if(player.onGround&&keys['Space']){ player.vy=5; player.onGround=false; }
  player.vy-=14*dt; player.pos.y+=player.vy*dt;
  const groundY=eyeH;
  if(player.pos.y<=groundY){ player.pos.y=groundY; player.vy=0; player.onGround=true; }
  // headbob + steps
  const spd=player.vel.length();
  if(spd>0.5&&player.onGround){ player.bob+=dt*spd*1.6; player.stepT-=dt*spd;
    if(player.stepT<=0){ player.stepT=2.2; AudioSys.step(player.crouch, player.pos.x, player.pos.z); } }
  const bobY=Math.sin(player.bob*2)*0.028*Math.min(1,spd/5), bobX=Math.cos(player.bob)*0.02*Math.min(1,spd/5);
  camera.position.set(player.pos.x+bobX*cos,player.pos.y+bobY,player.pos.z-bobX*sin);
  camera.rotation.y=player.yaw; camera.rotation.x=player.pitch;
  // ADS
  const wantAds=(mouseADS&&!player.sprint)?1:0;
  player.ads=lerp(player.ads,wantAds,1-Math.pow(0.0001,dt));
  const def=currentDef();
  weapons.rig.position.lerp(new THREE.Vector3(
    lerp(0.28,0.0,player.ads), lerp(-0.28,-0.22,player.ads)+bobY*0.4, lerp(-0.5,-0.38,player.ads)
  ),0.25);
  weapons.rig.rotation.x=lerp(weapons.rig.rotation.x*0.85,0,0.2);
  weapons.rig.position.z=Math.max(-0.6,weapons.rig.position.z-dt*0.4);
  camera.fov=effectiveFov()/def.zoom**player.ads*1; camera.updateProjectionMatrix();
  updateViewmodel(dt);
  $('crosshair').style.setProperty('--sp',(6+spd*1.6+player.noise*8- player.ads*4)+'px');
  $('crosshair').classList.toggle('ads',player.ads>0.5);
  $('crosshair').style.opacity=player.ads>0.7?0.4:1;
  $('stance-indicator').textContent=(player.crouch?'CROUCHED · SILENT':player.sprint&&moving?'SPRINTING · LOUD':moving?'MOVING':'STANDING')+(player.torch?' · TORCH ON':'');
  player.noise=Math.max(0,player.noise-dt*(player.crouch?0.8:0.35)-(moving?0:dt*2));
  if(player.sprint&&moving) player.noise=Math.min(1,player.noise+dt*0.5);
  // infiltration check
  if(!objectives.infiltrated&&(Math.abs(player.pos.z)<135&&Math.abs(player.pos.x)<135)){
    objectives.infiltrated=true; AudioSys.objective(); renderObjectives();
    toast('Inside the wire. Hack the 3 green uplinks.'); subtitle('“You\'re in. Stay low, stay quiet.”');
  }
  // regen slow when unseen
  if(player.hp<100&&player.hp>0) player.hp=Math.min(100,player.hp+dt*1.2),updateHealthHUD();
}
function effectiveFov(){
  let f=settings.fov;
  if(settings.autoFov){ const a=camera.aspect;
    if(a>=3.4) f+=12; else if(a>=2.2) f+=8; else if(a>=1.9) f+=4; }
  return f;
}

// ---------------- COMPASS + MINIMAP ----------------
function updateCompass(){
  const strip=$('compass-ticks'), mk=$('compass-markers');
  const yawDeg=((-player.yaw*180/Math.PI)%360+360)%360;
  const dirs=[[0,'N'],[45,'NE'],[90,'E'],[135,'SE'],[180,'S'],[225,'SW'],[270,'W'],[315,'NW'],[360,'N']];
  let html='';
  // show ±60° window mapped across strip
  const W=strip.clientWidth||600;
  dirs.forEach(([d,name])=>{ let diff=((d-yawDeg+540)%360)-180; if(Math.abs(diff)<70){
    const x=(diff+70)/140*W; const major=name.length<=2&&['N','E','S','W'].includes(name);
    html+=`<div class="tick" style="left:${x}px;${major?'color:#ffb454;font-weight:800;font-size:14px':''}">${name}<small>${d}°</small></div>`; }});
  strip.innerHTML=html;
  const tgt=currentTarget(); const dx=tgt.x-player.pos.x, dz=tgt.z-player.pos.z;
  const ang=Math.atan2(-dx,-dz); // world→yaw
  let diff=((ang-player.yaw)*180/Math.PI+540)%360-180;
  let mhtml='';
  if(Math.abs(diff)<70){ const x=(diff+70)/140*W; mhtml+=`<div class="marker" style="left:${x}px">◆</div>`; }
  else mhtml+=`<div class="marker" style="left:${diff>0?W-8:8}px;opacity:.5">${diff>0?'▶':'◀'}</div>`;
  // enemies on compass when alerted
  mk.innerHTML=mhtml;
  // distance
  const d=Math.hypot(dx,dz);
  $('obj-distance').textContent='◈ '+Math.round(d)+'m to objective';
}
function updateMinimap(){
  const c=minimapCtx,S=180,C=S/2,range=90;
  c.clearRect(0,0,S,S);
  c.save(); c.beginPath(); c.arc(C,C,C-2,0,7); c.clip();
  c.fillStyle='#0a141f'; c.fillRect(0,0,S,S);
  const px=x=>(x-player.pos.x)/range*C+C, pz=z=>(z-player.pos.z)/range*C+C;
  // roads
  c.fillStyle='#2c3138'; c.fillRect(px(-15),0,30,S); c.fillRect(0,pz(10-11),S,22/range*C);
  // buildings
  c.fillStyle='#4a5a6e';
  [[-40,-70,36,22],[30,-80,44,26],[95,-45,30,20],[-95,-30,28,18]].forEach(([x,z,w,d])=>{
    c.fillRect(px(x-w/2),pz(z-d/2),w/range*C,d/range*C); });
  if(window._containers){ c.fillStyle='#6e5a3a';
    for(const k of window._containers) c.fillRect(px(k.x-k.w/2),pz(k.z-k.d/2),k.w/range*C,k.d/range*C); }
  // terminals
  terminals.forEach(t=>{ c.fillStyle=t.hacked?'#225533':'#39ff88';
    c.beginPath(); c.arc(px(t.pos.x),pz(t.pos.z),4,0,7); c.fill(); });
  if(terminals.intel&&!terminals.intel.taken){ c.fillStyle='#ff3344';
    c.beginPath(); c.arc(px(terminals.intel.pos.x),pz(terminals.intel.pos.z),5,0,7); c.fill(); }
  // LZ
  c.strokeStyle='#ffb454'; c.lineWidth=2; c.beginPath();
  c.arc(px(120),pz(120),8,0,7); c.stroke();
  c.fillStyle='#ffb454'; c.font='10px monospace'; c.fillText('LZ',px(120)-6,pz(120)-10);
  // enemies (only if close/alerted — stealth)
  enemies.forEach(e=>{ if(!e.alive) return;
    const d=e.mesh.position.distanceTo(player.pos);
    if(d<45||e.state==='combat'){ c.fillStyle=e.state==='combat'?'#ff3333':'#ff9a3c';
      c.beginPath(); c.arc(px(e.mesh.position.x),pz(e.mesh.position.z),3,0,7); c.fill(); }});
  // player arrow (rotate with yaw)
  c.save(); c.translate(C,C); c.rotate(-player.yaw+Math.PI);
  c.fillStyle='#7de7ff'; c.beginPath(); c.moveTo(0,-8); c.lineTo(5,6); c.lineTo(-5,6); c.closePath(); c.fill(); c.restore();
  // north
  c.fillStyle='#8fb2cc'; c.font='10px monospace'; c.fillText('N',C-3,12);
  c.restore();
}

// ---------------- ULTRAWIDE ----------------
function updateAspect(){
  const w=innerWidth,h=innerHeight,a=w/h;
  let label='16:9',note='Standard framing.';
  if(a>=3.2){label='32:9 SUPER-ULTRAWIDE';note='FOV +12° · full peripheral HUD.';}
  else if(a>=2.15){label='21:9 ULTRAWIDE';note='FOV +8° · extended compass.';}
  else if(a>=1.85){label='21:10 / 16:10+';note='FOV +4°.';}
  else if(a<1.5){label='PORTRAIT / SQUARE';note='HUD condensed for narrow view.';}
  $('aspect-badge').textContent='� w '+label;
  $('aspect-live').textContent=`${w}×${h} · ${(a).toFixed(2)}:1 · ${label}`;
  $('aspect-note').textContent=note+' FOV auto-compensated for peripheral vision.';
  $('menu-aspect').textContent='🖥 Detected: '+w+'×'+h+' ('+label+')';
  $('quality-badge').textContent=settings.quality+(a>=2.15?' · UW':'');
  // letterbox simulation
  const sim=settings.aspectSim;
  const tb=$('letterbox-top'),bb=$('letterbox-bottom');
  if(sim!=='native'){
    const target=sim==='21:9'?21/9:32/9;
    if(a>target){ const usedH=w/target, cut=(h-usedH)/2;
      tb.classList.remove('hidden');bb.classList.remove('hidden');
      tb.style.height=cut+'px';bb.style.height=cut+'px';
      tb.style.top='0';bb.style.bottom='0';bb.style.top='auto';
    } else { tb.classList.add('hidden');bb.classList.add('hidden'); }
  } else { tb.classList.add('hidden');bb.classList.add('hidden'); }
  if(camera){ camera.aspect=a; camera.updateProjectionMatrix(); }
  if(renderer) renderer.setSize(w,h);
  $('hud').classList.toggle('safe-zone',settings.hudSafe&&a>=2.2);
}

// ---------------- QUALITY ----------------
function applyQuality(){
  const q=settings.quality;
  const pr=q==='LOW'?0.6:q==='MEDIUM'?0.85:q==='HIGH'?1.0:Math.min(devicePixelRatio||1,2);
  renderer.setPixelRatio(pr*(settings.resScale/100));
  renderer.shadowMap.enabled=settings.shadows&&q!=='LOW';
  sunLight.castShadow=settings.shadows&&q!=='LOW';
  const sz=q==='LOW'?1024:q==='MEDIUM'?1024:2048;
  if(sunLight.shadow.map){ sunLight.shadow.map.dispose(); sunLight.shadow.map=null; }
  sunLight.shadow.mapSize.set(sz,sz);
  scene.traverse(o=>{ if(o.material) o.material.needsUpdate=true; });
  updateAspect();
}

// ---------------- GAME FLOW ----------------
function startMission(){
  AudioSys.init(); if(AudioSys.ctx&&AudioSys.ctx.state==='suspended') AudioSys.ctx.resume();
  resetWorldState();
  ['menu-screen','end-screen','pause-screen'].forEach(id=>$(id).classList.add('hidden'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.add('hidden'));
  $('hud').classList.remove('hidden');
  $('loading').style.display='none';
  gameState='playing'; startTime=performance.now(); elapsed=0; kills=0; shotsFired=0; shotsHit=0; alarmsRaised=0;
  lockPointer();
  toast('Mission start — infiltrate from the south.');
}
function resetWorldState(){
  player.pos.set(0,1.7,152); player.yaw=0; player.pitch=0; player.hp=100; player.alive=true; player.noise=0;
  updateHealthHUD();
  for(const k in weapons.state){ weapons.state[k]={mag:WEAPON_DEFS[k].mag,reserve:WEAPON_DEFS[k].reserve,reloading:false,last:0}; }
  equipWeapon(settings.primary in WEAPON_DEFS&&settings.primary!=='pistol'?settings.primary:'rifle');
  currentWeapon=0; refreshGunVis();
  enemies.forEach(e=>{ e.alive=true; e.dying=false; e.deathT=0; e.hp=100; e.state='patrol'; e.alert=0;
    e.walkAmt=0; e.legL.rotation.x=0; e.legR.rotation.x=0; e.armL.rotation.x=0; e.armR.rotation.x=-1.1;
    e.torso.rotation.x=0; e.visorMat.emissive.setHex(0x000000);
    e.mesh.rotation.x=0; e.mesh.position.y=0;
    if(!e.mesh.parent) scene.add(e.mesh); });
  terminals.forEach(t=>{ if(t.hacked!==undefined){t.hacked=false; t.screen.material.color=new THREE.Color(0xffffff);
    t.ring.material.color=new THREE.Color(0x39ff88); t.light.intensity=6;} });
  if(terminals.intel){ terminals.intel.taken=false; terminals.intel.mesh.visible=true; }
  tracers.forEach(t=>scene.remove(t.m)); tracers.length=0;
  particles.forEach(p=>scene.remove(p.m)); particles.length=0;
  smokePuffs.forEach(p=>{ scene.remove(p.s); p.s.material.dispose(); }); smokePuffs.length=0;
  if(window._cmdDoor){ const d=window._cmdDoor; d.open=false; d.t=0; d.announced=false;
    d.mesh.position.x=d.baseX; d.spill.intensity=0; }
  initObjectives();
}
function gameOver(win){
  gameState=win?'win':'dead';
  document.exitPointerLock&&document.exitPointerLock();
  setTimeout(()=>{
    $('end-screen').classList.remove('hidden');
    $('end-title').textContent=win?'✔ MISSION COMPLETE':'✖ KIA — MISSION FAILED';
    $('end-title').style.color=win?'#7dffb2':'#ff5d5d';
    $('end-sub').textContent=win?'“Clean work. The depot is dark and no one saw your face.” — HQ':'“Eagle Sentry is down. Send the next operative.” — HQ';
    const acc=shotsFired?Math.round(shotsHit/shotsFired*100):0;
    const mm=String(Math.floor(elapsed/60)).padStart(2,'0'),ss=String(Math.floor(elapsed%60)).padStart(2,'0');
    $('end-stats').innerHTML=`TIME <b>${mm}:${ss}</b> · KILLS <b>${kills}</b> · ACCURACY <b>${acc}%</b> (${shotsHit}/${shotsFired})<br>HACKS <b>${objectives.hacks}/3</b> · INTEL <b>${objectives.intel?'RECOVERED':'LOST'}</b> · ALARMS <b>${alarmsRaised}</b>`;
  },win?1200:1500);
  if(!win) subtitle('You died. Press PLAY AGAIN to retry.',4000);
}
function togglePause(p){
  if(gameState!=='playing'&&gameState!=='paused') return;
  gameState=p?'paused':'playing';
  $('pause-screen').classList.toggle('hidden',!p);
  if(p){ document.exitPointerLock&&document.exitPointerLock();
    const mm=String(Math.floor(elapsed/60)).padStart(2,'0'),ss=String(Math.floor(elapsed%60)).padStart(2,'0');
    $('pause-stats').textContent=`Time ${mm}:${ss} · Kills ${kills} · Hacks ${objectives.hacks}/3 · Intel ${objectives.intel?'yes':'no'}`;
  } else lockPointer();
}

// ---------------- INPUT ----------------
let mouseADS=false;
let drawT=1, swayX=0, swayY=0, swayTX=0, swayTY=0; // viewmodel feel: draw + mouse sway
function updateViewmodel(dt){
  const gun=weapons.models[currentKey()], st=weapons.state[currentKey()];
  const rig=weapons.rig, t=performance.now()/1000;
  // reload performance: dip + roll + magazine out/in
  if(st.reloading){ st.reloadT=Math.min(1,(st.reloadT||0)+dt/(st.reloadDur||1.5));
    const dip=Math.sin(Math.PI*st.reloadT);
    rig.position.y-=dip*0.13; rig.rotation.x-=dip*0.55; rig.rotation.z+=dip*0.22;
    if(gun.userData.mag){ const out=Math.sin(Math.PI*Math.min(1,st.reloadT*1.12));
      gun.userData.mag.position.y=gun.userData.magY-out*0.24; }
  } else if(gun.userData.mag){ const m=gun.userData.mag;
    m.position.y+=(gun.userData.magY-m.position.y)*Math.min(1,dt*10); rig.rotation.z*=0.8; }
  // draw animation on weapon switch
  drawT=Math.min(1,drawT+dt*3.2);
  rig.position.y-=(1-drawT)*0.17; rig.rotation.x-=(1-drawT)*0.45;
  // sprint lowers the muzzle (IGI Origins patrol carry)
  const sprinting=player.sprint&&player.vel.length()>3&&player.ads<0.3;
  if(sprinting){ rig.rotation.x-=0.4; rig.position.y-=0.05; }
  // mouse sway + breathing
  swayX+=(swayTX-swayX)*Math.min(1,dt*9); swayY+=(swayTY-swayY)*Math.min(1,dt*9);
  swayTX*=Math.pow(0.02,dt); swayTY*=Math.pow(0.02,dt);
  rig.rotation.y+=swayX*0.09; rig.rotation.x+=swayY*0.07;
  rig.position.x+=swayX*0.03; rig.position.y+=swayY*0.02;
  const br=player.ads>0.5?2:1;
  rig.position.y+=Math.sin(t*1.6)*0.004*br; rig.position.x+=Math.cos(t*1.13)*0.003*br;
}
function lockPointer(){ canvas.requestPointerLock&&canvas.requestPointerLock(); }
function bindInput(){
  addEventListener('keydown',e=>{
    keys[e.code]=true;
    if(['Space','Tab'].includes(e.code)) e.preventDefault();
    if(gameState!=='playing') return;
    if(e.code==='KeyR') reload();
    if(e.code==='Digit1') switchSlot(0);
    if(e.code==='Digit2') switchSlot(1);
    if(e.code==='KeyC'){ player.crouch=!player.crouch; player.pos.y=player.crouch?1.15:1.7; }
    if(e.code==='KeyF'){ player.torch=!player.torch; flashLight.intensity=player.torch?55:0;
      toast(player.torch?'Torch ON — you are more visible.':'Torch OFF.'); }
    if(e.code==='KeyP'||e.code==='Escape') togglePause(true);
    if(e.code==='KeyE'&&interactTarget&&interactTarget.type!=='hack') doInteract();
  });
  addEventListener('keyup',e=>{ keys[e.code]=false; });
  document.addEventListener('pointerlockchange',()=>{
    const locked=document.pointerLockElement===canvas;
    $('click-to-play').classList.toggle('hidden',locked||gameState!=='playing');
    if(!locked&&gameState==='playing'&&player.alive){ /* soft pause hint, don't force */ }
  });
  $('click-to-play').addEventListener('click',()=>lockPointer());
  document.addEventListener('mousemove',e=>{
    if(document.pointerLockElement!==canvas||gameState!=='playing') return;
    const s=0.0021*settings.sens*(player.ads>0.5?0.6:1);
    player.yaw-=e.movementX*s;
    player.pitch-=e.movementY*s*(settings.invertY?-1:1);
    player.pitch=clamp(player.pitch,-1.45,1.45);
    swayTX=clamp(swayTX-e.movementX*0.00045,-0.5,0.5);
    swayTY=clamp(swayTY-e.movementY*0.00035,-0.4,0.4);
  });
  document.addEventListener('mousedown',e=>{
    if(gameState!=='playing'||document.pointerLockElement!==canvas) return;
    if(e.button===0){ if(currentDef().auto){ autoFiring=true; shoot(); } else shoot(); }
    if(e.button===2) mouseADS=true;
  });
  document.addEventListener('mouseup',e=>{
    if(e.button===0) autoFiring=false;
    if(e.button===2) mouseADS=false;
  });
  document.addEventListener('contextmenu',e=>e.preventDefault());
  addEventListener('resize',updateAspect);
  // weapon slot buttons
  document.querySelectorAll('#weapon-slots button').forEach((b,i)=>b.addEventListener('click',ev=>{ev.stopPropagation();switchSlot(i);}));
}
let autoFiring=false;
function doInteract(){
  const t=interactTarget; if(!t) return;
  if(t.type==='intel'){ terminals.intel.taken=true; terminals.intel.mesh.visible=false;
    objectives.intel=true; AudioSys.objective(); renderObjectives();
    toast('Intel secured. Exfiltrate to the LZ — run!'); subtitle('“That\'s the package. Move to the helicopter!”'); }
  if(t.type==='exfil'){ objectives.exfil=true; AudioSys.objective();
    toast('Exfiltration…'); gameOver(true); }
}

// ---------------- MAIN LOOP ----------------
let fpsAcc=0,fpsN=0,fpsT=0,lastFpsShow=0;
function loop(){
  requestAnimationFrame(loop);
  const dt=Math.min(0.05,clock.getDelta());
  const now=performance.now()/1000;
  if(gameState==='playing'){
    elapsed=(performance.now()-startTime)/1000;
    const mm=String(Math.floor(elapsed/60)).padStart(2,'0'),ss=String(Math.floor(elapsed%60)).padStart(2,'0');
    $('mission-timer').textContent=mm+':'+ss;
    player.sprint=!!keys['ShiftLeft']&&!!keys['KeyW']&&!player.crouch;
    if(autoFiring) shoot();
    updatePlayer(dt);
    const alert=updateEnemies(dt);
    if(alert>0.6&&alarmsRaised===0){ alarmsRaised++; AudioSys.alarm(); feed('⚠ Alarm raised — enemies alerted'); }
    updateInteract(dt);
    updateCompass();
    updateMinimap();
    // hack progress bar in prompt
    if(hacking){ $('interact-text').textContent=`Hacking… ${Math.round(hackProgress*100)}% (hold E)`; }
    // heli rotor + beacon blink
    if(window._heli){ const spool=objectives.intel?1:0.35;
      window._heli.userData.rotor.rotation.y+=dt*(8+spool*26);
      window._heli.position.y=1.6+Math.sin(now*1.3)*0.16;
      AudioSys.heliSet(player.pos.distanceTo(terminals.lzPos),spool); }
    // surveillance life: panning CCTVs, radar sweep, roaming searchlight
    if(window._cctvs) for(const c of window._cctvs) c.head.rotation.y=c.base+Math.sin(now*0.5+c.phase)*0.85;
    if(window._radar) window._radar.rotation.y+=dt*0.9;
    if(window._sweep){ const s=window._sweep; s.t+=dt*0.22;
      s.target.position.set(s.cx+Math.cos(s.t)*s.r,0,s.cz+Math.sin(s.t)*s.r); }
    // depot flag ripple
    if(window._flag){ const p=window._flag.mesh.geometry.attributes.position, b=window._flag.base;
      for(let i=0;i<p.count;i++){ const bx=b[i*3];
        p.setZ(i,Math.sin(bx*1.9+now*5.2)*0.2*((bx+1.7)/3.4)); }
      p.needsUpdate=true; }
    // command warehouse door grinds open once the network is down
    if(window._cmdDoor&&objectives.hacks>=3){ const d=window._cmdDoor; d.open=true; }
    if(window._cmdDoor&&window._cmdDoor.open&&window._cmdDoor.t<1){ const d=window._cmdDoor;
      d.t=Math.min(1,d.t+dt/2.4); const ez=1-Math.pow(1-d.t,2);
      d.mesh.position.x=d.baseX+ez*7.5; d.spill.intensity=ez*45;
      if(d.t>=1&&!d.announced){ d.announced=true; toast('Command warehouse breached — take the intel.'); } }
    // orange exfil smoke once the intel is in hand
    if(objectives.intel&&!objectives.exfil){ smokeT-=dt;
      if(smokeT<=0){ smokeT=0.09; puffSmoke(); } }
    updateSmoke(dt);
    // floating objective beacon tracks the current target
    if(window._beacon){ const tgt=currentTarget();
      window._beacon.position.set(tgt.x,9+Math.sin(now*2.4)*0.8,tgt.z);
      const pu=2.4+Math.sin(now*4)*0.35; window._beacon.scale.set(pu,pu,1);
      window._beacon.visible=gameState==='playing'; }
    // terminal screen flicker
    for(const tm of terminals){ if(tm.screen&&!tm.hacked&&Math.random()<dt*6)
      tm.screen.material.color.setScalar(0.75+Math.random()*0.3); }
    // low-HP heartbeat
    if(player.hp<35&&player.alive){ if(now-lastBeat>1.1){ lastBeat=now; AudioSys.heart(); } }
    if(terminals.intel&&terminals.intel.doc) terminals.intel.doc.rotation.y+=dt*1.2;
    scene.traverse(o=>{ if(o.userData&&o.userData.blink) o.visible=(now%1)<0.6; });
  }
  // particles
  for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; p.life-=dt;
    p.v.y-=9*dt; p.m.position.addScaledVector(p.v,dt);
    if(p.life<=0){ scene.remove(p.m); particles.splice(i,1); } }
  for(let i=tracers.length-1;i>=0;i--){ const t=tracers[i]; t.life-=dt;
    t.m.material.opacity=Math.max(0,t.life/0.07);
    if(t.life<=0){ scene.remove(t.m); t.m.geometry.dispose(); tracers.splice(i,1); } }
  renderer.render(scene,camera);
  // fps
  fpsAcc+=dt; fpsN++; fpsT+=dt;
  if(fpsT>0.5){ const fps=Math.round(fpsN/fpsAcc);
    if(settings.showFps) $('fps-counter').textContent=`${fps} FPS · ${(1000/fps).toFixed(1)}ms · ${renderer.info.render.triangles/1000|0}k tris`;
    else $('fps-counter').textContent='';
    fpsAcc=0;fpsN=0;fpsT=0; }
}

// ---------------- UI WIRING ----------------
function bindUI(){
  document.querySelectorAll('.btn, .loadout-card').forEach(b=>b.addEventListener('click',()=>{ AudioSys.init(); AudioSys.uiClick(); }));
  $('btn-deploy').onclick=()=>{ startMission(); };
  $('btn-briefing').onclick=()=>$('panel-briefing').classList.remove('hidden');
  $('btn-loadout').onclick=()=>$('panel-loadout').classList.remove('hidden');
  $('btn-settings').onclick=()=>$('panel-settings').classList.remove('hidden');
  $('btn-how').onclick=()=>$('panel-how').classList.remove('hidden');
  document.querySelectorAll('.close-panel').forEach(b=>b.onclick=()=>b.closest('.panel').classList.add('hidden'));
  document.querySelectorAll('.loadout-card').forEach(c=>c.onclick=()=>{
    document.querySelectorAll('.loadout-card').forEach(x=>x.classList.remove('active'));
    c.classList.add('active'); settings.primary=c.dataset.primary; saveSettings(); });
  // settings
  const q=$('set-quality'); q.value=settings.quality;
  q.onchange=()=>{ settings.quality=q.value; saveSettings(); applyQuality(); };
  $('set-resscale').value=settings.resScale;
  $('set-resscale').oninput=e=>{ settings.resScale=+e.target.value; $('rs-val').textContent=settings.resScale+'%'; saveSettings(); applyQuality(); };
  $('set-fov').value=settings.fov;
  $('set-fov').oninput=e=>{ settings.fov=+e.target.value; $('fov-val').textContent=settings.fov+'°'; saveSettings(); };
  $('set-autofov').checked=settings.autoFov;
  $('set-autofov').onchange=e=>{ settings.autoFov=e.target.checked; saveSettings(); };
  $('set-shadows').checked=settings.shadows;
  $('set-shadows').onchange=e=>{ settings.shadows=e.target.checked; saveSettings(); applyQuality(); };
  $('set-hudsafe').checked=settings.hudSafe;
  $('set-hudsafe').onchange=e=>{ settings.hudSafe=e.target.checked; saveSettings(); updateAspect(); };
  $('set-sens').value=settings.sens*100;
  $('set-sens').oninput=e=>{ settings.sens=+e.target.value/100; $('sens-val').textContent=settings.sens.toFixed(2); saveSettings(); };
  $('set-inverty').checked=settings.invertY;
  $('set-inverty').onchange=e=>{ settings.invertY=e.target.checked; saveSettings(); };
  $('set-vol').value=settings.vol*100;
  $('set-vol').oninput=e=>{ settings.vol=+e.target.value/100; $('vol-val').textContent=e.target.value+'%'; AudioSys.setVol(settings.vol); saveSettings(); };
  $('set-fps').checked=settings.showFps;
  $('set-fps').onchange=e=>{ settings.showFps=e.target.checked; saveSettings(); };
  $('aspect-sim').value=settings.aspectSim;
  $('aspect-sim').onchange=e=>{ settings.aspectSim=e.target.value; saveSettings(); updateAspect(); };
  $('btn-resume').onclick=()=>togglePause(false);
  $('btn-restart').onclick=()=>{ $('pause-screen').classList.add('hidden'); gameState='playing'; resetWorldState(); startTime=performance.now(); lockPointer(); };
  $('btn-quit').onclick=()=>{ location.reload(); };
  $('btn-again').onclick=()=>{ $('end-screen').classList.add('hidden'); startMission(); };
  $('btn-tomenu').onclick=()=>{ location.reload(); };
  document.addEventListener('keydown',e=>{ if(e.code==='KeyP'&&gameState==='paused') togglePause(false); });
  // reflect persisted
  $('rs-val').textContent=settings.resScale+'%'; $('fov-val').textContent=settings.fov+'°';
  $('sens-val').textContent=settings.sens.toFixed(2); $('vol-val').textContent=Math.round(settings.vol*100)+'%';
  document.querySelectorAll('.loadout-card').forEach(c=>c.classList.toggle('active',c.dataset.primary===settings.primary));
}

// ---------------- BOOT ----------------
async function boot(){
  try{
    buildTextures();
    buildWorld();
    initPlayer();
    spawnEnemies();
    initObjectives();
    player.alive=false; // idle until deploy; still render menu bg
    bindInput(); bindUI(); applyQuality(); updateAspect();
    upgradeGroundTextures(); // CC0 PBR sets stream over procedural fallbacks
    loadExternalAssets();    // Sketchfab hero GLBs stream in when ready
    clock=new THREE.Clock();
    // menu camera orbit
    camera.position.set(60,30,120); camera.lookAt(0,0,-40);
    let menuOrbit=true;
    document.getElementById('btn-deploy').addEventListener('click',()=>{menuOrbit=false;player.alive=true;},{once:true});
    const origLoop=loop;
    // idle cinematic while in menu
    (function menuCam(){
      if(gameState==='menu'&&menuOrbit){ const t=performance.now()/1000;
        camera.position.set(Math.cos(t*0.08)*110,34+Math.sin(t*0.05)*6,Math.sin(t*0.08)*110+10);
        camera.lookAt(10,4,-50);
        camera.fov=effectiveFov(); camera.updateProjectionMatrix();
        updateAspectLite(); }
      if(gameState==='menu') requestAnimationFrame(menuCam);
    })();
    function updateAspectLite(){ /* compass hidden in menu */ }
    loop();
    // expose for deploy transition
    const _start=startMission;
    startMission=function(){ _start(); menuOrbit=false; player.alive=true; };
    $('loading').style.display='none';
    // smoke-test hooks
    window.__igi={settings,enemies,terminals,startMission,keys,shoot,doInteract,hurtPlayer,Assets,
      get state(){return gameState},player,get objectives(){return objectives},
      version:'modern-operation-1.0-tribute'};
    console.log('[IGI tribute] boot ok, tris:',renderer.info.render.triangles);
  }catch(err){
    console.error(err);
    $('loading').innerHTML='<p>WebGL failed to start: '+err.message+'<br>Use a desktop Chromium with hardware acceleration.</p>';
  }
}
// pointer-lock exit brings up pause via Esc automatically (browser); also allow P
document.addEventListener('keydown',e=>{ if(e.code==='Escape'&&gameState==='playing'){ /* browser exits lock; show hint */ } });

boot();
