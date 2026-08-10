import type { PlanControls } from "../App";

interface SidebarProps {
  controls: PlanControls;
  onChange: (patch: Partial<PlanControls>) => void;
  onFit: () => void;
  onRotate: (deltaDeg: number) => void;
  onResetRotation: () => void;
}

const objectTypes = [
  "ПК — 1 место",
  "ПК — 2 места",
  "Линия — 5 ПК",
  "Диван",
  "Кресло",
  "Стол",
  "Консольная зона",
  "Ресепшн",
  "Барная стойка",
  "Серверная стойка",
  "Перегородка",
  "Свободная зона",
];

export function Sidebar({
  controls,
  onChange,
  onFit,
  onRotate,
  onResetRotation,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <header className="brand-row">
        <div>
          <h1>Планировщик клуба</h1>
          <p>Club Planner Desktop</p>
        </div>
        <span className="version-tag">Tauri 2</span>
      </header>

      <div className="base-note">
        <strong>Новая базовая планировка</strong>
        <span>Источник: «Замер.pdf» · точная векторная геометрия</span>
      </div>

      <section className="panel-section">
        <h2>Навигация и холст</h2>
        <div className="button-grid button-grid--three">
          <button className="button button--primary" type="button" onClick={onFit}>
            Вписать
          </button>
          <button type="button" onClick={() => onRotate(-90)} aria-label="Повернуть холст влево">
            ↺ 90°
          </button>
          <button type="button" onClick={() => onRotate(90)} aria-label="Повернуть холст вправо">
            90° ↻
          </button>
        </div>
        <button className="button button--wide" type="button" onClick={onResetRotation}>
          Сбросить поворот холста
        </button>

        <div className="check-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={controls.gridVisible}
              onChange={(event) => onChange({ gridVisible: event.target.checked })}
            />
            Сетка 0,5 м
          </label>
          <label className="check-row" title="Будет подключено вместе с редактором предметов">
            <input type="checkbox" checked disabled />
            Привязка 0,1 м
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={controls.labelsVisible}
              onChange={(event) => onChange({ labelsVisible: event.target.checked })}
            />
            Надписи плана
          </label>
          <label className="check-row" title="Станет доступно после переноса предметов">
            <input
              type="checkbox"
              checked={controls.objectLabelsVisible}
              disabled
              readOnly
            />
            Подписи предметов
          </label>
        </div>

        <label className="field-label" htmlFor="base-opacity">
          Контраст базового чертежа
        </label>
        <input
          id="base-opacity"
          className="range"
          type="range"
          min="0.25"
          max="1"
          step="0.05"
          value={controls.opacity}
          onChange={(event) => onChange({ opacity: Number(event.target.value) })}
        />
        <p className="hint">Поворот и параметры базового слоя уже работают. Зум и панорамирование будут перенесены следующим шагом.</p>
      </section>

      <section className="panel-section">
        <h2>Добавить предмет</h2>
        <div className="object-grid" aria-label="Библиотека предметов">
          {objectTypes.map((label) => (
            <button key={label} type="button" disabled title="Будет подключено на следующем этапе">
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2>Выбранный предмет</h2>
        <div className="empty-selection">
          <span className="empty-selection__mark" aria-hidden="true">□</span>
          <span>Выберите предмет на плане.</span>
          <small>Редактирование предметов — следующий этап.</small>
        </div>
      </section>

      <footer className="sidebar-footer">
        <span className="status-dot" aria-hidden="true" />
        Локальный режим · сеть не требуется
      </footer>
    </aside>
  );
}
