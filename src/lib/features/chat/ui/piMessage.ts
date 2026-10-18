import type { Message } from '@earendil-works/pi-ai';
import { messageText } from './piConversationView';

export function messageCopyText(message: Message): string {
  return [messageText(message), message.role === 'assistant' ? message.errorMessage : undefined].filter(Boolean).join('\n\n');
}

/** Pi's timestamp is the request start; duration supplies its recorded finish. */
export function messageTime(message: Message): { date: Date; label: string } | undefined {
  const duration = message.role === 'assistant' ? message.durationMs : undefined;
  const finished = duration !== undefined && Number.isFinite(duration) && duration >= 0;
  const date = new Date(message.timestamp + (finished ? duration : 0));
  if (!Number.isFinite(date.getTime())) return;
  return { date, label: message.role === 'user' ? 'Sent' : finished ? 'Finished' : 'Started' };
}
