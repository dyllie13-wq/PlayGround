# Call to Defense — Asset Attribution

All third-party assets were sourced with the project's skills and keep their
licence sidecars next to each file (`public/models/*.attribution.json`).

## 3D models (Sketchfab, via `load-sketchfab-threejs` skill)

| File | Model | Author | Licence |
|------|-------|--------|---------|
| `public/models/tank.glb` | Low Poly Tank | Kolos Studios | CC Attribution |
| `public/models/ifv.glb` | Low Poly Lazar 3 Multipurpose Fighting Vehicle | Polyte | CC Attribution |
| `public/models/drone.glb` | UAV Gerbera [Low-Poly] | Vlarder1 | CC Attribution |
| `public/models/shorad.glb` | Low poly Flakpanzer Gepard | SIpriv | CC Attribution |
| `public/models/sam.glb` | Lowpoly S300 | SIpriv | CC Attribution |
| `public/models/soldier.glb` | A.B.C. Soldier (low poly) | Götz von Berlichingen | CC Attribution |

Every model was GLB-inspected (`inspect_glb.mjs`): no archived
`KHR_materials_pbrSpecularGlossiness`, no malformed unlit materials, no Draco/Meshopt
decoders required — so no normalization pass was needed. The S300 contributes a
`Deploy` clip and the Gepard a `Radar` clip, both driven through `AnimationMixer`.

Source search contact sheets: `/tmp/sk-tank.png`, `/tmp/sk-drone.png`,
`/tmp/sk-apc.png`, `/tmp/sk-sam2.png` (visual ranking aids, not shipped).

## Imagery & textures (via `image-search` skill, DuckDuckGo)

- `public/textures/earth.jpg` — NASA SVS equirectangular Earth ("LARGEST" still),
  public domain. Used as the campaign-globe texture.
- Image-search skill (DuckDuckGo) was used to research "earth equirectangular map
  texture" (selected the NASA result above), "military camouflage seamless ground
  texture" (surveyed, not shipped — battlefield ground is procedural), and
  "modern main battle tank side view" (4 reference photos downloaded to
  `assets/reference/` for visual research, then **removed from the game** because
  they carried stock-photo watermarks). Main-menu backdrop is pure CSS.
  Search manifests: `/tmp/asset-img/*.json`.
- Battlefield ground, building façades, NATO markers and sprites are 100% procedural
  canvas textures generated at runtime — no external licence burden.

## Audio

All sound effects are synthesized at runtime with the Web Audio API (`src/audio.js`).
No audio files ship with the game.
