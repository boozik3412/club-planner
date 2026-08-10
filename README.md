# Club Planner Desktop

Автономный русскоязычный редактор расстановки оборудования и мебели поверх актуального обмерного плана компьютерного клуба. Приложение работает в отдельном Windows-окне на Tauri 2 и не использует внешние CDN или сеть для основной работы.

## Возможности

- точный векторный план `assets/base_plan_new_measurement.svg`, сетка, умное притягивание к стенам, зум, панорама и поворот холста;
- 17 шаблонов предметов, включая произвольные прямоугольник, круг и овал; точные размеры в метрах, drag/resize/rotate, подписи, слои и блокировка;
- Shift-мультивыделение, рамка, массовые свойства и совместное перемещение;
- центрирование, равномерное распределение и явное заполнение проёма между двумя перегородками с предпросмотром;
- постоянные группы, редактирование элементов группы, дублирование, поворот, блокировка и разгруппировка;
- история на 100 транзакций, recovery-autosave и предупреждение о несохранённых изменениях;
- системные Open/Save/Save As, `.clubplan` v1, legacy JSON v6 и экспорт SVG;
- восстановление размера и позиции окна между запусками.

## Требования для разработки

- Windows 10/11 x64 и установленный WebView2 Runtime;
- Node.js 22 и pnpm 10;
- Rust stable MSVC;
- Visual Studio Build Tools с компонентами Desktop development with C++.

## Запуск и проверки

```powershell
pnpm install
pnpm tauri dev
```

Полный frontend gate:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Rust gate:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Release и установщик:

```powershell
pnpm tauri build
```

Артефакты создаются в:

- `src-tauri/target/release/club-planner.exe`;
- `src-tauri/target/release/bundle/nsis/Club Planner_0.1.0_x64-setup.exe`.

## Основные сочетания клавиш

| Команда | Клавиши |
|---|---|
| Сохранить / сохранить как / открыть | `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Выбрать все редактируемые | `Ctrl+A` |
| Дублировать / удалить | `Ctrl+D` / `Delete` |
| Группа / разгруппировать | `Ctrl+G` / `Ctrl+Shift+G` |
| Повернуть выбранное | `R` / `Shift+R` |
| Переместить | стрелки; `Shift` — шаг 0,01 м |
| Выйти из группы / снять выделение | `Esc` |

Колесо меняет масштаб; средняя кнопка или `Пробел+ЛКМ` панорамирует; `Shift+ЛКМ` переключает предмет в выборке; `Shift+ПКМ` группирует выбранные предметы. Во время перетаскивания `Alt` временно отключает привязку к сетке и стенам, `Tab`/`Shift+Tab` перебирает близкие кандидаты. Отступ и автоповорот мебели/перегородок настраиваются в панели холста.

## Документация

- [Формат проекта](docs/FILE_FORMAT.md)
- [Импорт legacy JSON](docs/LEGACY_IMPORT.md)
- [Отчёт проверки MVP](docs/QA_REPORT.md)
- [Продуктовая спецификация](docs/PRODUCT_SPEC.md)
- [Критерии приёмки](docs/ACCEPTANCE_CRITERIA.md)

В MVP намеренно не входят вложенные группы, облачная синхронизация и PDF-экспорт.
