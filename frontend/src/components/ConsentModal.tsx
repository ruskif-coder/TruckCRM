import { useState, type ReactNode } from "react";
import { api } from "../api";

// ──────────────────────────────────────────────────────────────────────────────
// Модальное окно согласия с обработкой персональных данных (152-ФЗ).
// Появляется при первом входе (consent_given=false в данных пользователя).
// Не закрывается без нажатия «Принимаю» — оба чекбокса обязательны.
// После подтверждения: POST /api/auth/consent → вызов onAccepted().
// ──────────────────────────────────────────────────────────────────────────────

interface ConsentModalProps {
  onAccepted: () => void;
}

const ORG_NAME = "тестовые данные";
const ORG_INN = "тестовые данные";
const ORG_ADDRESS = "тестовые данные";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 12, border: "1px solid var(--border, #e0e0e0)", borderRadius: 10, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--bg-alt, #f7f8fa)",
          border: "none",
          padding: "12px 16px",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--ink, #222)",
          textAlign: "left",
        }}
      >
        {title}
        <span style={{ fontSize: 18, lineHeight: 1 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "12px 16px", fontSize: 13, lineHeight: 1.7, color: "var(--ink-2, #555)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function ConsentModal({ onAccepted }: ConsentModalProps) {
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAccept = check1 && check2;

  async function handleAccept() {
    if (!canAccept) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/auth/consent");
      onAccepted();
    } catch {
      setError("Не удалось сохранить согласие. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: 20,
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Шапка */}
        <div
          style={{
            background: "var(--dark, #1a1a2e)",
            color: "#fff",
            padding: "18px 24px",
            borderRadius: "20px 20px 0 0",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
            Обработка персональных данных
          </div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Для продолжения работы необходимо ваше согласие
          </div>
        </div>

        {/* Тело */}
        <div style={{ padding: "20px 24px", flex: 1 }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2, #555)", marginTop: 0, marginBottom: 16 }}>
            В соответствии с Федеральным законом № 152-ФЗ «О персональных данных» мы обязаны получить
            ваше явное согласие на обработку персональных данных до начала работы с системой.
            Ознакомьтесь с документами ниже и подтвердите согласие.
          </p>

          <Section title="Политика обработки персональных данных">
            <p><strong>Оператор:</strong> {ORG_NAME}</p>
            <p><strong>ИНН:</strong> {ORG_INN}</p>
            <p><strong>Адрес:</strong> {ORG_ADDRESS}</p>
            <p>
              <strong>Цель обработки:</strong> обеспечение работы корпоративной информационной системы
              управления транспортом, ведение учёта рейсов, водителей, автопарка и сопутствующей
              документации.
            </p>
            <p>
              <strong>Состав персональных данных:</strong> фамилия, имя, отчество; дата и место рождения;
              адрес регистрации и фактического проживания; паспортные данные; данные водительского
              удостоверения; номер СКЗИ; контактный телефон; адрес электронной почты.
            </p>
            <p>
              <strong>Правовое основание:</strong> статьи 6 и 9 Федерального закона № 152-ФЗ
              «О персональных данных» от 27.07.2006.
            </p>
            <p>
              <strong>Срок хранения:</strong> в течение всего периода трудовых/договорных отношений
              и не менее 5 лет после их прекращения — в соответствии с требованиями трудового
              и архивного законодательства.
            </p>
            <p>
              <strong>Передача третьим лицам:</strong> не осуществляется без отдельного согласия, за
              исключением случаев, предусмотренных законодательством Российской Федерации.
            </p>
            <p>
              Вы вправе отозвать согласие, обратившись письменно к администратору системы. Отзыв
              согласия не влияет на законность обработки, осуществлённой до его отзыва.
            </p>
          </Section>

          <Section title="Условия использования системы">
            <p>
              Система «Транспорт CRM» ({ORG_NAME}) предоставляется в рамках трудовых или иных
              договорных отношений исключительно для служебных целей.
            </p>
            <p>
              <strong>Пользователь обязуется:</strong>
            </p>
            <ul style={{ paddingLeft: 18, margin: "4px 0" }}>
              <li>не передавать учётные данные (логин/пароль) третьим лицам;</li>
              <li>использовать систему только в рамках своих должностных обязанностей;</li>
              <li>незамедлительно сообщать администратору об утере или компрометации доступа;</li>
              <li>не вносить заведомо недостоверные данные.</li>
            </ul>
            <p>
              Все действия пользователя в системе фиксируются в журнале аудита в соответствии
              с требованиями информационной безопасности.
            </p>
          </Section>

          {/* Чекбоксы */}
          <div style={{ marginTop: 16 }}>
            <label
              style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, cursor: "pointer", fontSize: 13, lineHeight: 1.5, color: "var(--ink, #222)" }}
            >
              <input
                type="checkbox"
                checked={check1}
                onChange={(e) => setCheck1(e.target.checked)}
                style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--primary, #2563eb)", width: 16, height: 16 }}
              />
              Я ознакомился(-ась) с Политикой обработки персональных данных и даю согласие на
              обработку моих персональных данных в указанных целях.
            </label>

            <label
              style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, lineHeight: 1.5, color: "var(--ink, #222)" }}
            >
              <input
                type="checkbox"
                checked={check2}
                onChange={(e) => setCheck2(e.target.checked)}
                style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--primary, #2563eb)", width: 16, height: 16 }}
              />
              Я ознакомился(-ась) с Условиями использования системы и принимаю их.
            </label>
          </div>

          {error && (
            <p style={{ color: "var(--ember, #e74c3c)", fontSize: 13, marginTop: 12, marginBottom: 0 }}>{error}</p>
          )}
        </div>

        {/* Кнопка */}
        <div style={{ padding: "0 24px 24px", flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleAccept}
            disabled={!canAccept || saving}
            style={{
              width: "100%",
              padding: "14px 0",
              borderRadius: 12,
              border: "none",
              background: canAccept ? "var(--primary, #2563eb)" : "var(--border, #d0d0d0)",
              color: canAccept ? "#fff" : "var(--smoke, #999)",
              fontFamily: "inherit",
              fontSize: 15,
              fontWeight: 700,
              cursor: canAccept ? "pointer" : "not-allowed",
              transition: "background 0.2s",
            }}
          >
            {saving ? "Сохранение..." : "Принимаю и продолжаю"}
          </button>
          <p style={{ fontSize: 12, color: "var(--smoke, #888)", textAlign: "center", marginTop: 10, marginBottom: 0 }}>
            Без подтверждения обоих пунктов работа с системой невозможна
          </p>
        </div>
      </div>
    </div>
  );
}
