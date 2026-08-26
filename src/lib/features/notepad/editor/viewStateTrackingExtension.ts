import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { SharedEditorResources } from './types';

/**
 * Capture selection and viewport changes at the CodeMirror view boundary.
 * Persistence remains owned by the pane/document coordinator; this plugin
 * only reports that the live view state changed.
 */
export function createViewStateTrackingExtension(
  sharedResources: SharedEditorResources | null
) {
  return ViewPlugin.fromClass(class {
    private readonly handleScroll = () => {
      this.notify();
    };

    constructor(private readonly view: EditorView) {
      view.scrollDOM.addEventListener('scroll', this.handleScroll, {
        passive: true
      });
    }

    update(update: ViewUpdate) {
      if (update.selectionSet) {
        this.notify();
      }
    }

    destroy() {
      this.view.scrollDOM.removeEventListener('scroll', this.handleScroll);
    }

    private notify() {
      sharedResources
        ?.resolveViewCallbacks(this.view)
        ?.onViewStateChange();
    }
  });
}
