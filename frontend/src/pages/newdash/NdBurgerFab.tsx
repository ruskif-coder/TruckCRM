/**
 * NdBurgerFab — плавающая кнопка-бургер в правом нижнем углу (только телефон).
 * Поверх всего; показывается при заходе на страницу и при скролле, затем плавно
 * затухает (~1 c) и перестаёт перехватывать нажатия (pointer-events:none) —
 * страница остаётся полностью доступной. Любой скролл/касание снова проявляет её.
 * По тапу открывает лист «Все разделы» (NdNavSheet). Монтируется один раз из
 * NdMenu. Стили — newdash.css (.nd-burgerfab).
 */
import { useEffect, useRef, useState } from "react";
import NdNavSheet from "./NdNavSheet";

const HOLD_MS = 1400;   // сколько висит проявленной перед затуханием

export default function NdBurgerFab() {
  const [navOpen, setNavOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const navOpenRef = useRef(false);
  navOpenRef.current = navOpen;

  useEffect(() => {
    const reveal = () => {
      setVisible(true);
      window.clearTimeout(timer.current);
      if (navOpenRef.current) return;                 // при открытом листе не гасим
      timer.current = window.setTimeout(() => setVisible(false), HOLD_MS);
    };
    reveal();                                          // на маунте (= вход/переключение страницы)
    // capture:true — ловим scroll и от внутренних контейнеров (события скролла не всплывают)
    window.addEventListener("scroll", reveal, { passive: true, capture: true });
    window.addEventListener("touchstart", reveal, { passive: true });
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("scroll", reveal, true);
      window.removeEventListener("touchstart", reveal);
    };
  }, []);

  // Пока лист открыт — держим кнопку проявленной; после закрытия снова заводим затухание.
  useEffect(() => {
    if (navOpen) { setVisible(true); window.clearTimeout(timer.current); }
    else { setVisible(true); timer.current = window.setTimeout(() => setVisible(false), HOLD_MS); }
  }, [navOpen]);

  return (
    <>
      <button
        className="nd-burgerfab"
        data-visible={visible || navOpen || undefined}
        onClick={() => setNavOpen(true)}
        title="Все разделы"
        aria-label="Все разделы"
      >
        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round"><path d="M3 5.5h16" /><path d="M3 11h16" /><path d="M3 16.5h16" /></svg>
      </button>
      <NdNavSheet open={navOpen} onClose={() => setNavOpen(false)} />
    </>
  );
}
