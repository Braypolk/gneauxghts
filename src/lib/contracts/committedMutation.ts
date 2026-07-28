/**
 * The canonical filesystem mutation succeeded, but required read-your-write
 * projections need repair. Callers must treat this as committed, not retry it.
 */
export interface CommittedMutationWarning {
  message: string;
  issues: Array<{
    stage: string;
    message: string;
  }>;
}
