# Domain complexity map

![Дерево сложности предметной области движка](./domain-complexity.svg)

Эта схема фиксирует не структуру папок, а **онтологию движка**: где находится причина, где появляются наблюдения и проекции, и где допускается распределённое исполнение.

## Главный инвариант

```
authoritative cause
      ↓
observation
      ↓
projection
      ↓
execution / presentation
```

Ни Render IR, ни сеть, ни NPU/GPU worker не становятся вторым источником истины. Они могут вычислять проекции или proposals, но долговечное состояние меняется только через владельца причины и его commit boundary.

## Соответствие коду

| Ветка | Основные границы |
| --- | --- |
| Симуляция | `src/core/kernel.ts`, `src/scene/scene.ts` |
| Физика | `src/physics/**`, `src/environment/deformable-surface.ts` |
| Мир и среда | `src/world/**`, `src/environment/**` |
| Агенты | `src/animation/**`, slot `agents.simulate` |
| Экономика | domain/slot `economics` / `economics.simulate` |
| Наблюдение | `CausalRenderObservation`, content-addressed surface state |
| Рендер | `src/render/**`, `src/render-ir/**` |
| Сеть / authority | `src/network/causal-authority.ts`, projections/playback |
| Хранение | `src/content/**`, `src/storage/**`, checkpoints / mutation log / scope heads |
| Исполнение | `src/execution/**`, `src/meshwork/**` |
| Доказательства | `test/**`, proving grounds, CI, Reality Gap |

## Что схема запрещает

- Renderer не создаёт физическую причину.
- Сетевой пакет не становится состоянием мира.
- Worker не мутирует authority напрямую.
- Репликация байтов не создаёт вторую истину: mutable только `ScopeHead`, остальное immutable CAS.
- NPU decision не блокирует authoritative tick.
- `renderMesh` не подменяет collision/physical geometry.
- LOD/depth меняет представление или частоту вычисления, но не смысл причины.

Связанные документы: [Causal render contract](./CAUSAL_RENDER_CONTRACT.md), [Server authority](./SERVER_AUTHORITY.md), [Distributed causal storage](./CAUSAL_STORAGE.md), [Infinite world](./INFINITE_WORLD.md), [Physics energy accounting](./PHYSICS_ENERGY_ACCOUNTING.md).
