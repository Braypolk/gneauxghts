export interface ForgottenNoteSummary {
  forgottenPath: string;
  originalPath: string;
  title: string;
  fileName: string;
  forgottenAtMillis: number;
  purgeAfterDays: 1 | 7 | 30;
  purgeAtMillis: number;
}

export interface RestoredForgottenNote {
  forgottenPath: string;
  restoredPath: string;
  title: string;
}
