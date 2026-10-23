# More real courses, and course tree mixes

Five more real courses from OpenStreetMap, chosen from a survey of every mapped course (2,831 `leisure=disc_golf_course` features, about 560 with 9+ hole lines) for fame and how well they're mapped. Most famous courses (Maple Hill, Winthrop Gold, Blue Ribbon Pines, Northwood Black, Beaver Ranch, Järva, Ale, Harmon Hills, Nokia's Beast) have no hole lines in OSM at all.

| Course | OSM | Holes | Trees | Tree models |
|---|---|---|---|---|
| Běchovice, Prague | [relation 14137393](https://www.openstreetmap.org/relation/14137393) (long tees) | 18, OSM pars | 16 woodland outlines | Oak, CommonTree, Birch / Pine |
| Skatås, Gothenburg | [relation 913917](https://www.openstreetmap.org/relation/913917) (yellow) | 20 (with 14b, 15b) | 2,300 mapped trees + woods | Birch, Oak / Pine, Spruce |
| Kincaid Park, Anchorage | [way 767928285](https://www.openstreetmap.org/way/767928285) | 18 | 17 woodland outlines | Birch / Spruce |
| Julkujärvi PRO, Ylöjärvi | [way 1562971247](https://www.openstreetmap.org/way/1562971247) | 18, OSM pars | 13 woodland outlines | Birch / Pine, Spruce |
| Blue Lake Park, Portland | [way 142321221](https://www.openstreetmap.org/way/142321221) | 17 (no hole 8 in OSM) | 12 woodland outlines | Oak, CommonTree / Spruce |

Build commands are in the README. Oak Grove now uses the oak models too (`--broadleaf Oak`); its holes and trees are unchanged.

## What the builder needed

- **Holes in a course area** (Kincaid, Julkujärvi, Blue Lake): only the hole lines mostly inside the course's outline. Julkujärvi's AM layout sits beside its PRO in the same search box.
- **Two lines with one number** (Kincaid has a second set of short lines numbered like the main 18): the line with a tee and basket mapped at its ends wins, then the longer one.
- **Hole numbers with a letter** (Skatås' 14b and 15b): sorted after their hole (14, 14b, 15, 15b), shown as numbered in the game and on the menu's hole picker. The menu's back nine is whatever's after the front nine (Skatås' back 11, Blue Lake's back 8).
- **A hole mapped without a number** (Kincaid's 4): `--hole-ref 996506301:4` numbers it by hand rather than guessing in code.
- **`--name`**: a relation's name is often its layout's ("Main 18 - long tees").

These are `selectHoles` and `compareRefs` in `src/course/disc-build.ts`. Tali, Tali Recreation and Oak Grove rebuild byte-identical through them.

## Known gaps

- **Blue Lake has no hole 8** (no line, tee or basket in OSM), so it plays 17.
- **Julkujärvi has no tees or baskets mapped**: holes run from line start to line end.
- **Woods are planted evenly**: woodland outlines become solid forest, so open stretches the satellite photo shows (right of Běchovice's 1st, Blue Lake's open park) play wooded. Skatås, with its mapped trees, is closest to the real thing.
- **Pars**: OSM's where tagged, used as mapped (Běchovice's 14th is par 5 at 124 m); else estimated from length.
- **Skatås' layout**: OSM's yellow relation has 20 holes; UDisc lists the yellow course at 25.

## Tree mixes

A course can name its tree models (`tree_models` in the course file; `--broadleaf` / `--conifer` on `npm run disc-course`) as model-name prefixes. Without one, trees are the MegaKit's `CommonTree` and `Pine`. Low-crowned trees draw from the conifers 65% of the time, others 25%. The renderer loads only the models a course uses.

| Prefix | Models | Source |
|---|---|---|
| `CommonTree` | 5 broadleaf | Stylized Nature MegaKit (Quaternius, CC0) |
| `Pine` | 5 pines | Stylized Nature MegaKit |
| `Birch` | 10 birches, green leaves | [Textured LowPoly Trees](https://opengameart.org/content/lowpoly-textured-trees) (Quaternius, CC0, May 2020) |
| `Spruce` | 5 spruces (the pack's "Pine") | Textured LowPoly Trees |
| `Oak` | 10 wide, crooked broadleaf (the pack's "Tree") | Textured LowPoly Trees |

No free oak made for the job turned up in this style (Poly Pizza's two oaks are Google Poly, CC-BY, and a different look), so the oaks are the pack's spreading broadleaf trees: a wide crown on a short, crooked trunk. Course trees are scaled to their own height and crown, so an oak planted narrow comes out taller than the model.

`npm run import-trees -- --src <unzipped pack folder>` converts the pack's OBJ files into `public/models/qtrees/` (glTF, materials renamed `Bark_*` / `Leaves_*` and textured by name, since the OBJ materials have no texture maps); then `npm run tree-shapes` measures them. Their trunks are low-poly (vertices only at segment ends, meters apart), so their trunk slices are traced from points along the bark's edges too; the MegaKit models are measured as before, unchanged.
