#include "vehicle.hpp"
#include <cmath>

namespace ov {

Vehicle::Vehicle() {
  // FL, FR, RL, RR (x right, z forward), wheelbase ~3.6m, track ~2.0m.
  wheels[0].local = Vec3(-1.0f, 0, 1.8f);
  wheels[1].local = Vec3(1.0f, 0, 1.8f);
  wheels[2].local = Vec3(-1.0f, 0, -1.8f);
  wheels[3].local = Vec3(1.0f, 0, -1.8f);
  for (auto& w : wheels) w.compression = 0.25f;  // ~static deflection
}

void Vehicle::damage(float dmg) {
  if (!alive) return;
  hp -= dmg;
  if (hp <= 0) { hp = 0; alive = false; }
}

void Vehicle::update(const VehicleInput& in, const World& world) {
  (void)world;  // ground sampled via static heightfield
  float dt = in.dt;
  if (!alive) return;

  float cy = std::cos(yaw), sy = std::sin(yaw);
  auto toWorld = [&](const Vec3& l) {
    return Vec3(pos.x + l.x * cy - l.z * sy, 0, pos.z + l.x * sy + l.z * cy);
  };

  // --- 4-point suspension raycasts vs heightfield ---
  float groundAvg = 0;
  float hFL = 0, hFR = 0, hRL = 0, hRR = 0;
  float hs[4];
  for (int i = 0; i < 4; ++i) {
    Vec3 wp = toWorld(wheels[i].local);
    float g = World::groundHeight(wp.x, wp.z);
    hs[i] = g;
    groundAvg += g * 0.25f;
  }
  hFL = hs[0]; hFR = hs[1]; hRL = hs[2]; hRR = hs[3];

  // Body vertical spring toward clearance target (semi-implicit Euler).
  // pos.y IS the body height state; bodyH is telemetry (offset from target).
  float target = groundAvg + 0.85f;
  float F = springK_ * 4.0f * (target - pos.y) - damperC_ * 4.0f * bodyV;
  bodyV += (F / mass_) * dt;
  pos.y += bodyV * dt;
  bodyH = pos.y - target;

  // Per-wheel compression from local ground delta (telemetry + load).
  float loads[4];
  float staticLoad = mass_ * GRAV / 4.0f;
  // Per-wheel compression: rest length minus current extension
  // (mount at body origin, hub ~0.35m above local ground).
  const float staticDefl = mass_ * GRAV / 4.0f / springK_;  // ~0.245m
  for (int i = 0; i < 4; ++i) {
    float len = clampf(restLen_ - ((pos.y - 0.35f) - hs[i]), 0.0f, travel_);
    float prev = wheels[i].compression;
    wheels[i].compressionV = (len - prev) / std::max(dt, 1e-4f);
    wheels[i].compression = len;
    loads[i] = staticLoad + springK_ * (len - staticDefl);
  }

  // --- weight transfer: longitudinal (accel) + lateral (yaw rate) ---
  float prevSpeed = speed;
  float engineF = in.throttle * engineA_ * (in.throttle > 0 ? 1.0f : 0.7f);
  float drag = 0.022f * speed * std::fabs(speed) + 0.35f * speed;
  float rr = 1.1f * (speed >= 0 ? 1 : -1);
  float a = engineF - drag - rr * (in.brake ? 6.0f : 1.0f);
  speed += a * dt;
  if (in.brake) speed = lerpf(speed, 0, clampf(6.0f * dt, 0, 1));
  speed = clampf(speed, -maxRev_, maxSpeed_);
  if (in.throttle == 0 && !in.brake) speed = lerpf(speed, 0, clampf(0.4f * dt, 0, 1));
  float accel = (speed - prevSpeed) / std::max(dt, 1e-4f);

  steerAng = lerpf(steerAng, in.steer * 0.55f, clampf(6.0f * dt, 0, 1));
  float yawRate = steerAng * speed / 4.2f;  // bicycle-ish
  // Tire grip: sand/loose ground slides more.
  float g0 = World::groundHeight(pos.x, pos.z);
  float grip = (g0 < 2.2f) ? 2.2f : 6.0f;
  yaw += yawRate * clampf(grip / 6.0f, 0.35f, 1.0f) * dt;
  if (grip < 6.0f) yaw += yawRate * 0.15f * dt;  // extra slide on sand

  float longT = mass_ * accel * 0.55f / 2.0f;      // N shifted F<->R
  float latT = mass_ * yawRate * std::fabs(speed) * 0.5f / 2.0f;  // L<->R
  loads[0] += -longT * 0.5f - latT * 0.5f;
  loads[1] += -longT * 0.5f + latT * 0.5f;
  loads[2] += longT * 0.5f - latT * 0.5f;
  loads[3] += longT * 0.5f + latT * 0.5f;
  for (int i = 0; i < 4; ++i) wheels[i].load = std::max(0.0f, loads[i]);

  // Body attitude from axle height differences (visual + aim disturbance).
  float tPitch = std::atan2((hRL + hRR) * 0.5f - (hFL + hFR) * 0.5f, 3.6f);
  float tRoll = std::atan2((hFR + hRR) * 0.5f - (hFL + hRL) * 0.5f, 2.0f);
  pitch = lerpf(pitch, tPitch, clampf(5.0f * dt, 0, 1));
  roll = lerpf(roll, tRoll, clampf(5.0f * dt, 0, 1));

  // Integrate position along heading.
  Vec3 hdg = dirFromYawPitch(yaw, 0);
  pos += hdg * (speed * dt);
  for (auto& w : wheels) w.spin += speed * dt / 0.5f;
}

}  // namespace ov
