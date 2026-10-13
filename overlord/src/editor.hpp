#pragma once
// In-game 3D mission editor data: placements, triggers, (de)serialization.
#include <string>
#include <vector>
#include "math.hpp"

namespace ov {

enum class PlaceKind : int { Unit = 0, Vehicle = 1, Object = 2, Trigger = 3, Waypoint = 4, Marker = 5 };

struct Placement {
  PlaceKind kind = PlaceKind::Unit;
  int faction = 1;
  float x = 0, z = 0;
  std::string label;
};

struct Trigger {
  float x = 0, z = 0, r = 50;
  std::string label;
  bool fired = false;
};

class Editor {
 public:
  std::vector<Placement> items;
  std::vector<Trigger> triggers;

  void add(PlaceKind kind, int faction, float x, float z, const std::string& label = "");
  void clear();
  void rebuildTriggers();  // derive trigger list from placements
  // Returns newly fired trigger labels this step.
  void checkTriggers(const Vec3& bluforPos, std::vector<std::string>& fired);

  std::string serialize() const;
  bool deserialize(const std::string& s);
};

}  // namespace ov
