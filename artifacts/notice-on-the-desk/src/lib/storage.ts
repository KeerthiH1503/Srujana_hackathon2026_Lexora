import type { AnalysisResult, Stage, TrackedNotice } from "@/types/analysis";

const STORAGE_KEY = "lexora.tracker.v1";
const LEGACY_STORAGE_KEY = "notice-on-the-desk.tracker.v1";

export type TrackerDetailsUpdate = Partial<
  Pick<TrackedNotice, "unresolved" | "docsGathered">
>;

function readEntries(): TrackedNotice[] {
  if (typeof window === "undefined") return [];
  let raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) window.localStorage.setItem(STORAGE_KEY, raw);
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Tracker data could not be read. Clear it or restore a valid browser storage entry.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Tracker data has an unexpected format.");
  }

  return parsed as TrackedNotice[];
}

function writeEntries(entries: TrackedNotice[]): void {
  if (typeof window === "undefined") {
    throw new Error("The tracker is only available in a browser.");
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function updateEntry(
  id: string,
  updater: (entry: TrackedNotice) => TrackedNotice,
): TrackedNotice | null {
  const entries = readEntries();
  const index = entries.findIndex((entry) => entry.result.id === id);
  if (index < 0) return null;

  const nextEntry = updater(entries[index]);
  entries[index] = nextEntry;
  writeEntries(entries);
  return nextEntry;
}

export const trackerStorage = {
  list(): TrackedNotice[] {
    return readEntries().sort(
      (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
    );
  },

  get(id: string): TrackedNotice | null {
    return readEntries().find((entry) => entry.result.id === id) ?? null;
  },

  add(result: AnalysisResult): TrackedNotice {
    const entries = readEntries();
    const existing = entries.find((entry) => entry.result.id === result.id);
    if (existing) return existing;

    const entry: TrackedNotice = {
      result,
      stage: "received",
      addedAt: new Date().toISOString(),
      unresolved: [],
      docsGathered: [],
    };
    writeEntries([entry, ...entries]);
    return entry;
  },

  updateStage(id: string, stage: Stage): TrackedNotice | null {
    return updateEntry(id, (entry) => ({ ...entry, stage }));
  },

  updateDetails(
    id: string,
    updates: TrackerDetailsUpdate,
  ): TrackedNotice | null {
    return updateEntry(id, (entry) => ({ ...entry, ...updates }));
  },

  delete(id: string): boolean {
    const entries = readEntries();
    const remaining = entries.filter((entry) => entry.result.id !== id);
    if (remaining.length === entries.length) return false;
    writeEntries(remaining);
    return true;
  },
};
