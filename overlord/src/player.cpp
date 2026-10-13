#include "player.hpp"
#include <cmath>

namespace ov {

Player::Player() {
  rifle_.muzzleVel = 900.0f;
  rifle_.damage = 34.0f;
  rifle_.penMM = 12.0f;
  rifle_.dragK = 0.00012f;
}

Vec3 Player::aimDir() const {
  return dirFromYawPitch(yaw + recoilY, pitch + recoilP);
}

float Player::moveSpeed() const {
  float base = 5.0f;
  if (stance == Stance::Crouch) base = 2.6f;
  if (stance == Stance::Prone) base = 1.2f;
  return base;
}

float Player::currentSpread() const {
  float speed = vel.len();
  float move = clampf(speed / 7.0f, 0.0f, 1.0f);
  float sway = (0.004f + 0.020f * move + (100.0f - stamina) * 0.00012f) * (1.0f - 0.7f * adsK);
  float crouchBonus = (stance == Stance::Stand) ? 1.0f : 0.7f;
  return (0.006f + sway) * crouchBonus + bloom;
}

void Player::damage(float dmg) {
  if (!alive) return;
  hp -= dmg;
  if (hp <= 0) { hp = 0; alive = false; }
}

void Player::resupplyIfNear(const Vec3& boxPos, float radius) {
  Vec3 d = pos - boxPos; d.y = 0;
  if (d.len() < radius) { ammo = 30; mags = 6; }
}

void Player::update(const PlayerInput& in, const World& world, Ballistics& bal,
                    std::vector<NoiseEvent>& noises, uint32_t& seed) {
  float dt = in.dt;
  if (!alive) return;

  yaw -= in.lookDx;
  pitch = clampf(pitch - in.lookDy, deg2rad(-85), deg2rad(85));

  if (in.toggleCrouch) stance = (stance == Stance::Crouch) ? Stance::Stand : Stance::Crouch;
  if (in.toggleProne) stance = (stance == Stance::Prone) ? Stance::Stand : Stance::Prone;

  float targetEye = stance == Stance::Stand ? 1.7f : (stance == Stance::Crouch ? 1.1f : 0.5f);
  eyeH = lerpf(eyeH, targetEye, clampf(dt * 8.0f, 0, 1));

  bool wantSprint = in.sprint && stance == Stance::Stand && in.moveFwd > 0.1f && stamina > 1.0f && !in.ads;
  float top = wantSprint ? 7.5f : moveSpeed();
  if (wantSprint) stamina = std::max(0.0f, stamina - 12.0f * dt);
  else stamina = std::min(100.0f, stamina + (in.moveFwd != 0 || in.moveSide != 0 ? 5.0f : 9.0f) * dt);

  // Wish direction in world space (yaw only).
  Vec3 fwd = dirFromYawPitch(yaw, 0), side = Vec3(-fwd.z, 0, fwd.x);
  Vec3 wish = (fwd * in.moveFwd + side * in.moveSide);
  if (wish.len() > 1) wish = wish.norm();
  Vec3 target = wish * top;
  float accel = 10.0f;  // inertia: exponential approach
  vel += (target - vel) * clampf(accel * dt, 0, 1);

  pos.x += vel.x * dt; pos.z += vel.z * dt;
  float g = World::groundHeight(pos.x, pos.z);
  pos.y = g;  // infantry glued to terrain (no jumping in tactical sim)

  // ADS blend, sway clock, recoil recovery, bloom decay.
  adsK = lerpf(adsK, in.ads ? 1.0f : 0.0f, clampf(dt * 10.0f, 0, 1));
  swayT += dt * (1.0f + vel.len() * 0.6f);
  recoilP = lerpf(recoilP, 0, clampf(dt * 7.0f, 0, 1));
  recoilY = lerpf(recoilY, 0, clampf(dt * 7.0f, 0, 1));
  bloom = std::max(0.0f, bloom - dt * 0.012f);

  if (fireCd > 0) fireCd -= dt;
  if (reloadT > 0) {
    reloadT -= dt;
    if (reloadT <= 0 && mags > 0) { mags--; ammo = 30; }
  } else if (in.reload && ammo < 30 && mags > 0) {
    reloadT = 2.2f;
  }

  if (in.fire && fireCd <= 0 && reloadT <= 0 && ammo > 0) {
    fireCd = 0.1f;  // 600 RPM
    ammo--; shotsFired++;
    Vec3 muzzle = eyePos() + aimDir() * 0.7f - Vec3(0, 0.12f, 0);
    bal.fire(muzzle, aimDir(), rifle_, /*shooterId=*/-100, /*fac=*/0,
             /*foe=*/false, currentSpread(), ++seed);
    noises.push_back({pos, 180.0f});
    // Recoil pattern: mostly vertical with slight random walk.
    recoilP += deg2rad(0.32f) * (1.0f - 0.45f * adsK);
    seed = seed * 1664525u + 1013904223u;
    recoilY += deg2rad(((seed & 0xff) / 255.0f - 0.5f) * 0.14f);
    bloom = std::min(0.02f, bloom + 0.0022f);
  }
}

}  // namespace ov
