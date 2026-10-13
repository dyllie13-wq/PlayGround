// VehiclePhysics.h — Alt Life arcade-credible vehicle bridge (C++17, no deps).
// Raycast wheel-ground contact + spring/damper suspension + Pacejka-lite tires.
// Physics core steps at fixed 120 Hz; render interpolates at display rate.
#pragma once
#include <cmath>

namespace altlife {

struct WheelState {
    float compression = 0.0f; // 0..1 suspension travel
    float slipAngle = 0.0f;    // radians
    float slipRatio = 0.0f;    // longitudinal slip
    float load = 0.0f;        // normal load (N)
    float surfaceMu = 1.0f;   // asphalt 1.0 / wet 0.65 / dirt 0.6 / grass 0.45
    bool grounded = false;
};

struct VehicleSetup {
    float mass = 1400.0f;        // kg
    float springK = 35000.0f;    // N/m per corner
    float damperC = 4000.0f;     // Ns/m per corner
    float restLength = 0.45f;    // m
    float tireB = 10.0f;         // Pacejka stiffness
    float tireC = 1.9f;
    float tireD = 1.0f;          // peak (scaled by surfaceMu * load)
    float tireE = 0.97f;
    float comHeight = 0.55f;     // m; shifts with cargo/passengers
};

// Pacejka Magic Formula: F = D*sin(C*atan(B*x - E*(B*x - atan(B*x))))
inline float Pacejka(float slip, float B, float C, float D, float E) {
    float bx = B * slip;
    return D * sinf(C * atanf(bx - E * (bx - atanf(bx))));
}

// Spring-damper: F = k*(rest - len) - c*dLen/dt. Call per corner per substep.
inline float SuspensionForce(float rayLen, float rayVel,
                             const VehicleSetup& s) {
    float compression = s.restLength - rayLen;
    if (compression <= 0.0f) return 0.0f;
    return s.springK * compression - s.damperC * rayVel;
}

// Combined-slip friction ellipse keyed by surface + load sensitivity.
inline float TireForce(float slip, float load, float mu,
                       const VehicleSetup& s) {
    float D = s.tireD * mu * load * 0.0015f; // load-scaled peak
    float f = Pacejka(slip, s.tireB, s.tireC, D, s.tireE);
    // Friction ellipse clamp: never exceed mu * load.
    float maxF = mu * load;
    if (f > maxF) f = maxF;
    if (f < -maxF) f = -maxF;
    return f;
}

// Dynamic center-of-mass: COM = sum(m_i p_i)/sum(m_i).
// Recompute per frame; passengers/cargo/fuel shift roll/pitch inertia.
struct MassPoint { float m, x, y, z; };
inline void ComputeCOM(const MassPoint* pts, int n,
                       float& cx, float& cy, float& cz) {
    double m = 0, x = 0, y = 0, z = 0;
    for (int i = 0; i < n; ++i) { m += pts[i].m; x += pts[i].m * pts[i].x; y += pts[i].m * pts[i].y; z += pts[i].m * pts[i].z; }
    if (m <= 0.0) { cx = cy = cz = 0; return; }
    cx = (float)(x / m); cy = (float)(y / m); cz = (float)(z / m);
}

} // namespace altlife
