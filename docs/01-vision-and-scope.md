# Vision and scope

## Intent

Play real golf holes in the browser. The satellite photo *is* the art. OpenStreetMap supplies the playable geometry (fairways, greens, bunkers, water, hole routing, par), so v1 has no computer vision at all.

Segmentation stays on the roadmap as a way to fill gaps where OSM is thin, and as the basis for turning unmapped parks into courses. It is a means, not the goal.

## Audience

The author and friends. No accounts, no monetization, no scale requirements. This matters for licensing: everything here assumes non-commercial personal use (see [03-data-sources](03-data-sources.md)).

## v1: done means

- One hole, The Country Club, Brookline MA, Main #17 (par 4, ~361 yd by the OSM hole line). See [04-course-model](04-course-model.md).
- Top-down view over live Esri imagery, with a toggle to the class-render view.
- Club select, aim, power; ball flies, lands, rolls, and reacts to surface.
- Trees block low balls; water is a penalty; leaving the course boundary is a +1 drop.
- 1–4 players, local hot-seat.
- Putt out on the green; stroke count vs par shown at the end.
- Flat terrain.

**Not in v1:** elevation, wind, multiple holes, multiple tees, segmentation, level editor, disc golf, networked multiplayer.

## Roadmap (rough order, not commitments)

1. **v1:** one hole, as above.
2. **Full course:** all 18 holes of one course from OSM; scorecard.
3. **Any OSM course:** offline pipeline run on any course with `golf=hole` data.
4. **Elevation:** lidar DEM → `heightAt`, slopes affect roll and putting; optional 3D camera. See [07-elevation-lidar](07-elevation-lidar.md).
5. **Level editor:** place or fix tees, pins and hazards; save as a course file.
6. **Park → disc golf:** algorithm suggests holes in a park, you edit in the level editor; disc flight model. See [08-level-editor-and-disc-golf](08-level-editor-and-disc-golf.md).
7. **Segmentation:** fill missing surfaces from NAIP where OSM is incomplete. See [06-segmentation](06-segmentation.md).
