# NewDash — инструкция по построению разделов и страниц

Единый шаблон интерфейса логиста (`/newdash`). **Новый раздел/страница строится
из готовых компонентов** — своя вёрстка и свои стили почти не пишутся. Всё в
скоупе `.nd`, стили — один файл `newdash.css`.

Порядок: скопировал структуру страницы → задал конфиг колонок таблицы → навесил
фильтры-чипы → при необходимости модалки из `NdModal`. Никаких инлайн-стилей
сверх динамики (ширины/позиции), никаких новых глобальных классов.

---

## 0. Компоненты (что уже есть)

| Компонент | Роль |
|---|---|
| `NdMenu` | боковое меню (общее). Разделы с `children` раскрываются под пунктом при наведении. |
| `NdSectionTabs` | сегмент-табы раздела между шапкой и контентом (переключение под-URL). |
| `NdDataTable` | **таблица** — весь функционал реестра (см. §3). |
| `NdMultiSelect` | фильтр-чип с мультивыбором (`.chip` + `.checkbox`). |
| `NdDateRange` | фильтр диапазона дат — лаймовый чип `ДД.ММ.ГГГГ – ДД.ММ.ГГГГ`. |
| `NdModal` | **модалка** — размеры/шапка/тело/действия (см. §4). |
| `newdash.css` | единый контур стилей (скоуп `.nd`). |

---

## 1. Единый CSS (`newdash.css`)

- **Всё в скоупе `.nd`**: `.nd .foo { … }`. Корень страницы — `<div className="nd">`.
- **Почему скоуп**: generic-имена (`.card/.chip/.status/.modal/.table/.overlay/.btn/.main/.topbar`)
  конфликтуют с глобальным `styles.css`. Скоуп `.nd .foo` (специфичность 0,2,0)
  перекрывает глобальный `.foo` (0,1,0).
- **ГРАБЛИ 1 (утечка свойств)**: `.nd .foo` перекрывает глобальный `.foo` только по СВОЙСТВАМ,
  что задаёт. Глобальные bare-классы (`.main{padding}`, `.topbar{margin-bottom}`, `.btn{opacity}`,
  `.icon-btn{position:relative}`) утекают незаданными свойствами. Поэтому в `.nd .main`/`.nd .topbar`
  явно `padding:0;margin:0`. При новом generic-классе проверять: `grep "^\.<class>[ ,{:]" styles.css`.
- **ГРАБЛИ 2 (равная специфичность → порядок загрузки)**: если своё правило и глобальное имеют
  ОДИНАКОВУЮ специфичность (напр. `.nd-modal__close{position:absolute}` vs глобальный
  `.icon-btn{position:relative}` — оба 0,1,0), победитель зависит от порядка загрузки CSS,
  а после HMR/пересборки он может перевернуться → плавающий баг. Правило: свои классы,
  использующие также глобальный generic-класс (`.icon-btn`/`.btn`/…), давать с префиксом `.nd`
  (`.nd .nd-modal__close`, 0,2,0) — тогда выигрывают детерминированно.
- **Keyframes** — с префиксом `nd-` (иначе коллизия с `design-system/animations.css`).
- **Токены** — из `design-system/tokens.css` (глобально). `--dossier` (тёмная шапка досье)
  определён локально на `.nd` (в обеих темах), т.к. `--invert` в тёмной теме лаймовый.
- **Инлайн-стили только для динамики** (span/order/height, позиции баров, ширины колонок).
  Повторяющиеся раскладки → helper-классы (`.row-c`, `.grow`, `.gap-*`, `.filter-field`, …).
- Проверять каскад можно изолированно тест-HTML (реальные `styles.css`+design-system+`newdash.css`)
  и замером `getBoundingClientRect` — логиниться в приложение ассистенту нельзя.

---

## 2. Структура страницы раздела

```tsx
export default function NewDashXxx() {
  // …state, загрузка данных, фильтры, rows (useMemo)…
  return (
    <div className="nd">
      <NdMenu active="<sectionKey>" />
      <main className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1 className="t-h1" style={{ margin: 0 }}>Заголовок</h1>
            <span className="t-mono muted">подпись · {count}</span>
          </div>
          <div className="spacer" />
          {/* поиск */}
          <div className="search" style={{ width: 260 }}>…<input …/></div>
          <button className="btn btn--ghost" onClick={…}>Компактно</button>
          {/* главное действие раздела — accent, напр. «Внести пробег» */}
          <button className="btn btn--accent" onClick={…}>Действие</button>
        </header>

        <NdSectionTabs tabs={SECTION_TABS} />           {/* под-табы раздела */}

        {/* виджеты-сводки по выборке (если нужны) — СВЕРХУ */}
        <div className="summarystrip"> <div className="summary">…</div> …4 </div>

        {/* фильтры — чипы, дата, тумблеры */}
        <div className="filterbar">
          <NdDateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
          <NdMultiSelect label="Машина" options={truckOptions} selected={truckF} onChange={setTruckF} />
          {/* … */}
          <button className="switch" aria-pressed={flag} onClick={…}>
            <span className="switch__track"><span className="switch__knob" /></span>Метка
          </button>
          <div className="spacer" />
          {/* иконочные действия (импорт лаймовый / экспорт / шаблон) — icon-btn */}
        </div>

        {/* таблица */}
        <div style={{ flex: 1, minHeight: 0, padding: "12px 24px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable … />
        </div>
      </main>

      {/* модалки — прямые дети .nd */}
      {open && <NdModal …>…</NdModal>}
    </div>
  );
}
```

