import type { ClientCaughtError } from '@sveltejs/kit/hooks';

const catalog = {
  page_unavailable: {
    heading: 'Page unavailable',
    message: 'This page is unavailable.'
  },
  request_unavailable: {
    heading: 'Request unavailable',
    message: 'The request could not be completed.'
  },
  client_failure: {
    heading: 'Workspace unavailable',
    message: 'The workspace could not be displayed. Recent changes may not have been saved.'
  }
} as const;

export type ClientErrorCode = keyof typeof catalog;
export type ClientErrorPresentation = {
  status: number;
  message: string;
  presentationCode: ClientErrorCode;
  diagnosticId?: string;
};

const fallback: ClientErrorPresentation = {
  status: 500,
  message: catalog.client_failure.message,
  presentationCode: 'client_failure'
};

// Expected error bodies are untrusted too. Never invoke their getters or read
// inherited fields; a throwing proxy simply uses the fixed fallback.
function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function validStatus(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : 500;
}

function createReference(): string | undefined {
  try {
    return `C-${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  } catch {
    return undefined;
  }
}

/** Synchronous, state-free presentation. Does not retain or log the exception. */
export function presentClientError(input: ClientCaughtError): ClientErrorPresentation {
  try {
    const status = input.kind === 'unknown' ? 500 : validStatus(ownValue(input.error, 'status'));
    const presentationCode = input.kind === 'unknown'
      ? 'client_failure'
      : status === 404 ? 'page_unavailable' : 'request_unavailable';
    return {
      status,
      message: catalog[presentationCode].message,
      presentationCode,
      diagnosticId: createReference()
    };
  } catch {
    return { ...fallback };
  }
}

/** Reuses the hook's reference; rendering this page creates no records/effects. */
export function clientErrorDisplay(error: unknown, pageStatus: number) {
  try {
    const candidate = ownValue(error, 'presentationCode');
    const code: ClientErrorCode = candidate === 'page_unavailable' || candidate === 'request_unavailable'
      ? candidate : 'client_failure';
    const reference = ownValue(error, 'diagnosticId');
    return {
      ...catalog[code],
      status: validStatus(pageStatus),
      diagnosticId: typeof reference === 'string' && /^C-[0-9a-f]{12}$/.test(reference)
        ? reference : undefined
    };
  } catch {
    return { ...catalog.client_failure, status: 500, diagnosticId: undefined };
  }
}
