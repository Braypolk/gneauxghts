import type { createAtlasLayout } from './atlasLayout';
export type AtlasGeometry = ReturnType<ReturnType<typeof createAtlasLayout>>;

const identity = (mark: AtlasGeometry['nodes'][number]) => mark.node.noteId ?? mark.node.id;
const point = (a: {x:number; y:number}, b: {x:number; y:number}, t: number) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});

/** Always use the admitted target inventory: removed notes cannot linger as animation ghosts. */
export function interpolateAtlas(from: AtlasGeometry, to: AtlasGeometry, progress: number): AtlasGeometry {
  if (progress >= 1) return to;
  const nodes = new Map(from.nodes.map(mark => [identity(mark), mark]));
  const clouds = new Map(from.clouds.map(mark => [mark.cloud.id, mark]));
  return {
    nodes: to.nodes.map(mark => ({...mark, ...point(nodes.get(identity(mark)) ?? mark, mark, progress)})),
    clouds: to.clouds.map(mark => {
      const prior = clouds.get(mark.cloud.id);
      if (!prior) return mark;
      return {...mark, center: point(prior.center, mark.center, progress),
        points: mark.points.map((p,i) => point(prior.points.length === mark.points.length ? prior.points[i] : p,p,progress)),
        labelPoint: point(prior.labelPoint, mark.labelPoint, progress),
        labelFontSize: prior.labelFontSize + (mark.labelFontSize-prior.labelFontSize)*progress};
    })
  };
}

export function atlasGeometryMoved(from: AtlasGeometry, to: AtlasGeometry) {
  const nodes = new Map(from.nodes.map(mark => [identity(mark), mark]));
  const clouds = new Map(from.clouds.map(mark => [mark.cloud.id, mark]));
  return to.nodes.some(mark => {const old=nodes.get(identity(mark));return old && (old.x!==mark.x || old.y!==mark.y);}) ||
    to.clouds.some(mark => {const old=clouds.get(mark.cloud.id);return old && (old.points.length!==mark.points.length || mark.points.some((p,i)=>p.x!==old.points[i].x || p.y!==old.points[i].y));});
}
