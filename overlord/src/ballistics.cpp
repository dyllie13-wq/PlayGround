#include "ballistics.hpp"
#include <cmath>

namespace ov {

Ballistics::Ballistics(int pool) { pool_.resize(pool > 0 ? pool : 64); }
void Ballistics::clear() { for (auto& p : pool_) p.active = false; }

static Vec3 spreadDir(const Vec3& d, float rad, uint32_t seed) {
  if (rad <= 0) return d;
  // Deterministic hash-based cone offset (no RNG state needed).
  uint32_t h = seed * 1664525u + 1013904223u;
  float a = (h & 0xffff) / 65535.0f * 2.0f * PI;
  h = h * 1664525u + 1013904223u;
  float r = (h & 0xffff) / 65535.0f * rad;
  Vec3 up = std::fabs(d.y) > 0.9f ? Vec3(1, 0, 0) : Vec3(0, 1, 0);
  Vec3 t1 = Vec3(d.y * up.z - d.z * up.y, d.z * up.x - d.x * up.z, d.x * up.y - d.y * up.x).norm();
  Vec3 t2 = Vec3(d.y * t1.z - d.z * t1.y, d.z * t1.x - d.x * t1.z, d.x * t1.y - d.y * t1.x).norm();
  return (d + t1 * (std::cos(a) * r) + t2 * (std::sin(a) * r)).norm();
}

void Ballistics::fire(const Vec3& muzzle, const Vec3& dir, const ProjCfg& cfg,
                      int shooterId, int shooterFaction, bool foe,
                      float spreadRad, uint32_t seed) {
  for (auto& p : pool_) {
    if (p.active) continue;
    p.active = true;
    p.pos = muzzle;
    p.vel = spreadDir(dir.norm(), spreadRad, seed) * cfg.muzzleVel;
    p.life = cfg.maxLife;
    p.shooterId = shooterId;
    p.shooterFaction = shooterFaction;
    p.dmgLeft = cfg.damage;
    p.penMM = cfg.penMM;
    p.caliberMM = cfg.caliberMM;
    p.dragK = cfg.dragK;
    p.pens = 0;
    p.lastSolidId = -1;
    p.foe = foe;
    return;
  }
}

int Ballistics::liveCount() const {
  int n = 0;
  for (const auto& p : pool_) if (p.active) ++n;
  return n;
}

bool Ballistics::liveState(Vec3& posOut, Vec3& velOut) const {
  for (const auto& p : pool_)
    if (p.active) { posOut = p.pos; velOut = p.vel; return true; }
  return false;
}

void Ballistics::step(float dt, const World& world, std::vector<HitBody>& bodies,
                      const Vec3* playerPos, float playerHeight, int playerId,
                      std::vector<HitEvent>& hits, std::vector<ShotReport>& shots) {
  const int SUB = 4;
  const float h = dt / SUB;
  for (auto& p : pool_) {
    if (!p.active) continue;
    bool dead = false;
    for (int s = 0; s < SUB && !dead; ++s) {
      Vec3 prev = p.pos;
      float speed = p.vel.len();
      if (speed > 1e-4f) {
        float dragAcc = p.dragK * speed * speed;
        p.vel -= p.vel.norm() * (dragAcc * h);
      }
      p.vel.y -= GRAV * h;
      p.pos += p.vel * h;
      p.life -= h;
      Vec3 seg = p.pos;

      // --- ground impact ---
      if (p.pos.y <= World::groundHeight(p.pos.x, p.pos.z)) {
        hits.push_back({p.shooterId, -1, HitZone::None, 0, false, false, p.pos});
        dead = true; break;
      }
      if (p.life <= 0 || p.vel.len() < 50.0f) { dead = true; break; }

      // --- penetration through solids (midpoint sample, one application per solid) ---
      world.solidsAlongSegment(prev, seg, solidScratch_);
      for (int sid : solidScratch_) {
        if (sid == p.lastSolidId) continue;
        const Solid* sol = world.getSolid(sid);
        if (!sol) continue;
        Vec3 mid = (prev + seg) * 0.5f;
        bool inside = mid.x >= sol->box.mn.x && mid.x <= sol->box.mx.x &&
                      mid.y >= sol->box.mn.y && mid.y <= sol->box.mx.y &&
                      mid.z >= sol->box.mn.z && mid.z <= sol->box.mx.z;
        float t0, t1;
        bool cross = segHitsAABB(prev, seg, sol->box, t0, t1);
        if (!inside && !cross) continue;
        float segLen = (seg - prev).len();
        float thick = cross ? (t1 - t0) * segLen : 0.25f;
        float depth = (p.penMM / 40.0f) / materialFactor(sol->mat);
        if (thick < depth && p.pens < 3) {
          p.dmgLeft *= (1.0f - thick / (depth + 1e-4f)) * 0.9f;
          p.pens++;
          p.lastSolidId = sid;
          if (p.dmgLeft < 1.0f) { dead = true; break; }
        } else {
          hits.push_back({p.shooterId, -1, HitZone::None, 0, false, false, mid});
          dead = true; break;
        }
      }
      if (dead) break;

      // --- agent hitboxes (nearest zone wins) ---
      float bestT = 2.0f; HitBody* bestB = nullptr; HitZone bestZ = HitZone::None;
      for (auto& b : bodies) {
        if (!b.alive || b.id == p.shooterId) continue;
        if (!p.foe && b.faction == p.shooterFaction) continue;   // no friendly fire (agents)
        if (p.foe && b.faction != 0) continue;                  // foe shots only vs BLUFOR bodies
        if (b.vehicleR > 0) {  // single-sphere vehicle body
          float tv = segHitsSphere(prev, seg, b.feet + Vec3(0, b.vehicleH, 0), b.vehicleR);
          if (tv >= 0 && tv < bestT) { bestT = tv; bestB = &b; bestZ = HitZone::Torso; }
          continue;
        }
        float th = segHitsSphere(prev, seg, hitHead(b), 0.28f * b.scale);
        if (th >= 0 && th < bestT) { bestT = th; bestB = &b; bestZ = HitZone::Head; }
        float tt = segHitsSphere(prev, seg, hitTorso(b), 0.45f * b.scale);
        if (tt >= 0 && tt < bestT) { bestT = tt; bestB = &b; bestZ = HitZone::Torso; }
        float tl = segHitsSphere(prev, seg, hitLimbs(b), 0.40f * b.scale);
        if (tl >= 0 && tl < bestT) { bestT = tl; bestB = &b; bestZ = HitZone::Limbs; }
      }
      if (bestB) {
        float dmg = p.dmgLeft * zoneMultiplier(bestZ);
        if (bestZ == HitZone::Torso && bestB->armorMM > 0)
          dmg *= (p.penMM >= bestB->armorMM) ? 0.85f : 0.35f;
        hits.push_back({p.shooterId, bestB->id, bestZ, dmg, p.pens > 0, false, prev + (seg - prev) * bestT});
        dead = true; break;
      }
      // --- player capsule (foe shots only) ---
      if (p.foe && playerPos) {
        Vec3 c0 = *playerPos + Vec3(0, playerHeight * 0.5f, 0);
        float tp = segHitsSphere(prev, seg, c0, 0.55f);
        if (tp < 0) {
          Vec3 chead = *playerPos + Vec3(0, playerHeight * 0.92f, 0);
          tp = segHitsSphere(prev, seg, chead, 0.30f);
          if (tp >= 0) p.dmgLeft *= 3.0f;  // headshot
        }
        if (tp >= 0) {
          hits.push_back({p.shooterId, playerId, HitZone::Torso, p.dmgLeft, p.pens > 0, false,
                          prev + (seg - prev) * tp});
          dead = true; break;
        }
      }
    }
    if (dead) p.active = false;
  }
}

}  // namespace ov
