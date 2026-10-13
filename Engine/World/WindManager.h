// WindManager.h — Alt Life single authoritative wind field (C++17, no deps).
// One wind field for CPU (physics/audio/particles) + GPU (foliage vertex shader).
// The HLSL/GLSL twin in Engine/Shaders/WindFoliage.hlsl MUST use the same
// constants, or foliage will disagree with physics about wind direction.
#pragma once
#include <cmath>

namespace altlife {

struct Vec3w { float x, y, z; };

struct WindParams {
    Vec3w prevailingDir = {0.8f, 0.0f, 0.6f}; // normalized XZ wind-rose dir
    float gustSpeed = 6.0f;    // m/s advection of gust fronts
    float gustStrength = 2.2f; // m/s peak gust amplitude
    float turbulence = 0.8f;   // street-canyon layer gain
    float flutter = 0.35f;     // leaf-scale high-frequency gain
    float time = 0.0f;         // seconds, advanced once per frame
};

// Cheap deterministic value-noise stand-ins (hash-based, no tables, so the
// GPU copy stays bit-similar). Replace with noise LUT if available.
inline float Hash1(float n) { return fmodf(sinf(n * 127.1f) * 43758.5453f, 1.0f); }
inline float VNoise(float x) {
    float i = floorf(x), f = x - i;
    float u = f * f * (3.0f - 2.0f * f);
    float a = Hash1(i), b = Hash1(i + 1.0f);
    // Hash1 can return negatives via fmod; remap to [0,1).
    a -= floorf(a); b -= floorf(b);
    return a * (1.0f - u) + b * u;
}

class WindManager {
public:
    explicit WindManager(const WindParams& p = {}) : params_(p) {}

    // Advance once per frame on the game thread (NOT per job).
    void Update(float dt) { params_.time += dt; }

    // Sample the full spatial wind vector at world position p (m/s).
    // Job-safe: reads params_ refreshed per frame; performs no writes.
    Vec3w Sample(float px, float py, float pz) const {
        const float t = params_.time;
        // Layer 1: synoptic gust front (~100 m), advected with prevailing dir.
        float fx = px * params_.prevailingDir.x + pz * params_.prevailingDir.z;
        float front = VNoise(fx * 0.01f - t * params_.gustSpeed * 0.02f);
        float gust = (front - 0.5f) * 2.0f * params_.gustStrength;
        // Layer 2: street-canyon turbulence (~10 m).
        float turb = (VNoise((px + pz) * 0.1f + t * 0.7f) - 0.5f)
                   * 2.0f * params_.turbulence;
        // Layer 3: leaf flutter (~1 m, height-graded by py in shader).
        float flut = (VNoise((px * 3.1f + py * 1.7f + pz * 2.3f) + t * 3.0f)
                   - 0.5f) * 2.0f * params_.flutter;
        float s = 1.0f + gust + turb; // bulk flow multiplier
        return {params_.prevailingDir.x * s + flut,
                flut * 0.4f, // slight vertical lift
                params_.prevailingDir.z * s - flut};
    }

    const WindParams& params() const { return params_; }

private:
    WindParams params_;
};

} // namespace altlife
