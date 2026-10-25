# Elevation and lidar

**Status (2026-10-25, D94):** the real disc golf courses stand on real ground, except Skatås (it needs a Lantmäteriet login); see the evaluation at the end. The arcade courses and the range stay flat. The golf mode (v1) is flat (`heightAt = 0`, D9). The world model is already 3D ([02-architecture](02-architecture.md)), so terrain is a new `Terrain` implementation, not a rewrite.

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

## Evaluation for the disc golf courses (2026-10-25)

The sections above are the original golf-era plan. This is what it takes for the nine real disc golf courses today.

### Is there data, and does it matter?

| Course | Source | Resolution | Licence | Relief |
|---|---|---|---|---|
| Kincaid Park (AK) | USGS 3DEP: 5 m Alaska DEM; a lidar point cloud also exists | 5 m (≈1 m from the LAZ) | Public domain | **~67 m** (12×12 sample; includes the low ground at the park's edge) |
| Century Park (Greer SC) | USGS 3DEP 1 m DEM | 1 m | Public domain | **~23 m** |
| Blue Lake (OR) | USGS 3DEP 1/9 arc-second DEM | ~3 m | Public domain | ~10 m |
| Oak Grove Gold (CA) | USGS 3DEP 1 m DEM | 1 m | Public domain | ~4 m (flat) |
| Tali, Julkujärvi (FI) | NLS Finland elevation model 2 m (file download service; free API key) | 2 m | CC BY 4.0 | not sampled; Julkujärvi is in an old sand pit, so likely a lot |
| Skatås (SE) | Lantmäteriet Markhöjdmodell grid 1+ (ordered through Geotorget, then download) | 1 m | Reported as open/CC0; **confirm on Lantmäteriet's page** | not sampled; hilly woods |
| DiscGolfPark Běchovice (CZ) | ČÚZK DMR 5G (ATOM download, LAZ / grid) | ~2 m | ČÚZK open data is CC BY 4.0; **confirm DMR 5G is covered** | not sampled |
| Wiener Prater (AT) | BEV ALS-DGM (Austria-wide, COG tiles, EPSG:3035) | 1 m | CC BY 4.0 | not sampled; the Prater is flat |

US relief comes from 144 `getSamples` points over each course's bounds on the 3DEP ImageServer. Coverage comes from the 3DEP index (1 m layer: Oak Grove and Greer; 1/9″: Blue Lake; 5 m Alaska: Kincaid). Kincaid and Century Park would change the most; Oak Grove and the Prater would barely change.

### Pipeline (offline, no GDAL)

A `npm run course-elevation -- --out <id>` script next to the course builder:

1. **Fetch.** US: one `exportImage` call to the 3DEP ImageServer for the course bounds (F32 GeoTIFF; no auth, no tiles). Europe: download the national tiles covering the bounds (some need a free key or an order, so a cached `--file` input is fine).
2. **Resample into the course frame.** For each cell of a grid over `course.bounds`, local meters → lat/lon (the course origin) → the source CRS (`proj4`: ETRS-TM35FIN, SWEREF 99 TM, S-JTSK or ETRS89/TM33, EPSG:3035) → bilinear sample. GeoTIFFs read with `geotiff` (pure JS).
3. **Clean.** Light smoothing (lidar noise reads as bumps); flatten water to its shoreline height; keep tee pads and greens as mapped.
4. **Write** `public/courses/<id>.height.bin`: Uint16 centimeters above the course minimum (655 m of range), plus `elevation: { cell, cols, rows, min, file }` in the course JSON. A 1 km × 0.7 km course is ~1.4 MB at 1 m, ~350 KB at 2 m (2 m is plenty for fairways; 1 m only near baskets if putting slopes matter).

### Runtime changes

| Area | Change | Size |
|---|---|---|
| Terrain | `HeightmapTerrain` (bilinear `heightAt`, `normalAt` from central differences) in the disc worlds instead of `FlatTerrain`; arcade courses stay flat | Small |
| Flight | Release height, landing and tree bases already use `heightAt`. Add: basket collisions relative to the ground at the basket (they use absolute heights today); a slope term in skid and roll so discs roll away downhill | Small–medium |
| Aim | The meter tick and ghost line follow automatically (they simulate in the same world). Add elevation change to the stats ("plays 12 ft downhill") | Small |
| Rendering | The photo, class, water and overlay planes become one subdivided, displaced ground mesh (~2 m segments). Everything placed "on the ground" gets `ground(x, y)`: trees, props, basket, tee pads, discs, spectators, wildlife, effects, bridges, first-person eye height. Seven render/mode files place objects today | **Large**: most of the work |
| Readability | Hillshade in the top-down and class views; slope arrows around the basket for putts | Medium |
| Online | Nothing: each client loads the same heightmap, and throws travel as results | — |

### Recommendation

Pilot on **Century Park and Kincaid**: both come from the 3DEP API with no account or reprojection beyond lat/lon, and they have the most relief (23 m and 67 m). The steps:

1. The pipeline script for 3DEP, then `HeightmapTerrain`, then the basket and slope fixes in flight, all testable without rendering.
2. A displaced ground mesh, and ground-relative placement for everything.
3. Hillshade, slope arrows and "uphill/downhill" in the stats.
4. The European sources one at a time (Finland first: open and documented), confirming each licence before shipping.

Sources: [3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer), [3DEP index](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer), [NLS elevation model 2 m](https://maanmittauslaitos.fi/en/node/10715) and [NLS terms](https://rsync.nic.funet.fi/index/geodata/mml/NLS_terms_of_use.pdf), [Lantmäteriet grid 1+](https://lantmateriet.se/en/geodata/our-products/product-list/terrain-model-download-grid-1), [ČÚZK data terms](https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-prostorovych-dat-CUZK.aspx) and [DMR 5G ATOM](https://geoportal.gov.cz/php/micka/record/basic/CZ-CUZK-ATOM-DMR5G-ETRS89?dlang=eng), [BEV ALS-DGM](https://inspire-geoportal.ec.europa.eu/srv/api/records/7beed39a-cd40-4ebc-92c6-4571aa7f1be2).

### What was built (D94)

- `npm run elevation -- --out <id>` (`scripts/build-elevation.ts`): picks the source by location, samples a 2 m grid over the course bounds (2×2 under each cell), fills gaps, smooths 3×3, writes `<id>.height.bin` (Uint16 cm above the lowest point) and `elevation` + attribution into the course JSON. Finland reads the funet mirror's tiles (no key); Austria range-reads the 50 km BEV tile; Czechia and the US are one `exportImage` call each. Sweden's COGs need Basic auth (`LM_USER` / `LM_PASS`).
- Relief as built: Kincaid 69.8 m, Běchovice 27.3 m, Julkujärvi 26.8 m, Century Park 24.6 m, Tali 20.6 m (the course is on Talin huippu), Wiener Prater 12.2 m (an embankment at the edge; the course is flat), Blue Lake 12.0 m, Oak Grove 6.1 m.
- `HeightmapTerrain` in the disc worlds; basket collisions and the tray drop relative to the ground at the basket; a downhill pull in skids and rolls; the putt tick against the chains where the basket stands.
- Rendering: `src/render/ground.ts` (`groundAt`) is set by the scene; the ground planes are draped (a vertex every ~2.5 m); trees, baskets, tee pads, discs, spectators, wildlife, cloud shadows, effects, bridges, the first-person eye, the chase camera and the flyover sit on it. The HUD shows how far up or down the basket is (↑/↓ next to the distance).
- Ghost discs on a course with ground are kept apart from the ones saved on the flat version.
- Tali Recreation (vector style) stands on the same ground: its layers are painted into a texture (`vectorCanvas`, 2.5 px/m) and draped like the photo.
- Hillshade (`src/render/hillshade.ts`): a north-west sun at 45°, one pixel per terrain cell, multiplied over the ground in every view. Slopes facing away darken (to half at most); flat ground and lit slopes are unchanged, so the photo keeps its colors.
- Slope arrows: a 2 m grid out to 10 m around the viewer's basket (an instanced mesh), lying on the ground and pointing downhill; none under 1%, full length from ~6%. They follow a Moving Basket.
- Tee pads are turned down the hole and tilted onto the slope.
