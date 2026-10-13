// Procedural WebAudio SFX — no external assets needed.
let ctx = null;
let muted = false;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function toggleMute() {
  muted = !muted;
  return muted;
}
export function isMuted() { return muted; }

function env(gainNode, t0, peak, decay) {
  gainNode.gain.setValueAtTime(0.0001, t0);
  gainNode.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
}

function tone(freq, dur = 0.15, type = 'square', vol = 0.08, slide = 0) {
  if (muted) return;
  try {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    env(g, t, vol, dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  } catch { /* audio unavailable */ }
}

function noise(dur = 0.4, vol = 0.2, lowpass = 800) {
  if (muted) return;
  try {
    const c = ac(), t = c.currentTime;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass;
    const g = c.createGain(); env(g, t, vol, dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  } catch { /* audio unavailable */ }
}

export const sfx = {
  select() { tone(660, 0.07, 'square', 0.05); },
  order() { tone(440, 0.09, 'square', 0.06); tone(660, 0.08, 'square', 0.04); },
  shoot() { noise(0.18, 0.12, 1400); },
  boom() { noise(0.7, 0.3, 420); tone(70, 0.5, 'sine', 0.2, -40); },
  sam() { tone(880, 0.4, 'sawtooth', 0.07, 440); },
  alarm() { tone(520, 0.25, 'square', 0.08); setTimeout(() => tone(390, 0.3, 'square', 0.08), 260); },
  capture() { tone(520, 0.12, 'sine', 0.08); setTimeout(() => tone(780, 0.15, 'sine', 0.08), 140); },
  coin() { tone(990, 0.1, 'sine', 0.07); setTimeout(() => tone(1320, 0.14, 'sine', 0.07), 110); },
  error() { tone(180, 0.2, 'square', 0.07); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.1), i * 180)); },
  lose() { [400, 340, 280, 200].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'sawtooth', 0.08), i * 220)); }
};
