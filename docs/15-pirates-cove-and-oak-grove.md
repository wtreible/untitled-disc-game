# Pirate's Cove and Oak Grove

Two more courses: an arcade one built like the others ([12](12-mini-golf-madness.md), [13](13-fantasy-and-rainbow.md)), and a second real course from OpenStreetMap, the first outside Helsinki.

| Course | Group | Build | File |
|---|---|---|---|
| Pirate's Cove | Arcade | `npm run pirate-course` | `public/courses/pirate.json` |
| Oak Grove | Real | `npm run disc-course -- --course relation/18072611 --out oak-grove --trees osm --broadleaf Oak` | `public/courses/oak-grove.json` |

After rebuilding either, `npm run course-summary` refreshes the menu's par and length stats.

## Pirate's Cove (arcade)

Sandy islands with mown fairways, joined by plank boardwalks. **Off the land is the sea**: the course sets `sea: true`, so everything outside its boundary (the islands) is water, out past the edge of the map too, not OB. A disc in the sea splashes, costs +1 ("Overboard!") and is played from where it left the land, as for any water. Land is built from strips along the hole lines with gaps where a hole crosses the sea; each strip stops one strip-radius short of its gap, since a strip's round end would otherwise reach into it.

| # | Name | Gimmick |
|---|---|---|
| 1 | Walk the Plank | A pirate ship moored off the fairway, a dock, cargo |
| 2 | Cannon Cove | A 28 m carry over a cove, cannons on the tee shore, rocks in the water |
| 3 | Shipwreck Shoals | A wreck stranded across the middle of the fairway: round it or over its masts |
| 4 | Skull Rock | A towering rock in a 12 m inlet just short of the basket |
| 5 | Crow's Nest | A 25 m lookout tower on the line, a pirate flag on top |
| 6 | Davy Jones' Locker | A 24 m carry to the basket's own island, with a treasure chest and rowboats |
| 7 | Ghost Ship | **The ghost ship sails 22 m either way across the fairway** (18 s a cycle; a `slide` collider) |
| 8 | X Marks the Spot | A dogleg through palms; a red X and a chest by the basket |
| 9 | Captain's Galleon | A 30 m galleon moored broadside in front of the last basket |

Models: [Pirate Kit](https://kenney.nl/assets/pirate-kit) (Kenney, CC0; `public/models/pirate/License.txt`). Music: the mini golf track for now (no pirate track yet).

## Oak Grove (real)

The Gold Course at Oak Grove Regional Park, Stockton, California ([OSM relation 18072611](https://www.openstreetmap.org/relation/18072611)): 18 holes, 68–130 m, pars estimated from length (OSM has none). It was the best-mapped candidate found: most famous courses (DeLaveaga, Maple Hill, Idlewild, Järva, Morley Field…) have no hole lines in OSM.

What the builder needed for it:

- **A course mapped as a relation** of its hole ways (`type=disc_golf_course`), not a closed way. osmtogeojson drops such relations, so the script reads the member ways and the name from the raw data; the playing area is the corridors around the holes. A stray `disc_golf=hole` of another layout nearby (a second "hole 1") is left out because it isn't a member.
- **Trees outside HSY's area** (`--trees osm`): every `natural=tree` node where it stands (height, crown and trunk from `height`, `diameter_crown` and `circumference` when tagged, else a plausible park tree), plus `natural=wood` / `landuse=forest` planted like canopy (8–16 m), giving way to mapped trees. Limbed up over the hole lines like planted trees.

**Known gap:** OSM's tree mapping there is partial. Holes 1, 2, 6, 15, 16 and 18 have no mapped trees within 30 m, and hole 17's come only from woodland outlines, so the course plays more open than the real park (the satellite photo shows more oaks). A global canopy-height dataset (e.g. Meta/WRI 1 m canopy height, CC BY 4.0) could fill this in the way HSY does for Helsinki.
