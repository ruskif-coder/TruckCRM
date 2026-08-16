/**
 * NdPhoneHead — шапка страницы на телефоне: заголовок + подзаголовок + кнопка «+»
 * (главное действие раздела) + бургер (☰), открывающий лист «Все разделы»
 * (NdNavSheet) — полная навигация вместо нижнего таб-бара. Рендерится страницей
 * только под isPhone. Стили — newdash.css (.nd-phead*).
 */
import { useState } from "react";
import NdNavSheet from "./NdNavSheet";

export default function NdPhoneHead({ title, subtitle, onAdd }: {
  title: string;
  subtitle?: string;
  onAdd?: () => void;         // зелёная «+» — главное действие раздела
}) {
  const [navOpen, setNavOpen] = useState(false);
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
        <button className="nd-phead__burger" onClick={() => setNavOpen(true)} title="Все разделы" aria-label="Все разделы">
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M2.5 4.5h13" /><path d="M2.5 9h13" /><path d="M2.5 13.5h13" /></svg>
        </button>
      </header>
      <NdNavSheet open={navOpen} onClose={() => setNavOpen(false)} />
    </>
  );
}
