// Project Overlord - headless executable. --simtest runs deterministic system
// checks (player/ballistics/vehicle/AI/editor/loop). --demo plays a scripted
// battle and prints the feed. No external dependencies.
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>
#include "math.hpp"
#include "world.hpp"
#include "player.hpp"
#include "ballistics.hpp"
#include "vehicle.hpp"
#include "ai.hpp"
#include "editor.hpp"
#include "game.hpp"

using namespace ov;

static int failures = 0;
static void check(bool ok, const char* name, const std::string& detail = "") {
  std::printf("[%s] %s %s\n", ok ? "PASS" : "FAIL", name, detail.c_str());
  if (!ok) failures++;
}

static float flatGround(float x0, float x1, float z, float& maxG) {
  maxG = -1e9f;
  for (int i = 0; i <= 10; ++i) {
    float g = World::groundHeight(x0 + (x1 - x0) * i / 10.0f, z);
    if (g > maxG) maxG = g;
  }
  return maxG;
}

static int runSimTest() {
  // ---- T1: projectile drop + drag ----
  {
    World w; Ballistics b; std::vector<HitBody> bodies; std::vector<HitEvent> hits; std::vector<ShotReport> shots;
    ProjCfg cfg;
    b.fire(Vec3(0, 60, 0), Vec3(1, 0, 0), cfg, 7, 0, false, 0, 1);
    for (int i = 0; i < 30; ++i) b.step(1/60.0f, w, bodies, nullptr, 0, -100, hits, shots);
    Vec3 p, v;
    bool live = b.liveState(p, v);
    char buf[128];
    std::snprintf(buf, sizeof buf, "y=%.2f x=%.1f speed=%.1f", p.y, p.x, v.len());
    check(live && p.y > 58.0f && p.y < 59.5f && p.x < 450.0f && p.x > 380.0f && v.len() < 900.0f,
          "ballistics.drop+drag", buf);
  }
  // ---- T2: head-zone hit ----
  {
    World w; Ballistics b; std::vector<HitEvent> hits; std::vector<ShotReport> shots;
    float maxG; flatGround(0, 20, 0, maxG);
    std::vector<HitBody> bodies;
    HitBody tgt; tgt.id = 3; tgt.faction = 1; tgt.alive = true; tgt.feet = Vec3(20, maxG + 0.01f, 0);
    bodies.push_back(tgt);
    Vec3 muzzle(0, maxG + 0.01f + 1.55f, 0);
    Vec3 head = hitHead(tgt);
    ProjCfg cfg; cfg.damage = 34;
    b.fire(muzzle, (head - muzzle).norm(), cfg, 9, 0, false, 0, 2);
    for (int i = 0; i < 120 && hits.empty(); ++i) b.step(1/60.0f, w, bodies, nullptr, 0, -100, hits, shots);
    bool ok = hits.size() == 1 && hits[0].zone == HitZone::Head &&
              std::fabs(hits[0].damage - 102.0f) < 1.0f;
    check(ok, "ballistics.headshot3x",
          hits.empty() ? "no hit" : ("dmg=" + std::to_string(hits[0].damage)));
  }
  // ---- T3: penetration (wood passes weakened, concrete stops) ----
  {
    auto shotThru = [&](Material m, float thick) {
      World w; Ballistics b; std::vector<HitEvent> hits; std::vector<ShotReport> shots;
      float maxG; flatGround(0, 20, 0, maxG);
      float mid = 10.0f;
      w.addSolid({{mid - thick/2, maxG - 2, -5}, {mid + thick/2, maxG + 5, 5}}, m);
      std::vector<HitBody> bodies;
      HitBody tgt; tgt.id = 3; tgt.faction = 1; tgt.alive = true; tgt.feet = Vec3(20, maxG + 0.01f, 0);
      bodies.push_back(tgt);
      Vec3 muzzle(0, maxG + 0.01f + 1.0f, 0);
      Vec3 torso = hitTorso(tgt);
      ProjCfg cfg; cfg.damage = 34; cfg.penMM = 12;
      b.fire(muzzle, (torso - muzzle).norm(), cfg, 9, 0, false, 0, 3);
      for (int i = 0; i < 120 && hits.empty(); ++i) b.step(1/60.0f, w, bodies, nullptr, 0, -100, hits, shots);
      return hits;
    };
    auto wood = shotThru(Material::Wood, 0.2f);
    check(wood.size() == 1 && wood[0].damage > 0 && wood[0].damage < 34 && wood[0].penetrated,
          "ballistics.pen-wood", wood.empty() ? "no hit" : ("dmg=" + std::to_string(wood[0].damage)));
    auto conc = shotThru(Material::Concrete, 1.0f);
    bool stopped = conc.empty() || conc[0].damage == 0;
    check(stopped, "ballistics.stop-concrete",
          conc.empty() ? "no hit" : ("dmg=" + std::to_string(conc[0].damage)));
  }
  // ---- T4: stamina drain + sprint gate ----
  {
    World w; Ballistics b; std::vector<NoiseEvent> n; uint32_t s = 5;
    Player p; p.pos = Vec3(0, World::groundHeight(0, 0), 0);
    PlayerInput in; in.moveFwd = 1; in.sprint = true;
    for (int i = 0; i < 600; ++i) { in.dt = 1/60.0f; p.update(in, w, b, n, s); }
    check(p.stamina < 5.0f && p.pos.dist(Vec3(0, p.pos.y, 0)) > 40.0f,
          "player.stamina", "stam=" + std::to_string(p.stamina));
  }
  // ---- T5: recoil kick + recovery ----
  {
    World w; Ballistics b; std::vector<NoiseEvent> n; uint32_t s = 9;
    Player p; p.pos = Vec3(0, World::groundHeight(0, 0), 0);
    PlayerInput in; in.fire = true;
    for (int i = 0; i < 40; ++i) { in.dt = 1/60.0f; p.update(in, w, b, n, s); }
    float kicked = p.recoilP;
    in.fire = false;
    for (int i = 0; i < 90; ++i) { in.dt = 1/60.0f; p.update(in, w, b, n, s); }
    check(p.ammo < 30 && p.ammo >= 20 && kicked > 0.001f && p.recoilP < kicked,
          "player.recoil", "ammo=" + std::to_string(p.ammo) +
          " kick=" + std::to_string(kicked) + " rest=" + std::to_string(p.recoilP));
  }
  // ---- T6: suspension settle + load sum ----
  {
    World w; Vehicle v;
    float g = World::groundHeight(0, 0);
    v.pos = Vec3(0, g + 0.85f + 2.0f, 0);
    VehicleInput in; in.dt = 1/60.0f;
    for (int i = 0; i < 180; ++i) v.update(in, w);
    float sum = 0;
    for (auto& wh : v.wheels) sum += wh.load;
    float target = v.mass() * GRAV;
    char buf[128];
    std::snprintf(buf, sizeof buf, "dy=%.3f load=%.0f vs %.0f", v.pos.y - (g + 0.85f), sum, target);
    check(std::fabs(v.pos.y - (g + 0.85f)) < 0.2f && std::fabs(sum - target) / target < 0.25f,
          "vehicle.suspension", buf);
  }
  // ---- T7: AI hearing -> engage ----
  {
    World w; w.clearSolids(); Ballistics b; AISystem ai;
    Player p; p.pos = Vec3(0, 0, 0);
    ai.spawn(1, Vec3(0, 0, 0), {});
    std::vector<NoiseEvent> noises = {{Vec3(100, 0, 0), 180.0f}};
    std::vector<HitEvent> hits; std::vector<std::string> feed; uint32_t s = 1;
    for (int i = 0; i < 120; ++i) ai.update(1/60.0f, i/60.0f, w, p, b, noises, hits, feed, s);
    check(ai.agents[0].state == AiState::Engage, "ai.hearing",
          "state=" + std::to_string((int)ai.agents[0].state));
  }
  // ---- T8: LOS blocked holds patrol, open ground engages ----
  {
    World w; Ballistics b; AISystem ai; Player p;
    float g1 = World::groundHeight(0, 0), g2 = World::groundHeight(100, 0);
    ai.spawn(1, Vec3(0, 0, 0), {});
    ai.agents[0].faceYaw = std::atan2(-100.0f, 0.0f);
    p.pos = Vec3(100, g2, 0);
    float wallG = World::groundHeight(50, 0);
    w.addSolid({{40, wallG - 2, -10}, {60, wallG + 8, 10}}, Material::Concrete);
    std::vector<NoiseEvent> noises; std::vector<HitEvent> hits;
    std::vector<std::string> feed; uint32_t s = 2;
    for (int i = 0; i < 180; ++i) ai.update(1/60.0f, i/60.0f, w, p, b, noises, hits, feed, s);
    bool held = ai.agents[0].state == AiState::Patrol;
    w.clearSolids();
    for (int i = 0; i < 120; ++i) ai.update(1/60.0f, 3 + i/60.0f, w, p, b, noises, hits, feed, s);
    bool engaged = ai.agents[0].state == AiState::Engage;
    (void)g1;
    check(held && engaged, "ai.los",
          std::string("blocked=") + (held ? "patrol" : "FAIL") +
          " open=" + (engaged ? "engage" : "FAIL"));
  }
  // ---- T9: editor trigger ----
  {
    Editor e;
    e.add(PlaceKind::Trigger, 0, 5, 5, "T1");
    std::vector<std::string> fired;
    e.checkTriggers(Vec3(5, 0, 5), fired);
    check(fired.size() == 1 && fired[0] == "T1", "editor.trigger");
    std::string s = e.serialize();
    Editor e2;
    check(e2.deserialize(s) && e2.items.size() == e.items.size(), "editor.serialize");
  }
  // ---- T10: full game loop ticks (player parked far off so this tests the
  // loop itself, not combat lethality) ----
  {
    Game g;
    g.toLive();
    g.player.pos = Vec3(-300, World::groundHeight(-300, -300), -300);
    PlayerDriveInput in;
    for (int i = 0; i < 600; ++i) { in.onFoot.dt = 1/60.0f; in.inVehicle.dt = 1/60.0f; g.step(1/60.0f, in); }
    check(g.mode == Mode::Live && std::fabs(g.time - 10.0f) < 0.01f,
          "game.loop10s", "t=" + std::to_string(g.time));
  }
  std::printf(failures == 0 ? "ALL SIMTESTS PASSED\n" : "%d SIMTEST(S) FAILED\n", failures);
  return failures == 0 ? 0 : 1;
}

