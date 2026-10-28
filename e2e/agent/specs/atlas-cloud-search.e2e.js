import { browser, $, $$, expect } from '@wdio/globals';

// Recorded through the atlas-cloud-search WDIO session, then isolated for replay.
describe('Atlas cloud search filtering', () => {
    it('hides unmatched clouds and captions, preserves matching parents, and restores the fixed map on clear', async () => {
        await browser.setWindowSize(1440, 1000);
        await browser.url('/__gneauxghts_e2e_reset');
        await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });

        await browser.url('/map');

        await expect($$('[data-node-id]')).toBeElementsArrayOfSize(2);
        await browser.execute(async () => {
          const atlas = await window.__TAURI_INTERNALS__.invoke('get_vault_atlas', {});
          atlas.worldLayout = true;
          atlas.revision++;
          atlas.nodes = atlas.nodes.map((node, i) => ({ ...node, x: i ? 1500 : -1500, y: 0, cloudId: i ? 'beta-cloud' : 'alpha-cloud', parentCloudId: i ? 'beta-cloud' : 'alpha-cloud', childCloudId: i ? 'beta-child' : 'alpha-child' }));
          atlas.clouds = atlas.nodes.flatMap(node => {
            const cloud = {
              id: node.cloudId, parentId: null, level: 0, label: node.cloudId,
              labelSource: 'topic', noteCount: 1, density: 1, color: [100, 150, 180, 255],
              centroid: [node.x, 0], radius: 200,
              hull: [[node.x-200,-180],[node.x+200,-180],[node.x+200,180],[node.x-200,180]],
              memberNodeIds: [node.id], coreNodeIds: [node.id], outlierNodeIds: [],
              childCloudIds: [node.childCloudId], representativeNodeIds: [node.id],
              familyId: node.cloudId === 'beta-cloud' ? 'alpha-cloud' : null
            };
            return [cloud, {...cloud, id: node.childCloudId, parentId: node.cloudId, familyId: null, level: 1, label: node.childCloudId, childCloudIds: [], hull: [[node.x-100,-90],[node.x+100,-90],[node.x+100,90],[node.x-100,90]]}];
          });
          window.__GNEAUXGHTS_E2E__.setAtlas(atlas);
          window.__GNEAUXGHTS_E2E__.emit('vault-note-changed', { documentKind: 'note', notePath: '/e2e/alpha.md', deleted: false, source: 'external' });
        });
        await expect($$('[data-cloud-id]')).toBeElementsArrayOfSize(4);
        await expect($('.atlas-map')).toHaveAttribute('data-map-moving', 'false');
        await $('[aria-label="Fit map to view"]').click();
        await expect($$('[data-family-id]')).toBeElementsArrayOfSize(1);

        const camera = await $('.map-world').getAttribute('transform');
        const shapes = await browser.execute(() => [...document.querySelectorAll('[data-cloud-id]')].map(cloud => [cloud.dataset.cloudId, cloud.getAttribute('points')]));
        await $('[aria-label="Search map notes"]').setValue('Beta');
        await expect($$('[data-node-id]')).toBeElementsArrayOfSize(1);
        await expect($$('[data-cloud-id]')).toBeElementsArrayOfSize(2);
        await expect($('[data-cloud-id="beta-cloud"]')).toExist();
        await expect($('[data-cloud-id="beta-child"]')).toExist();
        await expect($('.region-caption')).toHaveText('beta-cloud');
        await expect($$('[data-family-id]')).toBeElementsArrayOfSize(0);
        expect(await $('.map-world').getAttribute('transform')).toEqual(camera);
        await $('[aria-label="Fit map to view"]').click();
        expect(await $('.map-world').getAttribute('transform')).toEqual(camera);
        await $('[aria-label="Search map notes"]').setValue('no-such-word');
        await expect($$('[data-node-id]')).toBeElementsArrayOfSize(0);
        await expect($$('[data-cloud-id]')).toBeElementsArrayOfSize(0);
        await expect($$('.region-caption')).toBeElementsArrayOfSize(0);
        await expect($$('[data-family-id]')).toBeElementsArrayOfSize(0);
        await $('[aria-label="Clear search"]').click();
        await expect($$('[data-cloud-id]')).toBeElementsArrayOfSize(4);
        await expect($$('[data-node-id]')).toBeElementsArrayOfSize(2);
        await expect($$('[data-family-id]')).toBeElementsArrayOfSize(1);
        expect(await browser.execute(() => [...document.querySelectorAll('[data-cloud-id]')].map(cloud => [cloud.dataset.cloudId, cloud.getAttribute('points')]))).toEqual(shapes);
        expect(await $('.map-world').getAttribute('transform')).toEqual(camera);
        await $('[aria-label="Search map notes"]').setValue('Beta');
        await expect($$('[data-cloud-id]')).toBeElementsArrayOfSize(2);
    });
});
