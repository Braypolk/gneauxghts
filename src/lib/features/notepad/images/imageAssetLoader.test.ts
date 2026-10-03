import { describe, expect, it, vi } from 'vitest';
import { createImageAssetLoader } from './imageAssetLoader';
describe('image asset bytes cache', () => {
  it('coalesces requests, separates vault roots, refreshes changed files and retries errors', async () => {
    let root = 'one', fingerprint = 'old';
    const read = vi.fn(async () => `${root}:${fingerprint}`);
    const loader = createImageAssetLoader(read, () => root, async () => fingerprint);
    expect(await Promise.all([loader.load('a.png'), loader.load('a.png')])).toEqual(['one:old', 'one:old']);
    await loader.load('a.png'); expect(read).toHaveBeenCalledTimes(1);
    fingerprint = 'new'; expect(await loader.load('a.png')).toBe('one:new');
    root = 'two'; expect(await loader.load('a.png')).toBe('two:new');
    await loader.load('a.png', true); expect(read).toHaveBeenCalledTimes(4);
    read.mockRejectedValueOnce(new Error('missing'));
    await expect(loader.load('bad.png')).rejects.toThrow('missing');
    await expect(loader.load('bad.png')).resolves.toBe('two:new');
  });
  it('does not retain stale pending bytes after disposal', async () => {
    let release!: (url: string) => void;
    const read = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const loader = createImageAssetLoader(read, () => 'vault');
    const old = loader.load('a.png'); loader.destroy(); release('old'); await old;
    const current = loader.load('a.png'); release('fresh'); expect(await current).toBe('fresh');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('evicts old entries by count and byte budget', async () => {
    const read = vi.fn(async (name: string) => name);
    const loader = createImageAssetLoader(read, () => 'vault');
    for (let index = 0; index < 129; index++) await loader.load(`${index}.png`);
    await loader.load('0.png'); expect(read).toHaveBeenCalledTimes(130);
    const largeRead = vi.fn(async () => 'x'.repeat(25 * 1024 * 1024));
    const large = createImageAssetLoader(largeRead, () => 'vault');
    await large.load('large.png'); await large.load('large.png'); expect(largeRead).toHaveBeenCalledTimes(2);
  });
});
