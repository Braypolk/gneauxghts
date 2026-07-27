import type {
  ChatAttachmentInput,
  ChatModelCapabilities
} from './types';

export const MAX_CHAT_ATTACHMENTS = 10;
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_CHAT_TEXT_PREVIEW_BYTES = 512 * 1024;

export type ChatAttachmentPreviewKind = 'image' | 'pdf' | 'text' | 'unsupported';

export interface ChatAttachmentTextPreview {
  text: string;
  truncated: boolean;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.py': 'text/x-python',
  '.rtf': 'application/rtf',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xml': 'application/xml'
};

const MIME_ALIASES: Record<string, string> = {
  'application/javascript': 'text/javascript',
  'application/x-javascript': 'text/javascript',
  'application/x-python-code': 'text/x-python',
  'image/jpg': 'image/jpeg',
  'text/rtf': 'application/rtf',
  'text/xml': 'application/xml'
};

function inferredMimeType(file: File): string {
  if (file.type) {
    const mimeType = file.type.toLowerCase();
    return MIME_ALIASES[mimeType] ?? mimeType;
  }
  const lowerName = file.name.toLowerCase();
  const extension = Object.keys(MIME_BY_EXTENSION).find((candidate) =>
    lowerName.endsWith(candidate)
  );
  return extension ? MIME_BY_EXTENSION[extension] : 'application/octet-stream';
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 32_768;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function attachmentAccept(capabilities: ChatModelCapabilities | null): string {
  return capabilities?.acceptedMimeTypes.join(',') ?? '';
}

export function validateAttachmentBatch(
  files: File[],
  existing: ChatAttachmentInput[],
  capabilities: ChatModelCapabilities
): string | null {
  if (existing.length + files.length > MAX_CHAT_ATTACHMENTS) {
    return `Attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`;
  }
  const tooLarge = files.find((file) => file.size > MAX_CHAT_ATTACHMENT_BYTES);
  if (tooLarge) return `“${tooLarge.name}” is larger than 10 MB.`;
  const totalBytes =
    existing.reduce((sum, attachment) => sum + attachment.sizeBytes, 0) +
    files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
    return 'Attachments can total up to 25 MB per message.';
  }
  for (const file of files) {
    const mimeType = inferredMimeType(file);
    const image = mimeType.startsWith('image/');
    if ((image && !capabilities.images) || (!image && !capabilities.files)) {
      return `The selected model cannot accept “${file.name}”.`;
    }
    if (!capabilities.acceptedMimeTypes.includes(mimeType)) {
      return `“${file.name}” is not a supported attachment type.`;
    }
  }
  return null;
}

export async function filesToAttachments(files: File[]): Promise<ChatAttachmentInput[]> {
  return Promise.all(
    files.map(async (file) => {
      const mimeType = inferredMimeType(file);
      return {
        kind: mimeType.startsWith('image/') ? 'image' as const : 'file' as const,
        name: file.name || `Pasted image ${new Date().toLocaleTimeString()}`,
        mimeType,
        sizeBytes: file.size,
        dataBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer()))
      };
    })
  );
}

export function attachmentDataUrl(attachment: ChatAttachmentInput): string {
  return `data:${attachment.mimeType};base64,${attachment.dataBase64}`;
}

export function attachmentPreviewKind(
  attachment: ChatAttachmentInput
): ChatAttachmentPreviewKind {
  if (attachment.kind === 'image' || attachment.mimeType.startsWith('image/')) {
    return 'image';
  }
  if (attachment.mimeType === 'application/pdf') return 'pdf';
  if (
    attachment.mimeType.startsWith('text/') ||
    attachment.mimeType === 'application/json' ||
    attachment.mimeType === 'application/rtf' ||
    attachment.mimeType === 'application/xml'
  ) {
    return 'text';
  }
  return 'unsupported';
}

export function attachmentTextPreview(
  attachment: ChatAttachmentInput
): ChatAttachmentTextPreview {
  const bytes = base64ToBytes(attachment.dataBase64);
  const truncated = bytes.length > MAX_CHAT_TEXT_PREVIEW_BYTES;
  const previewBytes = truncated
    ? bytes.subarray(0, MAX_CHAT_TEXT_PREVIEW_BYTES)
    : bytes;
  return {
    text: new TextDecoder().decode(previewBytes),
    truncated
  };
}

export function attachmentBlob(attachment: ChatAttachmentInput): Blob {
  const bytes = base64ToBytes(attachment.dataBase64);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return new Blob([buffer], { type: attachment.mimeType });
}

export function formatAttachmentBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