Отступы ярусов: `topbar` `11px 24px`, `section-tabs` `14px 24px 0`, `summarystrip`
`14px 24px 0`, `filterbar` `12px 24px 0`, обёртка таблицы `12px 24px 20px`.
Ярусы `flex:none`, обёртка таблицы `flex:1; min-height:0` (иначе пагинация уедет).

Каждая под-вкладка раздела — **отдельный URL и отдельный файл-страница** (не единый
модуль с табами). Роут в `App.tsx` через `<ProtectedRoute>`. В `NdMenu.NAV` у раздела
задаются `children:[{label,to}]` (раскрытие в меню). В странице — `NdSectionTabs`.

---

## 3. Таблица `NdDataTable` (весь функционал реестра)

Новая таблица = **конфиг колонок + строки**. Сортировка, выбор+bulkbar, пагинация,
плотность, клавиатура (↑↓ Home End Space Enter Esc), раскрытие, скелет, пустое
состояние, липкие шапка/колонка/итог — внутри.

```tsx
const COLUMNS: Column<Row>[] = [
  { key: "id_col", label: "№", type: "id", width: "120px", sticky: true, strong: true },
  { key: "name",   label: "Название", type: "text", width: "minmax(160px, 1fr)" }, // гибкая — тянет по ширине
  { key: "status", label: "Статус", type: "status", width: "140px", tone: r => statusTone(r.status) },
  { key: "date",   label: "Дата", type: "date", width: "150px", format: fmtDt },
  { key: "sum",    label: "Сумма", type: "money", width: "128px", total: "sum",
                   cellTone: r => r.sum < 0 ? "neg" : "pos" },
  { key: "pct",    label: "Рентаб.", type: "pct", width: "96px",
                   total: all => `${Math.round(…)}%` },  // производный итог — функцией
];

<NdDataTable<Row>
  columns={COLUMNS} rows={rows} rowId={r => r.id}
  loading={loading} dense={dense}
  select                    // чекбоксы + bulkbar
  totals                    // липкая строка итога (сумма по ВСЕЙ выборке)
  sortKey="date" sortDir={-1}
  empty="Нет данных" emptyHint="Смягчите фильтры"
  bulkSummary={ids => `сумма …`}
  bulkActions={[
    { label: "Экспорт выбранных", onClick: async ids => {…} },
    { label: "Удалить", onClick: async (ids, api) => { if(confirm(…)){ …; api.clearSelection(); } } },
  ]}
  expand={r => <div>…детали / кнопки действий (напр. «Принудительно сдать»)…</div>}
/>
```

**Типы колонок** (тип задаёт выравнивание+шрифт+форматтер разом, вручную не переопределять):
`text` (слева, Onest) · `id` (слева, mono — госномера/№) · `date` (слева, mono) ·
`num`/`money`/`pct` (**справа, mono, tabular-nums**) · `status` (чип `.status--<tone>`).
Правило: всё, что сравнивают глазами по столбцу — mono и справа.

**Опции колонки**: `width` (px, ни одной `fr` — кроме ОДНОЙ гибкой `minmax(<px>,1fr)`
для растягивания на всю ширину), `sticky` (только первая смысловая), `strong`,
`total:'sum'|fn`, `sortValue`, `format`, `cellTone`, `tone` (для status).

**Плотность по умолчанию — компактная**: `dense` в NdDataTable по умолчанию `true`; страницы с тумблером «Компактно/Обычно» стартуют с `useState(true)`. Все таблицы разделов — компактные по умолчанию.

**Полная ширина**: `.table` уже `width:100%`; одну колонку задать `minmax(<px>,1fr)`.
**Строк на странице** (25/50/100/300/500) — в пейджере внизу (не в фильтрах).
**Клик по строке** — либо `expand`, либо `onRowClick` (взаимоисключимо).

---

## 4. Модалки `NdModal`

Окно = опции + тело из кирпичей. Три слоя (скроллится только тело), Esc/крестик/
подложка закрывают, блокировка скролла, фокус на первое поле — внутри.

