#pragma once
// Wheeled vehicle: 4-point raycast-style suspension telemetry, spring-damper
// body, weight transfer, pacejka-lite tireitants, arcade drivetrain.
#include "math.hpp"
#include "world.hpp"

namespace ov {

struct VehicleInput {
  float throttle = 0;  // -1..1
  float steer = 0;     // -1..1
  bool brake = false;
  float dt = 0.016f;
};

struct WheelState {
  Vec3 local{0, 0, 0};   // mount offset (x right, z fwd)
  float compression = 0;   // m (0 droop .. travel)
  float compressionV = 0;
  float load = 0;          // N, telemetry + weight transfer
  float spin = 0;
};

class Vehicle {
 public:
  Vehicle();

  Vec3 pos{0, 0, 0};   // body origin (ground-projected)
  float yaw = 0;
  float speed = 0;     // forward m/s
  float steerAng = 0;
  float bodyH = 0;     // smoothed body height offset
  float bodyV = 0;
  float pitch = 0, roll = 0;
  float hp = 500, maxHp = 500;
  bool alive = true;
  int faction = 0;
  int id = 0;
  WheelState wheels[4];

  void update(const VehicleInput& in, const World& world);
  void damage(float dmg);

  float mass() const { return mass_; }
  float suspensionTravel() const { return travel_; }

 private:
  float mass_ = 4200.0f;     // kg (MRAP)
  float springK_ = 42000.0f;   // N/m per corner
  float damperC_ = 5200.0f;    // Ns/m per corner
  float restLen_ = 0.75f;
  float travel_ = 0.45f;
  float engineA_ = 6.5f;       // m/s^2 at full throttle
  float maxSpeed_ = 26.0f;     // ~94 km/h
  float maxRev_ = 7.0f;
};

}  // namespace ov
