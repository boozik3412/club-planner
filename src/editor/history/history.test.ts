import { describe, expect, it } from "vitest";
import { updateProject, createEmptyProject } from "../model/project";
import {
  commitHistory,
  createHistory,
  isHistoryDirty,
  markHistorySaved,
  redoHistory,
  undoHistory,
} from "./history";

describe("transactional history", () => {
  it("undoes and redoes one whole project transaction", () => {
    const initial = createEmptyProject();
    const changed = updateProject(initial, (draft) => {
      draft.canvas.rotationDeg = 90;
    });
    const history = commitHistory(createHistory(initial), changed, "Поворот холста");
    expect(history.past).toHaveLength(1);
    expect(undoHistory(history).present.project.canvas.rotationDeg).toBe(0);
    expect(redoHistory(undoHistory(history)).present.project.canvas.rotationDeg).toBe(90);
  });

  it("tracks dirty state by revision and clears it when returning to the saved revision", () => {
    const initial = createEmptyProject();
    const saved = markHistorySaved(createHistory(initial));
    const changed = commitHistory(saved, updateProject(initial, (draft) => {
      draft.canvas.gridVisible = false;
    }), "Сетка");
    expect(isHistoryDirty(changed)).toBe(true);
    expect(isHistoryDirty(undoHistory(changed))).toBe(false);
  });

  it("keeps at least one hundred completed commands", () => {
    let history = createHistory(createEmptyProject(), true, 100);
    for (let index = 0; index < 120; index += 1) {
      history = commitHistory(history, updateProject(history.present.project, (draft) => {
        draft.canvas.basePlanOpacity = index / 120;
      }), `Шаг ${index}`);
    }
    expect(history.past).toHaveLength(100);
  });

  it("clears redo after a new command following undo", () => {
    const initial = createEmptyProject();
    const first = commitHistory(createHistory(initial), updateProject(initial, (draft) => {
      draft.canvas.rotationDeg = 90;
    }), "Первый поворот");
    const undone = undoHistory(first);
    const branched = commitHistory(undone, updateProject(undone.present.project, (draft) => {
      draft.canvas.gridVisible = false;
    }), "Сетка");

    expect(branched.future).toHaveLength(0);
    expect(redoHistory(branched)).toBe(branched);
  });
});
