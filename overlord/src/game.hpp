#pragma once
// Game: executable loop orchestrator. EDITOR (place/spawn) -> LIVE (sim) -> OVER.
#include <string>
#include <vector>
#include "math.hpp"
#include "world.hpp"
#include "player.hpp"
#include "ballistics.hpp"
#include "vehicle.hpp"
#include "ai.hpp"
#include "editor.hpp"

namespace ov {

enum class Mode : int { Editor = 0, Live = 1, Over = 2 };
enum class Result : int { None = 0, Victory = 1, Defeat = 2 };

struct PlayerDriveInput {
  PlayerInput onFoot;
  VehicleInput inVehicle;
  bool wantEnterExit = false;
};

class Game {
 public:
  Game();

  World world;
  Player player;
  Ballistics bal;
  AISystem ai;
  Editor editor;
  std::vector<Vehicle> vehicles;

  Mode mode = Mode::Editor;
  Result result = Result::None;
  std::string resultText;
  float time = 0;
  uint32_t seed = 12345;
  Vec3 playerSpawn{0, 0, -60};
  Vec3 ammoBox{20, 0, -40};
  Trigger objective{40, 20, 50, "OBJ Hammer", false};
  int mountedVehicle = -1;  // -1 on foot
  std::vector<std::string> feed;
  int playerKills = 0;

  void toLive();              // build agents/vehicles from editor + defaults
  void toEditor();            // back to editor (keeps placements)
  void step(float dt, const PlayerDriveInput& in);

  int aliveOpfor() const { return ai.aliveFaction(1); }

 private:
  std::vector<NoiseEvent> carriedNoises_;
  std::vector<HitBody> bodies_;
  std::vector<HitEvent> hits_;
  std::vector<ShotReport> shots_;
  void say(const std::string& s);
  void applyHits();
  void explodeVehicle(size_t idx);
};

}  // namespace ov
