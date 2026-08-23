/**
 * NdDataTable — шаблон таблиц системы (React-порт reference/data-table.js).
 * Единый компонент для ВСЕХ табличных экранов: новая таблица = конфиг колонок
 * + массив строк. Сортировка, выбор, пагинация, плотность, клавиатура,
 * раскрытие, bulkbar, скелет, пустое состояние — внутри. Стили — newdash.css
 * (скоуп `.nd`). Оборачивать в контейнер с классом `nd`.
 *
 * Использование:
 *   <NdDataTable columns={COLUMNS} rows={rows} select totals
 *     sortKey="period" onRowClick={openCard} />
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import NdEntityCard from "./NdEntityCard";

// ── Типы ───────────────────────────────────────────────────────────────────
export type ColType = "text" | "id" | "date" | "num" | "money" | "pct" | "status";
export type CellTone = "pos" | "neg" | "mute";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export type Column<R extends Row = Row> = {
  key: string;
  label: string;
  type: ColType;
  width?: string;
  sticky?: boolean;          // липкая при горизонтальном скролле (только первая смысловая)
  strong?: boolean;          // 600 вместо 400
  total?: "sum" | ((rows: R[]) => string);
  sortValue?: (r: R) => unknown;
  format?: (v: unknown, r: R | null) => string;
  render?: (r: R) => ReactNode;   // кастомный JSX в ячейке (кнопка/чип); клики глушить stopPropagation
  cellTone?: (r: R) => CellTone | undefined;
  tone?: (r: R) => string;   // только для type:'status'
};

export type BulkAction = {
  label: string;
  kind?: "accent" | "";
  onClick: (ids: (string | number)[], api: TableApi) => void;
};

export type TableApi = { clearSelection: () => void; flashRow: (id: string | number) => void };

export type NdDataTableProps<R extends Row = Row> = {
  columns: Column<R>[];
  rows: R[];
  select?: boolean;
  totals?: boolean;
  dense?: boolean;
  loading?: boolean;
  perPage?: number;
  perPageOptions?: number[];
  onPerPageChange?: (n: number) => void;   // если задан — perPage управляется снаружи, сегмент в пейджере скрыт
  onSortActive?: (active: boolean) => void;         // сообщает наружу, активна ли сортировка (для кнопки сброса в фильтрах)
  resetRef?: React.MutableRefObject<() => void>;    // наружу — функция сброса сортировки
  sortKey?: string | null;
  sortDir?: 1 | -1;
  rowId?: (r: R) => string | number;
  onRowClick?: (r: R, api: TableApi) => void;   // взаимоисключимо с expand
  expand?: (r: R) => ReactNode;
  bulkActions?: BulkAction[];
  bulkSummary?: (ids: (string | number)[]) => string;
  empty?: string;
  emptyHint?: string;
  keyboard?: boolean;
  stagger?: boolean;
  // Мобильная карточка (≤640px). Не задан → строится автоматически из columns
  // (первая/липкая колонка = заголовок, status-колонка = правый слот, остальные
  // = факты). Задать для точной раскладки конкретного реестра.
  card?: (r: R) => { avatar?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; extra?: ReactNode; collapsible?: boolean; facts?: { label: string; value: ReactNode }[]; actions?: ReactNode };
};

// ── Форматтеры / типы колонок ──────────────────────────────────────────────
export const FMT = {
  text: (v: unknown) => (v == null || v === "" ? "—" : String(v)),
  money: (v: unknown) => (v == null ? "—" : (v as number).toLocaleString("ru-RU", { minimumFractionDigits: (v as number) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " ₽"),
  num: (v: unknown) => (v == null ? "—" : (v as number).toLocaleString("ru-RU")),
  pct: (v: unknown) => (v == null ? "—" : v + "%"),
  date: (v: unknown) => (v == null ? "—" : String(v)),
};
const TYPES: Record<ColType, { align: string; mono: boolean; fmt: (v: unknown) => string }> = {
  text:   { align: "flex-start", mono: false, fmt: FMT.text },
  id:     { align: "flex-start", mono: true,  fmt: FMT.text },
  date:   { align: "flex-start", mono: true,  fmt: FMT.date },
  num:    { align: "flex-end",   mono: true,  fmt: FMT.num },
  money:  { align: "flex-end",   mono: true,  fmt: FMT.money },
  pct:    { align: "flex-end",   mono: true,  fmt: FMT.pct },
  status: { align: "flex-start", mono: false, fmt: FMT.text },
};

// ── Компонент ──────────────────────────────────────────────────────────────
export default function NdDataTable<R extends Row = Row>(props: NdDataTableProps<R>) {
  const {
    columns, rows, select = false, totals = false, dense = true, loading = false,
    perPage: perPageInit = 50, perPageOptions = [25, 50, 100, 300, 500], onPerPageChange,
    onSortActive, resetRef,
    sortKey: sortKeyInit = null, sortDir: sortDirInit = 1,
    rowId = (r: R) => r.id as string | number,
    onRowClick, expand, bulkActions = [], bulkSummary,
    empty = "Нет данных по заданным условиям", emptyHint = "Смягчите фильтры или расширьте период",
    keyboard = true, stagger = true, card,
  } = props;

  // Телефон (≤640px): вместо таблицы — список карточек (тот же конфиг колонок).
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setIsPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const denseEff = isPhone ? true : dense;   // на телефоне всегда компактно

  const [sel, setSel] = useState<Set<string | number>>(new Set());
  const [open, setOpen] = useState<Set<string | number>>(new Set());
  const [page, setPage] = useState(1);
  const [perPageInner, setPerPageInner] = useState(perPageInit);
  const perPage = onPerPageChange ? perPageInit : perPageInner;         // controlled | uncontrolled
  const setPerPage = (n: number) => { onPerPageChange ? onPerPageChange(n) : setPerPageInner(n); };
  const [focusIx, setFocusIx] = useState(-1);
  const [flash, setFlash] = useState<string | number | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(sortKeyInit || (columns[0] && columns[0].key) || null);
  const [sortDir, setSortDir] = useState<1 | -1>(sortDirInit);
  // Сброс сортировки: активна при ЛЮБОЙ сортировке (в т.ч. по умолчанию);
  // сброс → исходный порядок строк (как пришли с бэка). Кнопку рисует страница
  // в строке фильтров (onSortActive + resetRef), в пейджере её нет.
  // Сброс — чистый лист: снимаем сортировку И выбор строк/раскрытие/фокус
  // (иначе таблица скидывалась, а отмеченные чекбоксы оставались).
  const resetSort = () => { setSortKey(null); setSortDir(sortDirInit); setFocusIx(-1); setSel(new Set()); setOpen(new Set()); };
  if (resetRef) resetRef.current = resetSort;
  useEffect(() => { onSortActive?.(sortKey !== null); }, [sortKey, onSortActive]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const stickyLeft = select ? 40 : 0;
  const gridCols = (select ? "40px " : "") + columns.map(c => c.width || "140px").join(" ");

  // Сброс страницы/выбора при смене набора строк (аналог setRows)
  useEffect(() => { setPage(1); setSel(new Set()); setFocusIx(-1); }, [rows]);

  // ── сортировка ──
  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sortKey);
    const val = (r: R) => (col && col.sortValue ? col.sortValue(r) : r[sortKey as string]);
    return rows.slice().sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;                 // пустые всегда вниз
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv), "ru") * sortDir;
    });
  }, [rows, columns, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const curPage = Math.min(page, pages);
  const from = (curPage - 1) * perPage;
  const view = sorted.slice(from, from + perPage);

  // ── api для bulk-действий ──
  const clearSelection = useCallback(() => setSel(new Set()), []);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRow = useCallback((id: string | number) => {
    setFlash(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(f => (f === id ? null : f)), 950);
  }, []);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  const api: TableApi = useMemo(() => ({ clearSelection, flashRow }), [clearSelection, flashRow]);

  // ── действия ──
  const sortBy = (key: string) => {
    if (key === sortKey) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
    setFocusIx(-1);
  };
  const toggle = (id: string | number) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    const ids = view.map(rowId);
    const allOn = ids.every(id => sel.has(id));
    setSel(prev => { const n = new Set(prev); ids.forEach(id => allOn ? n.delete(id) : n.add(id)); return n; });
  };
  const toggleExpand = (id: string | number) => setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const syncShadows = () => {
    const el = scrollRef.current; if (!el) return;
    el.dataset.scrolledX = String(el.scrollLeft > 0);
    el.dataset.scrolledY = String(el.scrollTop > 0);
  };
  useEffect(syncShadows, [view, gridCols]);

  // ── клавиатура ──
  const onKey = (e: React.KeyboardEvent) => {
    if (!keyboard) return;
    const max = view.length - 1;
    if (max < 0) return;
    const move = (n: number) => {
      e.preventDefault();
      const ix = Math.max(0, Math.min(max, n));
      setFocusIx(ix);
      const el = scrollRef.current?.querySelector(`[data-ix="${ix}"]`) as HTMLElement | null;
      const host = scrollRef.current;
      if (el && host) {
        const box = el.getBoundingClientRect(), hb = host.getBoundingClientRect();
        if (box.top < hb.top + 44) host.scrollTop -= (hb.top + 44 - box.top);
        else if (box.bottom > hb.bottom) host.scrollTop += (box.bottom - hb.bottom);
      }
    };
    if (e.key === "ArrowDown") return move(focusIx + 1);
    if (e.key === "ArrowUp") return move(focusIx - 1);
    if (e.key === "Home") return move(0);
    if (e.key === "End") return move(max);
    if (focusIx < 0) return;
    const row = view[focusIx], id = rowId(row);
    if (e.key === " " && select) { e.preventDefault(); toggle(id); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (expand) toggleExpand(id);
      else if (onRowClick) onRowClick(row, api);
    } else if (e.key === "Escape" && sel.size) { e.preventDefault(); clearSelection(); }
  };

  // ── рендер ячейки ──
  const cellContent = (col: Column<R>, row: R): ReactNode => {
    const t = TYPES[col.type] || TYPES.text;
    const raw = row[col.key];
    if (col.render) return col.render(row);
    if (col.type === "status") {
      const tone = col.tone ? col.tone(row) : "idle";
      return <span className={`status status--${tone}`}>{t.fmt(raw)}</span>;
    }
    return col.format ? col.format(raw, row) : t.fmt(raw);
  };
  const cellStyle = (col: Column<R>, row: R): React.CSSProperties => {
    const t = TYPES[col.type] || TYPES.text;
    const s: React.CSSProperties = { justifyContent: t.align };
    if (col.sticky) { s.position = "sticky"; s.left = stickyLeft; s.zIndex = 1; s.background = "inherit"; }
    if (col.strong) s.fontWeight = 600;
    const tone = col.cellTone && col.cellTone(row);
    if (tone === "pos") s.color = "var(--success-strong)";
    if (tone === "neg") s.color = "var(--danger)";
    if (tone === "mute") s.color = "var(--text-3)";
    return s;
  };

  const pickedInView = select ? view.filter(r => sel.has(rowId(r))).length : 0;
  const allState = pickedInView === 0 ? "false" : pickedInView === view.length ? "true" : "mixed";

  // ── мобильная карточка: заголовок = липкая/первая колонка, правый слот =
  //    status-колонка, факты = остальные (тот же cellContent, что и в таблице) ──
  const primaryCol = columns.find(c => c.sticky) || columns[0];
  const statusCol = columns.find(c => c.type === "status" && c !== primaryCol);
  const factCols = columns.filter(c => c !== primaryCol && c !== statusCol);
  const buildCard = (r: R) => card ? card(r) : {
    avatar: undefined as ReactNode,
    title: primaryCol ? cellContent(primaryCol, r) : null,
    subtitle: undefined as ReactNode,
    right: statusCol ? cellContent(statusCol, r) : undefined,
    extra: undefined as ReactNode,
    collapsible: undefined as boolean | undefined,
    facts: factCols.map(c => ({ label: c.label, value: cellContent(c, r) })),
    actions: undefined as ReactNode,
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="table-card">
        {isPhone && (
          <div className="table-scroll" style={{ overflow: "auto" }}>
            {loading ? (
              <div className="nd-cards">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div className="nd-ecard" key={i} style={{ animation: "nd-fadeIn 200ms ease both", animationDelay: `${i * 40}ms` }}>
                    <i className="skeleton" style={{ height: 58, borderRadius: 10 }} />
                  </div>
                ))}
              </div>
            ) : view.length === 0 ? (
              <div style={{ padding: "56px 20px", textAlign: "center", animation: "nd-fadeUp 240ms var(--ease-standard) both" }}>
                <div className="t-h3" style={{ color: "var(--text-2)" }}>{empty}</div>
                <div className="t-body-s muted" style={{ marginTop: 6 }}>{emptyHint}</div>
              </div>
            ) : (
              <div className="nd-cards">
                {view.map(r => {
                  const id = rowId(r); const opened = open.has(id); const spec = buildCard(r);
                  return (
                    <Fragment key={id}>
                      <NdEntityCard
                        avatar={spec.avatar} title={spec.title} subtitle={spec.subtitle} right={spec.right}
                        extra={spec.extra} facts={spec.facts} actions={spec.actions}
                        collapsible={spec.collapsible}
                        clickable={!!(onRowClick || expand)}
                        onClick={() => { if (expand) toggleExpand(id); else onRowClick?.(r, api); }}
                        selectable={select} selected={sel.has(id)} onToggle={() => toggle(id)}
                      />
                      {opened && expand && <div className="nd-ecard nd-expand-scroll" style={{ paddingTop: 4 }}>{expand(r)}</div>}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!isPhone && (
        <div className="table-scroll" ref={scrollRef} tabIndex={0} onScroll={syncShadows} onKeyDown={onKey}>
          <div className="table" data-density={denseEff ? "compact" : "normal"} style={{ gridTemplateColumns: gridCols }}>
            {/* head */}
            <div className="table__head">
              {select && (
                <div className="table__td table__sticky" style={{ left: 0, justifyContent: "center", background: "var(--surface)", zIndex: 4 }}>
                  <button className="checkbox" role="checkbox" aria-checked={allState} title="Выбрать страницу" onClick={toggleAll} />
                </div>
              )}
              {columns.map(c => {
                const t = TYPES[c.type] || TYPES.text;
                const active = c.key === sortKey;
                const s: React.CSSProperties = { justifyContent: t.align };
                if (c.sticky) { s.position = "sticky"; s.left = stickyLeft; s.zIndex = 4; s.background = "var(--surface)"; }
                return (
                  <button
                    key={c.key}
                    className="table__th"
                    style={s}
                    aria-sort={active ? (sortDir > 0 ? "ascending" : "descending") : undefined}
                    onClick={() => sortBy(c.key)}
                  >
                    {c.label}<span className="table__sort">▲</span>
                  </button>
                );
              })}
            </div>

            {/* body */}
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div className="table__skeleton" key={i} style={{ animation: "nd-fadeIn 200ms ease both", animationDelay: `${i * 40}ms` }}>
                  {select && <div className="table__td" />}
                  {columns.map(c => <div className="table__td" key={c.key}><i className="skeleton" /></div>)}
                </div>
              ))
            ) : view.length === 0 ? (
              <div style={{ gridColumn: "1/-1", padding: "64px 20px", textAlign: "center", animation: "nd-fadeUp 240ms var(--ease-standard) both" }}>
                <div className="t-h3" style={{ color: "var(--text-2)" }}>{empty}</div>
                <div className="t-body-s muted" style={{ marginTop: 6 }}>{emptyHint}</div>
              </div>
            ) : (
              <>
                {view.map((r, i) => {
                  const id = rowId(r);
                  const on = sel.has(id), opened = open.has(id);
                  const clickable = !!(onRowClick || expand);
                  const cls = "table__row" + (clickable ? " table__row--clickable" : "") + (flash === id ? " table__row--flash" : "");
                  return (
                    <Fragment key={id}>
                      <div
                        className={cls}
                        style={stagger ? { animationDelay: `${Math.min(i * 14, 220)}ms` } : undefined}
                        aria-selected={on || undefined}
                        data-focus={i === focusIx || undefined}
                        data-ix={i}
                        onClick={e => {
                          if ((e.target as HTMLElement).closest("[data-pick]")) { toggle(id); return; }
                          setFocusIx(i);
                          if (expand) toggleExpand(id);
                          else if (onRowClick) onRowClick(r, api);
                        }}
                      >
                        {select && (
                          <div className="table__td table__sticky" style={{ left: 0, justifyContent: "center" }}>
                            <button className="checkbox" role="checkbox" aria-checked={on} data-pick onClick={e => { e.stopPropagation(); toggle(id); }} />
                          </div>
                        )}
                        {columns.map(c => {
                          const t = TYPES[c.type] || TYPES.text;
                          return (
                            <div key={c.key} className={"table__td" + (t.mono ? " table__td--mono" : "")} style={cellStyle(c, r)}>
                              {cellContent(c, r)}
                            </div>
                          );
                        })}
                      </div>
                      {opened && expand && (
                        <div className="table__expand"><div className="nd-expand-scroll" style={{ padding: "16px 0" }}>{expand(r)}</div></div>
                      )}
                    </Fragment>
                  );
                })}

                {/* foot */}
                {totals && (
                  <div className="table__foot">
                    {select && <div className="table__td table__sticky" style={{ left: 0, background: "var(--surface-2)", zIndex: 4 }} />}
                    {columns.map((c, i) => {
                      const t = TYPES[c.type] || TYPES.text;
                      let v = "";
                      if (c.total === "sum") {
                        const sum = sorted.reduce((acc, r) => acc + (typeof r[c.key] === "number" ? r[c.key] : 0), 0);
                        v = c.format ? c.format(sum, null) : t.fmt(sum);
                      } else if (typeof c.total === "function") {
                        v = c.total(sorted);
                      } else if (i === 0) {
                        v = "Итого · " + sorted.length;
                      }
                      const s: React.CSSProperties = { justifyContent: t.align };
                      if (c.sticky) { s.position = "sticky"; s.left = stickyLeft; s.zIndex = 4; s.background = "var(--surface-2)"; }
                      return <div key={c.key} className={"table__td" + (t.mono ? " table__td--mono" : "")} style={s}>{v}</div>;
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        )}

        {/* pager */}
        <div className="pager">
          <span className="t-body-s muted">показано {view.length ? `${from + 1}–${from + view.length}` : 0} из {sorted.length}</span>
          <span className="spacer" />
          {!onPerPageChange && <span className="pager__perpage">
            <span className="t-body-s muted-2">строк на странице</span>
            <span className="segments">
              {perPageOptions.map(n => (
                <button key={n} className="segments__item" style={{ fontFamily: "var(--font-mono)" }} aria-selected={n === perPage} onClick={() => { setPerPage(n); setPage(1); }}>{n}</button>
              ))}
            </span>
          </span>}
          {(pages > 1 || !isPhone) && (
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button className="pager__btn" disabled={curPage === 1} onClick={() => { setPage(p => Math.max(1, p - 1)); setFocusIx(-1); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}>‹</button>
              <span className="t-mono-500" style={{ padding: "0 6px" }}>{curPage} / {pages}</span>
              <button className="pager__btn" disabled={curPage === pages} onClick={() => { setPage(p => Math.min(pages, p + 1)); setFocusIx(-1); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}>›</button>
            </span>
          )}
        </div>
      </div>

      {/* bulkbar */}
      {select && sel.size > 0 && (
        <div className="bulkbar">
          <span className="t-body" style={{ fontWeight: 600 }}>Выбрано {sel.size}</span>
          {bulkSummary && <span className="t-mono" style={{ color: "var(--text-3)" }}>{bulkSummary([...sel])}</span>}
          <span className="spacer" />
          {bulkActions.map((a, i) => (
            <button key={i} className={"btn " + (a.kind === "accent" ? "btn--accent" : "btn--onDark")} onClick={() => a.onClick([...sel], api)}>{a.label}</button>
          ))}
          <button className="btn btn--quiet" style={{ color: "var(--text-3)" }} onClick={clearSelection}>Снять выбор</button>
        </div>
      )}
    </div>
  );
}
