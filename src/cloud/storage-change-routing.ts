interface StorageValueChange {
  oldValue?: unknown;
  newValue?: unknown;
}

type StorageChanges = Record<string, StorageValueChange | undefined>;

const CONVERSATION_MAP_KEYS = [
  'conversationTags',
  'conversationNotes',
  'cooperationProfiles',
  'conversationSopStages',
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function cloudSyncStorageRoute(changes: StorageChanges): {
  syncAll: boolean;
  conversationIds: string[];
} {
  // Applied atomically with downloaded values; do not echo them back to the server.
  if (changes.cloudRestoreApplied) return { syncAll: false, conversationIds: [] };
  if (changes.cloudSettings || changes.tagDefinitions) {
    return { syncAll: true, conversationIds: [] };
  }

  const conversationIds = new Set<string>();
  for (const key of CONVERSATION_MAP_KEYS) {
    const change = changes[key];
    if (!change) continue;
    const previous = record(change.oldValue);
    const next = record(change.newValue);
    for (const conversationId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (JSON.stringify(previous[conversationId]) !== JSON.stringify(next[conversationId])) {
        conversationIds.add(conversationId);
      }
    }
  }
  return { syncAll: false, conversationIds: [...conversationIds] };
}
