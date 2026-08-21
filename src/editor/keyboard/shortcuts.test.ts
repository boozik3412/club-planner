import { describe, expect, it } from "vitest";
import { resolveEditorShortcut } from "./shortcuts";

function shortcut(
  code: string,
  options: Partial<{ key: string; ctrlKey: boolean; shiftKey: boolean }> = {},
) {
  return resolveEditorShortcut({
    code,
    key: options.key ?? code,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: false,
    shiftKey: options.shiftKey ?? false,
    altKey: false,
  });
}

describe("editor shortcuts", () => {
  it("maps the primary project and editing commands", () => {
    expect(shortcut("KeyN", { ctrlKey: true })).toBe("new");
    expect(shortcut("KeyS", { ctrlKey: true })).toBe("save");
    expect(shortcut("KeyS", { ctrlKey: true, shiftKey: true })).toBe("save-as");
    expect(shortcut("KeyE", { ctrlKey: true })).toBe("export-svg");
    expect(shortcut("KeyE", { ctrlKey: true, shiftKey: true })).toBe("export-pdf");
    expect(shortcut("KeyZ", { ctrlKey: true })).toBe("undo");
    expect(shortcut("KeyZ", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(shortcut("KeyG", { ctrlKey: true })).toBe("group");
    expect(shortcut("KeyG", { ctrlKey: true, shiftKey: true })).toBe("ungroup");
    expect(shortcut("KeyL", { ctrlKey: true })).toBe("toggle-lock");
    expect(shortcut("KeyM")).toBe("measure");
    expect(shortcut("KeyV")).toBe("select-tool");
    expect(shortcut("KeyH")).toBe("pan-tool");
    expect(shortcut("KeyF")).toBe("fit");
    expect(shortcut("KeyH", { shiftKey: true })).toBe("mirror-horizontal");
    expect(shortcut("KeyV", { shiftKey: true })).toBe("mirror-vertical");
  });

  it("uses the physical code when event.key contains a Russian-layout character", () => {
    expect(shortcut("KeyZ", { key: "я", ctrlKey: true })).toBe("undo");
    expect(shortcut("KeyG", { key: "п", ctrlKey: true })).toBe("group");
    expect(shortcut("KeyM", { key: "ь" })).toBe("measure");
    expect(shortcut("KeyH", { key: "Р", shiftKey: true })).toBe("mirror-horizontal");
  });

  it("maps views and blocks browser-only WebView commands", () => {
    expect(shortcut("Digit0", { ctrlKey: true })).toBe("fit");
    expect(shortcut("Digit1", { ctrlKey: true })).toBe("view-2d");
    expect(shortcut("Digit2", { ctrlKey: true })).toBe("view-3d");
    expect(shortcut("Digit3", { ctrlKey: true })).toBe("view-split");
    expect(shortcut("KeyR", { ctrlKey: true })).toBe("block-browser");
    expect(shortcut("KeyP", { ctrlKey: true })).toBe("block-browser");
  });
});
