import { expect, it } from 'vitest';
import { polygonProximity, preparePolygonContainment, preparePolygonCoverage } from './atlasGeometry';

it('preserves caption containment and clearance across concave waists and boundaries', () => {
  const polygon = [
    {x:0,y:0}, {x:100,y:0}, {x:70,y:40}, {x:100,y:80},
    {x:0,y:80}, {x:30,y:40}
  ];
  for (const margin of [0, 4, 20]) {
    const contains = preparePolygonContainment(polygon, margin);
    for (let y = -5; y <= 85; y++) for (let x = -5; x <= 105; x++) {
      const expected = polygonProximity({x,y}, polygon);
      expect(contains({x,y}), `x=${x}, y=${y}, margin=${margin}, distance=${expected.distance}`).toBe(expected.inside && expected.distance >= margin);
    }
  }
  expect(preparePolygonContainment([], 4)({x:0,y:0})).toBe(false);
});

it('preserves filled routing obstacles and their inclusive outer clearance', () => {
  const polygon = [{x:0,y:0},{x:100,y:3},{x:70,y:40},{x:100,y:80},{x:0,y:80},{x:30,y:40}];
  for (const margin of [0, 4, 20]) {
    const covers = preparePolygonCoverage(polygon, margin);
    for (let y = -25; y <= 105; y++) for (let x = -25; x <= 125; x++) {
      const expected = polygonProximity({x,y}, polygon);
      expect(covers({x,y}), `x=${x}, y=${y}, margin=${margin}`).toBe(expected.inside || expected.distance <= margin);
    }
  }
  expect(preparePolygonCoverage([], 4)({x:0,y:0})).toBe(false);
});
