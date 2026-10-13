#pragma once
// World: analytic island heightfield + occluder/penetration solids registry.
#include <vector>
#include "math.hpp"

namespace ov {

enum class Material : int { Wood = 0, Sandbag = 1, Concrete = 2, Metal = 3, Rock = 4 };

// Resistance factor: penetration depth (m) is divided by this per material.
inline float materialFactor(Material m) {
  switch (m) {
    case Material::Wood: return 1.0f;
    case Material::Sandbag: return 2.5f;
    case Material::Concrete: return 6.0f;
    case Material::Metal: return 8.0f;
    default: return 4.0f;
  }
}

struct Solid {
  AABB box;
  Material mat = Material::Wood;
  int id = 0;
};

class World {
 public:
  World();

  // Everon-style island heightfield (same shaping as the web visualizer).
  static float groundHeight(float x, float z);

  int addSolid(const AABB& box, Material mat);
  void clearSolids();

  // True if segment is occluded; hitT/hitId describe the closest solid.
  bool segmentBlocked(const Vec3& a, const Vec3& b, float& hitT, int& hitId) const;
  bool segmentBlocked(const Vec3& a, const Vec3& b) const {
    float t; int id; return segmentBlocked(a, b, t, id);
  }
  // All solids whose box the segment passes through (for penetration).
  void solidsAlongSegment(const Vec3& a, const Vec3& b, std::vector<int>& out) const;
  const Solid* getSolid(int id) const;

  // Builds the default village/FOB/airfield occluder set.
  void buildDefaultTown();

 private:
  std::vector<Solid> solids_;
  int nextId_ = 1;
};

}  // namespace ov