static int runDemo() {
  Game g;
  g.editor.add(PlaceKind::Waypoint, 0, -70, -40, "wp1");
  g.editor.add(PlaceKind::Waypoint, 0, 40, 20, "wp2");
  g.editor.add(PlaceKind::Unit, 1, 150, 140, "");
  g.toLive();
  PlayerDriveInput in;
  const float dt = 1/60.0f;
  int steps = 0;
  struct { float blindT = 0; } Bud;
  while (g.mode == Mode::Live && steps < 7200) {
    // Bot: track nearest VISIBLE OPFOR (a player engages what they can see),
    // advance/flank toward the nearest live one otherwise.
    const Agent* vis = nullptr; float vd = 1e9f;
    const Agent* near = nullptr; float nd = 1e9f;
    Vec3 eye0 = g.player.eyePos();
    for (const auto& a : g.ai.agents) {
      if (!a.alive || a.faction != 1) continue;
      float d = a.pos.dist(g.player.pos);
      if (d < nd) { nd = d; near = &a; }
      Vec3 et = a.pos + Vec3(0, 1.55f, 0), tt = a.pos + Vec3(0, 1.0f, 0);
      if ((!g.world.segmentBlocked(eye0, et) || !g.world.segmentBlocked(eye0, tt)) && d < vd) {
        vd = d; vis = &a;
      }
    }
    const Agent* best = vis ? vis : near;
    in = PlayerDriveInput();
    in.onFoot.dt = dt; in.inVehicle.dt = dt;
    in = PlayerDriveInput();
    in.onFoot.dt = dt; in.inVehicle.dt = dt;
    if (best) {
      Vec3 eyeT = best->pos + Vec3(0, 1.55f, 0);   // eye-level: symmetric LOS with AI
      Vec3 torsoT = best->pos + Vec3(0, 1.0f, 0);  // center of mass
      Vec3 eye = g.player.eyePos();
      Vec3 de = eyeT - eye, dt2 = torsoT - eye;
      float dist = de.len();
      g.player.yaw = std::atan2(-dt2.x, -dt2.z);   // aim center of mass
      g.player.pitch = std::asin(dt2.y / dt2.len());
      bool losEye = !g.world.segmentBlocked(eye, eyeT);
      bool losTorso = !g.world.segmentBlocked(eye, torsoT);
      in.onFoot.fire = (losEye || losTorso) && dist < 320.0f;
      if (g.player.ammo == 0 && g.player.reloadT <= 0) in.onFoot.reload = true;
      if (!losEye && !losTorso) { Bud.blindT += dt; } else { Bud.blindT = 0; }
      if (!losEye && !losTorso && Bud.blindT > 2.0f) {
        in.onFoot.moveFwd = 0.6f; in.onFoot.moveSide = 1.0f;  // flank for an angle
      } else {
        in.onFoot.moveFwd = (!losTorso || dist > 200.0f) ? 1.0f : 0.0f;
      }
      if (steps % 60 == 0)
        std::printf("  T+%ds bot los=%d/%d dist=%.0f hp=%.0f ammo=%d opfor=%d liveShots=%d\n",
                    steps / 60, (int)losEye, (int)losTorso, (double)dist, (double)g.player.hp,
                    g.player.ammo, g.aliveOpfor(), g.bal.liveCount());
    } else {
      in.onFoot.moveFwd = 1.0f;
    }
    g.step(dt, in);
    steps++;
  }
  std::printf("=== PROJECT OVERLORD HEADLESS BATTLE ===\n");
  for (const auto& f : g.feed) std::printf("  %s\n", f.c_str());
  std::printf("result=%s (%s) time=%.1fs shots=%g kills=%d opforLeft=%d php=%.0f\n",
              g.result == Result::Victory ? "VICTORY" : "DEFEAT",
              g.resultText.c_str(), g.time, (double)g.player.shotsFired,
              g.playerKills, g.aliveOpfor(), (double)g.player.hp);
  return 0;
}

int main(int argc, char** argv) {
  std::string a = argc > 1 ? argv[1] : "";
  if (a == "--simtest") return runSimTest();
  if (a == "--demo") return runDemo();
  std::printf("Project Overlord 0.1.0 - headless tactical sim\n"
              "  overlord --simtest   run deterministic system checks\n"
              "  overlord --demo      run scripted battle to completion\n");
  return 0;
}
