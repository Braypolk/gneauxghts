export interface ForgottenNoteSummary {
  forgottenPath: string;
  originalPath: string;
  title: string;
  fileName: string;
  forgottenAtMillis: number;
  purgeAfterDays: 1 | 7 | 30;
  purgeAtMillis: number;
  kind: 'note' | 'chat';
  conversationId?: string | null;
}

export interface RestoredForgottenNote {
  forgottenPath: string;
  restoredPath: string;
  title: string;
  kind: 'note' | 'chat';
  conversationId?: string | null;
}
