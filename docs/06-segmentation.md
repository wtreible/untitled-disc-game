# Segmentation (future)

Not needed for v1: OSM supplies the geometry. Segmentation is for (a) filling gaps where OSM is incomplete (trees, rough, unmapped courses), and (b) turning unmapped parks into playable ground for the level editor.

**Input:** NAIP 4-band (R, G, B, NIR) at 0.6 m, offline in Python. Esri imagery is display-only and **not** a segmentation input (D4).

**Output:** a class raster in the hole's local frame, then vectorized into polygons in the same schema as OSM features, so the game doesn't care where a polygon came from. Every derived polygon is tagged `source: "seg:<method>"`.

## The hard part

Fairway, green and tee are all short, healthy grass, nearly identical in color. They differ in **texture** (mowing stripes on fairways, a uniform look on greens), **shape** (greens are compact ovals at the end of hole lines; tees are small rectangles), and **context**. Bunkers, water and trees are comparatively easy, especially with NIR. Every approach below should be judged on green vs fairway.

## Approach 1: Classical per-pixel

1. Features per pixel: NDVI = (NIR − R)/(NIR + R), Lab color, a local texture measure (variance or Gabor response over ~3 m).
2. Cluster (k-means) or threshold:
   - water: low NDVI, low NIR
   - sand: low NDVI, high brightness
   - trees: high NDVI, dark, high texture
   - short grass: high NDVI, bright, low texture
   - rough: high NDVI, medium texture
3. Optional SLIC superpixels first, then classify superpixels instead of pixels (less speckle).
4. Morphological cleanup (open/close), drop regions below a minimum area.
5. Split short grass into green/fairway/tee by **shape and OSM context**: the region the `golf=hole` line ends in is the green, compact small rectangles near line starts are tees, the rest is fairway.

- **Pros:** no training, fast, explainable, fully tunable, runs in the browser if ported.
- **Cons:** brittle across imagery dates, seasons, and shadows; green vs fairway needs the context heuristics.

## Approach 2: Small trained model

- U-Net-style network (e.g. a MobileNet or ResNet-18 encoder) on 4-band NAIP chips.
- **Labels for free:** rasterize existing OSM golf polygons on well-mapped courses as training masks. Thousands of courses, no hand labeling. Expect label noise from the imagery/OSM misalignment; buffer edges as "ignore".
- Export to ONNX for runtime use (onnxruntime-web) in the park flow.

- **Pros:** learns texture and context, so the best green/fairway separation; improves with data.
- **Cons:** training setup, a GPU for reasonable iteration speed, model size in the browser (~5–20 MB), and harder to debug.

## Approach 3: Human-in-the-loop (seeded flood fill)

- In the level editor, the user clicks a seed point and picks a class; the tool region-grows by color/NDVI similarity with a tolerance slider; the result is vectorized and simplified, then editable.
- Can also start from approach 1 or 2 output and let the user fix it.

- **Pros:** highest accuracy per minute of effort for a single hole; a natural fit with the level editor (D14); trivially handles green vs fairway because a human chose.
- **Cons:** manual; doesn't scale to "any course automatically".

## Recommendation for when we get here

Ship approach 3 inside the level editor first, because it's useful immediately and serves D14. Use approach 1 as the "suggest" layer that pre-fills it. Approach 2 only if automated coverage of unmapped courses becomes a goal.

## Evaluation

Use well-mapped OSM courses as ground truth: per-class IoU, plus a confusion matrix focused on green↔fairway and trees↔rough. Report alignment-tolerant scores (e.g. ignore a 1–2 m band at polygon edges).
