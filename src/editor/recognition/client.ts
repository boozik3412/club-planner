import type {
  RecognitionDraft,
  RecognitionImage,
  RecognitionOptions,
  RecognitionProgress,
  RecognizerRequest,
  RecognizerResponse,
} from "./types";
import type { PlanSource } from "../model/types";

interface ActiveRecognition {
  cancel: () => void;
  result: Promise<RecognitionDraft>;
}

export function startRecognition(
  image: RecognitionImage,
  source: PlanSource,
  options: RecognitionOptions,
  onProgress: (progress: RecognitionProgress) => void,
): ActiveRecognition {
  const worker = new Worker(new URL("./recognizer.worker.ts", import.meta.url), { type: "module", name: "club-planner-recognizer" });
  const id = crypto.randomUUID();
  let settled = false;
  let rejectResult: ((reason?: unknown) => void) | null = null;
  const result = new Promise<RecognitionDraft>((resolve, reject) => {
    rejectResult = reject;
    worker.onmessage = (event: MessageEvent<RecognizerResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      if (response.type === "progress") onProgress(response.progress);
      if (response.type === "result") {
        settled = true;
        worker.terminate();
        resolve(response.draft);
      }
      if (response.type === "cancelled") {
        settled = true;
        worker.terminate();
        reject(new DOMException("Распознавание отменено", "AbortError"));
      }
      if (response.type === "error") {
        settled = true;
        worker.terminate();
        reject(new Error(response.message));
      }
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      reject(new Error(event.message || "Локальный распознаватель аварийно завершился"));
    };
    const request: RecognizerRequest = { id, type: "recognize", image, source, options };
    worker.postMessage(request, [image.rgba.buffer]);
  });
  return {
    result,
    cancel: () => {
      if (settled) return;
      worker.postMessage({ id, type: "cancel" } satisfies RecognizerRequest);
      window.setTimeout(() => {
        if (!settled) {
          settled = true;
          worker.terminate();
          rejectResult?.(new DOMException("Распознавание отменено", "AbortError"));
        }
      }, 1_500);
    },
  };
}
