import { describe, expect, it } from "vitest";
import {
  EMPTY_DOWNLOAD_PROGRESS,
  formatDownloadProgress,
  reduceDownloadProgress,
} from "./app-updater";

describe("app updater progress", () => {
  it("accumulates chunks against the announced download size", () => {
    let progress = reduceDownloadProgress(EMPTY_DOWNLOAD_PROGRESS, {
      event: "Started",
      data: { contentLength: 10 * 1024 * 1024 },
    });
    progress = reduceDownloadProgress(progress, {
      event: "Progress",
      data: { chunkLength: 2.5 * 1024 * 1024 },
    });

    expect(progress).toEqual({
      downloadedBytes: 2.5 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024,
      finished: false,
    });
    expect(formatDownloadProgress(progress)).toBe("25% · 2,5 МБ из 10,0 МБ");
  });

  it("handles an unknown content length and the install transition", () => {
    let progress = reduceDownloadProgress(EMPTY_DOWNLOAD_PROGRESS, {
      event: "Started",
      data: {},
    });
    progress = reduceDownloadProgress(progress, {
      event: "Progress",
      data: { chunkLength: 1024 * 1024 },
    });
    expect(formatDownloadProgress(progress)).toBe("Загружено 1,0 МБ");

    progress = reduceDownloadProgress(progress, { event: "Finished" });
    expect(formatDownloadProgress(progress)).toBe("Загрузка завершена · установка…");
  });
});
