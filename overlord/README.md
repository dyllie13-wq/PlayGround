# Project Overlord — headless runtime (C++17, zero dependencies)

Compilable, executable game loop: fixed 60 Hz tick, player controller, physical
ballistics, wheeled-vehicle physics, AI FSM, editor placements, win/lose logic.

## Layout

| File | System |
|---|---|
| `src/math.hpp` | Vec3, segment-vs-AABB/sphere primitives |
| `src/world.{hpp,cpp}` | Island heightfield, occluder/penetration solids, LOS |
| `src/player.{hpp,cpp}` | Stances, inertia, stamina, ADS, sway, recoil/bloom, reload |
| `src/ballistics.{hpp,cpp}` | Drag/gravity projectiles, head/torso/limb zones, penetration |
| `src/vehicle.{hpp,cpp}` | 4-point suspension, spring-damper body, weight transfer, grip |
| `src/ai.{hpp,cpp}` | Patrol / Engage / Cover / Suppress + vision + hearing |
| `src/editor.{hpp,cpp}` | Placements, trigger volumes, mission (de)serialization |
| `src/game.{hpp,cpp}` | EDITOR → LIVE → OVER loop, damage routing, objectives |
| `src/main.cpp` | `--simtest` checks, `--demo` scripted battle |

## Build & run

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j4
./build/overlord --simtest   # 12 deterministic checks, exit 0 on pass
./build/overlord --demo      # scripted 1v12 battle with feed output
ctest --test-dir build       # same simtest via CTest
```

## Render/input binding notes (for engine integrators)

- `Game::step(1/60, input)` is the whole frame: feed it `PlayerDriveInput`
  from SDL/GLFW/Godot input and read `Game::feed` for killfeed/triggers.
- Ballistics constants (`ProjCfg`: 900 m/s, dragK 0.00012, 34 dmg, 12 mm pen)
  match the web visualizer's tracer solver.
- AI eye heights assume ~1.7 m standing infantry; vehicle hull hits use id ≥ 1000.
