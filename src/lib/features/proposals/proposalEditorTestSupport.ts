import { vi } from 'vitest';
import { createEditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import { createRuntimePane } from '$lib/features/notepad/editor/testSupport';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import { updateDocumentMarkdown } from '$lib/features/notepad/document/documentState';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import { reviewProjection } from './reviewExtension';

/** A real shared document runtime and capability adapter; only the view host is absent. */
export function createReviewEditorForTest(document: NoteDraftState) {
  const runtime = documentRegistry.ensure(document.handle).ensureResources({
    assetRootPath: null, storePastedImage: vi.fn()
  }).runtime;
  runtime.ensureMarkdown(document.working.markdown);
  const pane = createRuntimePane(runtime, runtime.markdown, 0,
    markdown => updateDocumentMarkdown(document, markdown));
  let attached = true;
  return {
    ...pane,
    runtime,
    adapter: createEditorCapabilityAdapter(() => attached ? pane.controller : null),
    get markdown() { return pane.view.state.doc.toString(); },
    get review() { return pane.view.state.field(reviewProjection, false) ?? null; },
    get installed() { return Boolean(pane.view.state.field(reviewProjection, false)); },
    dispose() { runtime.detachController(pane.controller); attached = false; }
  };
}
