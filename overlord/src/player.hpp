#pragma once
// Player controller: stances, inertia, stamina, ADS, sway, recoil, reload.
#include <cstdint>
#include "math.hpp"
#include "world.hpp"
#include "ballistics.hpp"

namespace ov {

enum class Stance : int { Stand = 0, Crouch = 1, Prone = 2 };

struct PlayerInput {
  float moveFwd = 0;    // -1..1 (local)
  float moveSide = 0;   // -1..1
  bool sprint = false;
  bool ads = false;
  bool fire = false;
  bool toggleCrouch = false;
  bool toggleProne = false;
  bool reload = false;
  float lookDx = 0;     // mouse deltas (rad)
  float lookDy = 0;
  float dt = 0.016f;
};

struct NoiseEvent { Vec3 pos; float radius; };

class Player {
 public:
  Player();

  void update(const PlayerInput& in, const World& world, Ballistics& bal,
              std::vector<NoiseEvent>& noises, uint32_t& seed);

  // -- state (public for game/AI/tests) --
  Vec3 pos{0, 0, 0};   // feet
  Vec3 vel{0, 0, 0};
  float yaw = 0, pitch = 0;
  Stance stance = Stance::Stand;
  float eyeH = 1.7f;
  float stamina = 100.0f;
  float hp = 100.0f;
  bool alive = true;
  int ammo = 30, mags = 6;
  float reloadT = 0;
  float fireCd = 0;
  float recoilP = 0, recoilY = 0;   // accumulated kick (rad)
  float bloom = 0;                 // extra spread from sustained fire
  float swayT = 0;
  float adsK = 0;                  // 0 hip .. 1 ads
  float shotsFired = 0;

  float eyeHeight() const { return eyeH; }
  Vec3 eyePos() const { return pos + Vec3(0, eyeH, 0); }
  Vec3 aimDir() const;
  float currentSpread() const;     // radians, includes sway/bloom/ads
  float moveSpeed() const;         // target top speed m/s

  void damage(float dmg);
  void resupplyIfNear(const Vec3& boxPos, float radius);

 private:
  ProjCfg rifle_;
};

}  // namespace ov
