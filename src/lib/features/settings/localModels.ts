import type { LocalModel } from '$lib/features/chat/types';

export function mergeLocalModels(
  discovered: LocalModel[],
  configuredModel: string
): LocalModel[] {
  const merged = new Map<string, LocalModel>();
  const configured = configuredModel.trim();

  if (configured) {
    merged.set(configured, { id: configured, ownedBy: null });
  }
  for (const model of discovered) {
    const id = model.id.trim();
    if (id) merged.set(id, { ...model, id });
  }

  return [...merged.values()];
}
