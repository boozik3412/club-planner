export type EditorShortcut =
  | "block-browser"
  | "new"
  | "open"
  | "save"
  | "save-as"
  | "export-svg"
  | "export-pdf"
  | "undo"
  | "redo"
  | "duplicate"
  | "copy"
  | "paste"
  | "group"
  | "ungroup"
  | "select-all"
  | "toggle-lock"
  | "fit"
  | "view-2d"
  | "view-3d"
  | "view-split"
  | "select-tool"
  | "pan-tool"
  | "measure"
  | "room-tool"
  | "door-tool"
  | "mirror-horizontal"
  | "mirror-vertical"
  | "delete"
  | "escape"
  | "rotate-clockwise"
  | "rotate-counterclockwise"
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down";

export interface ShortcutKeyboardEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

function physicalKey(event: ShortcutKeyboardEvent): string {
  if (event.code) return event.code;
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return event.key;
}

export function resolveEditorShortcut(event: ShortcutKeyboardEvent): EditorShortcut | null {
  const code = physicalKey(event);
  const control = event.ctrlKey || event.metaKey;

  if (event.key === "F5" || (control && ["KeyR", "KeyP", "Equal", "Minus", "NumpadAdd", "NumpadSubtract"].includes(code))) {
    return "block-browser";
  }
  if (event.altKey) return null;

  if (control) {
    if (code === "KeyN") return "new";
    if (code === "KeyO") return "open";
    if (code === "KeyS") return event.shiftKey ? "save-as" : "save";
    if (code === "KeyE") return event.shiftKey ? "export-pdf" : "export-svg";
    if (code === "KeyZ") return event.shiftKey ? "redo" : "undo";
    if (code === "KeyY") return "redo";
    if (code === "KeyD") return "duplicate";
    if (code === "KeyC") return "copy";
    if (code === "KeyV") return "paste";
    if (code === "KeyG") return event.shiftKey ? "ungroup" : "group";
    if (code === "KeyA") return "select-all";
    if (code === "KeyL") return "toggle-lock";
    if (code === "Digit0" || code === "Numpad0") return "fit";
    if (code === "Digit1" || code === "Numpad1") return "view-2d";
    if (code === "Digit2" || code === "Numpad2") return "view-3d";
    if (code === "Digit3" || code === "Numpad3") return "view-split";
    return null;
  }

  if (event.key === "Delete" || event.key === "Backspace") return "delete";
  if (event.key === "Escape") return "escape";
  if (event.shiftKey && code === "KeyH") return "mirror-horizontal";
  if (event.shiftKey && code === "KeyV") return "mirror-vertical";
  if (code === "KeyV") return "select-tool";
  if (code === "KeyH") return "pan-tool";
  if (code === "KeyR") return event.shiftKey ? "rotate-counterclockwise" : "rotate-clockwise";
  if (code === "KeyM") return "measure";
  if (code === "KeyP") return "room-tool";
  if (code === "KeyD") return "door-tool";
  if (code === "KeyF") return "fit";
  if (event.key === "ArrowLeft") return "move-left";
  if (event.key === "ArrowRight") return "move-right";
  if (event.key === "ArrowUp") return "move-up";
  if (event.key === "ArrowDown") return "move-down";
  return null;
}
