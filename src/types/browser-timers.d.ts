interface Window {
  setTimeout(handler: TimerHandler, timeout?: number, ...arguments: unknown[]): number;
  clearTimeout(handle?: number): void;
  setInterval(handler: TimerHandler, timeout?: number, ...arguments: unknown[]): number;
  clearInterval(handle?: number): void;
}
