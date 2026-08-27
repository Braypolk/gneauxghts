const MODIFIER_HINT_DELAY_MS = 220;

class ModifierHintState {
  visible = $state(false);
  #timer: number | null = null;

  handleKeydown = (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== 'Meta' && event.key !== 'Control')) {
      return;
    }
    this.#clearTimer();
    this.#timer = window.setTimeout(() => {
      this.#timer = null;
      this.visible = true;
    }, MODIFIER_HINT_DELAY_MS);
  };

  handleKeyup = (event: KeyboardEvent) => {
    if (event.key !== 'Meta' && event.key !== 'Control') {
      return;
    }
    this.reset();
  };

  reset = () => {
    this.#clearTimer();
    this.visible = false;
  };

  #clearTimer() {
    if (this.#timer === null) {
      return;
    }
    window.clearTimeout(this.#timer);
    this.#timer = null;
  }
}

export const modifierHints = new ModifierHintState();
