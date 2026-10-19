# Glossary

**Golf**
- **Hole:** one unit of play, tee to cup. In OSM, a `golf=hole` way from tee to green.
- **Tee / tee box:** where a hole starts. Courses have several per hole (back, middle, forward).
- **Fairway:** closely mown grass between tee and green; the intended landing area.
- **Rough:** longer grass bordering the fairway. Our default class for unlabeled ground inside the course.
- **Green:** very short grass around the cup, where you putt.
- **Pin / flag / cup:** the target on the green. Cup diameter 108 mm.
- **Bunker:** sand-filled hazard.
- **Water hazard / lateral water hazard:** penalty areas. Modern rules call them red and yellow penalty areas; we keep the OSM names.
- **OB (out of bounds):** outside the course boundary. Penalty: stroke and distance.
- **Par:** expected strokes for a skilled player (3, 4 or 5).
- **Stroke play:** total strokes count. **Birdie** −1, **eagle** −2, **bogey** +1, **double bogey** +2 relative to par.
- **Carry:** distance the ball flies before first landing. **Roll:** distance after landing.
- **Apex:** the highest point of the ball's flight.
- **Lie:** the surface and condition where the ball rests; affects the next shot.
- **Dogleg:** a hole that bends left or right.
- **Routing:** the order and path of holes on a course. Championship events sometimes use a composite routing that differs from the member course.
- **Handicap (hole):** the hole's difficulty rank on the course, 1 = hardest.
- **Links (OSM `golf:links`):** a named sub-course at a multi-course club (e.g. Main, Primrose). Not to be confused with "links golf", the coastal style.

**Disc golf**
- **Basket:** the target. **Mando:** a mandatory side to pass an obstacle on.
- **Flight numbers:** speed, glide, turn, fade. They describe how a disc curves.
- **Hyzer / anhyzer:** release angle, tilted outside edge down or up.
- **Circle 1 / 2:** putting distance bands, ≤10 m and 10–20 m.

**Geo / imagery**
- **Web Mercator (EPSG:3857):** the projection web map tiles use. It distorts scale by 1/cos(latitude).
- **Local tangent frame:** our per-hole flat x/y meters coordinates around the green.
- **Tile z/x/y:** zoom level and tile column/row in a web map pyramid. Esri URLs order it z/y/x.
- **Orthophoto / orthoimagery:** aerial imagery corrected so it overlays a map. "Satellite" imagery in web maps is often aerial.
- **NAIP:** USDA National Agriculture Imagery Program; US aerial imagery, 0.6 m, RGB + near-infrared.
- **NIR / NDVI:** near-infrared band; Normalized Difference Vegetation Index, (NIR − R)/(NIR + R). High means live vegetation.
- **COG:** Cloud-Optimized GeoTIFF; a raster you can partially read over HTTP.
- **ODbL:** Open Database License (OSM's). Attribution + share-alike for derived databases.
- **Overpass:** the read-only query API for OSM data.

**Elevation**
- **Lidar:** laser-scanned 3D point clouds. **QL1/QL2:** USGS quality levels (point density).
- **DEM / DTM:** digital elevation / terrain model; bare-earth ground heights.
- **DSM:** digital surface model; top of everything (trees, buildings).
- **CHM:** canopy height model = DSM − DTM.
- **Hillshade:** shaded relief rendering of terrain.

**Segmentation**
- **Semantic segmentation:** assigning a class to every pixel.
- **SLIC superpixels:** small, color-coherent pixel clusters used as classification units.
- **U-Net:** a common encoder-decoder network for segmentation.
- **IoU:** intersection over union; per-class overlap score versus ground truth.
- **Region growing / flood fill:** expanding a region from a seed point by similarity.
