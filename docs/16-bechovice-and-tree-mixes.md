# Běchovice and course tree mixes

## Běchovice (real)

DiscGolfPark Běchovice, Prague ([OSM relation 14137393](https://www.openstreetmap.org/relation/14137393), the "Main 18 - long tees" layout): 18 holes, 75–271 m, par 64 with OSM's own pars. It's the test case of the 2025 [disc golf layout proposal](https://community.openstreetmap.org/t/rfc-feature-proposal-disc-golf-course-2025/127516) (`type=disc_golf_layout`), and its holes still carry a `ref`, so the builder reads it like Oak Grove. UDisc calls it Prague's hardest course; it hosted the 2023 Czech national championship.

```sh
npm run disc-course -- --course relation/14137393 --out bechovice --trees osm --broadleaf CommonTree,Birch --name "DiscGolfPark Běchovice"
```

- **Name:** the relation's name is the layout's, so `--name` sets the course's.
- **Trees:** OSM has 2 mapped trees there but 16 woodland outlines, planted like canopy (8–16 m): about 14,300 trees.
- **Known gaps:** the woods are planted evenly, so stretches the satellite photo shows as meadow and scrub (right of hole 1) play as solid woodland. OSM's pars are used as mapped, including par 5 on the 124 m 14th.

## Tree mixes

A course can name its tree models (`tree_models` in the course file; `--broadleaf` / `--conifer` on `npm run disc-course`) as model-name prefixes. Without one, trees are the MegaKit's `CommonTree` and `Pine`, as before. Low-crowned trees still draw from the conifers 65% of the time, others 25%. The renderer loads only the models a course uses.

| Prefix | Models | Source |
|---|---|---|
| `CommonTree` | 5 broadleaf | Stylized Nature MegaKit (Quaternius, CC0) |
| `Pine` | 5 pines | Stylized Nature MegaKit |
| `Birch` | 10 birches, green leaves | [Textured LowPoly Trees](https://opengameart.org/content/lowpoly-textured-trees) (Quaternius, CC0, May 2020) |
| `Spruce` | 5 spruces (the pack's "Pine") | Textured LowPoly Trees |

`npm run import-trees -- --src <unzipped pack folder>` converts the pack's OBJ files into `public/models/qtrees/` (glTF, materials renamed `Bark_*` / `Leaves_*` and textured by name, since the OBJ materials have no texture maps); then `npm run tree-shapes` measures them. Their trunks are low-poly (vertices only at segment ends, meters apart), so their trunk slices are traced from points along the bark's edges too; the MegaKit models are measured as before, unchanged.
