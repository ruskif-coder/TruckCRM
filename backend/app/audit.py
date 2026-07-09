"""Журнал действий пользователей (2026-06-28) — центральная точка записи
после явного запроса пользователя "введём логирование действий
пользователей". Решено через AskUserQuestion в этом же чате:
  - логируются изменения (create/update/delete) по всем разделам + попытки
    входа (успех/неудача); просмотр (GET) не логируется;
  - каждая запись хранит полную историю изменений по полям (старое → новое
    значение), не только короткую строку;
  - показывается во вкладке «Журнал» в Настройках, admin-only.

Вызывается из каждого роутера (crud.py::make_router и custom-роутеры) сразу
после session.commit() основного действия, в той же сессии — отдельным
commit. Если запись журнала не удастся, основное действие уже сохранено:
журналирование вспомогательное и не должно блокировать рабочую операцию.
"""

import json
from datetime import date, datetime
from typing import Any, Optional

from sqlmodel import Session

from . import models

# Человекочитаемые подписи зон для сводки в журнале - покрывает и
# операционные зоны (см. permissions.ZONES), и admin-only разделы, которых
# там нет (пользователи/настройки/условия оплаты/партии рейсов/роли/вход).
ZONE_LABELS: dict[str, str] = {
    "trucks": "Машины",
    "drivers": "Водители",
    "trips": "Рейсы",
    "expenses": "Расходы",
    "fuel": "Топливо",
    "carriers": "Перевозчики",
    "routes": "Маршруты",
    "documents": "Документы",
    "mileage_logs": "Пробег",
    "dashboard": "Дашборд",
    "users": "Пользователи",
    "settings": "Настройки",
    "driver_rates": "Условия оплаты",
    "trip_batches": "Партии рейсов",
    "role_permissions": "Роли",
    "auth": "Вход в систему",
    "repair_requests": "Заявки на ремонт",
    "vehicle_inspections": "Приёмка-передача авто",
}

ACTION_LABELS: dict[str, str] = {
    "create": "создал",
    "update": "изменил",
    "delete": "удалил",
    "login_success": "вошёл в систему",
    "login_failed": "не смог войти в систему",
    "logout": "вышел из системы",
    "import": "импортировал",
    "post_to_expenses": "провёл в расходы",
    "reset_password": "сбросил пароль",
    "download_file": "скачал файл",
}


def _json_safe(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def mask(data: Optional[dict], *keys: str) -> Optional[dict]:
    """Возвращает копию `data` без перечисленных ключей - используется
    перед передачей before/after в log_action для полей, которые не должны
    оказаться в журнале даже в виде bcrypt-хэша (password_hash и т.п.)."""
    if data is None:
        return None
    return {k: v for k, v in data.items() if k not in keys}


def _diff(before: Optional[dict], after: Optional[dict]) -> dict[str, dict[str, Any]]:
    """Полная история по затронутым полям. create: before=None - все поля
    after получают old=None. delete: after=None - все поля before получают
    new=None. update: оба заданы - только поля, где значение реально
    изменилось."""
    changes: dict[str, dict[str, Any]] = {}
    if before is None and after is not None:
        for k, v in after.items():
            changes[k] = {"old": None, "new": _json_safe(v)}
    elif after is None and before is not None:
        for k, v in before.items():
            changes[k] = {"old": _json_safe(v), "new": None}
    elif before is not None and after is not None:
        for k in set(before) | set(after):
            old_v, new_v = before.get(k), after.get(k)
            if old_v != new_v:
                changes[k] = {"old": _json_safe(old_v), "new": _json_safe(new_v)}
    return changes


def default_label(data: Optional[dict]) -> str:
    """Дешёвый дефолт для генерик-роутеров (crud.py::make_router), которые
    не знают заранее, какое поле модели - "имя" для человека. Перебирает
    самые частые кандидаты; если ни одного нет, log_action сам подставит
    "#<entity_id>"."""
    if not data:
        return ""
    for key in ("name", "full_name", "label", "plate", "type", "request_number", "username"):
        v = data.get(key)
        if v:
            return str(v)
    return ""


def log_action(
    session: Session,
    *,
    user: Optional[models.User],
    action: str,
    zone: str,
    entity_id: Optional[int] = None,
    entity_label: str = "",
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    username_override: str = "",
    extra: Optional[dict] = None,
) -> None:
    """Записывает одну строку журнала.

    `user` - текущий пользователь; допускается None только для
    login_failed с логином, которого нет в БД (тогда берётся
    `username_override` - то, что человек ввёл в форму входа).
    `entity_label` - человекочитаемое имя конкретной записи (гос. номер
    машины, ФИО водителя и т.п.) для сводки; если пусто и есть entity_id,
    в сводке используется "#<entity_id>".
    `extra` - произвольные дополнительные данные не по схеме before/after
    (например, счётчики импорта) - попадают в changes_json под ключом
    "_extra" рядом с обычным диффом полей.
    """
    zone_label = ZONE_LABELS.get(zone, zone)
    action_label = ACTION_LABELS.get(action, action)
    who = (user.full_name or user.username) if user else (username_override or "неизвестный")

    what = entity_label or (f"#{entity_id}" if entity_id is not None else "")
    if action in ("login_success", "login_failed"):
        summary = f"{who}: {action_label}"
    else:
        summary = f"{who} {action_label} «{zone_label}»" + (f" — {what}" if what else "")

    changes = _diff(before, after)
    if extra:
        changes["_extra"] = {"old": None, "new": {k: _json_safe(v) for k, v in extra.items()}}

    entry = models.ActionLog(
        user_id=user.id if user else None,
        username=user.username if user else username_override,
        role=user.role if user else "",
        action=action,
        zone=zone,
        entity_id=entity_id,
        summary=summary,
        changes_json=json.dumps(changes, ensure_ascii=False),
    )
    session.add(entry)
    session.commit()
