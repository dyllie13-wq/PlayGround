#pragma once
// Project Overlord - minimal math core (no external deps).
#include <cmath>
#include <algorithm>

namespace ov {

constexpr float PI = 3.14159265358979323846f;
constexpr float GRAV = 9.81f;

inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline float lerpf(float a, float b, float t) { return a + (b - a) * t; }
inline float deg2rad(float d) { return d * PI / 180.0f; }
inline float smoothstep(float e0, float e1, float x) {
  float t = clampf((x - e0) / (e1 - e0), 0.0f, 1.0f);
  return t * t * (3.0f - 2.0f * t);
}

struct Vec3 {
  float x = 0, y = 0, z = 0;
  Vec3() = default;
  Vec3(float X, float Y, float Z) : x(X), y(Y), z(Z) {}
  Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
  Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
  Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
  Vec3 operator/(float s) const { return {x / s, y / s, z / s}; }
  Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
  Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
  Vec3& operator*=(float s) { x *= s; y *= s; z *= s; return *this; }
  float dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }
  float len() const { return std::sqrt(x * x + y * y + z * z); }
  float len2() const { return x * x + y * y + z * z; }
  Vec3 norm() const { float l = len(); return l > 1e-6f ? (*this) / l : Vec3(0, 0, 0); }
  float dist(const Vec3& o) const { return (*this - o).len(); }
};

inline Vec3 dirFromYawPitch(float yaw, float pitch) {
  float cp = std::cos(pitch);
  return Vec3(-std::sin(yaw) * cp, std::sin(pitch), -std::cos(yaw) * cp);
}

struct AABB { Vec3 mn, mx; };

// Slab test. Returns true if segment [a,b] hits box; tmin/tmax in [0,1].
inline bool segHitsAABB(const Vec3& a, const Vec3& b, const AABB& box, float& tmin, float& tmax) {
  tmin = 0.0f; tmax = 1.0f;
  Vec3 d = b - a;
  const float* A[3] = {&a.x, &a.y, &a.z};
  const float* D[3] = {&d.x, &d.y, &d.z};
  const float* MN[3] = {&box.mn.x, &box.mn.y, &box.mn.z};
  const float* MX[3] = {&box.mx.x, &box.mx.y, &box.mx.z};
  for (int i = 0; i < 3; ++i) {
    float a0 = *A[i], dd = *D[i];
    if (std::fabs(dd) < 1e-8f) {
      if (a0 < *MN[i] || a0 > *MX[i]) return false;
    } else {
      float inv = 1.0f / dd;
      float t0 = (*MN[i] - a0) * inv, t1 = (*MX[i] - a0) * inv;
      if (t0 > t1) std::swap(t0, t1);
      tmin = std::max(tmin, t0); tmax = std::min(tmax, t1);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// Segment-sphere, returns smallest t in [0,1] or -1.
inline float segHitsSphere(const Vec3& a, const Vec3& b, const Vec3& c, float r) {
  Vec3 d = b - a, m = a - c;
  float A = d.dot(d), B = m.dot(d), C = m.dot(m) - r * r;
  if (C <= 0.0f) return 0.0f;               // starts inside
  if (A < 1e-12f) return -1.0f;
  float disc = B * B - A * C;
  if (disc < 0.0f) return -1.0f;
  float t = (-B - std::sqrt(disc)) / A;
  return (t >= 0.0f && t <= 1.0f) ? t : -1.0f;
}

}  // namespace ov
