/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const desktopMocks = vi.hoisted(() => ({
  chooseAndOpenProject: vi.fn(),
  confirmAction: vi.fn().mockResolvedValue(true),
  isTauriRuntime: vi.fn().mockReturnValue(false),
  showError: vi.fn(),
  writeRecovery: vi.fn().mockResolvedValue(undefined),
}));

const updaterMocks = vi.hoisted(() => ({
  checkForAppUpdate: vi.fn(),
}));

const windowMocks = vi.hoisted(() => ({
  onCloseRequested: vi.fn().mockResolvedValue(() => undefined),
  setTitle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./components/BasePlanCanvas", () => ({
  BasePlanCanvas: ({
    betweenRequest,
    measureRequest,
    onAddDimension,
    onVisibleCenterChange,
  }: {
    betweenRequest: { mode: string } | null;
    measureRequest: number | null;
    onAddDimension: (start: { xM: number; yM: number }, end: { xM: number; yM: number }) => void;
    onVisibleCenterChange: (center: { xM: number; yM: number }) => void;
  }) => (
    <main aria-label="Рабочая область плана">
      <button type="button" onClick={() => onVisibleCenterChange({ xM: 12.3, yM: 4.5 })}>Сместить видимую область</button>
      {betweenRequest ? `Режим между перегородками: ${betweenRequest.mode}` : null}
      {measureRequest ? <button type="button" onClick={() => onAddDimension({ xM: 1, yM: 1 }, { xM: 4, yM: 1 })}>Создать тестовый размер</button> : null}
    </main>
  ),
}));

vi.mock("./components/Plan3DView", () => ({
  Plan3DView: () => <section aria-label="Тестовый 3D-вид">3D-сцена загружена</section>,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => windowMocks),
}));

vi.mock("./editor/updater/app-updater", async (importOriginal) => {
  const original = await importOriginal<typeof import("./editor/updater/app-updater")>();
  return { ...original, checkForAppUpdate: updaterMocks.checkForAppUpdate };
});

