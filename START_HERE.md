# Club Planner — передача проекта в Codex

Это пакет исходного контекста для разработки отдельного настольного приложения-планировщика компьютерного клуба.

## Что открыть в Codex

Откройте **всю эту папку** как локальный проект, а не отдельный HTML-файл.

Сначала попросите Codex прочитать:

1. `AGENTS.md`
2. `docs/PRODUCT_SPEC.md`
3. `docs/ACCEPTANCE_CRITERIA.md`
4. `docs/ARCHITECTURE_DECISION.md`
5. `legacy/floor_planner_v6_new_base.html`

Затем отправьте Codex текст из `CODEX_START_PROMPT.md`.

## Что лежит в пакете

- `legacy/floor_planner_v6_new_base.html` — рабочий браузерный прототип v6, который надо использовать как источник поведения и визуальной логики.
- `assets/base_plan_new_measurement.svg` — актуальная векторная базовая планировка.
- `assets/measurement_plan.pdf` — исходный замер помещения.
- `reference/technical_passport_old.pdf` — старый технический паспорт; только справочный материал, не базовая геометрия.
- `docs/PRODUCT_SPEC.md` — требования продукта.
- `docs/ACCEPTANCE_CRITERIA.md` — проверяемые критерии готовности.
- `AGENTS.md` — постоянные инструкции Codex для репозитория.

## Целевая поставка

- Windows-приложение, запускаемое отдельно от браузера.
- Установщик Windows.
- По возможности переносная сборка.
- Работа без интернета.
- Формат проекта `.clubplan`.
