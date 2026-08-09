/**
 * NdSortReset — чип сброса сортировки для строки фильтров (.filterbar).
 * Рисуется страницей после последнего фильтра; виден при активной сортировке.
 * Состояние берётся из NdDataTable (onSortActive + resetRef).
 */
export default function NdSortReset({ active, onReset }: { active: boolean; onReset: () => void }) {
  if (!active) return null;
  return (
    <button type="button" className="chip" title="Сбросить сортировку" onClick={onReset}>
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M2.4 6.5a4.6 4.6 0 1 1 1.4 3.3" /><path d="M2.2 3.4v3h3" /></svg>
      Сортировка
    </button>
  );
}
