import type { DownloadEvent } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  currentVersion: string;
  version: string;
  notes: string;
  date: string | null;
}

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  finished: boolean;
}

export interface AppUpdateCandidate {
  info: UpdateInfo;
  downloadAndInstall: (onProgress: (progress: DownloadProgress) => void) => Promise<void>;
  relaunch: () => Promise<void>;
  dispose: () => Promise<void>;
}

export type UpdaterViewState =
  | { phase: "unavailable" }
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current" }
  | { phase: "available"; info: UpdateInfo }
  | { phase: "installing"; info: UpdateInfo; progress: DownloadProgress }
  | { phase: "restarting"; info: UpdateInfo }
  | { phase: "error"; message: string };

export const EMPTY_DOWNLOAD_PROGRESS: DownloadProgress = {
  downloadedBytes: 0,
  totalBytes: null,
  finished: false,
};

export function reduceDownloadProgress(
  current: DownloadProgress,
  event: DownloadEvent,
): DownloadProgress {
  if (event.event === "Started") {
    return {
      downloadedBytes: 0,
      totalBytes: event.data.contentLength ?? null,
      finished: false,
    };
  }
  if (event.event === "Progress") {
    return {
      ...current,
      downloadedBytes: current.downloadedBytes + event.data.chunkLength,
    };
  }
  return { ...current, finished: true };
}

export function formatDownloadProgress(progress: DownloadProgress): string {
  if (progress.finished) return "Загрузка завершена · установка…";
  if (!progress.totalBytes) {
    return progress.downloadedBytes > 0
      ? `Загружено ${formatMegabytes(progress.downloadedBytes)}`
      : "Подготовка загрузки…";
  }
  const percent = Math.min(100, Math.round(progress.downloadedBytes / progress.totalBytes * 100));
  return `${percent}% · ${formatMegabytes(progress.downloadedBytes)} из ${formatMegabytes(progress.totalBytes)}`;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

export async function checkForAppUpdate(): Promise<AppUpdateCandidate | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 15_000 });
  if (!update) return null;

  const info: UpdateInfo = {
    currentVersion: update.currentVersion,
    version: update.version,
    notes: update.body?.trim() ?? "",
    date: update.date ?? null,
  };

  return {
    info,
    async downloadAndInstall(onProgress) {
      let progress = EMPTY_DOWNLOAD_PROGRESS;
      await update.downloadAndInstall((event) => {
        progress = reduceDownloadProgress(progress, event);
        onProgress(progress);
      }, { timeout: 120_000 });
    },
    async relaunch() {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
    async dispose() {
      await update.close();
    },
  };
}