vi.mock("./editor/persistence/desktop-files", () => ({
  chooseAndOpenProject: desktopMocks.chooseAndOpenProject,
  clearRecovery: vi.fn().mockResolvedValue(undefined),
  confirmAction: desktopMocks.confirmAction,
  exitApplication: vi.fn().mockResolvedValue(undefined),
  isTauriRuntime: desktopMocks.isTauriRuntime,
  openProjectAtPath: vi.fn(),
  readRecovery: vi.fn().mockResolvedValue(null),
  saveProjectContents: vi.fn().mockResolvedValue(null),
  savePdfContents: vi.fn().mockResolvedValue(null),
  saveSvgContents: vi.fn().mockResolvedValue(null),
  showError: desktopMocks.showError.mockResolvedValue(undefined),
  writeRecovery: desktopMocks.writeRecovery,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  desktopMocks.isTauriRuntime.mockReturnValue(false);
  desktopMocks.confirmAction.mockResolvedValue(true);
  updaterMocks.checkForAppUpdate.mockResolvedValue(null);
});

describe("App integration", () => {
  it("adds a new object at the center of the currently visible plan area", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Сместить видимую область" }));
    await user.click(screen.getByRole("button", { name: /^Стол$/ }));

    expect(screen.getByRole("spinbutton", { name: "X, м" })).toHaveValue(12.3);
    expect(screen.getByRole("spinbutton", { name: "Y, м" })).toHaveValue(4.5);
  });

  it("copies and pastes selected objects with Ctrl+C and Ctrl+V", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^Стол$/ }));
    await user.keyboard("{Control>}c{/Control}{Control>}v{/Control}");

    expect(screen.getByText(/2 предметов · 0 групп/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Выбрано: 1" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "X, м" })).toHaveValue(31.55);
  });

  it("clears the pending status timer when the application view closes", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const user = userEvent.setup();
    const view = render(<App />);

    await user.click(screen.getByRole("button", { name: /^Стол$/ }));
    const statusTimerCallIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 4_000);
    expect(statusTimerCallIndex).toBeGreaterThanOrEqual(0);
    const statusTimerId = setTimeoutSpy.mock.results[statusTimerCallIndex]?.value;

    view.unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(statusTimerId);
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it("edits a base wall as one undoable transaction and opens the lazy 3D view", async () => {
    const user = userEvent.setup();
    render(<App />);

    const wallSelect = screen.getByRole("combobox", { name: "Архитектурная стена" });
    await user.selectOptions(wallSelect, "wall-main-top");
    const heightField = screen.getByRole("spinbutton", { name: "Высота стены, м" });
    await user.clear(heightField);
    await user.type(heightField, "2.7");
    fireEvent.blur(heightField);
    expect(screen.getByRole("spinbutton", { name: "Высота стены, м" })).toHaveValue(2.7);

    await user.click(screen.getByRole("button", { name: "↶" }));
    expect(screen.getByRole("spinbutton", { name: "Высота стены, м" })).toHaveValue(3.04);

    await user.click(screen.getAllByRole("button", { name: "3D" })[0]);
    expect(await screen.findByRole("region", { name: "Тестовый 3D-вид" })).toHaveTextContent("3D-сцена загружена");
  });

  it("bulk-edits, groups, undoes and redoes through the Russian UI", async () => {
    const user = userEvent.setup();
    render(<App />);

    const tableButton = screen.getByRole("button", { name: /^Стол$/ });
    await user.click(tableButton);
    await user.click(tableButton);
    await user.keyboard("{Control>}a{/Control}");

    expect(screen.getByRole("heading", { name: "Выбрано: 2" })).toBeInTheDocument();
    const widthField = screen.getByRole("spinbutton", { name: "Ширина, м" });
    await user.clear(widthField);
    await user.type(widthField, "1.3");
    await user.tab();
    expect(screen.getByRole("spinbutton", { name: "Ширина, м" })).toHaveValue(1.3);

    await user.click(screen.getByRole("button", { name: "Сгруппировать" }));
    expect(screen.getByText(/2 предметов · 1 групп/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Разгруппировать" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "↶" }));
    expect(screen.getByText(/2 предметов · 0 групп/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "↷" }));
    expect(screen.getByText(/2 предметов · 1 групп/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Разгруппировать" })).toBeEnabled();
  });

  it("handles popular shortcuts by physical key with a Russian layout and ignores inputs", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tableButton = screen.getByRole("button", { name: /^Стол$/ });
    await user.click(tableButton);
    await user.click(tableButton);
    fireEvent.keyDown(window, { key: "ф", code: "KeyA", ctrlKey: true, cancelable: true });
    fireEvent.keyDown(window, { key: "п", code: "KeyG", ctrlKey: true, cancelable: true });
    expect(screen.getByText(/2 предметов · 1 групп/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "я", code: "KeyZ", ctrlKey: true, cancelable: true });
    expect(screen.getByText(/2 предметов · 0 групп/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Я", code: "KeyZ", ctrlKey: true, shiftKey: true, cancelable: true });
    expect(screen.getByText(/2 предметов · 1 групп/)).toBeInTheDocument();

    const widthField = screen.getByRole("spinbutton", { name: "Ширина, м" });
    widthField.focus();
    fireEvent.keyDown(widthField, { key: "п", code: "KeyG", ctrlKey: true, shiftKey: true, cancelable: true });
    expect(screen.getByText(/2 предметов · 1 групп/)).toBeInTheDocument();
    widthField.blur();

    fireEvent.keyDown(window, { key: "д", code: "KeyL", ctrlKey: true, cancelable: true });
    expect(screen.getByText("Блокировка выборки")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2", code: "Digit2", ctrlKey: true, cancelable: true });
    expect(await screen.findByRole("region", { name: "Тестовый 3D-вид" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "1", code: "Digit1", ctrlKey: true, cancelable: true });
    fireEvent.keyDown(window, { key: "р", code: "KeyH", cancelable: true });
    expect(screen.getByRole("button", { name: "Рука (H)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "м", code: "KeyV", cancelable: true });
    expect(screen.getByRole("button", { name: "Выбор (V)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "ь", code: "KeyM", cancelable: true });
    expect(screen.getByRole("button", { name: "Создать тестовый размер" })).toBeInTheDocument();
  });

  it("mirrors a selection and splits a partition into two parts with one undo step", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^Дверь$/ }));
    fireEvent.keyDown(window, { key: "Р", code: "KeyH", shiftKey: true, cancelable: true });
    expect(screen.getByText("Отражение слева направо")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "↶" }));
    expect(screen.getByText("Отменено: Отражение слева направо")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Перегородка$/ }));
    const passage = screen.getByRole("spinbutton", { name: "Ширина прохода, м" });
    await user.clear(passage);
    await user.type(passage, "0.8");
    await user.click(screen.getByRole("button", { name: "Разделить перегородку" }));
    expect(screen.getByText(/3 предметов · 0 групп/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Выбрано: 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "↶" }));
    expect(screen.getByText(/2 предметов · 0 групп/)).toBeInTheDocument();
  });

  it("keeps the current project when opening a corrupted file fails", async () => {
    desktopMocks.chooseAndOpenProject.mockResolvedValueOnce({
      path: "C:\\broken.clubplan",
      contents: "{not-json",
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^Стол$/ }));

    await user.click(screen.getByRole("button", { name: /^Открыть$/ }));

    expect(await screen.findByText(/Ошибка открытия:/)).toBeInTheDocument();
    expect(screen.getByText(/1 предметов · 0 групп/)).toBeInTheDocument();
    expect(desktopMocks.showError).toHaveBeenCalledWith(expect.stringContaining("Не удалось открыть проект"));
  });

  it("creates custom rectangle, circle and oval with editable dimensions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^Прямоугольник$/ }));
    expect(screen.getByRole("spinbutton", { name: "Ширина, м" })).toHaveValue(1.5);
    expect(screen.getByRole("spinbutton", { name: "Глубина, м" })).toHaveValue(1);
    const rectangleHeight = screen.getByRole("spinbutton", { name: "Высота, м" });
    await user.clear(rectangleHeight);
    await user.type(rectangleHeight, "2.2");
    await user.tab();
    expect(screen.getByRole("spinbutton", { name: "Высота, м" })).toHaveValue(2.2);

    await user.click(screen.getByRole("button", { name: /^Круг$/ }));
    const circleWidth = screen.getByRole("spinbutton", { name: "Ширина, м" });
    await user.clear(circleWidth);
    await user.type(circleWidth, "2");
    await user.tab();
    expect(screen.getByRole("spinbutton", { name: "Ширина, м" })).toHaveValue(2);
    expect(screen.getByRole("spinbutton", { name: "Глубина, м" })).toHaveValue(2);

    await user.click(screen.getByRole("button", { name: /^Овал$/ }));
    expect(screen.getByRole("spinbutton", { name: "Ширина, м" })).toHaveValue(1.8);
    expect(screen.getByRole("spinbutton", { name: "Глубина, м" })).toHaveValue(1.1);
    expect(screen.getByText(/3 предметов · 0 групп/)).toBeInTheDocument();
  });

  it("starts centering and distribution between partitions from the selection panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^Стол$/ }));
    await user.click(screen.getByRole("button", { name: "По центру между" }));
    expect(screen.getByText("Режим между перегородками: center")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Заполнить проём" }));
    expect(screen.getByText("Режим между перегородками: fill")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Стол$/ }));
    await user.keyboard("{Control>}a{/Control}");
    await user.click(screen.getByRole("button", { name: "Равные промежутки" }));
    expect(screen.getByText("Режим между перегородками: distribute")).toBeInTheDocument();
  });

  it("blocks browser-only desktop shortcuts", () => {
    render(<App />);

    expect(fireEvent.keyDown(window, { key: "F5", code: "F5", cancelable: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "r", ctrlKey: true, cancelable: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "p", ctrlKey: true, cancelable: true })).toBe(false);
  });

  it("creates an array, reusable template, permanent dimension and updates the summary", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "ПК — 1 место" }));
    await user.click(screen.getByRole("button", { name: "Создать ряд" }));
    expect(screen.getByText(/3 предметов · 0 групп/)).toBeInTheDocument();
    expect(screen.getAllByText("3", { selector: ".summary-grid dd" })).toHaveLength(2);

    const templateName = screen.getByRole("textbox", { name: "Название составного шаблона" });
    await user.type(templateName, "Игровой ряд");
    await user.click(screen.getByRole("button", { name: "Сохранить выборку" }));
    expect(screen.getByText("Игровой ряд")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Вставить" }));
    expect(screen.getByText(/6 предметов · 1 групп/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Линейка · постоянный размер" }));
    await user.click(screen.getByRole("button", { name: "Создать тестовый размер" }));
    expect(screen.getByText("3.00 м")).toBeInTheDocument();

    const passage = screen.getByRole("spinbutton", { name: "Минимальный проход, м" });
    await user.clear(passage);
    await user.type(passage, "1.2");
    await user.tab();
    expect(screen.getByRole("spinbutton", { name: "Минимальный проход, м" })).toHaveValue(1.2);
  });

  it("selects an existing persistent dimension and deletes it with Delete", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Линейка · постоянный размер" }));
    await user.click(screen.getByRole("button", { name: "Создать тестовый размер" }));

    const dimension = screen.getByRole("button", { name: /^Размер 1/ });
    expect(dimension).toHaveTextContent("3.00 м");
    await user.keyboard("{Escape}");
    expect(dimension).toHaveAttribute("aria-pressed", "false");
    await user.click(dimension);
    expect(dimension).toHaveAttribute("aria-pressed", "true");

    await user.keyboard("{Delete}");
    expect(screen.queryByRole("button", { name: /^Размер 1/ })).not.toBeInTheDocument();
    expect(screen.getByText("Создайте размер инструментом «Линейка»." )).toBeInTheDocument();
  });

  it("checks for a signed update, preserves dirty work and installs only after confirmation", async () => {
    desktopMocks.isTauriRuntime.mockReturnValue(true);
    const candidate = {
      info: {
        currentVersion: "0.1.2",
        version: "0.1.3",
        notes: "Исправления редактора",
        date: "2026-08-13T10:00:00Z",
      },
      downloadAndInstall: vi.fn(async (onProgress: (progress: { downloadedBytes: number; totalBytes: number; finished: boolean }) => void) => {
        onProgress({ downloadedBytes: 5, totalBytes: 10, finished: false });
        onProgress({ downloadedBytes: 10, totalBytes: 10, finished: true });
      }),
      relaunch: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    updaterMocks.checkForAppUpdate.mockResolvedValue(candidate);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Доступна v0.1.3")).toBeInTheDocument();
    expect(screen.getByText("Исправления редактора")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Стол$/ }));
    await user.click(screen.getByRole("button", { name: "Установить и перезапустить" }));

    expect(desktopMocks.confirmAction).toHaveBeenCalledWith(
      expect.stringContaining("Несохранённый проект будет помещён в автосохранение"),
      "Обновление Club Planner",
    );
    expect(desktopMocks.writeRecovery).toHaveBeenCalledOnce();
    expect(candidate.downloadAndInstall).toHaveBeenCalledOnce();
    expect(candidate.relaunch).toHaveBeenCalledOnce();
  });

  it("keeps an update-server failure non-blocking and offers a manual retry", async () => {
    desktopMocks.isTauriRuntime.mockReturnValue(true);
    updaterMocks.checkForAppUpdate.mockRejectedValue(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<App />);

    const retry = await screen.findByRole("button", { name: "Проверить обновления" });
    expect(screen.queryByText(/Не удалось связаться/)).not.toBeInTheDocument();
    await user.click(retry);

    expect(await screen.findByText("Не удалось связаться с сервером обновлений. Проверьте интернет и повторите попытку.")).toBeInTheDocument();
    expect(screen.getAllByRole("main", { name: "Рабочая область плана" })).not.toHaveLength(0);
  });
});
