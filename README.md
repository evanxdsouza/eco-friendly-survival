# Eco Friendly Survival

An interactive 3D web simulation of a disaster-resilient city, built with vanilla
[Three.js](https://threejs.org/) and Vite. Four buildings sit on a shared site
connected by roads, each demonstrating a different resilience strategy through a
live, triggerable simulation.

Everything is rendered physically-based, and every texture is generated
procedurally at load — there are no external image or model assets.

## Run it

```bash
npm install
npm run dev
```

Then open the printed URL (default `http://localhost:5173`).

```bash
npm run build     # production build into dist/
npm run preview   # serve the production build
```

## The four buildings

| Building | Resilience features | Interaction |
| --- | --- | --- |
| **Earthquake-Resistant** | Reinforced frame, shear walls, lead-rubber base isolators, seismic moat, X-bracing | *Simulate Earthquake* — the ground jolts at high frequency while the superstructure sways slowly and out of phase. That phase difference is base isolation. |
| **Flood-Resilient** | Elevated on piers, open undercroft, debris screen, waterproof materials, rainwater harvesting | *Simulate Flood* — the channel rises and spreads, wetting the piers to the waterline and floating debris. The house stays dry and reachable by stair. |
| **Acid-Rain-Resistant** | Steep mono-pitch roof, corrosion-resistant coating, gasket-sealed openings, air-purifying planting | *Simulate Acid Rain* — rain lands, runs down the pitch, is caught by the gutter and drops through the downpipe into the tank. It never pools on the structure. |
| **Vertical Farm Tower** | Stacked planter ledges, rooftop PV array, wind turbine, gravity-fed drip irrigation | *Trigger Growth* — a time-lapse growth cycle; crops scale and deepen in colour while the drip emitters run. The turbine spins continuously. |

## Controls

- **Orbit** drag · **Zoom** scroll · **Pan** right-drag
- Click any building to focus it and run its demo
- Top-left panel: focus each building, trigger each demo, manual flood slider
- **Time of day** scrub — drives sun angle and colour, sky, fog and street lighting
- **Render quality** — Low / Medium / High (auto-detected at boot)

Append `?quality=low` to the URL to force a quality level.

## Rendering approach

- **ACES filmic tone mapping** with image-based lighting, so every surface
  responds to a real sky rather than a flat ambient term
- **Procedural PBR textures** — albedo, normal and roughness maps generated as
  `DataTexture`s at load. Tiling is seamless via 4D noise sampled on a torus
- **Post-processing** — GTAO contact occlusion, bloom, SMAA, and a photographic
  grade pass (vignette, edge chromatic aberration, film grain)
- **Reflective water** via three's `Water`, with a procedurally generated normal map
- **Draw-call discipline** — `MeshBuilder` bakes many small parts into one merged
  mesh per material, so a 60-pane curtain wall costs 2 draw calls; vegetation and
  repeated elements use `InstancedMesh`

### A note on the environment map

The visible sky dome uses three's Preetham `Sky` shader, but the environment map
for lighting is baked from a separate bounded procedural sky. This is deliberate:
running `PMREMGenerator.fromScene()` over the `Sky` shader overflows half-float to
`Infinity` near the sun disc, and PMREM's blur then spreads that as `NaN` across
the mip chain. A single `NaN` texel turns every lit material black — even at
`envMapIntensity: 0`, since `0 * NaN` is still `NaN`.

## Project structure

```
index.html
src/
  main.js            orchestration, boot sequence, interaction wiring, frame loop
  scene.js           renderer / camera / controls bootstrap, site signage
  sky.js             sky dome, sun, IBL bake, time-of-day
  terrain.js         landform, roads, markings, kerbs, footways, water
  textures.js        procedural PBR texture library
  materials.js       shared PBR material library
  parts.js           reusable architectural components + MeshBuilder
  props.js           trees, grass, street furniture, vehicles
  postprocessing.js  EffectComposer pipeline
  ui.js              overlay controls
  cameraTween.js     camera fly-to
  utils.js           label panels, easing, scattering
  buildings/
    earthquakeBuilding.js
    floodBuilding.js
    acidRainBuilding.js
    farmTower.js
```

Each building file is self-contained and commented with its geometry tweak
points at the top.

## Requirements

A WebGL2-capable browser with hardware acceleration. Software rendering
(SwiftShader / llvmpipe) will run correctly but at a very low frame rate — use
the Low quality setting if you have no GPU.
