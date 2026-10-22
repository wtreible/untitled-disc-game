# Level editor and disc golf

> The disc golf variant is now implemented; see [10-disc-golf](10-disc-golf.md). The level editor and park → course flow below are still future work.

## Level editor (D14)

One editor serves three jobs: fixing OSM mistakes on real courses, building holes in parks, and authoring disc golf courses.

**Edits:**
- Place or move tee, pin/basket, and the routing line (with dogleg points).
- Draw, edit or delete surface polygons (pen tool, plus seeded flood fill from [06-segmentation](06-segmentation.md) approach 3).
- Set par, tree heights, OB lines, and (disc golf) mandatory-side markers ("mandos").
- Nudge the imagery alignment offset.

**Output:** the same `course.json` schema as the OSM pipeline, with per-feature `source` (`osm`, `seg:*`, `manual`). Saved locally (file download / localStorage) in the hobby phase.

## Hole editor for the current game (planned, not started)

Recorded 2026-10-21 as a later feature. A smaller, game-first version of the editor above: make your own holes on the existing courses and share them with friends.

- **Edit on any course map:** place the tee and basket, drag the routing line (doglegs), set par; add and remove trees (pick a model and size), and on the arcade courses place props from the course's kit (the models and colliders `scripts/course-kit.ts` already builds: `shapeColliders`, `silhouetteBoxes`).
- **Play it right away:** the editor produces a `DiscHole` plus any extra trees and props, and the game plays it like a course hole (single-hole round, test throws with the ghost line).
- **Share it as a file or a link:** a small JSON (the course id, the hole, the added trees and props; colliders recomputed on load from the models, not stored) as a download, or packed into the URL hash for short holes. Opening one offers "Play this hole" and "Host it online"; online, the hole travels in the lobby so everyone plays the same thing.
- **Checks before saving:** tee and basket in bounds and clear of props (the same rules as `tests/courses.test.ts`), the hole reachable (a putt from 6 m in), par from length.
- **Open questions:** collider computation in the browser needs the model files loaded (it's build-time today); how much of the kit to expose per course; whether shared holes need a version field for future course changes.

## Park → course with algorithm suggestions

Runtime flow (this is why the vector pipeline is TypeScript, D7):

1. User picks a park (search, or click on the map) → fetch OSM for its `leisure=park` polygon via Overpass from the browser (**verify** Overpass CORS headers before relying on this).
2. Build an **open ground** mask: park polygon minus buildings, water, woods/trees, playgrounds, sports pitches, and paths (buffered).
3. Suggest holes: sample candidate tee/target pairs in open ground, score them, and keep the best non-overlapping set:
   - length in range (disc golf: ~50–150 m; pitch-and-putt golf: ~50–110 m)
   - clear line of sight, or a deliberate obstacle to shape around
   - **safety buffers:** reject lines crossing paths, roads, playgrounds or picnic areas, or landing near them
   - flow: each hole's target close to the next hole's tee
4. Optionally run NAIP segmentation (live or cached) to find trees OSM doesn't have.
5. Drop the suggestions into the editor for the user to accept, tweak or delete.

## Disc golf variant

**OSM already has tags:** `leisure=disc_golf_course`, `disc_golf=tee`, `disc_golf=basket`, `disc_golf=hole`. Mapped disc golf courses can go through the same pipeline as golf courses before any park → course generation.

**What changes vs golf:**

| | Golf | Disc golf |
|---|---|---|
| Target | Pin + cup on a green | Basket (no green; any ground) |
| Equipment | Clubs (carry, apex, roll) | Discs: speed, glide, turn, fade (the standard four-number flight ratings) |
| Flight | Parabola + roll | Curved path: early turn, late fade, hyzer/anhyzer release angle, some skip/roll |
| Surfaces | Many lie classes | Mostly irrelevant; trees and OB dominate |
| Trees | Option B blocking | Central to play: sample path vs canopy constantly; deflection (option C) fits better here |
| Finishing | Putting with roll physics | "In the basket" if the throw ends within a catch radius at low speed, or a probabilistic putt from circle 1 (≤10 m) / circle 2 (10–20 m) |

The flight model needs a lateral curve component: a 2D path offset by `turn` early and `fade` late, scaled by speed and release angle, still drawn as a 3D path with height so tree blocking works unchanged.
