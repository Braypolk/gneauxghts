import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
import { attachmentHistoryContent, prepareAttachments, projectAttachments } from './attachments';
import type { NativeAdmission } from './nativeProvider';

describe('Pi attachment byte ownership', () => {
  it('prepares exact bytes against the frozen native admission before turn acceptance', async () => {
    const input = { kind: 'file' as const, name: 'exact.md', mimeType: 'text/markdown', sizeBytes: 7, dataBase64: btoa('# exact') };
    const admitted = { ...input, id: 'pi-attachment-stable' };
    mock.invoke.mockResolvedValue([admitted]);
    const attachments = await prepareAttachments([input], { id: 'native-admitted' } as NativeAdmission);
    expect(mock.invoke).toHaveBeenCalledWith('pi_prepare_attachments', { admissionId: 'native-admitted', attachments: [input] });
    expect(projectAttachments(attachments)).toEqual([admitted]);
    expect(attachments[0].dataBase64).toBe(input.dataBase64);
  });

  it('keeps IDs and content in reopened projection without mutating the snapshot', () => {
    const admitted = { id: 'stable-original-id', kind: 'image' as const, name: 'image.png', mimeType: 'image/png', sizeBytes: 3, dataBase64: 'YWJj' };
    const snapshot = Object.freeze([Object.freeze(admitted)]);
    expect(projectAttachments(snapshot)).toEqual([admitted]);
    expect(projectAttachments(snapshot)[0]).not.toBe(admitted);
    expect(projectAttachments()).toEqual([]);
  });

  it('retains production follow-up inventory without replaying attachment bytes', () => {
    const input = { kind: 'file' as const, name: 'exact.md', mimeType: 'text/markdown', sizeBytes: 7, dataBase64: btoa('# exact') };
    expect(attachmentHistoryContent('Earlier question', [input])).toBe('Earlier question\n\n[Previously attached: exact.md]');
    expect(attachmentHistoryContent('Earlier question')).toBe('Earlier question');
    expect(attachmentHistoryContent('', [input])).not.toContain(input.dataBase64);
  });

  it('propagates unavailable or unsupported content without manufacturing an accepted attachment', async () => {
    mock.invoke.mockRejectedValue(new Error('The selected model cannot accept this attachment type'));
    await expect(prepareAttachments([], { id: 'native-admitted' } as NativeAdmission)).rejects.toThrow('cannot accept');
  });
});
