// Drop the animations a course doesn't use from the animated GLBs (KayKit characters ship ~76 clips
// each, ~3.6 MB; a course plays one). Run after building the courses:
//
//   npm run slim-models
//
// Re-adding a clip later means re-copying the original GLB from the KayKit pack first.
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import type { DiscCourseFile } from '../src/course/disc-types';

const COURSES = ['silly', 'fantasy', 'rainbow'];
const used = new Map<string, Set<string>>();
for (const id of COURSES) {
  const c: DiscCourseFile = JSON.parse(readFileSync(`public/courses/${id}.json`, 'utf8'));
  for (const p of c.props ?? []) if (p.anim && p.model.startsWith('kaykit/')) {
    if (!used.has(p.model)) used.set(p.model, new Set());
    used.get(p.model)!.add(p.anim);
  }
}

const io = new NodeIO();
for (const [model, keep] of used) {
  const path = `public/models/${model}`;
  const before = readFileSync(path).length;
  const doc = await io.read(path);
  const anims = doc.getRoot().listAnimations();
  for (const a of anims) {
    if (keep.has(a.getName())) continue;
    // Disposing the animation alone leaves its keyframe accessors behind; free those too.
    const data = a.listSamplers().flatMap((sm) => [sm.getInput(), sm.getOutput()]);
    for (const ch of a.listChannels()) ch.dispose();
    for (const sm of a.listSamplers()) sm.dispose();
    a.dispose();
    for (const acc of data) if (acc && acc.listParents().every((p) => p === doc.getRoot())) acc.dispose();
  }
  await doc.transform(prune());
  await io.write(path, doc);
  const after = readFileSync(path).length;
  console.log(`${model}: kept ${[...keep].join(', ')} of ${anims.length} clips; ${(before / 1e6).toFixed(2)} → ${(after / 1e6).toFixed(2)} MB`);
}
