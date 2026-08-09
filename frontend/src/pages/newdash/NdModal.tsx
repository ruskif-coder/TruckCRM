/**
 * NdModal — шаблон модальных окон (React-порт reference/modal.js).
 * Единый компонент для ВСЕХ окон: размер + шапка + тело + действия.
 * Три слоя (скроллится только тело), Esc/крестик/подложка закрывают,
 * блокировка скролла страницы, фокус на первое поле. Стили — newdash.css.
 * ВАЖНО: рендерить внутри контейнера с классом `nd` (все страницы /newdash
 * такие) — тогда работают кирпичи тела `.facts`/`.form-grid`/`.mark`/…
 *
 * <NdModal size="form" title="Внести пробег" onClose={close}
 *   actions={[{label:"Отмена",kind:"ghost",onClick:close},
 *             {label:"Сохранить",kind:"accent",onClick:save,disabled:!ok}]}>
 *   …тело из .field / .facts / .form-grid…
 * </NdModal>
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export type ModalSize = "form" | "panel" | "wide" | "sheet";
export type ActionKind = "primary" | "accent" | "ghost" | "quiet";
export type ModalAction = { label: string; kind?: ActionKind; grow?: boolean; disabled?: boolean; onClick?: () => void };
export type StatusTone = "ok" | "warn" | "risk" | "idle";

const BTN: Record<ActionKind, string> = {
  primary: "btn btn--primary", accent: "btn btn--accent", ghost: "btn btn--ghost", quiet: "btn btn--quiet",
};

export default function NdModal({
  size = "form", head = "plain", align = "center",
  title, subtitle, avatar, status, headExtra, actions = [], closable = true, onClose, children, bodyStyle,
}: {
  size?: ModalSize;
  head?: "plain" | "dark";
  align?: "center" | "right";
  title: string;
  subtitle?: string;
  avatar?: string;                      // инициалы для тёмной шапки-досье
  status?: { label: string; tone: StatusTone };
  headExtra?: ReactNode;                // доп. блок в шапке (напр. facts-грид акта)
  bodyStyle?: React.CSSProperties;      // напр. { overflow: "hidden" } — фиксировать часть тела, скроллить вложенную секцию
  actions?: ModalAction[];
  closable?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Блокировка скролла + фокус на первое поле — ТОЛЬКО при монтировании,
  // иначе inline-onClose менял бы идентичность эффекта и перебивал каретку.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = bodyRef.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);
  // Esc — отдельным эффектом со свежими closable/onClose.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && closable) onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [closable, onClose]);

  return (
    <div className={`nd-overlay nd-overlay--${align === "right" ? "right" : "center"}`} onClick={e => { if (closable && e.target === e.currentTarget) onClose(); }}>
      <div className={`nd-modal nd-modal--${size}`} role="dialog" aria-modal="true" aria-label={title}>
        {closable && (
          <button className="nd-modal__close icon-btn icon-btn--plain" title="Закрыть" onClick={onClose}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M3.5 3.5 10.5 10.5" /><path d="M10.5 3.5 3.5 10.5" /></svg>
          </button>
        )}

        <div className={`nd-modal__head${head === "dark" ? " nd-modal__head--dark" : ""}`}>
          {head === "dark" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {avatar && <span className="avatar avatar--lg">{avatar}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-h1" style={{ fontSize: 19, lineHeight: 1.2 }}>{title}</div>
                {subtitle && <div className="t-body-s muted" style={{ marginTop: 4 }}>{subtitle}</div>}
              </div>
              {status && <span className={`status status--${status.tone}`}>{status.label}</span>}
            </div>
          ) : (
            <>
              <div className="t-h2">{title}</div>
              {subtitle && <div className="t-body-s muted" style={{ marginTop: 4 }}>{subtitle}</div>}
            </>
          )}
          {headExtra}
        </div>

        <div className="nd-modal__body" ref={bodyRef} style={bodyStyle}>{children}</div>

        {actions.length > 0 && (
          <div className="nd-modal__foot">
            {actions.map((a, i) => (
              <button key={i} className={BTN[a.kind || "ghost"]} style={a.grow ? { flex: 1 } : undefined} disabled={a.disabled} onClick={a.onClick}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
