"""Конфигурируемая матрица доступа по ролям ("Настройки -> Роли", добавлено
2026-06-28). До этой фичи права были зашиты прямо в коде каждого роутера
(require_role("admin","foreman") и т.п. - см. комментарии "Роли по API" в
routers/*.py) по схеме "Разделение по зонам", которую выбрал пользователь:
бухгалтер -> расходы/топливо/перевозчики; бригадир -> машины/водители/
рейсы; водитель -> read-only, только свои рейсы/заправки.

Теперь для "операционных" разделов (ZONES ниже) право чтения/записи на
роль хранится в таблице models.RolePermission, и admin может его поменять
через UI без правки кода - см. routers/role_permissions.py (GET/PUT) и
auth.require_zone() (дependency, которая читает эту таблицу вместо
статического списка ролей).

Роль "admin" в таблице не хранится вообще и здесь не упоминается - у неё
всегда безусловный полный доступ (require_zone и require_role одинаково
пропускают admin без проверки таблицы).

Что СОЗНАТЕЛЬНО осталось вне этой матрицы (через require_role("admin")
прямо в своём роутере, как и раньше): Пользователи (routers/users.py),
Настройки (routers/settings.py - глобальные дефолты, и сама эта страница
со списком ролей), Условия оплаты (routers/driver_rates.py), Партии рейсов
(routers/trip_batches.py - неактивная фича). Это защитный пол: будь они
настраиваемыми через ту же страницу, которую контролируют, роль могла бы
сама себе выдать доступ к управлению ролями/пользователями.

2026-06-29 ("журнал пробегов", вкладка «Пробеги» в разделе «Рейсы»):
водителю открыта запись в "mileage_logs" (раньше там не было вообще
никакого доступа) - он должен сам вносить показания одометра по своей
машине; own_filter_field в main.py сужает то, что он *видит*, до его
собственных записей, как и для trips/fuel. Заодно открыт READ на "trucks" -
без него форма не могла бы показать список машин для выбора (раньше
водителю эта зона не требовалась, т.к. он не работал ни с одной страницей,
которая обращается к /api/trucks/). См. _upgrade_legacy_driver_defaults()
ниже - без неё это изменение не подействовало бы на БД, которая уже
прошла сидирование со старыми дефолтами.
"""

from sqlmodel import Session, select

from . import models

# (ключ зоны, человекочитаемая подпись для UI)
ZONES: list[tuple[str, str]] = [
    ("trucks", "Машины"),
    ("drivers", "Водители"),
    ("trips", "Рейсы"),
    ("expenses", "Расходы"),
    ("fuel", "Топливо"),
    ("carriers", "Перевозчики"),
    ("routes", "Маршруты"),
    ("documents", "Документы"),
    ("mileage_logs", "Пробег"),
    ("dashboard", "Дашборд"),
    # Дашборд водителя (2026-06-30): заявки на ремонт от водителя → бригадиру.
    # Водитель: read+write (только свои, own_filter_field); бригадир: read+write все.
    ("repair_requests", "Заявки на ремонт"),
]
ZONE_KEYS = {zone for zone, _ in ZONES}

# "Дашборд" - это просмотр сводки (GET), там нет понятия "запись" - UI прячет
# переключатель записи для этой зоны (см. Settings.tsx RolesTab).
READ_ONLY_ZONES = {"dashboard"}

CONFIGURABLE_ROLES: list[tuple[str, str]] = [
    ("foreman", "Бригадир"),
    ("accountant", "Бухгалтер"),
    ("driver", "Водитель"),
]
CONFIGURABLE_ROLE_KEYS = {role for role, _ in CONFIGURABLE_ROLES}

