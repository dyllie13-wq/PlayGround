// SurfelLighting.h — Alt Life BlackSpace-style dynamic GI evaluator (C++17, no deps).
// Visual benchmark:
//   https://www.youtube.com/watch?v=rHnNIbz8Ia0
//   https://www.youtube.com/watch?v=xv3wFGGeIsI&t=1968s (3D Game, Desktop)
// Contract: surfels are maintained by an async compute/job pass; this header
// evaluates per-pixel diffuse bounce under shifting sun/moon without lightmap bakes.
// Threading: Update() runs on streaming jobs; Evaluate is read-only per pixel.
#pragma once
#include <cstdint>
#include <cmath>

namespace altlife {

struct Vec3 { float x, y, z; };
inline Vec3 operator+(Vec3 a, Vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 operator-(Vec3 a, Vec3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 operator*(Vec3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline float Dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline float Length(Vec3 v) { return std::sqrt(Dot(v, v)); }

// One cached bounce sample in world space.
struct Surfel {
    Vec3 position;    // world-space anchor
    Vec3 normal;      // geometric mean normal of contributing pixels
    Vec3 irradiance;  // multi-bounce diffuse irradiance E (lux-like)
    float radius = 0.6f;   // validity radius (m); grows in flat regions
    float validity = 1.0f;  // [0,1] temporal confidence; sun motion decays it
    uint32_t lastTouchFrame = 0;
};

// Time-of-day lighting state, refreshed once per frame on the game thread.
struct DayPhase {
    Vec3 sunDir = {0.5f, 0.8f, 0.3f};       // normalized, points TOWARD the sun
    Vec3 sunColor = {1.0f, 0.95f, 0.88f};   // sun radiance (includes elevation dimming)
    Vec3 moonDir = {-0.5f, -0.8f, -0.3f};
    Vec3 moonColor = {0.0f, 0.0f, 0.0f};    // ~0 at day; dominates at night
    Vec3 skyAmbient = {0.25f, 0.32f, 0.45f};// SDF-probe fallback ambient
    float sunAngularChange = 0.0f;          // radians since last frame (drives invalidation)
};

constexpr int kGatherRays = 8;     // surfels sampled per pixel
constexpr float kBaseRadius = 0.6f;// m, near-field surfel spacing
constexpr float kMaxRadius = 3.0f; // m, far/flat-region cap
constexpr float kAngleWeight = 2.0f;

// Bilateral kernel: normal agreement x distance falloff x confidence.
inline float SurfelWeight(const Vec3& p, const Vec3& n, const Surfel& s) {
    Vec3 d = p - s.position;
    float dist = Length(d);
    if (dist > s.radius * 2.0f || s.validity <= 0.0f) return 0.0f;
    float nAlign = Dot(n, s.normal);
    if (nAlign <= 0.0f) return 0.0f; // backface: no bounce (prevents light leak)
    float falloff = 1.0f - dist / (s.radius * 2.0f);
    return std::pow(nAlign, kAngleWeight) * falloff * falloff * s.validity;
}

// Per-pixel diffuse bounce: L_o = (rho/pi) * E_gathered.
// `fetch(i)` maps gather tap i -> surfel (hash-grid lookup in real engine;
// a flat ring buffer here keeps the snippet dependency-free).
// Thread-safety: read-only over surfels; run one call per pixel in jobs.
template <typename FetchFn>
Vec3 EvaluateSurfelBounce(const Vec3& albedo, const Vec3& fragPos,
                           const Vec3& fragNormal, FetchFn&& fetch) {
    Vec3 acc{0, 0, 0};
    float wSum = 0.0f;
    for (int i = 0; i < kGatherRays; ++i) {
        const Surfel& s = fetch(i);
        float w = SurfelWeight(fragPos, fragNormal, s);
        acc = acc + s.irradiance * w;
        wSum += w;
    }
    if (wSum < 1e-4f) return {0, 0, 0}; // caller adds SDF-probe fallback
    Vec3 e = acc * (1.0f / wSum);       // normalized irradiance
    constexpr float kInvPi = 0.3183099f;
    return {albedo.x * e.x * kInvPi, albedo.y * e.y * kInvPi, albedo.z * e.z * kInvPi};
}

// Per-frame maintenance (jobified over surfel tiles): decay surfels the
// moving sun/moon invalidated, so time-of-day shifts cost O(changed).
inline void InvalidateForTimeOfDay(Surfel* surfels, int count,
                                   const DayPhase& phase, uint32_t frame) {
    // Wider sun swing => harsher confidence cut. Moon uses same path at night.
    float cut = 1.0f - fminf(phase.sunAngularChange * 8.0f, 0.9f);
    for (int i = 0; i < count; ++i) {
        surfels[i].validity *= cut;
        surfels[i].lastTouchFrame = frame;
    }
}

} // namespace altlife
