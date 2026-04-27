export type RememberMode =
  | 'exact'
  | 'cleanUp'
  | 'summarize'
  | 'outline'
  | 'actionItems'
  | 'decisions'
  | 'meetingNotes'
  | 'evergreen'
  | 'retitle'
  | 'studyGuide'
  | 'splitUp'
  | 'integrate';
export type CustomRememberActionKind = 'singleNote' | 'advanced';
export type RememberActionKind = 'exact' | CustomRememberActionKind;
export type EditableRememberActionFamily = 'edit' | 'organize' | 'integrate';
export type RememberActionFamily = 'exact' | EditableRememberActionFamily;
export type CleanUpApplyPolicy = 'autoApply' | 'requireApproval';
export type AiProviderKind = 'openAiCompatible' | 'llamaServer';
export type AiJobStatus =
  | 'queued'
  | 'running'
  | 'pendingApproval'
  | 'applied'
  | 'rejected'
  | 'failed'
  | 'stale';
export type RememberAiStatus = 'notRequested' | 'queued' | 'failedToQueue';

export type AiChange =
  | {
      kind: 'updateNote';
      path: string;
      baseContentHash: string;
      newTitle: string;
      newMarkdown: string;
    }
  | {
      kind: 'createNote';
      suggestedTitle: string;
      markdown: string;
    }
  | {
      kind: 'deleteNote';
      path: string;
      baseContentHash: string;
    };

export interface RememberDispatchResult {
  sourcePath: string | null;
  sourceContentHash: string | null;
  aiJobId: number | null;
  aiStatus: RememberAiStatus;
}

