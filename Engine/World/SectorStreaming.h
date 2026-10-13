// SectorStreaming.h — Alt Life GTA-style sector streamer (C++17, no deps).
// World tiled into 128 m sectors grouped in 512 m super-tiles (SDF/GI/wind).
// Ring priorities around camera + predicted velocity; budgeted uploads/frame.
#pragma once
#include <cstdint>
#include <cmath>

namespace altlife {

constexpr float kSectorSize = 128.0f;
constexpr float kInnerRing = 256.0f;  // LOD0 + full AI + full physics
constexpr float kMidRing = 800.0f;    // LOD1 + imposters + spline traffic
constexpr float kOuterRing = 2500.0f; // LOD2 + skyline only

enum class SectorLOD : uint8_t { Coarse = 0, Mid = 1, Hero = 2 };

struct SectorRequest {
    int32_t sx = 0, sz = 0; // sector coords
    SectorLOD lod = SectorLOD::Coarse;
    float priority = 0.0f; // higher = stream first
};

// Sector coords from world position.
inline void WorldToSector(float x, float z, int32_t& sx, int32_t& sz) {
    sx = (int32_t)floorf(x / kSectorSize);
    sz = (int32_t)floorf(z / kSectorSize);
}

// Priority: inner ring first, boosted along velocity (3 s prefetch).
// Game thread computes; streaming threads consume in priority order.
inline SectorRequest ClassifySector(int32_t sx, int32_t sz,
                                    float camX, float camZ,
                                    float velX, float velZ) {
    float cx = (sx + 0.5f) * kSectorSize;
    float cz = (sz + 0.5f) * kSectorSize;
    // Predictive prefetch point: p + v * 3 s.
    float px = camX + velX * 3.0f, pz = camZ + velZ * 3.0f;
    float dx = cx - px, dz = cz - pz;
    float dist = sqrtf(dx * dx + dz * dz);
    SectorRequest r{sx, sz, SectorLOD::Coarse, 0.0f};
    if (dist < kInnerRing) r.lod = SectorLOD::Hero;
    else if (dist < kMidRing) r.lod = SectorLOD::Mid;
    // Priority falls with distance; hero ring dominates.
    r.priority = (kOuterRing - dist) + (r.lod == SectorLOD::Hero ? 5000.0f : 0.0f);
    if (dist > kOuterRing) r.priority = -1.0f; // out of range: evict candidate
    return r;
}

} // namespace altlife
