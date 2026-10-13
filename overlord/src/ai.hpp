#pragma once
// AI: event-driven FSM (Patrol / Engage / Cover / Suppress) with LOS + hearing.
#include <string>
#include <vector>
#include "math.hpp"
#include "world.hpp"
#include "ballistics.hpp"
#include "player.hpp"

namespace ov {

enum class AiState : int { Patrol = 0, Engage = 1, Cover = 2, Suppress = 3 };

struct Agent {
  int id = -1;
  int faction = 1;  // 0 BLUFOR, 1 OPFOR, 2 CIV
  Vec3 pos{0, 0, 0};  // feet
  float hp = 100, maxHp = 100;
  bool alive = true;
  bool crouch = false;
  AiState state = AiState::Patrol;
  std::vector<Vec3> waypoints;
  size_t wpi = 0;
  float faceYaw = 0;
  Vec3 lastKnown{0, 0, 0};
  float lastSeenT = -1000;
  float alertT = 0;
  float fireCd = 0;
  float aimProg = 0;     // continuous visual contact (s) before first aimed burst
  int burstLeft = 0;
  float burstT = 0;
  float stateT = 0;      // time in current state
  float hunkerT = 0;
  Vec3 coverPos{0, 0, 0};
  bool hasCover = false;
  float incomingT = -1000;
  int incomingN = 0;
  float popT = 0;
  float speed = 4.2f;

  HitBody toHitBody() const;
  void damage(float dmg);
};

class AISystem {
 public:
  std::vector<Agent> agents;

  int spawn(int faction, const Vec3& pos, const std::vector<Vec3>& wps);
  void clear();

  // dt-step all agents. `noises` is read and AI gunfire is appended for next step.
  void update(float dt, float time, const World& world, const Player& player,
              Ballistics& bal, std::vector<NoiseEvent>& noises,
              const std::vector<HitEvent>& hits, std::vector<std::string>& feed,
              uint32_t& seed);

  int aliveFaction(int faction) const;

 private:
  bool canSee(const Agent& a, const World& world, const Vec3& eye, const Vec3& tgtEye,
              float range, float fovCos) const;
  void findCover(Agent& a, const World& world, const Vec3& threat);
  void moveToward(Agent& a, const World& world, const Vec3& dest, float speed, float dt);
  void fireShot(Agent& a, Ballistics& bal, const Vec3& target, float spread,
                std::vector<NoiseEvent>& outNoises, uint32_t& seed);
};

}  // namespace ov
