type RestoredTab = {
  id: string;
  title: string;
  content: string;
  filePath?: string | null;
};

export function getDirtyTabIds(
  tabs: RestoredTab[],
  savedTabs: Record<string, { title: string; content: string }>,
): string[] {
  return tabs.filter((tab) => {
    const saved = savedTabs[tab.id];
    return !saved || saved.title !== tab.title || saved.content !== tab.content;
  }).map((tab) => tab.id);
}

export function getRestoredDirtyTabIds(tabs: RestoredTab[], storedIds: unknown): Set<string> {
  if (Array.isArray(storedIds) && storedIds.every((id) => typeof id === "string")) {
    return new Set(storedIds);
  }
  // Older versions did not persist the saved baseline. Keep uncertain content unsaved.
  return new Set(tabs.filter((tab) => tab.content !== "" || tab.filePath).map((tab) => tab.id));
}

export function writeLocalState(storage: Storage, key: string, state: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
