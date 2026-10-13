// app.js — Alt Life interactive starter demos (dependency-free, Canvas2D).
// Mirrors Engine/World/WindManager.h + Engine/Renderer/GI/SurfelLighting.h math
// so the browser demo agrees with the C++ headers.
(function () {
  'use strict';

  // ---------- shared utils ----------
  function hash1(n) { var s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x) {
    var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return hash1(i) * (1 - u) + hash1(i + 1) * u;
  }

  // ---------- wind demo ----------
  // Same 3 layers as WindManager::Sample: gust front + canyon turb + flutter.
  var wind = { dirX: 0.8, dirZ: 0.6, gust: 2.2, turb: 0.8, flutter: 0.35, time: 0 };
  (function () {
    var n = Math.hypot(wind.dirX, wind.dirZ);
    wind.dirX /= n; wind.dirZ /= n;
  })();
  function windSample(px, py, pz, t) {
    var fx = px * wind.dirX + pz * wind.dirZ;
    var front = vnoise(fx * 0.01 - t * wind.gust * 0.02);
    var gust = (front - 0.5) * 2 * wind.gust;
    var turb = (vnoise((px + pz) * 0.1 + t * 0.7) - 0.5) * 2 * wind.turb;
    var flut = (vnoise(px * 3.1 + py * 1.7 + pz * 2.3 + t * 3.0) - 0.5) * 2 * wind.flutter;
    var s = 1 + gust * 0.35 + turb * 0.35;
    return { x: wind.dirX * s * 8 + flut * 8, gust: Math.min(1, Math.max(0, 0.5 + gust * 0.25)), flut: flut };
  }

  function initWindDemo() {
    var canvas = document.getElementById('windCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var gustSlider = document.getElementById('gustSlider');
    var gustVal = document.getElementById('gustVal');
    var t = 0, last = performance.now();
    var blades = [];
    for (var i = 0; i < 90; i++) {
      blades.push({ x: (i + 0.5) / 90, h: 40 + hash1(i * 3.7) * 70, phase: hash1(i * 9.1) * 6.28, flex: 0.5 + hash1(i * 1.3) * 0.5 });
    }
    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt; wind.time = t;
      var W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      // sky gradient shifts with gust energy (mist parts like §1.3 volumetrics)
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1b2740'); g.addColorStop(0.7, '#24334d'); g.addColorStop(1, '#2c3a2e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // ground
      ctx.fillStyle = '#141a14'; ctx.fillRect(0, H - 26, W, 26);
      // mist band advected by wind
      ctx.fillStyle = 'rgba(180,200,220,0.10)';
      for (var m = 0; m < 3; m++) {
        var mx = ((t * (12 + m * 6)) % (W + 200)) - 100;
        ctx.beginPath(); ctx.ellipse(mx, H - 60 - m * 22, 130, 12, 0, 0, 6.29); ctx.fill();
      }
      // blades / trees: offset = W(p,t) * heightWeight^2 * flexibility
      for (var i = 0; i < blades.length; i++) {
        var b = blades[i];
        var px = b.x * W, baseY = H - 26;
        var w = windSample(px * 0.5, 0, b.phase * 20, t);
        var sway = Math.sin(t * 1.2 + b.phase + px * 0.02) * 6 + w.x * 1.1 * b.flex + w.flut * 30 * b.flex;
        var tipX = px + sway * (b.h / 80), tipY = baseY - b.h;
        var lean = sway * 0.4;
        ctx.strokeStyle = 'rgba(110,190,120,' + (0.55 + w.gust * 0.4).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, baseY);
        ctx.quadraticCurveTo(px + lean * 0.4, baseY - b.h * 0.6, tipX, tipY);
        ctx.stroke();
        // canopy dot on tall blades (trees)
        if (b.h > 85) {
          ctx.fillStyle = 'rgba(70,150,90,0.85)';
          ctx.beginPath(); ctx.arc(tipX, tipY - 8, 10 + w.gust * 3, 0, 6.29); ctx.fill();
        }
      }
      // HUD: wind readout
      ctx.fillStyle = 'rgba(230,238,248,0.85)'; ctx.font = '12px system-ui';
      ctx.fillText('wind t=' + t.toFixed(1) + 's  gust=' + wind.gust.toFixed(1) + ' m/s', 10, 18);
      requestAnimationFrame(frame);
    }
    if (gustSlider) {
      gustSlider.addEventListener('input', function () {
        wind.gust = parseFloat(gustSlider.value);
        if (gustVal) gustVal.textContent = wind.gust.toFixed(1) + ' m/s';
      });
    }
    requestAnimationFrame(frame);
  }

  // ---------- surfel GI demo ----------
  // Top-down single room: sun dir rotates with slider; surfels on walls gather
  // bounce via the same bilateral kernel as SurfelWeight() (normal x falloff).
  function initSurfelDemo() {
    var canvas = document.getElementById('giCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var sunSlider = document.getElementById('sunSlider');
    var sunVal = document.getElementById('sunVal');
    var sunAngle = Math.PI * 0.25;
    // surfels anchored on room perimeter (position, normal, irradiance)
    var surfels = [];
    var N = 48;
    for (var i = 0; i < N; i++) {
      var f = i / N, x, y, nx, ny;
      if (f < 0.25) { x = f / 0.25; y = 0; nx = 0; ny = 1; }
      else if (f < 0.5) { x = 1; y = (f - 0.25) / 0.25; nx = -1; ny = 0; }
      else if (f < 0.75) { x = 1 - (f - 0.5) / 0.25; y = 1; nx = 0; ny = -1; }
      else { x = 0; y = 1 - (f - 0.75) / 0.25; nx = 1; ny = 0; }
      surfels.push({ x: x, y: y, nx: nx, ny: ny, e: 0 });
    }
    function updateIrradiance() {
      var sx = Math.cos(sunAngle), sy = Math.sin(sunAngle);
      for (var i = 0; i < surfels.length; i++) {
        var s = surfels[i];
        // direct: facing the sun => lit; opposite => bounce only
        var direct = Math.max(0, s.nx * sx + s.ny * sy);
        // 1-bounce approx: energy from lit walls leaks to dark walls
        s.e = 0.15 + direct * 1.0;
      }
      // one diffuse bounce blur pass (multi-bounce interior approx)
      var tmp = surfels.map(function (s) { return s.e; });
      for (var k = 0; k < surfels.length; k++) {
        var prev = tmp[(k - 1 + tmp.length) % tmp.length];
        var next = tmp[(k + 1) % tmp.length];
        surfels[k].e = tmp[k] * 0.7 + (prev + next) * 0.15 + 0.1;
      }
    }
    function draw() {
      var W = canvas.width, H = canvas.height;
      var pad = 26, S = Math.min(W, H) - pad * 2;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0b0e13'; ctx.fillRect(0, 0, W, H);
      // floor with gathered bounce: L_o = (rho/pi) * E
      var cells = 26;
      for (var gy = 0; gy < cells; gy++) {
        for (var gx = 0; gx < cells; gx++) {
          var px = (gx + 0.5) / cells, py = (gy + 0.5) / cells;
          var acc = 0, wSum = 0;
          for (var i = 0; i < surfels.length; i += 2) {
            var s = surfels[i];
            var dx = px - s.x, dy = py - s.y;
            var dist = Math.hypot(dx, dy);
            var R = 0.45;
            if (dist > R) continue;
            var fall = 1 - dist / R;
            var w = fall * fall; // top-down: no normal term on floor
            acc += s.e * w; wSum += w;
          }
          var e = wSum > 1e-4 ? acc / wSum : 0.12;
          var v = Math.min(255, Math.round(e * 120));
          ctx.fillStyle = 'rgb(' + (v + 20) + ',' + (v * 0.9 + 18) + ',' + (v * 0.75 + 30) + ')';
          ctx.fillRect(pad + gx / cells * S, pad + gy / cells * S, S / cells + 0.5, S / cells + 0.5);
        }
      }
      // room border + surfels
      ctx.strokeStyle = '#6cb8ff'; ctx.lineWidth = 2;
      ctx.strokeRect(pad, pad, S, S);
      for (var j = 0; j < surfels.length; j++) {
        var q = surfels[j];
        var X = pad + q.x * S, Y = pad + q.y * S;
        var r = 2 + Math.min(5, q.e * 3);
        ctx.fillStyle = 'rgba(255,200,120,' + Math.min(1, 0.3 + q.e * 0.4).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(X, Y, r, 0, 6.29); ctx.fill();
      }
      // sun arrow
      var cx = pad + S / 2, cy = pad + S / 2;
      ctx.strokeStyle = '#ffd76c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sunAngle) * S * 0.42, cy + Math.sin(sunAngle) * S * 0.42);
      ctx.stroke();
      ctx.fillStyle = '#ffd76c'; ctx.font = '12px system-ui';
      ctx.fillText('sun ' + Math.round(sunAngle * 180 / Math.PI) + '°  drag slider = time-of-day', 10, 16);
    }
    updateIrradiance(); draw();
    if (sunSlider) {
      sunSlider.addEventListener('input', function () {
        sunAngle = parseFloat(sunSlider.value) * Math.PI / 180;
        if (sunVal) sunVal.textContent = sunSlider.value + '°';
        updateIrradiance(); draw(); // sun motion invalidates cache O(changed)
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initWindDemo(); initSurfelDemo();
  });
})();
