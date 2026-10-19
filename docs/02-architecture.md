# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language/build | TypeScript + Vite | Geometry and physics bugs are silent; types help. Vite is near-zero config. |
| Renderer | Three.js, orthographic camera looking straight down | Looks 2D on day one. Going 3D means swapping the camera and displacing the ground mesh. No game-engine opinions to fight. |
| Physics | Hand-written | The simple shot model is ~100 lines. Rapier/cannon-es only pay off with 3D mesh collisions. |
| Vector pipeline | TypeScript (osmtogeojson, turf.js, proj4) | The same code runs offline **and** at runtime, which the future "add a hole from a park" feature needs. |
| Raster pipeline (later) | Python (rasterio, PDAL, numpy) | NAIP segmentation and lidar → heightmap. Writes plain files the TS side reads. |

### Renderer decision note

MapLibre was the alternative. Its main advantage is streaming and stitching map tiles for free, which only matters when panning a large area. One hole fits in a ~400 × 200 m box: at zoom 19 (~0.3 m/px at Brookline's latitude, ~56 m per tile) that's about 30–40 tiles at roughly 20–30 KB each, around 1 MB per hole. Stitching that into one texture ourselves is a small job, so Three.js wins on game feel and the 3D path. Revisit if we ever want a free-roam map view.

## Coordinate frame

Each hole gets a **local tangent frame** in meters:

- Origin: the green's centroid (pin area). +x = east, +y = north, +z = up.
- Conversion: equirectangular around the origin. `x = (lon − lon0) · 111320 · cos(lat0)`, `y = (lat − lat0) · 110540`. Over a few hundred meters the error is far below anything a player could notice.
- **Not Web Mercator.** Mercator stretches distances by 1/cos(lat), about 35% at Brookline (42.3°N), which would make yardages wrong.

Imagery tiles arrive in Web Mercator. Over one hole, Mercator → local is effectively a single affine transform. Stitch the tiles into a canvas, then place that canvas as a texture on a ground quad whose corners are the tile bbox corners converted to local meters.

## World model (3D-ready)

```
World
├─ terrain: { heightAt(x, y): number, normalAt(x, y): Vec3 }   // v1: 0 and (0,0,1)
├─ surfaces: { classAt(x, y): SurfaceClass }                   // from OSM polygons
├─ obstacles: { trees: Canopy[] }                              // footprint + height
├─ hole: { tee: Vec2, pin: Vec2, par: number, routing: Vec2[] }
└─ ball: { pos: Vec3, vel: Vec3, state: 'rest' | 'flight' | 'roll' | 'holed' }
```

- All physics works in 3D (`Vec3`), even on flat ground. The ball has height in flight, which is what lets trees block shots.
- `heightAt` is an interface. v1 uses `FlatTerrain`; later `HeightmapTerrain` reads a lidar-derived grid. Physics and rendering never know which one they have.
- `classAt` rasterizes OSM polygons into a lookup grid (e.g. 0.25 m cells) at load time, so the per-frame lookup is O(1).

## Renderers

Two views share one scene graph and differ only in the ground material:

1. **Photo view:** stitched Esri texture on the ground. Optional semi-transparent class overlay for debugging.
2. **Class render view:** ground drawn from the surface classes: flat colors to start, procedural textures later (stripes on fairway, sand grain on bunkers, water shader).

Ball, shot preview arc, aim line and pin are shared overlay objects. The UI (club picker, power meter, scorecard) is an HTML overlay, not drawn in WebGL.

**3D later:** swap `OrthographicCamera` for `PerspectiveCamera` (chase cam behind the ball) and replace the ground quad with a subdivided plane displaced by `heightAt`. The textures stay the same.

## Data flow

```
offline (TS script)                        runtime (browser)
──────────────────                         ─────────────────
Overpass query ─► OSM JSON                 load course.json
  ─► osmtogeojson ─► GeoJSON               fetch Esri tiles for hole bbox (live)
  ─► project to local frame                stitch ─► ground texture
  ─► classify + clip to hole corridor      rasterize classes ─► classAt grid
  ─► course.json (committed)               game loop
```

`course.json` holds polygons in local meters, the hole routing, tee, pin, par, local bounds (converted back to lat/lon via the origin for tile fetching), and the OSM attribution and timestamp. Schema: [04-course-model](04-course-model.md#coursejson).
