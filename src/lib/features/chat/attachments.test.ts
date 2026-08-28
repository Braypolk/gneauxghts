import { describe, expect, it } from 'vitest';
import {
  attachmentAccept,
  attachmentBlob,
  attachmentPreviewKind,
  attachmentTextPreview,
  filesToAttachments,
  formatAttachmentBytes,
  validateAttachmentBatch
} from './attachments';
import type { ChatAttachmentInput } from './types';
import type { ChatModelCapabilities } from './types';

const multimodal: ChatModelCapabilities = {
  images: true,
  audio: false,
  video: false,
  files: true,
  acceptedMimeTypes: ['image/png', 'text/plain', 'application/pdf'],
  tools: true,
};

describe('chat attachments', () => {
  it('encodes supported image and text files for the IPC boundary', async () => {
    const files = [
      new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' }),
      new File(['hello'], 'notes.txt', { type: 'text/plain' })
    ];

    expect(validateAttachmentBatch(files, [], multimodal)).toBeNull();
    await expect(filesToAttachments(files)).resolves.toEqual([
      expect.objectContaining({
        kind: 'image',
        name: 'shot.png',
        mimeType: 'image/png',
        sizeBytes: 4,
        dataBase64: 'iVBORw=='
      }),
      expect.objectContaining({
        kind: 'file',
        name: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        dataBase64: 'aGVsbG8='
      })
    ]);
  });

  it('rejects pasted images when the selected model only accepts text files', () => {
    const fileOnly = { ...multimodal, images: false };
    const image = new File(['image'], 'shot.png', { type: 'image/png' });

    expect(validateAttachmentBatch([image], [], fileOnly)).toContain(
      'cannot accept'
    );
    expect(attachmentAccept(fileOnly)).toContain('text/plain');
  });

  it('rejects unsupported types before reading file data', () => {
    const archive = new File(['zip'], 'archive.zip', { type: 'application/zip' });
    expect(validateAttachmentBatch([archive], [], multimodal)).toContain(
      'not a supported attachment type'
    );
  });

  it('accepts configured audio and video inputs and classifies their previews', async () => {
    const mediaCapabilities: ChatModelCapabilities = {
      ...multimodal,
      audio: true,
      video: true,
      acceptedMimeTypes: ['audio/mpeg', 'video/mp4']
    };
    const audio = new File(['audio'], 'clip.mp3', { type: 'audio/mpeg' });
    const video = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    expect(validateAttachmentBatch([audio, video], [], mediaCapabilities)).toBeNull();
    const [audioAttachment, videoAttachment] = await filesToAttachments([audio, video]);
    expect(attachmentPreviewKind(audioAttachment)).toBe('audio');
    expect(attachmentPreviewKind(videoAttachment)).toBe('video');
  });

  it('prepares safe local previews for text, images, and PDFs', () => {
    const textAttachment: ChatAttachmentInput = {
      kind: 'file',
      name: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 11,
      dataBase64: 'aGVsbG8gd29ybGQ='
    };
    const pdfAttachment: ChatAttachmentInput = {
      ...textAttachment,
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      dataBase64: 'JVBERg=='
    };
    const imageAttachment: ChatAttachmentInput = {
      ...textAttachment,
      kind: 'image',
      name: 'photo.png',
      mimeType: 'image/png'
    };

    expect(attachmentPreviewKind(textAttachment)).toBe('text');
    expect(attachmentTextPreview(textAttachment)).toEqual({
      text: 'hello world',
      truncated: false
    });
    expect(attachmentPreviewKind(pdfAttachment)).toBe('pdf');
    expect(attachmentBlob(pdfAttachment)).toEqual(
      expect.objectContaining({ size: 4, type: 'application/pdf' })
    );
    expect(attachmentPreviewKind(imageAttachment)).toBe('image');
    expect(formatAttachmentBytes(1536)).toBe('1.5 KB');
  });
});
