# Course model

## Surface classes

| Class | OSM source | Notes |
|---|---|---|
| `tee` | `golf=tee` | Usually several polygons per hole (tee boxes). |
| `fairway` | `golf=fairway` | |
| `green` | `golf=green` | |
| `rough` | `golf=rough`, **and default** | Rough is rarely mapped (2 polygons at TCC). Any unclassified ground inside the course boundary is rough. |
| `bunker` | `golf=bunker` | |
| `water` | `golf=water_hazard`, `golf=lateral_water_hazard`, `natural=water` | Lateral vs regular matters only for drop rules. |
| `trees` | `natural=wood`, `natural=tree_row`, `natural=tree` (point → circle), `landuse=forest` | Obstacle with a height, plus a ground class under it (treated like deep rough). |
| `path` | `golf=cartpath`, `highway=path/footway` | Plays as fairway-ish hardpan; cosmetic in v1. |
| `oob` | Outside the `leisure=golf_course` polygon | Stroke and distance. |

**Priority when polygons overlap** (highest wins): water > bunker > green > tee > fairway > path > trees > rough. Bunkers are often drawn on top of fairway polygons, so priority order is required, not optional.

## Hole structure

OSM models a hole as a `golf=hole` **way** running from tee to green, with tags `ref` (hole number), `par`, `handicap`, and on multi-course clubs `golf:links`.

- **Tee point:** first node of the hole way. v1 uses this as the single tee (D12). Tee polygons near it can confirm or snap it.
- **Pin:** last node of the hole way, snapped to the nearest point inside the `golf=green` polygon it touches. Later: a random position inside the green, inset from the edge.
- **Routing polyline:** the hole way itself. Doglegs show up as middle nodes. Used for camera framing and the "aim at the target" default.
- **Hole corridor:** buffer the routing line (e.g. 60 m) and clip all features to it, plus the green and tee polygons whole. This also sets the imagery bbox.
- **Yardage:** length of the routing line. That's not the official card yardage, which is measured from a specific tee marker.

## v1 hole: The Country Club, Main #17

Checked against live OSM on 2026-10-19:

| Item | Value |
|---|---|
| Course | The Country Club, Chestnut Hill / Brookline, MA, OSM way `29870415` |
| Hole way | `866021894`: `ref=17`, `par=4`, `handicap=12`, `golf:links=Main` |
| Routing | 3 nodes (dogleg); ~330 m / ~361 yd along the line |
| Mapped nearby (within 40 m of the line) | tee polygons (one 4 m from the tee point, `670772671`), green `670756124`, fairway `670756132`, ~10 bunkers |
| Course-wide counts | 27 holes (Main 18 + Primrose 9), 30 greens, 30 fairways, 72 tees, 133 bunkers, 12 water hazards, 2 rough, 2 woods |

**Caveats:**
- Some features within 40 m belong to neighboring holes (a second green 23 m away). Corridor clipping has to pick the green the hole line actually ends in.
- Three Primrose holes are missing their `golf:links` tag. Filter by `golf:links` **and** location.
- Trees are barely mapped (2 woods, no `natural=tree` nodes on the whole course), and none fall within hole 17's corridor. The nearest mapped cart path is 194 m away. So v1's hole 17 plays with **no trees and no paths**: tree blocking is implemented and tested but has nothing to block until trees are added (level editor, or lidar canopy, docs/07).

## course.json

Written by `npm run course` to `public/courses/<name>.json`; the type is `CourseFile` in `src/course/types.ts`.

```jsonc
{
  "name": "The Country Club",
  "links": "Main",
  "source": { "osm_timestamp": "…", "course_osm_id": "way/29870415", "attribution": "© OpenStreetMap contributors (ODbL)" },
  "origin": { "lat": 42.3127909, "lon": -71.1433690 },  // green centroid; full precision (imagery is placed from it)
  "imagery_offset_m": [0, 0],                          // manual photo alignment nudge
  "holes": [{
    "ref": "17", "par": 4, "tee": [x, y], "pin": [x, y], "routing": [[x, y], …], "length_m": 330,
    "features": [{ "class": "bunker", "osm_id": "way/1150714909", "rings": [[[x, y], …]] }],
    "trees": [{ "osm_id": "…", "rings": [...], "height_m": 15 }],
    "boundary": [[[[x, y], …]]],                       // course polygon(s); outside = OOB
    "bounds": [[minX, minY], [maxX, maxY]]             // local meters; drives the surface grid and imagery bbox
  }]
}
```

All coordinates other than `origin` are local meters, rounded to cm. Cart paths are mapped as lines in OSM and are buffered to ~3 m strips; single-node trees become 5 m circles.
