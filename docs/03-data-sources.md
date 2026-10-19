# Data sources

| Source | Role | Resolution | Coverage | License / terms | Status |
|---|---|---|---|---|---|
| OpenStreetMap | Course geometry, routing, par | Vector | Worldwide, quality varies | ODbL | **v1** |
| Esri World Imagery | Display only, streamed live | ~0.3 m in most US metros | Worldwide | Esri terms; attribution required | **v1** |
| USDA NAIP | Derivation / segmentation | 0.6 m (some years 1 m), 4-band RGB+NIR | Continental US | Public domain | Future |
| USGS 3DEP lidar | Elevation | ~1 m DEM (QL2) | Most of US | Public domain | Future |
| HSY land cover 2024 | Tree canopy by height class (disc golf trees) | Vector, from lidar + aerial | Helsinki region | Open WFS; likely CC BY 4.0 (see docs/10) | **In use** |
| Sentinel-2 | — | 10 m | Worldwide | Free / open | Evaluated, rejected |

## OpenStreetMap

- Query via the Overpass API. **Send a User-Agent** identifying the project; a bare request got `406 Not Acceptable` during testing. The main endpoint `overpass-api.de` is often at capacity (a `502` page saying so), so retry with backoff. The `overpass.kumi.systems` mirror timed out in testing.
- Pull everything inside the course polygon with `map_to_area`:

  ```
  [out:json][timeout:90];
  way(<course way id>)->.c; .c map_to_area->.a;
  ( way(area.a)["golf"]; relation(area.a)["golf"];
    way(area.a)["natural"~"water|wood|tree_row|scrub"]; );
  out tags geom;
  ```
- **ODbL:** show attribution ("© OpenStreetMap contributors"). A derived database (our `course.json`) is share-alike if published. That's fine for a hobby project; keep the OSM timestamp in each file.
- **Don't trust tags.** The Country Club's own `note` tag says it hosted "the 2022 Masters". It hosted the 2022 U.S. Open.

## Esri World Imagery

- Tile URL: `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (note: **y before x**).
- Verified 2026-10-19: tiles return `Access-Control-Allow-Origin: *`, so they can be uploaded as WebGL textures without tainting the canvas. A z18 tile was ~20 KB JPEG.
- **Live only, never bundled or cached to disk in the repo.** Display attribution on screen ("Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community", or whatever the service's attribution endpoint returns).
- **Verify before any non-personal use:** Esri's terms for keyless use of basemap tiles are aimed at limited non-commercial use. Anything beyond friends-and-family likely needs an ArcGIS account and API key.
- Imagery date and alignment differ from NAIP and from whatever imagery OSM mappers traced. Expect offsets of a few meters between photo and polygons. Fine for v1 (D13). A per-hole manual nudge offset in `course.json` is the cheap fix.

## NAIP (future)

- Public domain, so it's fine to derive from. 4 bands: the **near-infrared band** separates live grass from sand, water and pavement far better than RGB alone (NDVI).
- Available as Cloud-Optimized GeoTIFFs (e.g. AWS / Microsoft Planetary Computer), which can be range-read without downloading whole tiles.
- Refreshed every 2–3 years per state. Leaf-on summer imagery.
- Used offline (Python) for [06-segmentation](06-segmentation.md), and possibly at runtime for the park → course flow.

## Sentinel-2: why rejected

10 m pixels: a typical green (~500 m²) is about 5 pixels, a bunker is under one. It can't resolve any golf surface class. Possible future niche: coarse park-scale tree/water masks where NAIP doesn't cover (outside the US). Reopen only with a concrete use.