# Дефолты = ровно то поведение, что было зашито в коде до этой фичи (см.
# комментарии "Роли по API" в каждом роутере) - чтобы первый запуск после
# обновления никому ничего не отрезал и не открыл лишнего без явного
# решения админа. "driver" на trips/fuel = (True, False): раньше там вообще
# не было read_roles (т.е. читать мог любой залогиненный), а own_filter_field
# в crud.py отдельно сужал список до собственных строк - это поведение не
# меняется, см. crud.py make_router().
DEFAULT_MATRIX: dict[tuple[str, str], tuple[bool, bool]] = {
    ("trucks", "foreman"): (True, True),
    ("trucks", "accountant"): (True, False),
    # (False,False) -> (True,False) 2026-06-29: нужно для выбора машины в
    # новой форме "Пробеги" (own_filter_field там не на машинах, а на
    # mileage_logs.driver_id - сама зона "trucks" остаётся read-only).
    ("trucks", "driver"): (True, False),
    ("drivers", "foreman"): (True, True),
    ("drivers", "accountant"): (True, False),
    ("drivers", "driver"): (False, False),
    ("trips", "foreman"): (True, True),
    ("trips", "accountant"): (True, False),
    ("trips", "driver"): (True, False),
    ("expenses", "foreman"): (True, False),
    ("expenses", "accountant"): (True, True),
    ("expenses", "driver"): (False, False),
    ("fuel", "foreman"): (True, False),
    ("fuel", "accountant"): (True, True),
    ("fuel", "driver"): (True, False),
    ("carriers", "foreman"): (True, False),
    ("carriers", "accountant"): (True, True),
    ("carriers", "driver"): (False, False),
    ("routes", "foreman"): (True, True),
    ("routes", "accountant"): (True, False),
    ("routes", "driver"): (False, False),
    ("documents", "foreman"): (True, True),
    ("documents", "accountant"): (True, False),
    ("documents", "driver"): (False, False),
    ("mileage_logs", "foreman"): (True, True),
    ("mileage_logs", "accountant"): (True, False),
    # (False,False) -> (True,True) 2026-06-29: водитель сам вносит показания
    # одометра по своей машине (см. модуль docstring выше); own_filter_field
    # в main.py ограничивает чтение его собственными записями.
    ("mileage_logs", "driver"): (True, True),
    ("dashboard", "foreman"): (True, False),
    ("dashboard", "accountant"): (True, False),
    ("dashboard", "driver"): (False, False),
    # Заявки на ремонт (дашборд водителя, 2026-06-30):
    # водитель - read+write (own_filter_field ограничит до его записей);
    # бригадир - read+write (видит и меняет статус всех заявок);
    # бухгалтер - read-only.
    ("repair_requests", "foreman"): (True, True),
    ("repair_requests", "accountant"): (True, False),
    ("repair_requests", "driver"): (True, True),
}


def seed_default_role_permissions(session: Session) -> None:
    """Дозаполняет таблицу значениями DEFAULT_MATRIX (как seed_default_admin
    в auth.py, но не "только если пусто", а точечно). Идемпотентно: трогает
    только (role, zone) пары, которых ещё нет в таблице - то, что админ уже
    поменял через UI на предыдущих запусках, не перезатирается. Это же
    дозаполняет новые зоны/роли, если их когда-нибудь добавят в ZONES/
    CONFIGURABLE_ROLES после того, как у части пользователей таблица уже
    была создана и частично заполнена."""
    existing = {(p.zone, p.role) for p in session.exec(select(models.RolePermission)).all()}
    added = False
    for (zone, role), (can_read, can_write) in DEFAULT_MATRIX.items():
        if zone not in ZONE_KEYS or role not in CONFIGURABLE_ROLE_KEYS:
            continue
        if (zone, role) in existing:
            continue
        session.add(models.RolePermission(role=role, zone=zone, can_read=can_read, can_write=can_write))
        added = True
    if added:
        session.commit()


# Одноразовая корректировка уже засеянных строк (2026-06-29, "журнал
# пробегов"). seed_default_role_permissions() выше принципиально
# additive-only - она не трогает (zone, role) пары, которые уже есть в
# таблице, поэтому простая правка DEFAULT_MATRIX выше ничего не даст на
# БД, которая уже была засеяна со старыми дефолтами (False, False) до
# этого изменения. Здесь поэтому отдельно поднимаем именно эти две строки
# (driver/mileage_logs, driver/trucks) до нового дефолта - но только если
# они до сих пор равны *старому* дефолту (False, False) "как из коробки".
# Если админ уже зашёл в Настройки -> Роли и сам что-то включил/выключил
# для водителя на этих зонах, его решение не перезатирается.
_LEGACY_DRIVER_ZONE_DEFAULTS: list[str] = ["mileage_logs", "trucks"]


def upgrade_legacy_driver_defaults(session: Session) -> None:
    changed = False
    for zone in _LEGACY_DRIVER_ZONE_DEFAULTS:
        perm = session.exec(
            select(models.RolePermission).where(
                models.RolePermission.role == "driver",
                models.RolePermission.zone == zone,
            )
        ).first()
        if perm is None:
            continue  # ещё не засеяно - seed_default_role_permissions() выше внесёт уже новый дефолт
        if not perm.can_read and not perm.can_write:
            perm.can_read, perm.can_write = DEFAULT_MATRIX[(zone, "driver")]
            session.add(perm)
            changed = True
    if changed:
        session.commit()
