import { invoke } from "@tauri-apps/api/core";
import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";

export interface FilePayload {
  path: string;
  contents: string;
  assets: ProjectAssetPayload[];
}

export interface ProjectAssetPayload {
  path: string;
  mimeType: string;
  dataBase64: string;
}

export interface BinaryFilePayload {
  path: string;
  name: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  dataBase64: string;
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in globalThis;
}

function downloadText(fileName: string, contents: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function openBrowserFile(extensions: string): Promise<FilePayload | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions;
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        resolve(file ? { path: file.name, contents: await file.text(), assets: [] } : null);
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

export async function chooseAndOpenProject(): Promise<FilePayload | null> {
  if (!isTauriRuntime()) return openBrowserFile(".clubplan,.json,application/json");
  const path = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Club Planner", extensions: ["clubplan"] },
      { name: "Legacy JSON", extensions: ["json"] },
    ],
  });
  return typeof path === "string" ? invoke<FilePayload>("read_project_file", { path }) : null;
}

export async function openProjectAtPath(path: string): Promise<FilePayload> {
  if (!isTauriRuntime()) throw new Error("Недавние файлы доступны в настольной версии");
  return invoke<FilePayload>("read_project_file", { path });
}

export async function saveProjectContents(
  contents: string,
  currentPath: string | null,
  forceChoose: boolean,
  assets: readonly ProjectAssetPayload[] = [],
): Promise<string | null> {
  if (!isTauriRuntime()) {
    downloadText("club-layout.clubplan", contents, "application/json");
    return "club-layout.clubplan";
  }
  let path = forceChoose ? null : currentPath;
  if (!path) {
    path = await save({
      defaultPath: "club-layout.clubplan",
      filters: [{ name: "Club Planner", extensions: ["clubplan"] }],
    });
  }
  if (!path) return null;
  if (!path.toLowerCase().endsWith(".clubplan")) path += ".clubplan";
  return invoke<string>("write_project_file", { path, contents, assets });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function openBrowserPlanSource(): Promise<BinaryFilePayload | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        if (file.size > 128 * 1024 * 1024) throw new Error("Исходный план превышает безопасный размер 128 МБ");
        const mimeType = file.type === "application/pdf" || file.type === "image/png" || file.type === "image/jpeg"
          ? file.type
          : file.name.toLowerCase().endsWith(".pdf") ? "application/pdf"
            : file.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
        resolve({
          path: file.name,
          name: file.name,
          mimeType,
          dataBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
        });
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

export async function choosePlanSource(): Promise<BinaryFilePayload | null> {
  if (!isTauriRuntime()) return openBrowserPlanSource();
  const path = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Планы помещений", extensions: ["pdf", "png", "jpg", "jpeg"] },
      { name: "PDF", extensions: ["pdf"] },
      { name: "Изображения", extensions: ["png", "jpg", "jpeg"] },
    ],
  });
  return typeof path === "string" ? invoke<BinaryFilePayload>("read_plan_source", { path }) : null;
}

export async function saveSvgContents(contents: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    downloadText("club-layout.svg", contents, "image/svg+xml");
    return "club-layout.svg";
  }
  let path = await save({
    defaultPath: "club-layout.svg",
    filters: [{ name: "SVG", extensions: ["svg"] }],
  });
  if (!path) return null;
  if (!path.toLowerCase().endsWith(".svg")) path += ".svg";
  return invoke<string>("write_svg_file", { path, contents });
}

export async function savePdfContents(contents: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error("Экспорт PDF доступен в настольном приложении");
  }
  let path = await save({
    defaultPath: "club-layout.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return null;
  if (!path.toLowerCase().endsWith(".pdf")) path += ".pdf";
  return invoke<string>("write_pdf_file", { path, contents });
}

export async function writeRecovery(contents: string): Promise<void> {
  if (isTauriRuntime()) await invoke("write_recovery", { contents });
}

export async function readRecovery(): Promise<string | null> {
  return isTauriRuntime() ? invoke<string | null>("read_recovery") : null;
}

export async function clearRecovery(): Promise<void> {
  if (isTauriRuntime()) await invoke("clear_recovery");
}

export async function exitApplication(): Promise<void> {
  if (isTauriRuntime()) await invoke("exit_application");
}

export async function confirmAction(text: string, title = "Club Planner"): Promise<boolean> {
  return isTauriRuntime()
    ? confirm(text, { title, kind: "warning" })
    : window.confirm(text);
}

export async function showError(text: string): Promise<void> {
  if (isTauriRuntime()) await message(text, { title: "Club Planner", kind: "error" });
  else window.alert(text);
}
