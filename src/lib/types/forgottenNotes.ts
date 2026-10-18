import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';

export interface ForgottenNoteSummary {
  forgottenPath: string;
  originalPath: string;
  title: string;
  fileName: string;
  forgottenAtMillis: number;
  purgeAfterDays: 1 | 7 | 30;
  purgeAtMillis: number;
  commitWarning?: CommittedMutationWarning | null;
}

export interface RestoredForgottenNote {
  forgottenPath: string;
  restoredPath: string;
  title: string;
  commitWarning?: CommittedMutationWarning | null;
}
