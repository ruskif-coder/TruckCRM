/**
 * NdPhoneHead — шапка страницы на телефоне: заголовок + подзаголовок + кнопка «+»
 * (главное действие) + бургер (☰), открывающий лист снизу с меню страницы
 * (вкладки раздела, действия — импорт/экспорт и т.п.). Рендерится страницей
 * только под isPhone. Стили — newdash.css (.nd-phead*). Десктопная шапка (.topbar)
 * при этом не рендерится.
 */
import { useState } from "react";
import type { ReactNode } from "react";

export default function NdPhoneHead({ title, subtitle, onAdd, menu }: {
  title: string;
  subtitle?: string;
  onAdd?: () => void;         // зелёная «+» — главное действие раздела
  menu?: ReactNode;           // содержимое листа под бургером (вкладки/действия)
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
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
        {menu && (
          <button className="nd-phead__burger" onClick={() => setOpen(true)} title="Меню" aria-label="Меню раздела">
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M2.5 4.5h13" /><path d="M2.5 9h13" /><path d="M2.5 13.5h13" /></svg>
          </button>
        )}
      </header>
      {open && menu && (
        <div className="nd-msheet" onClick={() => setOpen(false)}>
          <div className="nd-msheet__backdrop" />
          <div className="nd-msheet__panel" onClick={e => e.stopPropagation()}>
            <div className="nd-msheet__grip"><i /></div>
            <div className="nd-phead__menu" onClick={() => setOpen(false)}>{menu}</div>
          </div>
        </div>
      )}
    </>
  );
}
