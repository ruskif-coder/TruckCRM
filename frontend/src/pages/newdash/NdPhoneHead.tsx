/**
 * NdPhoneHead — шапка страницы на телефоне: заголовок + подзаголовок + кнопка «+»
 * (главное действие раздела). Навигация — плавающий бургер (NdBurgerFab, правый
 * нижний угол) и свайп между страницами. Рендерится страницей только под isPhone.
 * Стили — newdash.css (.nd-phead*).
 */
export default function NdPhoneHead({ title, subtitle, onAdd }: {
  title: string;
  subtitle?: string;
  onAdd?: () => void;         // зелёная «+» — главное действие раздела
}) {
  return (
    <header className="nd-phead">
      <div className="nd-phead__titles">
        <h1 className="nd-phead__title">{title}</h1>
        {subtitle && <div className="nd-phead__sub">{subtitle}</div>}
      </div>
      {onAdd && (
        <button className="nd-phead__add" onClick={onAdd} title="Добавить" aria-label="Добавить">
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round"><path d="M10 4.5v11" /><path d="M4.5 10h11" /></svg>
        </button>
      )}
    </header>
  );
}
