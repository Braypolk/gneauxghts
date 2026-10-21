import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { original, edit, validate, planMotionEdits } from '../animationLab.mjs';
const root = new URL('../../', import.meta.url);
const paths = { morph: 'src/lib/ui/morphing-containers/motion.ts', surfaces: 'src/lib/ui/morphing-containers/MorphingContainers.svelte', search: 'src/lib/ui/search/searchMotion.ts', popup: 'src/lib/features/notepad/ui/searchResultsReveal.ts' };
const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key,path]) => [key,await readFile(new URL(path,root),'utf8')])));
test('invalid timing/easing inputs cannot enter the source edit plan', () => {
  for (const changes of [{duration: -1},{duration: Infinity},{curve: [1.1,0,0.2,1]},{searchCurve: [0,1,2]},{reveal: 1.1},{fadeIn: '100;alert(1)'}]) assert.throws(() => validate({...original,...changes}));
  assert.deepEqual(validate({...original, path: '/tmp/ignored'}), original);
});
test('all sources are compared before an edit plan can be produced', () => {
  const concurrent = {...sources, popup: sources.popup + '\n// concurrent edit\n'};
  assert.throws(() => planMotionEdits(concurrent,sources,original), /changed since launch/);
  assert.equal(concurrent.popup, sources.popup + '\n// concurrent edit\n');
});
test('an edit changes the intended clocks and preserves every unrelated source byte', () => {
  const values = {...original,duration:760,curve:[0.4,0,0.2,1],searchDuration:640,searchCurve:[0.2,0,0.4,1],fadeOut:125,fadeIn:310,reveal:0.8,popupIn:420,popupOut:230};
  const plan = planMotionEdits(sources,sources,values);
  assert.match(plan.morph, /const travelDuration = 600;/);
  assert.match(plan.morph, /const pinchExtraDuration = 160;/);
  assert.match(plan.surfaces, /progress >= 0.8/);
  assert.match(plan.surfaces, /opacity 125ms/);
  assert.match(plan.surfaces, /transition-duration: 310ms/);
  assert.match(plan.search, /searchExpansionDuration = 640/);
  assert.match(plan.popup, /direction === 'out' \? 230 : 420/);
  for (const key of Object.keys(sources)) assert.equal(edit(key,plan[key],original),edit(key,sources[key],original));
});
test('fractional clock constants remain editable after applying a non-round duration', () => {
  const next = edit('morph',sources.morph,{...original,duration:451});
  assert.match(edit('morph',next,{...original,duration:760}),/const travelDuration = 600;/);
});
