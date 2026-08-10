import { useCallback, useEffect, useState } from "react";
import { BasePlanCanvas } from "./components/BasePlanCanvas";
import { Sidebar } from "./components/Sidebar";
import { normalizeQuarterTurn } from "./editor/base-plan";

export interface PlanControls {
  rotationDeg: number;
  gridVisible: boolean;
  labelsVisible: boolean;
  objectLabelsVisible: boolean;
  opacity: number;
}

const initialControls: PlanControls = {
  rotationDeg: 0,
  gridVisible: true,
  labelsVisible: true,
  objectLabelsVisible: true,
  opacity: 0.82,
};

function useDesktopGuards() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const browserCommand =
        event.key === "F5" ||
        (event.ctrlKey && ["r", "p", "+", "-", "0"].includes(key));

      if (browserCommand) {
        event.preventDefault();
      }
    };

    const handleContextMenu = (event: MouseEvent) => event.preventDefault();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);
}

export default function App() {
  const [controls, setControls] = useState<PlanControls>(initialControls);
  const [status, setStatus] = useState("Загрузка базовой планировки…");

  useDesktopGuards();

  const rotateCanvas = useCallback((deltaDeg: number) => {
    setControls((current) => ({
      ...current,
      rotationDeg: normalizeQuarterTurn(current.rotationDeg + deltaDeg),
    }));
  }, []);

  const resetRotation = useCallback(() => {
    setControls((current) => ({ ...current, rotationDeg: 0 }));
  }, []);

  const updateControls = useCallback((patch: Partial<PlanControls>) => {
    setControls((current) => ({ ...current, ...patch }));
  }, []);

  const reportPlanReady = useCallback((labelCount: number) => {
    setStatus(`Базовый план готов · ${labelCount} подписей`);
  }, []);

  const reportPlanError = useCallback((message: string) => {
    setStatus(`Ошибка базового плана: ${message}`);
  }, []);

  const reportPlanFitted = useCallback(() => {
    setStatus("Базовый план вписан в рабочую область.");
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        controls={controls}
        onChange={updateControls}
        onFit={reportPlanFitted}
        onRotate={rotateCanvas}
        onResetRotation={resetRotation}
      />

      <main className="workspace" aria-label="Рабочая область плана">
        <BasePlanCanvas
          controls={controls}
          onReady={reportPlanReady}
          onError={reportPlanError}
        />

        <div className="workspace-hud" aria-live="polite">
          <strong>Новая база</strong>
          <span>Замер 2026 · лестница слева · векторный слой заблокирован</span>
        </div>

        <div className="workspace-status">
          <span>{status}</span>
          <span>{controls.rotationDeg}° · вписано</span>
        </div>
      </main>
    </div>
  );
}
