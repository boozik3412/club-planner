import type { ProjectState } from "../model/types";

export interface HistoryNode {
  project: ProjectState;
  revision: number;
  label: string;
}

export interface HistoryState {
  past: HistoryNode[];
  present: HistoryNode;
  future: HistoryNode[];
  nextRevision: number;
  savedRevision: number | null;
  limit: number;
}

export function createHistory(
  project: ProjectState,
  saved = true,
  limit = 100,
): HistoryState {
  return {
    past: [],
    present: { project, revision: 0, label: "Новый проект" },
    future: [],
    nextRevision: 1,
    savedRevision: saved ? 0 : null,
    limit,
  };
}

export function commitHistory(
  history: HistoryState,
  project: ProjectState,
  label: string,
): HistoryState {
  if (project === history.present.project) return history;
  const past = [...history.past, history.present].slice(-history.limit);
  return {
    ...history,
    past,
    present: { project, revision: history.nextRevision, label },
    future: [],
    nextRevision: history.nextRevision + 1,
  };
}

export function undoHistory(history: HistoryState): HistoryState {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistory(history: HistoryState): HistoryState {
  const next = history.future[0];
  if (!next) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: next,
    future: history.future.slice(1),
  };
}

export function markHistorySaved(history: HistoryState): HistoryState {
  return { ...history, savedRevision: history.present.revision };
}

export function isHistoryDirty(history: HistoryState): boolean {
  return history.present.revision !== history.savedRevision;
}

export function canUndo(history: HistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.future.length > 0;
}
