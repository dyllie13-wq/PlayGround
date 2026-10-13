#include "editor.hpp"
#include <sstream>

namespace ov {

void Editor::add(PlaceKind kind, int faction, float x, float z, const std::string& label) {
  items.push_back({kind, faction, x, z, label});
  if (kind == PlaceKind::Trigger) triggers.push_back({x, z, 50.0f, label.empty() ? "Trigger" : label, false});
}

void Editor::clear() { items.clear(); triggers.clear(); }

void Editor::rebuildTriggers() {
  triggers.clear();
  for (const auto& p : items)
    if (p.kind == PlaceKind::Trigger)
      triggers.push_back({p.x, p.z, 50.0f, p.label.empty() ? "Trigger" : p.label, false});
}

void Editor::checkTriggers(const Vec3& bluforPos, std::vector<std::string>& fired) {
  for (auto& t : triggers) {
    if (t.fired) continue;
    float dx = bluforPos.x - t.x, dz = bluforPos.z - t.z;
    if (dx * dx + dz * dz < t.r * t.r) {
      t.fired = true;
      fired.push_back(t.label);
    }
  }
}

std::string Editor::serialize() const {
  std::ostringstream o;
  o << "overlord-mission-v1\n";
  for (const auto& p : items)
    o << (int)p.kind << ' ' << p.faction << ' ' << p.x << ' ' << p.z << ' ' << p.label << '\n';
  return o.str();
}

bool Editor::deserialize(const std::string& s) {
  clear();
  std::istringstream in(s);
  std::string line;
  if (!std::getline(in, line) || line != "overlord-mission-v1") return false;
  int k, f; float x, z; std::string label;
  while (in >> k >> f >> x >> z) {
    std::getline(in, label);
    if (!label.empty() && label[0] == ' ') label.erase(0, 1);
    add((PlaceKind)k, f, x, z, label);
  }
  return true;
}

}  // namespace ov
