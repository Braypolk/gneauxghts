/** Drive the normal visible split controls; hidden desktop controls cannot focus on iOS. */
export async function openProbeChatSplit<T extends { click(): void; focus(): void }>(input: {
  visibleButton(label: string): T | undefined;
  mobileThoughtPartner(): T | undefined;
  pause(): Promise<unknown>;
  until<V>(read: () => V | Promise<V>, label: string): Promise<NonNullable<V>>;
}) {
  const control = await input.until(() => {
    const desktop = input.visibleButton('Open split pane options');
    if (desktop) return { kind: 'desktop' as const, node: desktop };
    const mobile = input.visibleButton('Split pane');
    return mobile ? { kind: 'mobile' as const, node: mobile } : undefined;
  }, 'visible normal split control');
  if (control.kind === 'desktop') {
    control.node.focus(); await input.pause();
    (await input.until(() => input.visibleButton('Split with thought partner'), 'visible desktop thought partner split')).click();
  } else {
    control.node.click();
    (await input.until(input.mobileThoughtPartner, 'normal mobile thought partner pane option')).click();
  }
  return control.kind;
}
