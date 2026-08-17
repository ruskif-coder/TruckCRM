/**
 * useSwipeNav — горизонтальный свайп влево/вправо для навигации по /newdash на
 * телефоне. Строит ЕДИНЫЙ упорядоченный список всех страниц (разделы NAV + их
 * вкладки-children подряд) и листает по нему: внутри раздела свайп перескакивает
 * вкладки, на границе — уходит в соседний раздел. Один жест закрывает оба уровня
 * («вкладки и разделы»).
 *
 * Монтируется один раз — из NdMenu (он есть на каждой странице). На десктопе
 * выключен (enabled=false). Слушатели пассивные, вертикальный скролл не трогаем;
 * жест игнорируется в горизонтально-скроллящихся зонах (таблицы, лента вкладок),
 * в полях ввода и когда открыт любой оверлей (модалка/лист).
 */
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { NAV, ADMIN_ONLY_PATHS } from "./NdMenu";

function buildFlatPages(isAdmin: boolean): string[] {
  const pages: string[] = [];
  for (const item of NAV) {
    const kids = (item.children || []).filter(c => isAdmin || !ADMIN_ONLY_PATHS.has(c.to));
    if (kids.length) pages.push(...kids.map(k => k.to));
    else pages.push(item.to);
  }
  return pages;
}

const MIN_DX = 70;      // порог горизонтали, px
const MAX_DT = 600;     // максимум времени жеста, мс
const H_RATIO = 2;      // |dx| должен быть >= |dy| * H_RATIO (уверенно горизонтальный)
// Зоны, где свайп НЕ должен листать страницы (собственный горизонтальный скролл/ввод).
const IGNORE_SEL = ".table-scroll, .segments, .nd-fdrop, input, textarea, select, [data-noswipe]";
// Открытые оверлеи — при них навигацию не трогаем.
const OVERLAY_SEL = ".nd-overlay, .nd-msheet, .nd-fsheet";

export default function useSwipeNav(enabled: boolean) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const pages = useMemo(() => buildFlatPages(user?.role === "admin"), [user?.role]);

  // Свежие значения в слушателе без переподписки на каждый переход.
  const pathRef = useRef(pathname); pathRef.current = pathname;
  const pagesRef = useRef(pages); pagesRef.current = pages;

  useEffect(() => {
    if (!enabled) return;
    let x0 = 0, y0 = 0, t0 = 0, tracking = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      if (document.querySelector(OVERLAY_SEL)) { tracking = false; return; }
      const el = e.target as HTMLElement | null;
      if (el && el.closest(IGNORE_SEL)) { tracking = false; return; }
      const t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); tracking = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return; tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (Date.now() - t0 > MAX_DT) return;
      if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * H_RATIO) return;
      const list = pagesRef.current;
      const i = list.indexOf(pathRef.current);
      if (i === -1) return;
      const ni = dx < 0 ? i + 1 : i - 1;   // свайп влево → следующая, вправо → предыдущая
      if (ni < 0 || ni >= list.length) return;
      navigate(list[ni]);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [enabled, navigate]);
}