```tsx
{open && (
  <NdModal
    size="form"            // form 420 · panel 520 · wide 800 · sheet 760 (пятого нет — иначе это страница)
    head="plain"           // plain (документ/форма) | dark (карточка СУБЪЕКТА: водитель/машина, аватар)
    title="Заголовок" subtitle="подпись"
    avatar="ЦМ"            // только для head="dark"
    status={{ label: "В рейсе", tone: "ok" }}
    onClose={close}
    actions={[
      { label: "Отмена", kind: "ghost", onClick: close },                 // отмена — ghost, слева
      { label: "Сохранить", kind: "accent", grow: true, disabled: !ok, onClick: save },  // главное — справа
    ]}
  >
    {/* тело из кирпичей: */}
    <div className="field"><span className="field__label">…</span><input className="field__input" …/></div>
    {/* .facts — сводка (подпись … значение справа) */}
    <div className="facts"><div className="facts__row"><span className="facts__label">…</span><span className="facts__value">…</span></div></div>
    {/* .form-grid — анкета (2 колонки, .form-grid__field--wide на обе) */}
    {/* .act-cols / .check-row / .mark--yes|no|none — акт приёмки-сдачи (sheet) */}
  </NdModal>
)}
```

- Действия: `primary` (чёрная/лаймовая в тёмной), `accent` (лаймовая), `ghost` (рамка),
  `quiet` (текст). `grow:true` — растянуть. Одно главное действие, справа.
- `head="dark"` — **только** для окна про субъект (досье), не про документ. Фон `--dossier`.
- Тело — из `.field` / `.facts` / `.form-grid` / `.act-*` / `.mark` / `.section` (белая карточка на сером теле). Своей вёрстки не писать.
- `NdModal` рендерить **внутри `.nd`** страницы (кирпичи `.facts`/… скоупятся под `.nd`).
  На модалке класс `nd` НЕ ставить (там `height:100vh;min-width:1180px` — сломает окно).
- **Скролл (правило для ВСЕХ модалок):** если сверху виджет/сводка, который должен оставаться видимым, а ниже длинный список — фиксируй виджет, скроль только список:
  `<NdModal bodyStyle={{ overflow: "hidden" }}>` +
  верхняя `<section className="section" style={{ flex: "none" }}>` (закреплена) +
  нижняя `<section className="section" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>` (скроллится).
  По умолчанию (без bodyStyle) скроллится всё тело — это ок для форм без «шапки-сводки».
- `headExtra` — доп. блок в шапке (напр. facts-грид акта). Кастомная ячейка таблицы — `render` в колонке.

---

## 5. Фильтры / чипы / тумблеры

- `NdMultiSelect` — мультивыбор (чип-триггер `label + значение + ▾`, поповер с `.checkbox`).
  Опции из `uniqueSorted(rows.map(...))`. Пусто → «Все», 1 → значение, N → «N выбр.».
- `NdDateRange` — лаймовый чип диапазона, поповер с «С»/«По».
- Тумблер — `.switch[aria-pressed]` (лаймовый трек). Напр. «Штрафы»/«Только ТО».
- Иконочные действия — `.icon-btn` (лаймовый акцент: `.icon-btn--accent`, напр. Импорт),
  с `title` (тултип).
- Фильтрация — в одном `useMemo` над строками: даты (`slice(0,10)` сравнение), Set-фильтры
  (`.size && !set.has(...)`), тумблеры, поиск. Виджеты-сводки считать по отфильтрованным `rows`.

---

## 6. Данные

- Реальные API где есть. Форма ответа = форма строк таблицы (обогащать при загрузке:
  driver/truck-подписи, вычисляемые поля вроде `billing = amount*(1-insurance_pct%)`).
- **OZON-зависимое** (live-табло рейсов, «рейсы в работе») — заглушка до появления API OZON.
  Реестр рейсов (`/api/trips/`) — это импортированный XLSX, реальные данные, НЕ OZON.
- Права: `/newdash` под `<ProtectedRoute>` (admin/логист). Часть API (напр.
  `foreman-dashboard/*`) требует роль — при отказе показывать пустое состояние, не падать.

---

## 7. Чек-лист новой страницы раздела

- [ ] Отдельный файл-страница + отдельный URL (роут в App.tsx), НЕ таб в одном модуле.
- [ ] Корень `<div className="nd">` → `NdMenu` + `<main className="main">`.
- [ ] Ярусы по порядку: topbar → NdSectionTabs → (summarystrip) → filterbar → таблица.
- [ ] Таблица через `NdDataTable`: числовые колонки `num/money/pct` (mono, справа),
      ширины в px + одна `minmax(…,1fr)`, `sticky` на первой, итоги по всей выборке.
- [ ] Фильтры через `NdMultiSelect`/`NdDateRange`/`.switch`; фильтрация в одном `useMemo`.
- [ ] Модалки через `NdModal` (размер из четырёх, тело из кирпичей, главное действие справа).
- [ ] Раздел добавлен в `NdMenu.NAV` (+`children` если под-страницы) и в `NdSectionTabs`.
- [ ] Никаких новых глобальных CSS-классов; проверены коллизии с `styles.css`.
- [ ] `tsc --noEmit` и `vite build` чистые.
- [ ] Перенесён ВЕСЬ функционал аналога (импорт/экспорт/шаблон, массовые действия,
      добавление/редактирование, специфичные кнопки вроде «принудительно сдать»).
```
