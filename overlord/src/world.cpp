#include "world.hpp"
#include <cmath>

namespace ov {

World::World() = default;

float World::groundHeight(float x, float z) {
  float h = 8.0f * std::sin(x * 0.012f) * std::cos(z * 0.010f)
          + 11.0f * std::sin(x * 0.0035f + 1.7f) * std::sin(z * 0.004f + 0.6f)
          + 4.0f * std::sin(x * 0.03f + 0.5f) * std::sin(z * 0.028f + 1.2f);
  float se = std::max(0.0f, (x + z) * 0.5f);
  h += smoothstep(120.0f, 420.0f, se) * 85.0f;
  float r = std::sqrt(x * x + z * z) / 430.0f;
  h -= smoothstep(0.72f, 1.05f, r) * 30.0f;
  h += 10.0f;
  return h;
}

int World::addSolid(const AABB& box, Material mat) {
  Solid s; s.box = box; s.mat = mat; s.id = nextId_++;
  solids_.push_back(s);
  return s.id;
}

void World::clearSolids() { solids_.clear(); }

bool World::segmentBlocked(const Vec3& a, const Vec3& b, float& hitT, int& hitId) const {
  bool hit = false; hitT = 1.0f; hitId = -1;
  for (const auto& s : solids_) {
    float t0, t1;
    if (segHitsAABB(a, b, s.box, t0, t1) && t0 < hitT && t1 > 0.0f) {
      hit = true; hitT = t0; hitId = s.id;
    }
  }
  return hit;
}

void World::solidsAlongSegment(const Vec3& a, const Vec3& b, std::vector<int>& out) const {
  out.clear();
  for (const auto& s : solids_) {
    float t0, t1;
    if (segHitsAABB(a, b, s.box, t0, t1) && t0 < 1.0f && t1 > 0.0f) out.push_back(s.id);
  }
}

const Solid* World::getSolid(int id) const {
  for (const auto& s : solids_) if (s.id == id) return &s;
  return nullptr;
}

static void houseBox(World& w, float x, float z, float hw, float hd, float h, Material m) {
  float g = World::groundHeight(x, z);
  w.addSolid({{x - hw, g, z - hd}, {x + hw, g + h, z + hd}}, m);
}

void World::buildDefaultTown() {
  clearSolids();
  for (int i = 0; i < 8; ++i) houseBox(*this, 40 - 60 + i * 17, 20 - 28, 6, 5, 5.5f, Material::Wood);
  for (int i = 0; i < 7; ++i) houseBox(*this, 40 - 52 + i * 17, 20 + 34, 6, 5, 5.5f, Material::Wood);
  {  // church nave + tower
    float g = groundHeight(48, 18);
    addSolid({{48 - 11, g, 18 - 5}, {48 + 11, g + 9, 18 + 5}}, Material::Concrete);
    addSolid({{61 - 3, g, 18 - 3}, {61 + 3, g + 20, 18 + 3}}, Material::Concrete);
  }
  {  // airfield hangar (north)
    float g = groundHeight(-170, -280);
    addSolid({{-170 - 15, g, -280 - 10}, {-170 + 15, g + 10, -280 + 10}}, Material::Metal);
  }
  {  // FOB watchtower cabin + sandbag ring (SE hill)
    float g = groundHeight(205, 185);
    addSolid({{205 - 5.5f, g + 11.5f, 185 - 5.5f}, {205 + 5.5f, g + 15.5f, 185 + 5.5f}}, Material::Wood);
    for (int i = 0; i < 14; ++i) {
      float a = i / 14.0f * 2.0f * PI;
      float x = 205 + std::cos(a) * 20.0f, z = 185 + std::sin(a) * 20.0f;
      float gy = groundHeight(x, z);
      addSolid({{x - 2.2f, gy, z - 2.2f}, {x + 2.2f, gy + 2.4f, z + 2.2f}}, Material::Sandbag);
    }
  }
}

}  // namespace ov