export interface AiSettings {
  providerKind: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

export interface AiModelOption {
  id: string;
}

export interface ClearInboxResult {
  cancelledJobs: number;
  removedJobs: number;
}

export interface AiDiagnosticsLastRun {
  kind: string;
  actionLabel: string;
  status: AiJobStatus;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  elapsedMillis: number;
  updatedAtMillis: number;
}

export interface AiDiagnosticsMetrics {
  runCount: number;
  promptTokensTotal: number;
  completionTokensTotal: number;
  totalTokensTotal: number;
  promptTokensMax: number;
  completionTokensMax: number;
  totalTokensMax: number;
  lastRun: AiDiagnosticsLastRun | null;
}

export interface AiDiagnosticsSnapshot {
  capturedAtMillis: number;
  metrics: AiDiagnosticsMetrics;
}

export interface AiSettingsUpdate {
  providerKind: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

export interface AiRunMetrics {
  elapsedMillis: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface InboxListItem {
  id: number;
  kind: string;
  actionLabel: string;
  status: AiJobStatus;
  title: string;
  summary: string;
  sourcePath: string;
  sourceTitle: string;
  affectedNotes: string[];
  createdAtMillis: number;
  updatedAtMillis: number;
}

export interface AiChangePreview {
  change: AiChange;
  currentTitle: string | null;
  currentMarkdown: string | null;
}

export interface InboxItemDetail {
  id: number;
  kind: string;
  actionLabel: string;
  status: AiJobStatus;
  title: string;
  summary: string;
  sourcePath: string;
  sourceTitle: string;
  sourceMarkdown: string;
  sourceContentHash: string;
  providerKind: AiProviderKind | null;
  model: string | null;
  requiresApproval: boolean;
  failureReason: string | null;
  metrics: AiRunMetrics | null;
  proposedChanges: AiChange[];
  changePreviews: AiChangePreview[];
  createdAtMillis: number;
  updatedAtMillis: number;
}

export interface RememberActionOption {
  id: string;
  label: string;
  description: string;
  family: RememberActionFamily;
  builtIn: boolean;
  actionKind: RememberActionKind;
  prompt: string | null;
}

export interface EditableRememberAction {
  id: string;
  label: string;
  description: string;
  prompt: string;
  kind: CustomRememberActionKind;
  family: EditableRememberActionFamily;
  visible: boolean;
}

export const EXACT_REMEMBER_ACTION: RememberActionOption = {
  id: 'exact',
  label: 'Remember',
  description: 'Save exactly as written.',
  family: 'exact',
  builtIn: true,
  actionKind: 'exact',
  prompt: null
};

export const defaultEditableRememberActions = [
  {
    id: 'cleanUp',
    label: 'Clean Up',
    description: 'Balanced cleanup that rewrites for clarity and structure.',
    prompt:
      "Aggressively clean up this note without adding new facts. Reorganize, rewrite, and structure it into usable plain markdown while preserving the note's intent and meaning.",
    kind: 'singleNote',
    family: 'edit',
    visible: true
  },
  {
    id: 'summarize',
    label: 'Summarize',
    description: 'Condense the note into a short summary with the key points intact.',
    prompt:
      'Condense this note into a brief high-signal summary with concise supporting bullets. Remove repetition and low-value detail without adding new facts.',
    kind: 'singleNote',
    family: 'edit',
    visible: true
  },
  {
    id: 'outline',
    label: 'Outline',
    description: 'Reshape the note into a clear hierarchical outline.',
    prompt:
      'Reshape this note into a clear hierarchical outline with headings and nested bullets. Prefer structure and scanability over preserving the original prose, without adding new facts.',
    kind: 'singleNote',
    family: 'edit',
    visible: true
  },
  {
    id: 'actionItems',
    label: 'Action Items',
    description: 'Center the note around next steps, blockers, and follow-up tasks.',
    prompt:
      'Rewrite this note into an action-oriented working note. Center it on next steps, blockers, and follow-up tasks, and use markdown tasks like "* [ ]" when the source supports them. Do not add new facts.',
    kind: 'singleNote',
    family: 'edit',
    visible: true
  },
  {
    id: 'decisions',
    label: 'Decisions',
    description: 'Pull out decisions, assumptions, and unresolved questions.',
    prompt:
      'Rewrite this note into a decision log. Pull explicit decisions, assumptions, and unresolved questions into clearly labeled sections, and preserve uncertainty instead of smoothing it over. Do not add new facts.',
    kind: 'singleNote',
    family: 'edit',
    visible: true
  },
  {
    id: 'meetingNotes',
    label: 'Meeting Notes',
    description: 'Reformat the note into a structured meeting record.',
    prompt:
      'Rewrite this note into structured meeting notes with sections like context, discussion, decisions, and action items when supported by the source. Do not invent attendees, dates, or agenda items, and do not add new facts.',
    kind: 'singleNote',
    family: 'edit',
    visible: true
  },
  {
    id: 'evergreen',
    label: 'Evergreen',
    description: 'Turn rough capture into a more durable, reference-friendly note.',
    prompt:
      'Transform this note into a durable evergreen note. Rewrite fleeting phrasing into stable reference language when the meaning is clear, prefer reusable headings, and do not add new facts.',
    kind: 'singleNote',
    family: 'edit',
    visible: true
  },
  {
    id: 'retitle',
    label: 'Retitle',
    description: 'Find a clearer title and lightly clean the body to match it.',
    prompt:
      'Choose a more specific, searchable title when the current title is vague or generic. Make only the light body edits needed to align the note with the improved title, without adding new facts.',
    kind: 'singleNote',
    family: 'edit',
    visible: true
  },
  {
    id: 'studyGuide',
    label: 'Study Guide',
    description: 'Turn the note into a review sheet with concepts and self-check questions.',
    prompt:
      'Turn this note into a study guide with key concepts, compact explanations, and self-check questions answerable from the source. Do not add answers or concepts that are not supported by the note.',
    kind: 'singleNote',
    family: 'edit',
    visible: true
  },
  {
    id: 'splitUp',
    label: 'Split Up',
    description:
      'Break a mixed note into focused notes, preferring new notes and only integrating when the fit is strong.',
    prompt:
      'If this note mixes genuinely distinct themes, split it into focused notes. Prefer creating new notes over editing existing ones, update an existing note only when the fit is high confidence, and leave the source as a short index or meaningful remainder when useful. Do not add new facts.',
    kind: 'advanced',
    family: 'organize',
    visible: true
  },
  {
    id: 'integrate',
    label: 'Integrate',
    description: 'Balanced integration that fits the note into the vault.',
    prompt:
      'Integrate this note into the vault. Prefer absorbing content into existing notes when the fit is clear, create a new note only when that is better than forcing weak integration, and delete the source only if its meaningful content is fully absorbed elsewhere. Do not add new facts.',
    kind: 'advanced',
    family: 'integrate',
    visible: true
  }
] as const satisfies ReadonlyArray<EditableRememberAction>;

export function editableRememberActionToOption(
  action: EditableRememberAction
): RememberActionOption {
  return {
    id: action.id,
    label: action.label,
    description: action.description,
    family: action.family,
    builtIn: false,
    actionKind: action.kind,
    prompt: action.prompt
  };
}

export function rememberActionRequiresIntegrateSupport(
  action: Pick<RememberActionOption, 'family'>
): boolean {
  return action.family === 'integrate';
}

export function rememberActionRequiresApproval(action: RememberActionOption): boolean {
  return action.actionKind === 'advanced';
}
