import { invoke } from '@tauri-apps/api/core';
import type { ChatAttachment, ChatAttachmentInput } from '$lib/features/chat/types';
import type { NativeAdmission } from './nativeProvider';

/** Native validation happens before Pi accepts the turn. Pi retains these bytes. */
export function prepareAttachments(inputs: readonly ChatAttachmentInput[], admission: NativeAdmission): Promise<ChatAttachment[]> {
  return invoke('pi_prepare_attachments', { admissionId: admission.id, attachments: inputs });
}

/** Stable IDs are issued before acceptance and round-trip in the request snapshot. */
export function projectAttachments(inputs: readonly ChatAttachmentInput[] = []): ChatAttachment[] {
  return inputs.map((input, index) => ({ ...input,
    id: (input as Partial<ChatAttachment>).id ?? `pi-attachment-${index}` }));
}

/** Match ordinary chat: follow-ups retain inventory, not a second copy of bytes. */
export function attachmentHistoryContent(content: string, attachments: readonly ChatAttachmentInput[] = []): string {
  return attachments.length ? `${content}\n\n[Previously attached: ${attachments.map(item => item.name).join(', ')}]` : content;
}
