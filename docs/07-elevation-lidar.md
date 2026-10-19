# Elevation and lidar (future)

v1 is flat (`heightAt = 0`, D9). The world model is already 3D ([02-architecture](02-architecture.md)), so terrain is a new `Terrain` implementation, not a rewrite.

## Sources

| Source | Product | Resolution | Good for |
|---|---|---|---|
| USGS 3DEP | 1 m DEM (bare earth), and raw point clouds (LAZ) | 1 m; points QL2 ≈ 2 pts/m², QL1 ≈ 8 pts/m² | Fairway undulation, green tiers, bunker depth (approximate) |
| State programs (e.g. MassGIS) | Often 3DEP-derived or newer flights | Varies | Check per state; sometimes newer or denser |
| SRTM / Copernicus DEM | Global DEM | 30 m | Only "this hole plays uphill"; useless for greens |

1 m bare-earth DEMs capture green tiers and big breaks, but not subtle 1–2% putting slopes. For realistic greens, build a DTM at ~0.5 m from QL1 points where available, and accept it's still smoother than reality.

## Two models from one point cloud

- **DTM (bare earth):** ground-classified returns → `heightAt`. This is the playing surface.
- **DSM − DTM = canopy height model:** real tree heights. Replaces the 15 m default in tree option B ([05-gameplay](05-gameplay.md)) and can even produce tree footprints where OSM has none.

## Pipeline (Python, offline)

1. Find 3DEP tiles covering the hole bbox (USGS TNM API, or Planetary Computer / AWS for COGs and EPT point clouds).
2. PDAL: crop to bbox → ground classification (already present in most 3DEP LAZ) → rasterize to a DTM at 0.5–1 m; separately, first returns → DSM.
3. Reproject into the hole's local frame (meters, origin at the green centroid).
4. Light smoothing (lidar noise reads as bumpy greens).
5. Export: Float32 binary grid + small JSON header (origin, cell size, dims), or a 16-bit PNG with scale/offset. Commit next to `course.json`.

## Runtime

- `HeightmapTerrain.heightAt(x, y)`: bilinear interpolation; `normalAt` from central differences.
- **Physics:** roll gets a gravity term along the slope; landing uses the terrain height instead of z = 0; flight checks for hitting rising ground.
- **Putting:** curved putts arrive for free once roll uses slope. Add a grid or arrow overlay on the green to show slope, since a top-down photo hides it.
- **Rendering:** subdivided ground plane displaced by the heightmap; the photo texture stays the same. Enables the perspective chase cam. In top-down view, add hillshade to the class-render view.
