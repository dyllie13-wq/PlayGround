#include "game.hpp"
#include <cmath>

namespace ov {

Game::Game() : bal(256) {
  world.buildDefaultTown();
  playerSpawn.y = World::groundHeight(playerSpawn.x, playerSpawn.z);
  ammoBox.y = World::groundHeight(ammoBox.x, ammoBox.z);
}

void Game::say(const std::string& s) {
  feed.push_back(s);
  if (feed.size() > 40) feed.erase(feed.begin());
}

void Game::toLive() {
  ai.clear();
  vehicles.clear();
  hits_.clear();
  carriedNoises_.clear();
  feed.clear();
  time = 0;
  result = Result::None;
  resultText.clear();
  playerKills = 0;
  mountedVehicle = -1;
  player = Player();
  player.pos = playerSpawn;
  player.yaw = PI;  // face village (north +z? spawn south looking north)
  bal.clear();
  editor.rebuildTriggers();

  // Patrol route from editor waypoints, else default loop.
  std::vector<Vec3> route;
  for (const auto& p : editor.items)
    if (p.kind == PlaceKind::Waypoint)
      route.push_back(Vec3(p.x, World::groundHeight(p.x, p.z), p.z));
  if (route.empty())
    route = {Vec3(-190, 0, -110), Vec3(-70, 0, -40), Vec3(40, 0, 20), Vec3(205, 0, 185)};

  auto spawnGroup = [&](int faction, float x, float z, int n, float spread) {
    for (int i = 0; i < n; ++i) {
      float sx = x + ((i * 37) % 17 - 8) * spread / 8.0f;
      float sz = z + ((i * 53) % 13 - 6) * spread / 8.0f;
      ai.spawn(faction, Vec3(sx, 0, sz), route);
    }
  };

  bool hasVehicles = false;
  // Default OPFOR layout mirrors the visualizer/FOB scenario (always present;
  // editor placements reinforce it).
  spawnGroup(1, 191, 179, 4, 20);
  spawnGroup(1, 50, 6, 3, 16);
  spawnGroup(1, -20, 60, 2, 12);
  spawnGroup(1, 120, 120, 2, 12);
  spawnGroup(2, 40, 20, 2, 30);
  for (const auto& p : editor.items) {
    if (p.kind == PlaceKind::Unit && p.faction == 1) {
      ai.spawn(1, Vec3(p.x, 0, p.z), route);
    } else if (p.kind == PlaceKind::Unit && p.faction == 2) {
      ai.spawn(2, Vec3(p.x, 0, p.z), route);
    } else if (p.kind == PlaceKind::Vehicle) {
      Vehicle v; v.pos = Vec3(p.x, World::groundHeight(p.x, p.z) + 0.85f, p.z);
      v.faction = p.faction; v.id = (int)vehicles.size(); vehicles.push_back(v);
      hasVehicles = true;
    }
  }
  if (!hasVehicles) {
    Vehicle v;  // player MRAP near spawn
    v.pos = Vec3(playerSpawn.x + 12, World::groundHeight(playerSpawn.x + 12, playerSpawn.z + 8) + 0.85f,
                 playerSpawn.z + 8);
    v.faction = 0; v.id = 0; vehicles.push_back(v);
    Vehicle e;  // OPFOR technical at FOB
    e.pos = Vec3(197, World::groundHeight(197, 193) + 0.85f, 193);
    e.faction = 1; e.id = 1; vehicles.push_back(e);
  }
  // Vehicle hitbodies now handled per-step.

  say("mission live: " + std::to_string(ai.aliveFaction(1)) + " OPFOR active. Take OBJ Hammer.");
  mode = Mode::Live;
}

void Game::toEditor() { mode = Mode::Editor; }

void Game::explodeVehicle(size_t idx) {
  Vehicle& v = vehicles[idx];
  say("destroyed: " + std::string(v.faction == 0 ? "BLUFOR" : "OPFOR") +
      " vehicle #" + std::to_string(v.id));
  for (auto& a : ai.agents) {  // cook-off splash
    if (!a.alive) continue;
    if (a.pos.dist(v.pos) < 7.0f) {
      a.damage(65.0f);
      if (!a.alive) say("kill: OPFOR #" + std::to_string(a.id) + " (cook-off)");
    }
  }
  if (mountedVehicle == (int)idx) {
    mountedVehicle = -1;
    player.pos = v.pos + Vec3(3, 0, 0);
    player.pos.y = World::groundHeight(player.pos.x, player.pos.z);
    player.damage(25.0f);
  }
}

void Game::applyHits() {
  for (const auto& h : hits_) {
    if (h.targetId == -1) continue;  // ground / stopped by cover
    if (h.targetId == -100) {        // the player
      float dmg = h.damage;
      if (mountedVehicle >= 0) {     // hull absorbs most
        vehicles[mountedVehicle].damage(dmg * 1.5f);
        if (!vehicles[mountedVehicle].alive) explodeVehicle(mountedVehicle);
        dmg *= 0.2f;
      }
      bool was = player.alive;
      player.damage(dmg);
      if (was && !player.alive) say("KIA: player down");
      continue;
    }
    if (h.targetId >= 1000) {  // vehicle
      size_t idx = (size_t)(h.targetId - 1000);
      if (idx < vehicles.size() && vehicles[idx].alive) {
        bool was = vehicles[idx].alive;
        vehicles[idx].damage(h.damage);
        if (was && !vehicles[idx].alive) explodeVehicle(idx);
      }
      continue;
    }
    for (auto& a : ai.agents) {
      if (a.id != h.targetId || !a.alive) continue;
      bool was = a.alive;
      a.damage(h.damage);
      if (was && !a.alive) {
        const char* zn = h.zone == HitZone::Head ? "HEADSHOT" : "kill";
        say(std::string(zn) + ": " +
            (a.faction == 1 ? "OPFOR" : (a.faction == 0 ? "BLUFOR" : "CIV")) +
            " #" + std::to_string(a.id));
        if (a.faction == 1 && h.shooterId == -100) playerKills++;
      }
    }
  }
}

void Game::step(float dt, const PlayerDriveInput& in) {
  if (mode != Mode::Live) return;
  time += dt;

  // --- enter/exit vehicle ---
  if (in.wantEnterExit) {
    if (mountedVehicle >= 0) {
      mountedVehicle = -1;
      player.pos = player.pos + Vec3(3, 0, 0);
      player.pos.y = World::groundHeight(player.pos.x, player.pos.z);
    } else {
      for (size_t i = 0; i < vehicles.size(); ++i) {
        if (!vehicles[i].alive || vehicles[i].faction != 0) continue;
        Vec3 d = vehicles[i].pos - player.pos; d.y = 0;
        if (d.len() < 5.0f) { mountedVehicle = (int)i; break; }
      }
    }
  }

  std::vector<NoiseEvent> stepNoises = carriedNoises_;

  if (mountedVehicle >= 0) {
    vehicles[mountedVehicle].update(in.inVehicle, world);
    player.pos = vehicles[mountedVehicle].pos;
    player.pos.y = World::groundHeight(player.pos.x, player.pos.z);
    player.vel = Vec3(0, 0, 0);
    player.yaw -= in.onFoot.lookDx;
    player.pitch = clampf(player.pitch - in.onFoot.lookDy, deg2rad(-85), deg2rad(85));
  } else {
    player.update(in.onFoot, world, bal, stepNoises, seed);
  }
  player.resupplyIfNear(ammoBox, 5.0f);

  for (size_t i = 0; i < vehicles.size(); ++i) {
    if ((int)i == mountedVehicle) continue;
    VehicleInput idle; idle.dt = dt;
    vehicles[i].update(idle, world);
  }

  // --- hit bodies: agents + vehicles (+ mounted player hull) ---
  bodies_.clear();
  for (const auto& a : ai.agents) {
    if (a.alive) bodies_.push_back(a.toHitBody());
  }
  for (size_t i = 0; i < vehicles.size(); ++i) {
    if (!vehicles[i].alive) continue;
    HitBody b;
    b.id = 1000 + (int)i;
    b.faction = vehicles[i].faction;
    b.alive = true;
    b.feet = vehicles[i].pos;
    b.vehicleR = 2.6f; b.vehicleH = 1.0f;
    b.armorMM = 8.0f;
    bodies_.push_back(b);
  }

  const Vec3* ppos = nullptr;
  float pheight = 1.7f;
  HitBody playerHull;
  if (mountedVehicle >= 0) {
    playerHull.id = -100; playerHull.faction = 0; playerHull.alive = player.alive;
    playerHull.feet = vehicles[mountedVehicle].pos;
    playerHull.vehicleR = 2.4f; playerHull.vehicleH = 1.0f;
    bodies_.push_back(playerHull);
  } else if (player.alive) {
    ppos = &player.pos; pheight = player.eyeHeight();
  }

  hits_.clear();
  shots_.clear();
  bal.step(dt, world, bodies_, ppos, pheight, -100, hits_, shots_);
  applyHits();

  size_t mark = stepNoises.size();
  ai.update(dt, time, world, player, bal, stepNoises, hits_, feed, seed);
  carriedNoises_.assign(stepNoises.begin() + mark, stepNoises.end());

  // --- triggers ---
  std::vector<std::string> fired;
  editor.checkTriggers(player.pos, fired);
  for (const auto& f : fired) say("trigger: \"" + f + "\" condition [this] TRUE -> onAct exec");
  if (!objective.fired) {
    float dx = player.pos.x - objective.x, dz = player.pos.z - objective.z;
    if (dx * dx + dz * dz < objective.r * objective.r && player.alive) {
      objective.fired = true;
      result = Result::Victory;
      resultText = "OBJ Hammer captured at T+" + std::to_string((int)time) + "s";
      say("VICTORY: " + resultText);
      mode = Mode::Over;
      return;
    }
  }

  if (ai.aliveFaction(1) == 0) {
    result = Result::Victory;
    resultText = "all OPFOR eliminated at T+" + std::to_string((int)time) + "s";
    say("VICTORY: " + resultText);
    mode = Mode::Over;
    return;
  }
  if (!player.alive) {
    result = Result::Defeat;
    resultText = "player KIA at T+" + std::to_string((int)time) + "s";
    say("DEFEAT: " + resultText);
    mode = Mode::Over;
  }
}

}  // namespace ov
