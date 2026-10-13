#pragma once
// Ballistics: pooled projectiles with drag/gravity/wind, multi-zone hitboxes,
// material penetration, per-shooter damage attribution.
#include <cstdint>
#include <vector>
#include "math.hpp"
#include "world.hpp"

namespace ov {

enum class HitZone : int { None = 0, Head = 1, Torso = 2, Limbs = 3 };

inline float zoneMultiplier(HitZone z) {
  switch (z) {
    case HitZone::Head: return 3.0f;
    case HitZone::Torso: return 1.0f;
    case HitZone::Limbs: return 0.6f;
    default: return 0.0f;
  }
}

// Spherical approximation of a humanoid hitbox set (feet at `feet`).
struct HitBody {
  int id = 0;
  int faction = 0;          // 0 BLUFOR, 1 OPFOR, 2 CIV
  bool alive = true;
  bool crouch = false;
  Vec3 feet;                // world position of feet
  float armorMM = 0.0f;     // torso vest rating
  float scale = 1.0f;
  float vehicleR = 0.0f;    // >0: single-sphere vehicle body instead of zones
  float vehicleH = 1.2f;    // center height of vehicle sphere
};

inline Vec3 hitHead(const HitBody& b) {
  return b.feet + Vec3(0, (b.crouch ? 1.05f : 1.55f) * b.scale, 0);
}
inline Vec3 hitTorso(const HitBody& b) {
  return b.feet + Vec3(0, (b.crouch ? 0.65f : 1.00f) * b.scale, 0);
}
inline Vec3 hitLimbs(const HitBody& b) {
  return b.feet + Vec3(0, 0.40f * b.scale, 0);
}

struct ProjCfg {
  float muzzleVel = 900.0f;  // m/s
  float dragK = 0.00012f;    // quadratic drag coefficient (1/m)
  float caliberMM = 5.56f;
  float damage = 34.0f;
  float penMM = 12.0f;       // penetration capability
  float maxLife = 5.0f;
};

struct Projectile {
  bool active = false;
  Vec3 pos, vel;
  float life = 0;
  int shooterId = -1;
  int shooterFaction = 0;
  float dmgLeft = 0;
  float penMM = 0;
  float caliberMM = 5.56f;
  float dragK = 0.00012f;
  int pens = 0;
  int lastSolidId = -1;
  bool foe = false;  // targets the player rather than agents
};

struct HitEvent {
  int shooterId = -1;
  int targetId = -1;   // agent id, or -1 for world/ground
  HitZone zone = HitZone::None;
  float damage = 0;
  bool penetrated = false;
  bool killed = false;
  Vec3 at;
};

struct ShotReport {  // returned per sub-step for noise/suppression systems
  Vec3 origin;
  float loudRadius = 180.0f;
};

class Ballistics {
 public:
  explicit Ballistics(int pool = 256);
  void clear();

  // Spawn a projectile. spreadRad adds a random cone (radians) via rng-free hash.
  void fire(const Vec3& muzzle, const Vec3& dir, const ProjCfg& cfg,
            int shooterId, int shooterFaction, bool foe, float spreadRad, uint32_t seed);

  // Fixed-step integration. Fills `hits` and `shots` (noise origins).
  void step(float dt, const World& world, std::vector<HitBody>& bodies,
            const Vec3* playerPos, float playerHeight, int playerId,
            std::vector<HitEvent>& hits, std::vector<ShotReport>& shots);

  int liveCount() const;
  // Test/debug accessor: first live projectile state.
  bool liveState(Vec3& posOut, Vec3& velOut) const;

 private:
  std::vector<Projectile> pool_;
  std::vector<int> solidScratch_;
};

}  // namespace ov
