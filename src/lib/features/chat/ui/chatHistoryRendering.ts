/** Bound Markdown mounting work while allowing hidden native windows to finish. */
export function renderChatHistoryInBatches(
  total: number,
  alreadyRendered: number,
  render: (count: number) => void
) {
  let count = alreadyRendered;
  let stopped = false;
  let channel: MessageChannel | undefined;

  function stop() {
    stopped = true;
    if (!channel) return;
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
    channel = undefined;
  }

  function batch() {
    if (stopped) return;
    count = Math.min(total, count + 8);
    try {
      render(count);
    } catch (error) {
      stop();
      throw error;
    }
    if (count >= total) {
      stop();
      return;
    }
    if (stopped) return;

    // Message-port tasks yield between bounded DOM updates without depending
    // on animation frames or chained timers, both throttled in native windows.
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = batch;
    }
    channel.port2.postMessage(null);
  }

  batch();
  return stop;
}
