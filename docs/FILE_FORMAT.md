# Формат `.clubplan` v4

Начиная с версии 0.2.0 `.clubplan` — самодостаточный ZIP-контейнер. Геометрия проекта хранится в метрах, исходный чертёж и выровненная подложка находятся внутри файла. JSON-проекты v1–v3 и legacy JSON v6 по-прежнему читаются, но следующее сохранение выполняется как v4.

## Содержимое контейнера

```text
mimetype
project.json
sources/<sha-prefix>.pdf | .png | .jpg
previews/<sha-prefix>-p<page>.png
previews/<sha-prefix>-p<page>-thumb.png
```

`mimetype` содержит `application/vnd.clubplanner.project+zip` без сжатия. `project.json` и ресурсы сжимаются Deflate. Пути абсолютного вида, `..`, пустые сегменты, дубликаты и ресурсы вне `sources/` или `previews/` отклоняются. Ограничения чтения: 256 записей, 16 МБ для `project.json`, 512 МБ для всего распакованного контейнера. SHA-256 каждого невстроенного исходника сверяется с `PlanSource.sha256`. Запись выполняется через временный файл и атомарную замену.

## Верхний уровень

```json
{
  "format": "clubplan",
  "formatVersion": 4,
  "generator": { "name": "Club Planner", "version": "0.2.0" },
  "project": { "id": "project-uuid", "createdAt": "...", "modifiedAt": "..." },
  "basePlan": { "id": "source-id", "asset": "previews/source.png", "widthM": 24.6, "heightM": 12.1, "unitsPerMeter": 100, "sha256": "..." },
  "planSources": [],
  "activePlanSourceId": "source-id",
  "canvas": {},
  "architecture": {},
  "layers": [],
  "objects": [],
  "groups": [],
  "dimensions": [],
  "customTemplates": []
}
```

`basePlan` сохранён как совместимое описание размеров сцены и камеры. Источник истины для подложки — `planSources` и `activePlanSourceId`; источник архитектуры — `architecture`.

## PlanSource

```json
{
  "id": "source-uuid",
  "kind": "pdf",
  "name": "measurement.pdf",
  "mimeType": "application/pdf",
  "sha256": "64 hex characters",
  "embeddedPath": "sources/abcd1234.pdf",
  "previewPath": "previews/abcd1234-p1.png",
  "thumbnailPath": "previews/abcd1234-p1-thumb.png",
  "pageIndex": 0,
  "pageCount": 3,
  "sourceWidth": 6000,
  "sourceHeight": 2800,
  "widthM": 30.0,
  "heightM": 14.0,
  "cropQuad": [{ "x": 0, "y": 0 }, { "x": 5999, "y": 0 }, { "x": 5999, "y": 2799 }, { "x": 0, "y": 2799 }],
  "rotationDeg": 0,
  "perspectiveMatrix": [1, 0, 0, 0, 1, 0, 0, 0, 1],
  "metersPerSourceUnit": 0.005,
  "locked": true,
  "recognizer": {
    "engineVersion": "local-hybrid-1",
    "pdfEngine": "pdf.js 6.2.108",
    "cvEngine": "OpenCV.js 5.0.0",
    "ocrEngine": "Tesseract.js 7.0.0 rus+eng"
  }
}
```

`kind` равен `bundled-svg`, `pdf` или `image`. Номер PDF-страницы нулевой. Масштаб обязателен для распознанного источника и подтверждается пользователем по двум точкам. OCR-размер не становится масштабом без подтверждения.

## Архитектурный граф

`architecture.vertices` хранит общие соединительные точки:

```json
{ "id": "vertex-1", "xM": 1.2, "yM": 3.4, "provenance": "raster", "confidence": 0.91, "reviewStatus": "candidate", "locked": false }
```

Стена ссылается на две вершины и хранит прямую либо настоящую дугу:

```json
{
  "id": "wall-1",
  "kind": "wall",
  "startVertexId": "vertex-1",
  "endVertexId": "vertex-2",
  "curve": { "kind": "arc", "bulge": 0.4142135624 },
  "thicknessM": 0.2,
  "heightM": 3.04,
  "baseElevationM": 0,
  "heightSource": "default",
  "thicknessSource": "user",
  "provenance": "vector-pdf",
  "confidence": 0.87,
  "reviewStatus": "accepted",
  "locked": false
}
```

`bulge = tan(sweepAngle / 4)`; знак определяет направление дуги от начальной вершины к конечной. Разделение дуги делит sweep и сохраняет исходные центр и радиус. 2D использует SVG `A`, привязка — аналитическую ближайшую точку, 3D — адаптивные хорды с ошибкой не более 0,01 м.

Проём принадлежит стене и задаётся длиной вдоль её геометрии:

```json
{
  "id": "opening-1",
  "kind": "door",
  "hostWallId": "wall-1",
  "offsetM": 1.4,
  "widthM": 0.9,
  "sillHeightM": 0,
  "openingHeightM": 2.1,
  "verticalSource": "user",
  "swing": "right",
  "openingAngleDeg": 90,
  "provenance": "manual",
  "confidence": 1,
  "reviewStatus": "accepted",
  "locked": false
}
```

Допустимые `provenance`: `bundled`, `vector-pdf`, `raster`, `manual`. Состояния проверки: `candidate`, `accepted`, `rejected`. Только `accepted` участвует в помещениях, привязках, диагностике и 3D. Высотные зоны остаются в `architecture.heightRegions`; помещения вычисляются из замкнутых граней принятого графа и не сериализуются.

## Объекты, группы и размеры

Формат предметов, групп, постоянных размеров и составных шаблонов совместим с v3. Предмет хранит центр, ширину, глубину, высоту, отметку установки, угол, отражения, слой, блокировку и свойства. Один предмет входит не более чем в одну top-level группу. Выделение, камера, режим 2D/3D, drag-preview, Undo/Redo и состояние мастера импорта не сериализуются.

## Миграции

- v1: добавляются архитектурные defaults, высоты и безопасные значения отсутствующих полей;
- v2: `wallOverrides` накладываются на встроенный архитектурный граф;
- v3: отражения и все объекты сохраняются, overrides превращаются в значения project-owned стен;
- legacy JSON v6: импортируется библиотека предметов с документированными ограничениями;
- следующее сохранение любого старого проекта создаёт ZIP v4.

Будущие версии выше v4 отклоняются до публикации состояния. Повторяющиеся ID, отсутствующие вершины/host-стены, некорректные размеры, небезопасные ZIP-пути и неверные контрольные суммы показываются как ошибка и не заменяют открытый проект.
