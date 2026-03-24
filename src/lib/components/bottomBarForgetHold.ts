const FORGET_HOLD_COMPLETION_DELAY_MS = 100;

interface BottomBarForgetHoldControllerDeps {
  getIsForgetHoldEnabled: () => boolean;
  getIsHoldingForget: () => boolean;
  setIsHoldingForget: (value: boolean) => void;
  getForgetHoldDurationMs: () => number;
  getForgetHoldStartedAt: () => number;
  setForgetHoldStartedAt: (value: number) => void;
  setForgetHoldProgress: (value: number) => void;
  getForgetHoldFrame: () => number | null;
  setForgetHoldFrame: (value: number | null) => void;
  getForgetHoldTimeout: () => ReturnType<typeof window.setTimeout> | null;
  setForgetHoldTimeout: (value: ReturnType<typeof window.setTimeout> | null) => void;
  onForget: () => void;
}

export function createBottomBarForgetHoldController({
  getIsForgetHoldEnabled,
  getIsHoldingForget,
  setIsHoldingForget,
  getForgetHoldDurationMs,
  getForgetHoldStartedAt,
  setForgetHoldStartedAt,
  setForgetHoldProgress,
  getForgetHoldFrame,
  setForgetHoldFrame,
  getForgetHoldTimeout,
  setForgetHoldTimeout,
  onForget
}: BottomBarForgetHoldControllerDeps) {
  function clearForgetHoldFrame() {
    const forgetHoldFrame = getForgetHoldFrame();
    if (forgetHoldFrame === null) return;
    window.cancelAnimationFrame(forgetHoldFrame);
    setForgetHoldFrame(null);
  }

  function clearForgetHoldTimeout() {
    const forgetHoldTimeout = getForgetHoldTimeout();
    if (forgetHoldTimeout === null) return;
    window.clearTimeout(forgetHoldTimeout);
    setForgetHoldTimeout(null);
  }

  function resetForgetHold() {
    clearForgetHoldFrame();
    clearForgetHoldTimeout();
    setIsHoldingForget(false);
    setForgetHoldProgress(0);
    setForgetHoldStartedAt(0);
  }

  function tickForgetHoldProgress() {
    if (!getIsHoldingForget() || !getIsForgetHoldEnabled()) return;

    const elapsed = performance.now() - getForgetHoldStartedAt();
    const nextProgress = Math.min(elapsed / getForgetHoldDurationMs(), 1);
    setForgetHoldProgress(nextProgress);

    if (nextProgress >= 1) {
      setForgetHoldFrame(null);
      return;
    }

    setForgetHoldFrame(window.requestAnimationFrame(tickForgetHoldProgress));
  }

  function beginForgetHold() {
    if (!getIsForgetHoldEnabled() || getIsHoldingForget()) return;

    clearForgetHoldFrame();
    clearForgetHoldTimeout();
    setIsHoldingForget(true);
    setForgetHoldProgress(0);
    setForgetHoldStartedAt(performance.now());
    tickForgetHoldProgress();
    setForgetHoldTimeout(
      window.setTimeout(() => {
        clearForgetHoldFrame();
        setForgetHoldProgress(1);
        setForgetHoldTimeout(
          window.setTimeout(() => {
            resetForgetHold();
            onForget();
          }, FORGET_HOLD_COMPLETION_DELAY_MS)
        );
      }, getForgetHoldDurationMs())
    );
  }

  function cancelForgetHold() {
    if (!getIsHoldingForget()) return;
    resetForgetHold();
  }

  function handleForgetPointerDown(event: PointerEvent) {
    if (!getIsForgetHoldEnabled() || event.button !== 0) return;
    beginForgetHold();
  }

  function handleForgetKeyDown(event: KeyboardEvent) {
    if (!getIsForgetHoldEnabled() || event.repeat || (event.key !== ' ' && event.key !== 'Enter')) {
      return;
    }
    event.preventDefault();
    beginForgetHold();
  }

  function handleForgetKeyUp(event: KeyboardEvent) {
    if (!getIsForgetHoldEnabled() || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    cancelForgetHold();
  }

  function handleForgetClick() {
    if (getIsForgetHoldEnabled()) return;
    onForget();
  }

  function getForgetButtonAriaLabel() {
    return getIsForgetHoldEnabled() ? 'Hold to forget' : 'Forget';
  }

  return {
    resetForgetHold,
    handleForgetPointerDown,
    handleForgetKeyDown,
    handleForgetKeyUp,
    handleForgetClick,
    cancelForgetHold,
    getForgetButtonAriaLabel
  };
}
