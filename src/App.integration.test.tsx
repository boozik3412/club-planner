/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const desktopMocks = vi.hoisted(() => ({
  chooseAndOpenProject: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("./components/BasePlanCanvas", () => ({
  BasePlanCanvas: () => <main aria-label="Рабочая область плана" />,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("./editor/persistence/desktop-files", () => ({
  chooseAndOpenProject: desktopMocks.chooseAndOpenProject,
  clearRecovery: vi.fn().mockResolvedValue(undefined),
  confirmAction: vi.fn().mockResolvedValue(true),
  exitApplication: vi.fn().mockResolvedValue(undefined),
  isTauriRuntime: vi.fn().mockReturnValue(false),
  openProjectAtPath: vi.fn(),
  readRecovery: vi.fn().mockResolvedValue(null),
  saveProjectContents: vi.fn().mockResolvedValue(null),
  saveSvgContents: vi.fn().mockResolvedValue(null),
  showError: desktopMocks.showError.mockResolvedValue(undefined),
  writeRecovery: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("App integration", () => {
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

  it("blocks browser-only desktop shortcuts", () => {
    render(<App />);

    expect(fireEvent.keyDown(window, { key: "F5", code: "F5", cancelable: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "r", ctrlKey: true, cancelable: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "p", ctrlKey: true, cancelable: true })).toBe(false);
  });
});
