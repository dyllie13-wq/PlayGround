#include "ai.hpp"
#include <cmath>
#include <string>

namespace ov {

HitBody Agent::toHitBody() const {
  HitBody b;
  b.id = id; b.faction = faction; b.alive = alive;
  b.crouch = crouch; b.feet = pos;
  b.armorMM = (faction == 1) ? 4.0f : 0.0f;
  return b;
}

void Agent::damage(float dmg) {
  if (!alive) return;
  hp -= dmg;
  if (hp <= 0) { hp = 0; alive = false; }
}

int AISystem::spawn(int faction, const Vec3& pos, const std::vector<Vec3>& wps) {
  Agent a;
  a.id = (int)agents.size() + 1;
  a.faction = faction;
  a.pos = pos;
  a.pos.y = World::groundHeight(pos.x, pos.z);
  a.waypoints = wps;
  a.speed = (faction == 2) ? 2.0f : 4.2f;
  if (faction == 2) { a.hp = a.maxHp = 100; }
  agents.push_back(a);
  return a.id;
}

void AISystem::clear() { agents.clear(); }

int AISystem::aliveFaction(int faction) const {
  int n = 0;
  for (const auto& a : agents) if (a.alive && a.faction == faction) ++n;
  return n;
}

bool AISystem::canSee(const Agent& a, const World& world, const Vec3& eye,
                      const Vec3& tgtEye, float range, float fovCos) const {
  Vec3 d = tgtEye - eye;
  float dist = d.len();
  if (dist > range || dist < 1e-4f) return false;
  Vec3 fwd = dirFromYawPitch(a.faceYaw, 0);
  Vec3 dn = d / dist;
  float facing = fwd.x * dn.x + fwd.z * dn.z;
  if (a.alertT <= 0 && facing < fovCos) return false;  // limited FOV when calm
  return !world.segmentBlocked(eye, tgtEye);
}

void AISystem::findCover(Agent& a, const World& world, const Vec3& threat) {
  Vec3 best = a.pos; float bestScore = -1e9f;
  for (int i = 0; i < 16; ++i) {
    float ang = i / 16.0f * 2.0f * PI;
    for (float r = 12.0f; r <= 60.0f; r += 16.0f) {
      Vec3 c = a.pos + Vec3(std::cos(ang) * r, 0, std::sin(ang) * r);
      c.y = World::groundHeight(c.x, c.z);
      Vec3 ce = c + Vec3(0, 1.4f, 0);
      Vec3 te = threat + Vec3(0, 1.5f, 0);
      if (!world.segmentBlocked(te, ce)) continue;  // must break LOS
      float score = -c.dist(a.pos) * 0.5f - c.dist(threat) * 0.1f;
      if (score > bestScore) { bestScore = score; best = c; }
    }
  }
  if (bestScore > -1e9f) { a.coverPos = best; a.hasCover = true; }
}

void AISystem::moveToward(Agent& a, const World& world, const Vec3& dest, float speed, float dt) {
  (void)world;
  Vec3 d = dest - a.pos; d.y = 0;
  float dist = d.len();
  if (dist < 0.5f) return;
  Vec3 step = d / dist * std::min(speed * dt, dist);
  a.pos += step;
  a.pos.y = World::groundHeight(a.pos.x, a.pos.z);
  a.faceYaw = std::atan2(-d.x, -d.z);
}

void AISystem::fireShot(Agent& a, Ballistics& bal, const Vec3& target, float spread,
                        std::vector<NoiseEvent>& outNoises, uint32_t& seed) {
  Vec3 muzzle = a.pos + Vec3(0, a.crouch ? 1.1f : 1.5f, 0);
  Vec3 dir = (target - muzzle).norm();
  ProjCfg cfg;
  cfg.muzzleVel = 830.0f; cfg.damage = 11.0f; cfg.penMM = 10.0f;
  bal.fire(muzzle, dir, cfg, a.id, a.faction, /*foe=*/true, spread, ++seed);
  outNoises.push_back({a.pos, 180.0f});
}

void AISystem::update(float dt, float time, const World& world, const Player& player,
                      Ballistics& bal, std::vector<NoiseEvent>& noises,
                      const std::vector<HitEvent>& hits, std::vector<std::string>& feed,
                      uint32_t& seed) {
  std::vector<NoiseEvent> myNoises;

  // Pre-scan impacts for suppression accounting.
  for (auto& a : agents) {
    if (!a.alive || a.faction == 2) continue;
    for (const auto& h : hits) {
      Vec3 d = h.at - a.pos; d.y = 0;
      if (d.len() < 9.0f && h.shooterId != a.id) {
        if (time - a.incomingT > 2.0f) { a.incomingT = time; a.incomingN = 1; }
        else a.incomingN++;
        if (h.shooterId == -100 && player.alive) {  // shot by the player
          a.lastKnown = player.pos; a.alertT = 6.0f;
        }
      }
    }
  }

  for (auto& a : agents) {
    if (!a.alive) continue;
    if (a.fireCd > 0) a.fireCd -= dt;
    if (a.alertT > 0) a.alertT -= dt;
    a.stateT += dt;

    // Hearing.
    for (const auto& n : noises) {
      Vec3 d = n.pos - a.pos; d.y = 0;
      if (d.len() < n.radius && a.faction != 2) {
        a.lastKnown = n.pos; a.alertT = 6.0f;
        if (a.state == AiState::Patrol) { a.state = AiState::Engage; a.stateT = 0; }
      } else if (d.len() < 60.0f && a.faction == 2) {
        // Civilians flee from loud noises.
        Vec3 away = (a.pos - n.pos); away.y = 0;
        if (away.len() > 1.0f) moveToward(a, world, a.pos + away.norm() * 30.0f, 3.5f, dt);
      }
    }

    // Vision vs the player.
    Vec3 eye = a.pos + Vec3(0, a.crouch ? 1.1f : 1.6f, 0);
    Vec3 pEye = player.pos + Vec3(0, player.eyeHeight(), 0);
    float range = player.stance == Stance::Stand ? 260.0f
                : (player.stance == Stance::Crouch ? 210.0f : 165.0f);
    bool seesPlayer = player.alive && a.faction == 1 &&
                      canSee(a, world, eye, pEye, range, std::cos(deg2rad(65)));

    if (a.faction == 2) {  // civilians wander
      if (!a.waypoints.empty()) {
        Vec3 wp = a.waypoints[a.wpi % a.waypoints.size()];
        Vec3 d = wp - a.pos; d.y = 0;
        if (d.len() < 3.0f) a.wpi++;
        else moveToward(a, world, wp, a.speed, dt);
      }
      continue;
    }

    switch (a.state) {
      case AiState::Patrol: {
        a.crouch = false;
        if (seesPlayer) {
          a.state = AiState::Engage; a.stateT = 0;
          a.lastKnown = player.pos; a.lastSeenT = time; a.alertT = 8.0f;
          feed.push_back("contact: OPFOR #" + std::to_string(a.id) + " engaging player");
        } else if (!a.waypoints.empty()) {
          Vec3 wp = a.waypoints[a.wpi % a.waypoints.size()];
          Vec3 d = wp - a.pos; d.y = 0;
          if (d.len() < 3.0f) a.wpi++;
          else moveToward(a, world, wp, 2.2f, dt);
        }
        break;
      }
      case AiState::Engage: {
        a.crouch = false;
        if (seesPlayer) {
          a.lastKnown = player.pos; a.lastSeenT = time; a.alertT = 8.0f;
          a.aimProg += dt;
          Vec3 d = player.pos - a.pos;
          a.faceYaw = std::atan2(-d.x, -d.z);
          float dist = d.len();
          if (dist > 40.0f) moveToward(a, world, player.pos, a.speed, dt);
          // Aimed bursts with distance-based spread (0.4s acquire delay).
          if (a.fireCd <= 0 && a.aimProg > 0.4f) {
            if (a.burstLeft <= 0) { a.burstLeft = 3 + (seed++ % 3); a.burstT = 0; a.fireCd = 1.1f + (seed % 100) / 100.0f; }
          }
          if (a.burstLeft > 0) {
            a.burstT -= dt;
            if (a.burstT <= 0) {
              a.burstT = 0.13f;
              a.burstLeft--;
              fireShot(a, bal, pEye, 0.006f + dist * 0.00004f, myNoises, seed);
            }
          }
        } else {
          // Hunt last known position.
          a.aimProg = 0;
          Vec3 d = a.lastKnown - a.pos; d.y = 0;
          if (d.len() > 6.0f) moveToward(a, world, a.lastKnown, a.speed, dt);
          else if (time - a.lastSeenT > 10.0f) { a.state = AiState::Patrol; a.stateT = 0; }
        }
        // Suppression / cover checks.
        if (a.incomingN >= 3 && time - a.incomingT < 2.0f) {
          a.state = AiState::Suppress; a.stateT = 0; a.hunkerT = 3.5f;
          feed.push_back("suppressed: OPFOR #" + std::to_string(a.id) + " hunkered");
        } else if (a.hp < 45.0f && !a.hasCover) {
          findCover(a, world, a.lastKnown);
          if (a.hasCover) { a.state = AiState::Cover; a.stateT = 0; }
        }
        break;
      }
      case AiState::Cover: {
        Vec3 d = a.coverPos - a.pos; d.y = 0;
        if (d.len() > 2.0f) {
          a.crouch = false;
          moveToward(a, world, a.coverPos, a.speed * 1.1f, dt);
        } else {
          a.crouch = true;
          if (seesPlayer) { a.lastKnown = player.pos; a.lastSeenT = time; }
          // Pop-up snapshots.
          a.popT -= dt;
          if (a.popT <= 0) {
            a.popT = 2.6f;
            a.crouch = false;
            if (player.alive) {
              Vec3 dd = player.pos - a.pos;
              a.faceYaw = std::atan2(-dd.x, -dd.z);
              fireShot(a, bal, pEye, 0.02f, myNoises, seed);
            }
            a.crouch = true;
          }
          if (a.stateT > 9.0f) { a.state = AiState::Engage; a.stateT = 0; a.hasCover = false; }
        }
        if (a.incomingN >= 3 && time - a.incomingT < 2.0f) {
          a.state = AiState::Suppress; a.stateT = 0; a.hunkerT = 3.5f;
        }
        break;
      }
      case AiState::Suppress: {
        a.crouch = true;
        a.hunkerT -= dt;
        if (a.hunkerT <= 0) {
          a.state = AiState::Engage; a.stateT = 0; a.incomingN = 0;
          // Blind suppressive burst at last known.
          for (int i = 0; i < 4; ++i)
            fireShot(a, bal, a.lastKnown + Vec3(0, 1.2f, 0), 0.05f, myNoises, seed);
          feed.push_back("suppressing: OPFOR #" + std::to_string(a.id) + " spraying last known");
        }
        break;
      }
    }
  }

  // AI gunfire is audible too (heard next step).
  noises.insert(noises.end(), myNoises.begin(), myNoises.end());
}

}  // namespace ov
