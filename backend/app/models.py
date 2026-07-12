from datetime import date, datetime
from datetime import date as _Date  # noqa: F401 — alias for fields literally named `date`
# (see CashFlowEntryUpdate.date below). Pydantic v2 has a documented bug where a field
# named exactly `date` annotated `Optional[date]` mis-resolves its own annotation to
# NoneType, so it rejects every real date value with "Input should be None" (hit
# 2026-06-23 editing a Реестр расходов entry). Aliasing the import for just these
# fields breaks the name collision. Upstream: pydantic/pydantic#12728, #9907, #7945.
# Required (non-Optional) `date: date` fields elsewhere in this file are unaffected.
from typing import List, Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

EXPENSE_CATEGORIES = ["Ремонт/запчасти", "Топливо", "Зарплата", "Страховка", "Прочее"]
DOC_TYPES = ["ОСАГО", "КАСКО", "Техосмотр", "Лицензия/разрешение", "Другое"]
RATE_TYPES = ["perTrip", "perKm", "salary", "percentOfNet"]
ROLES = ["admin", "driver", "foreman", "accountant"]

# CashFlowEntry ("Реестр расходов") picklists. Banks/categories replaced
# 2026-06-23 per user request with the company's real short lists (the
# original lists, taken verbatim from the data validation lists in the
# user-supplied "Реестр расходов.xlsx" CF sheet, were a placeholder from
# that one fixture file, not the company's actual chart of accounts). See
# models.CashFlowEntryBase below. "АльфаБанк Личные" split into two separate
# entries ("Альфабанк"/"Личные") same day per user correction - they're
# distinct picklist positions, not one combined bank name. "Ремонт" added
# same day as its own entry, separate from "Ремонт внеплановый".
CASHFLOW_STATUSES = ["ОПЛАЧЕНО", "ПЛАН ОПЛАТ", "ПЛАН ПОСТУПЛЕНИЙ"]
CASHFLOW_BANKS = ["АльфаКарта", "Альфабанк", "Личные", "Фирма", "Наличные"]
CASHFLOW_CATEGORIES = [
    "Оплата перевозок", "Оплата аренды", "Техническое обслуживание", "Ремонт", "Ремонт внеплановый",
    "Тех осмотр", "Топливо", "Фот", "Займ", "Запчасти", "Штрафы",
    "НАЛОГИ", "КАСКО", "ОСАГО", "Платная дорога", "Расчёт с водителем", "Прочее",
]
# "Платная дорога" (2026-06-28, "кабинет водителя" план, п.1): записывается
# вручную в реестр расходов с заполненными truck_id+driver_id+date - читается
# обратно в calculations.py::weekly_pnl() для колонки "Дорога" вместо
# хардкода 0. "Расчёт с водителем" (там же, п.3) - выплаты, проведённые
# кнопкой «Провести расчёт» на странице Отчёты; задел под будущий баланс
# водителя, в эту итерацию страница баланса не строится.

# Площадка-источник заявки, выбирается пользователем в окне импорта (не
# приходит из самого файла) - см. models.Trip.source.
TRIP_SOURCES = ["OZON", "WB", "ATI", "Прямые", "Прочие"]
# Реестр перевозчиков (models.Carrier) запущен 2026-06-23 - список для окна
# импорта теперь читается оттуда (GET /api/carriers/) на frontend, а не из
# плейсхолдера. Старый DEFAULT_CARRIER_NAME убран как мёртвый код (не был
# использован ни в одном create-пути, только в комментариях).


# ---------------- Truck ----------------
# "Вид" / "надстройка" picklists added 2026-06-23 for the Автомобили admin
# form - exact wording dictated by the user (incl. "Рефрежиратор" spelling).
# "Надстройка" allows "" (бортовая платформа / no superstructure - two of
# the 3 real trucks are plain бортовой, only one is actually tented).
VEHICLE_TYPES = ["Грузовой", "Легковой", "Фура"]
BODY_TYPES = ["Тент", "Рефрежиратор", "Изотерма", "Фургон", "Прицеп"]


class TruckBase(SQLModel):
    # `label` used to be the only display name (set to the bare plate by
    # find_or_create_truck() for importer-created rows) - now auto-synced
    # from `brand` by routers/trucks.py, so it no longer needs to be
    # required/user-supplied. See "Название" in the Автомобили form, which
    # writes to `brand`, not `label`.
    label: str = ""
    plate: str = ""
    brand: str = ""
    year: Optional[int] = None
    vehicle_type: str = ""
    body_type: str = ""
    maintenance_interval_km: Optional[int] = None
    osago_date: Optional[date] = None
    kasko_date: Optional[date] = None
    tech_inspection_date: Optional[date] = None
    # Document numbers, added 2026-06-24 (were previously crammed into free-
    # text `notes`, migrated to the database). `pts_number` holds
    # whichever of ПТС/ЭПТС applies to that vehicle - they're mutually
    # exclusive (paper vs electronic version of the same document), so one
    # column covers both rather than fabricating an ЭПТС for a truck that
    # only has a paper ПТС.
    vin: str = ""
    chassis_number: str = ""
    pts_number: str = ""
    sts_number: str = ""
    # Document numbers added 2026-07-03 (карточка авто: блок документов).
    # sts_number already existed; osago/kasko/tech_inspection numbers are new.
    # Scan filenames served as /truck-scans/<filename> (StaticFiles mount).
    osago_number: str = ""
    kasko_number: str = ""
    tech_inspection_number: str = ""
    sts_date: Optional[date] = None         # дата окончания / выдачи СТС
    sts_scan: str = ""
    osago_scan: str = ""
    kasko_scan: str = ""
    tech_inspection_scan: str = ""
    notes: str = ""


class Truck(TruckBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class TruckCreate(TruckBase):
    pass


class TruckUpdate(SQLModel):
    label: Optional[str] = None
    plate: Optional[str] = None
    brand: Optional[str] = None
    year: Optional[int] = None
    vehicle_type: Optional[str] = None
    body_type: Optional[str] = None
    maintenance_interval_km: Optional[int] = None
    osago_date: Optional[date] = None
    kasko_date: Optional[date] = None
    tech_inspection_date: Optional[date] = None
    vin: Optional[str] = None
    chassis_number: Optional[str] = None
    pts_number: Optional[str] = None
    sts_number: Optional[str] = None
    osago_number: Optional[str] = None
    kasko_number: Optional[str] = None
    tech_inspection_number: Optional[str] = None
    sts_date: Optional[date] = None
    sts_scan: Optional[str] = None
    osago_scan: Optional[str] = None
    kasko_scan: Optional[str] = None
    tech_inspection_scan: Optional[str] = None
    notes: Optional[str] = None


# ---------------- Driver ----------------
# Extended 2026-06-19 with the full registration-card field set from the
# legacy desktop app's "Регистрация водителя" form (user-supplied
# screenshot), built as a dedicated section/page (see memory:
# transport-crm-auth-import-built). `name` ("Фамилия Имя") stays as the
# legacy display/matching field used by importers/common.py's surname
# matching - it's kept in sync with last_name/first_name by the drivers
# router rather than replaced, so existing Trip/FuelRecord driver_id FKs
# and the import matching logic don't need to change.
class DriverBase(SQLModel):
    # Optional at the API layer (default "") because the drivers router
    # (routers/drivers.py) recomputes this from last_name/first_name on
    # create/update - the frontend registration form never has to send it
    # directly.
    name: str = ""
    phone: str = ""
    truck_id: Optional[int] = Field(default=None, foreign_key="truck.id")
    rate_type: str = "perTrip"
    default_rate: float = 0
    notes: str = ""  # "Примечание" on the registration form

    active: bool = True
    mobile_app_enabled: bool = False
    mobile_login: str = ""
    mobile_password: str = ""

    last_name: str = ""
    first_name: str = ""
    middle_name: str = ""
    birth_date: Optional[date] = None
    birth_place: str = ""
    email: str = ""

    passport_number: str = ""
    passport_issued_date: Optional[date] = None
    passport_issued_by: str = ""
    registration_address: str = ""
    residence_address: str = ""

    license_number: str = ""
    license_issued_date: Optional[date] = None
    license_valid_until: Optional[date] = None

    skzi_card_number: str = ""
    skzi_issued_date: Optional[date] = None
    skzi_valid_until: Optional[date] = None


class Driver(DriverBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class DriverCreate(DriverBase):
    pass


class DriverUpdate(SQLModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    truck_id: Optional[int] = None
    rate_type: Optional[str] = None
    default_rate: Optional[float] = None
    notes: Optional[str] = None

    active: Optional[bool] = None
    mobile_app_enabled: Optional[bool] = None
    mobile_login: Optional[str] = None
    mobile_password: Optional[str] = None

    last_name: Optional[str] = None
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    birth_date: Optional[date] = None
    birth_place: Optional[str] = None
    email: Optional[str] = None

    passport_number: Optional[str] = None
    passport_issued_date: Optional[date] = None
    passport_issued_by: Optional[str] = None
    registration_address: Optional[str] = None
    residence_address: Optional[str] = None

    license_number: Optional[str] = None
    license_issued_date: Optional[date] = None
    license_valid_until: Optional[date] = None

    skzi_card_number: Optional[str] = None
    skzi_issued_date: Optional[date] = None
    skzi_valid_until: Optional[date] = None


# ---------------- Route ----------------
class RouteBase(SQLModel):
    name: str
    km_one_way: float = 0


class Route(RouteBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class RouteCreate(RouteBase):
    pass


class RouteUpdate(SQLModel):
    name: Optional[str] = None
    km_one_way: Optional[float] = None


# ---------------- Carrier ("Перевозчики") ----------------
# Built 2026-06-23 as the first tab of the new Настройки (Settings) admin
# page. `name` is the short label meant for use in tables/pickers elsewhere
# (e.g. eventually replacing Trip.carrier_name's free-text placeholder, see
# DEFAULT_CARRIER_NAME above) - kept distinct from `full_name`, the legal
# entity name. "Базовые реквизиты" = the standard Russian legal-entity
# requisite set (ОГРН/КПП/юр. адрес + banking details), not yet validated
# (no ИНН checksum etc.) since the user only asked for the fields, not
# validation. `insurance_pct` ("% СК") is a plain stored number - the user
# said it'll be used in summary reports later, no calculation lives here yet.
class CarrierBase(SQLModel):
    name: str
    full_name: str = ""
    inn: str = ""
    phone: str = ""
    contact_person: str = ""
    ogrn: str = ""
    kpp: str = ""
    legal_address: str = ""
    bank_name: str = ""
    bik: str = ""
    settlement_account: str = ""
    correspondent_account: str = ""
    insurance_pct: float = 0  # "% СК"
    # Связь с контрагентом (2026-07-12): для зачёта поступлений при расчёте
    # баланса перевозчика. Устанавливается вручную в карточке перевозчика.
    counterparty_id: Optional[int] = Field(default=None, foreign_key="counterparty.id")


class Carrier(CarrierBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class CarrierCreate(CarrierBase):
    pass


class CarrierUpdate(SQLModel):
    name: Optional[str] = None
    full_name: Optional[str] = None
    inn: Optional[str] = None
    phone: Optional[str] = None
    contact_person: Optional[str] = None
    ogrn: Optional[str] = None
    kpp: Optional[str] = None
    legal_address: Optional[str] = None
    bank_name: Optional[str] = None
    bik: Optional[str] = None
    settlement_account: Optional[str] = None
    correspondent_account: Optional[str] = None
    insurance_pct: Optional[float] = None
    counterparty_id: Optional[int] = None


# ---------------- DriverRate ("Условия оплаты водителя") ----------------
# Built 2026-06-28 to replace calculations.py's flat DRIVER_PCT_PLACEHOLDER
# with real per-driver conditions, per the user's explicit spec: "водитель" +
# "перевозчик" - "формат" - "условие" - one row per (driver, carrier) pair,
# a `rate_type` ("формат", from RATE_TYPES) and a single `rate_value`
# ("условие") whose unit depends on rate_type (% of net for percentOfNet,
# ₽/trip for perTrip, ₽/km for perKm, ₽/month for salary). One row per
# (driver_id, carrier_id) - enforced with a unique constraint since this is a
# brand-new table with no legacy rows to migrate around.
class DriverRateBase(SQLModel):
    driver_id: int = Field(foreign_key="driver.id")
    carrier_id: int = Field(foreign_key="carrier.id")
    rate_type: str = "percentOfNet"
    rate_value: float = 0
    notes: str = ""


class DriverRate(DriverRateBase, table=True):
    __tablename__ = "driverrate"
    __table_args__ = (UniqueConstraint("driver_id", "carrier_id", name="uq_driverrate_driver_carrier"),)
    id: Optional[int] = Field(default=None, primary_key=True)


class DriverRateCreate(DriverRateBase):
    pass


class DriverRateUpdate(SQLModel):
    driver_id: Optional[int] = None
    carrier_id: Optional[int] = None
    rate_type: Optional[str] = None
    rate_value: Optional[float] = None
    notes: Optional[str] = None


# ---------------- TripBatch ("Рейсы") ----------------
class TripBatchBase(SQLModel):
    period_start: date
    period_end: date
    driver_id: int = Field(foreign_key="driver.id")
    truck_id: int = Field(foreign_key="truck.id")
    route_id: Optional[int] = Field(default=None, foreign_key="route.id")
    km_per_trip: float = 0
    rate_per_trip: float
    trips_count: int
    gross_revenue: float
    fines: float = 0
    toll_road: float = 0
    fuel_cost: float = 0
    commission_pct: Optional[float] = None  # None => use settings.default_commission_pct
    route_name: str = ""  # cached fallback label if route gets deleted


class TripBatch(TripBatchBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class TripBatchCreate(TripBatchBase):
    pass


class TripBatchUpdate(SQLModel):
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    driver_id: Optional[int] = None
    truck_id: Optional[int] = None
    route_id: Optional[int] = None
    km_per_trip: Optional[float] = None
    rate_per_trip: Optional[float] = None
    trips_count: Optional[int] = None
    gross_revenue: Optional[float] = None
    fines: Optional[float] = None
    toll_road: Optional[float] = None
    fuel_cost: Optional[float] = None
    commission_pct: Optional[float] = None
    route_name: Optional[str] = None


# ---------------- Trip ("Реестр поездок") — raw, ungrouped import rows.
# One row per source line from the registry export, all statuses included
# (even "Отменено"). This is what the import endpoint creates now. The
# weekly-aggregated TripBatch above stays untouched as a separate, dormant
# entity reserved for a future dashboard feature (decided 2026-06-19/20 —
# see memory: transport-crm-auth-import-built).
class TripBase(SQLModel):
    request_number: str
    external_request_number: str = ""
    tariff_type: str = ""
    plate_raw: str = ""
    truck_id: Optional[int] = Field(default=None, foreign_key="truck.id")
    driver_name_raw: str = ""
    driver_id: Optional[int] = Field(default=None, foreign_key="driver.id")
    driver_phone: str = ""
    confirmed_at: Optional[datetime] = None
    status: str = ""
    dep_at: datetime
    end_at: Optional[datetime] = None
    amount: float = 0
    # "Штраф" column, added to the import template by the user 2026-06-26 -
    # a per-trip fine/penalty amount read straight from the file (see
    # TRIP_COLUMNS in importers/trip_registry.py).
    fines: float = 0
    # Chosen by the user in the import dialog (not read from the file) -
    # one value applies to every row of that import batch. See TRIP_SOURCES
    # / DEFAULT_CARRIER_NAME above and memory: transport-crm-rebuild-scope.
    source: str = ""
    carrier_name: str = ""


class Trip(TripBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class TripCreate(TripBase):
    pass


# ---------------- Trip export (2026-06-29, кнопка "Экспорт" в реестре
# поездок) - "выгрузка файла в эксель с учетом сортировки... добавить
# колонку 'билинг'". Фильтрация/сортировка и сам расчёт "Биллинг" (сумма за
# вычетом "% СК" перевозчика) уже сделаны на фронте для отображения на
# экране (Trips.tsx::billingFor) - сюда приходит готовый список строк в
# нужном порядке, бэкенд только сериализует его в .xlsx, не повторяя эту
# логику на Python.
class TripExportRow(SQLModel):
    source: str = ""
    carrier_name: str = ""
    request_number: str = ""
    status: str = ""
    dep_at: str = ""
    end_at: str = ""
    tariff_type: str = ""
    driver_name: str = ""
    truck_label: str = ""
    driver_phone: str = ""
    amount: float = 0
    billing: float = 0
    fines: float = 0


class TripExportRequest(SQLModel):
    rows: List[TripExportRow]


class TripUpdate(SQLModel):
    request_number: Optional[str] = None
    external_request_number: Optional[str] = None
    tariff_type: Optional[str] = None
    plate_raw: Optional[str] = None
    truck_id: Optional[int] = None
    driver_name_raw: Optional[str] = None
    driver_id: Optional[int] = None
    driver_phone: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    status: Optional[str] = None
    dep_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    amount: Optional[float] = None
    fines: Optional[float] = None
    source: Optional[str] = None
    carrier_name: Optional[str] = None


# ---------------- FuelRecord ("Топливо") ----------------
# Rows come from two sources, mixed in the same table (decided 2026-06-19
# evening, see memory: transport-crm-auth-import-built): file import (fuel
# card export, e.g. E100 - one row per card transaction, upserted by
# `external_id`) and manual entry (user fills date/truck/volume/amount by
# hand, no card data - `external_id` stays empty so it never collides with
# an import). Negative volume/amount rows in the source file are price
# corrections tied to an adjacent transaction - imported as separate rows
# as-is (not netted out), since a plain SUM already gives the correct
# total.
class FuelRecordBase(SQLModel):
    external_id: str = ""  # "ID" column from the card export; blank => manual entry
    date: datetime
    station: str = ""  # АЗС
    card_number: str = ""  # Карта №
    truck_brand_raw: str = ""  # Марка ТС, as written in the file
    plate_raw: str = ""  # Гос. Номер ТС, as written in the file
    truck_id: Optional[int] = Field(default=None, foreign_key="truck.id")
    volume: float = 0  # Объем (литры) - can be negative (correction row)
    amount: float = 0  # Сумма - can be negative (correction row)
    external_transaction_id: str = ""  # "ID транзакции" - long opaque string, kept for traceability only


class FuelRecord(FuelRecordBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class FuelRecordCreate(FuelRecordBase):
    pass


class FuelRecordUpdate(SQLModel):
    external_id: Optional[str] = None
    date: Optional[datetime] = None
    station: Optional[str] = None
    card_number: Optional[str] = None
    truck_brand_raw: Optional[str] = None
    plate_raw: Optional[str] = None
    truck_id: Optional[int] = None
    volume: Optional[float] = None
    amount: Optional[float] = None
    external_transaction_id: Optional[str] = None


# ---------------- Expense (DORMANT - superseded 2026-06-20) ----------------
# Left in place rather than deleted, same precedent as the dormant TripBatch
# entity (see memory: transport-crm-auth-import-built). This was a
# placeholder from the initial scaffold, never wired to any frontend page,
# and confirmed empty (0 rows) in the live DB when superseded. The real
# "Реестр расходов" feature is CashFlowEntry below, built from a real
# export file - its field set (статус/банк/НДС/контрагент/separate
# поступления-списания) doesn't match this simpler shape, and main.py no
# longer mounts a router for this model.
class ExpenseBase(SQLModel):
    date: date
    amount: float
    category: str = "Ремонт/запчасти"
    truck_id: Optional[int] = Field(default=None, foreign_key="truck.id")
    driver_id: Optional[int] = Field(default=None, foreign_key="driver.id")
    description: str = ""


class Expense(ExpenseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class ExpenseCreate(ExpenseBase):
    pass


class ExpenseUpdate(SQLModel):
    date: Optional[_Date] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    truck_id: Optional[int] = None
    driver_id: Optional[int] = None
    description: Optional[str] = None


# ---------------- CashFlowEntry ("Реестр расходов") ----------------
# Built 2026-06-20 from a real export (user-supplied "Реестр расходов.xlsx",
# sheet "CF"). Despite the Russian name, the sheet tracks both incoming and
# outgoing payments (поступления/списания), not only expenses - kept as two
# separate amount fields rather than one signed "amount", matching the
# source file exactly. `vat_amount` ("НДС ФАКТ") mirrors the sheet's
# `=SUM(поступления:списания)*НДС/100` formula and is recomputed server-side
# on every create/update by routers/cash_flow.py, not sent by the frontend.
# Manual-entry only for now (no Excel import) - user confirmed via
# AskUserQuestion on 2026-06-20, see memory: transport-crm-auth-import-built.
class CashFlowEntryBase(SQLModel):
    date: date
    status: str = "ОПЛАЧЕНО"
    income: float = 0  # поступления
    expense: float = 0  # списания
    bank: str = ""
    period: str = ""  # "ПЕРИОД", free text e.g. "06-2026" - frontend defaults it from `date`, still editable/sortable on its own
    vat_pct: float = 0  # НДС, %
    vat_amount: float = 0  # НДС ФАКТ - server-recomputed, see routers/cash_flow.py::_recompute_vat
    truck_id: Optional[int] = Field(default=None, foreign_key="truck.id")  # Машина
    driver_id: Optional[int] = Field(default=None, foreign_key="driver.id")  # Водитель
    category: str = ""  # Статья
    counterparty: str = ""  # Контрагент
    purpose: str = ""  # Назначение
    # Заполняется только строками, которые сформированы автоматически кнопкой
    # «Провести в расходы» на странице «Топливо» (2026-06-28, задача #137):
    # f"fuel:{truck_id}:{week_monday_iso}:{bank}" - один на (машина, неделя,
    # банк/карта). Пустая строка у всех остальных (ручных) строк реестра.
    # Используется как ключ upsert'а в routers/fuel.py::post_fuel_to_expenses
    # - повторное нажатие кнопки обновляет уже созданную строку, а не плодит
    # дубли, и не трогает status/vat_pct/counterparty/purpose, если бухгалтер
    # их уже отредактировал вручную.
    fuel_source_key: str = ""


class CashFlowEntry(CashFlowEntryBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class CashFlowEntryCreate(CashFlowEntryBase):
    pass


class CashFlowEntryUpdate(SQLModel):
    date: Optional[_Date] = None
    status: Optional[str] = None
    income: Optional[float] = None
    expense: Optional[float] = None
    bank: Optional[str] = None
    period: Optional[str] = None
    vat_pct: Optional[float] = None
    vat_amount: Optional[float] = None
    truck_id: Optional[int] = None
    driver_id: Optional[int] = None
    category: Optional[str] = None
    counterparty: Optional[str] = None
    purpose: Optional[str] = None
    fuel_source_key: Optional[str] = None


class CashFlowBulkUpdate(SQLModel):
    """Payload for PATCH /api/expenses/bulk - the multi-select mass-edit
    feature. Only the fields the user actually toggled on in the bulk-edit
    modal should be present in the request body; `ids` is always required."""

    ids: List[int]
    bank: Optional[str] = None
    period: Optional[str] = None
    truck_id: Optional[int] = None
    driver_id: Optional[int] = None
    category: Optional[str] = None


# ---------------- MileageLog ----------------
class MileageLogBase(SQLModel):
    date: date
    truck_id: int = Field(foreign_key="truck.id")
    # Добавлено 2026-06-29 ("журнал с формой добавления... водитель (для
    # водителей автозаполнение собой)") - привязка записи к водителю, чтобы
    # own_filter_field в crud.py мог сузить список записей водителя до его
    # собственных (main.py), а форма могла автозаполнять поле им самим.
    # Опционально - бригадир/бухгалтер может внести запись без указания
    # конкретного водителя (например, по показаниям одометра при осмотре).
    driver_id: Optional[int] = Field(default=None, foreign_key="driver.id")
    odometer: Optional[float] = None
    is_service: bool = False
    note: str = ""


class MileageLog(MileageLogBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class MileageLogCreate(MileageLogBase):
    pass


class MileageLogUpdate(SQLModel):
    date: Optional[_Date] = None
    truck_id: Optional[int] = None
    driver_id: Optional[int] = None
    odometer: Optional[float] = None
    is_service: Optional[bool] = None
    note: Optional[str] = None


# ---------------- Document ----------------
class DocumentBase(SQLModel):
    type: str = "ОСАГО"
    truck_id: Optional[int] = Field(default=None, foreign_key="truck.id")
    expiry_date: date
    notes: str = ""


class Document(DocumentBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class DocumentCreate(DocumentBase):
    pass


class DocumentUpdate(SQLModel):
    type: Optional[str] = None
    truck_id: Optional[int] = None
    expiry_date: Optional[date] = None
    notes: Optional[str] = None


# ---------------- Settings (singleton row, id always 1) ----------------
class SettingsBase(SQLModel):
    default_commission_pct: float = 0.1
    default_maintenance_interval_km: int = 15000


class Settings(SettingsBase, table=True):
    id: Optional[int] = Field(default=1, primary_key=True)


class SettingsUpdate(SQLModel):
    default_commission_pct: Optional[float] = None
    default_maintenance_interval_km: Optional[int] = None


# ---------------- User (auth) ----------------
class UserBase(SQLModel):
    username: str
    role: str = "admin"
    full_name: str = ""
    is_active: bool = True
    # 2026-06-28 (роли по API): связывает учётку с карточкой водителя, чтобы
    # роль "driver" могла видеть собственные рейсы/заправки (own-data filter
    # в crud.py). Optional/None для всех остальных ролей - заполняется только
    # на странице «Пользователи» при role=="driver". Существующая таблица
    # `user` уже содержит 1 строку (admin), поэтому колонка добавляется через
    # _PENDING_COLUMNS в database.py, а не create_all().
    driver_id: Optional[int] = Field(default=None, foreign_key="driver.id")
    # 2026-07-04: email для сброса пароля (optional, пользователи вносят
    # вручную); consent_given_at — факт принятия политики обработки ПД (152-ФЗ)
    # при первичном входе. Оба поля добавляются через _PENDING_COLUMNS.
    email: Optional[str] = Field(default=None)
    consent_given_at: Optional[datetime] = Field(default=None)
    # 2026-07-07: отметка последней активности (для блока "Сейчас в системе")
    last_seen_at: Optional[datetime] = Field(default=None)


class User(UserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    password_hash: str


class UserCreate(UserBase):
    password: str


class UserUpdate(SQLModel):
    username: Optional[str] = None
    role: Optional[str] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    driver_id: Optional[int] = None
    email: Optional[str] = None


# ---------------- PasswordResetToken (сброс пароля, 2026-07-04) ----------------
# UUID-токен, создаётся при запросе сброса пароля; действителен 1 час;
# помечается used=True после применения. Почта не отправляется (нет SMTP) -
# ссылка пишется в лог как задел на будущее (см. FUTURE_TASK: подключить SMTP).
class PasswordResetToken(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(index=True)
    user_id: int = Field(foreign_key="user.id")
    expires_at: datetime
    used: bool = False


# ---------------- RolePermission (Настройки -> Роли, 2026-06-28) ----------
# Конфигурируемая матрица доступа: какие роли (кроме admin - у него всегда
# полный доступ безусловно, см. auth.require_zone) могут читать/писать в
# тот или иной "раздел" (zone). Раньше это было зашито в коде каждого
# роутера (require_role("admin","foreman") и т.п.) - теперь это таблица,
# которую правит admin со страницы Настройки -> Роли. Список зон и
# дефолтные значения (= старое поведение из кода) - см. permissions.py, не
# здесь, чтобы не тащить бизнес-список в чисто табличный модуль.
class RolePermissionBase(SQLModel):
    role: str
    zone: str
    can_read: bool = False
    can_write: bool = False


class RolePermission(RolePermissionBase, table=True):
    __table_args__ = (UniqueConstraint("role", "zone", name="uq_role_permission_role_zone"),)
    id: Optional[int] = Field(default=None, primary_key=True)


class RolePermissionItem(SQLModel):
    role: str
    zone: str
    can_read: bool
    can_write: bool


class RolePermissionBulkUpdate(SQLModel):
    items: List[RolePermissionItem]


# ---------------- ActionLog ("Журнал действий", 2026-06-28) --------------
# Журнал действий пользователей: создание/правка/удаление по всем разделам +
# попытки входа (успех/неудача) - просмотр (GET) намеренно не логируется
# (см. AskUserQuestion 2026-06-28 - "Изменения + вход", не "всё включая
# просмотр"). Пишется через app/audit.py::log_action, вызываемую из каждого
# роутера сразу после собственного commit основного действия.
# changes_json хранит JSON {field: {"old": ..., "new": ...}} - полная история
# по затронутым полям (выбор пользователя "Полная история изменений", не
# короткая строка без деталей): на create все поля payload'а имеют old=None,
# на delete все поля удалённой записи имеют new=None, на update - только
# реально изменившиеся поля.
# user_id допускает NULL - неудачный вход с логином, которого нет в БД, не
# привязан ни к какому User; username/role в этом случае берутся из того,
# что ввёл пользователь в форме входа, а не из FK. username/role всегда
# кэшируются на момент записи (не читаются через join), чтобы строка
# журнала оставалась читаемой даже после удаления/смены роли учётки.
class ActionLogBase(SQLModel):
    created_at: datetime = Field(default_factory=datetime.utcnow)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    username: str = ""
    role: str = ""
    action: str  # "create" | "update" | "delete" | "login_success" | "login_failed" | "import" | "post_to_expenses" | "reset_password"
    zone: str = ""  # раздел-сущность, см. audit.ZONE_LABELS
    entity_id: Optional[int] = None
    summary: str = ""
    changes_json: str = ""


class ActionLog(ActionLogBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


# ---------------- RepairRequest ("Заявка на ремонт", дашборд водителя 2026-06-30)
# Текстовая заметка от водителя о неисправностях / замечаниях по машине.
# Бригадир видит все заявки, водитель - только свои (own_filter_field="driver_id"
# в make_router, аналогично MileageLog и Trip). Статус меняет бригадир/admin.
# 2026-07-03: добавлены truck_id + photo_paths (JSON-список имён файлов фото).
class RepairRequestBase(SQLModel):
    driver_id: Optional[int] = Field(default=None, foreign_key="driver.id")
    truck_id: Optional[int] = Field(default=None, foreign_key="truck.id")
    text: str
    photo_paths: str = Field(default="")  # JSON-список имён файлов, напр. '["a.jpg","b.jpg"]'
    priority: str = "обычная"             # обычная / срочная
    close_comment: str = Field(default="")  # комментарий при закрытии
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = "создана"  # создана / в работе / закрыта


class RepairRequest(RepairRequestBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class RepairRequestCreate(SQLModel):
    # driver_id заполняется фронтендом явно (user.driver_id из AuthContext),
    # аналогично MileageLogCreate - бэкенд не подставляет его сам из токена,
    # т.к. make_router::create_endpoint не имеет доступа к текущему User.
    driver_id: Optional[int] = None
    truck_id: Optional[int] = None
    text: str
    photo_paths: str = ""
    priority: str = "обычная"


class RepairRequestUpdate(SQLModel):
    text: Optional[str] = None
    status: Optional[str] = None
    photo_paths: Optional[str] = None
    close_comment: Optional[str] = None


# Лёгкая модель для POST /api/driver-dashboard/expense (дашборд водителя
# 2026-06-30) - водитель вносит расход прямо с телефона, не заходя в раздел
# «Расходы». Создаётся как обычный CashFlowEntry, виден в реестре расходов.
class DriverExpenseCreate(SQLModel):
    expense_date: date
    amount: float
    category: str
    description: str = ""


# ══════════════════════════════════════════════════════════════════════════════
# Справочник статей расходов (2026-07-04)
# Единый источник статей для реестра расходов И кабинета водителя.
# allowed_roles — JSON-список ролей, которым видна статья (admin — всегда).
# ══════════════════════════════════════════════════════════════════════════════
_ALL_ROLES_JSON = '["driver","foreman","accountant"]'

class ExpenseCategory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    allowed_roles: str = Field(default=_ALL_ROLES_JSON)  # JSON-массив ролей
    active: bool = True
    sort_order: int = 0


# ══════════════════════════════════════════════════════════════════════════════
# Заявки на компенсацию (2026-07-04)
# Водитель подаёт заявку → admin принимает/отказывает.
# При принятии создаётся CashFlowEntry (запись в реестре расходов).
# Влияние на баланс водителя будет реализовано отдельным шагом.
# ══════════════════════════════════════════════════════════════════════════════
class CompensationRequest(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    driver_id: Optional[int] = Field(default=None, foreign_key="driver.id")
    truck_id: Optional[int] = Field(default=None, foreign_key="truck.id")
    expense_date: date = Field(default_factory=date.today)
    amount: float
    category: str
    description: str = Field(default="")
    photo_paths: str = Field(default="")   # JSON-список имён файлов
    status: str = "на рассмотрении"        # на рассмотрении / принято / отказано
    reject_reason: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CompensationRequestCreate(SQLModel):
    driver_id: Optional[int] = None
    truck_id: Optional[int] = None
    expense_date: date
    amount: float
    category: str
    description: str = ""
    photo_paths: str = ""


class CompensationRejectPayload(SQLModel):
    reason: str = ""


class ChangePasswordRequest(SQLModel):
    """Смена пароля текущего пользователя (POST /api/auth/change-password).
    Доступно любой роли. Старый пароль проверяется перед сменой.
    """
    old_password: str
    new_password: str


# ══════════════════════════════════════════════════════════════════════════════
# Приёмка-передача авто (2026-07-02)
# ══════════════════════════════════════════════════════════════════════════════

# Дефолтная комплектация (Блок 3) — применяется если для машины ещё нет
# TruckEquipmentItem строк.
DEFAULT_EQUIPMENT_ITEMS: list[str] = [
    "Автономка", "Домкрат", "Монтажка", "Ключ балонный",
    "Набор инструментов", "Спецовка", "Холодильник",
]

# Фиксированные пункты Блока 1 (Состояние авто)
INSPECTION_BLOCK1_ITEMS: list[str] = [
    "Фары передние", "Фары задние", "Шины передние",
    "Шины задние", "Уровень масла", "Охлаждающая жидкость",
]

# Фиксированные пункты Блока 2 (Документы)
INSPECTION_BLOCK2_ITEMS: list[str] = [
    "СТС", "ОСАГО", "Карта ТехОсмотра", "Топливная карта", "Путевые листы",
]


# ---------------- TruckEquipmentItem ----------------
# Список оснащения на борту конкретной машины (Блок 3 приёмки).
# Если для truck_id нет строк — используются DEFAULT_EQUIPMENT_ITEMS.
class TruckEquipmentItemBase(SQLModel):
    truck_id: int = Field(foreign_key="truck.id")
    label: str
    sort_order: int = 0


class TruckEquipmentItem(TruckEquipmentItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class TruckEquipmentItemCreate(SQLModel):
    label: str
    sort_order: int = 0


class TruckEquipmentItemUpdate(SQLModel):
    label: Optional[str] = None
    sort_order: Optional[int] = None


# ---------------- VehicleSession ----------------
# Сессия назначения машины водителю: создаётся при «Принять», закрывается
# при «Сдать». Пока ended_at == None — машина считается «С водителем».
class VehicleSessionBase(SQLModel):
    driver_id: int = Field(foreign_key="driver.id")
    truck_id: int = Field(foreign_key="truck.id")
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    start_inspection_id: Optional[int] = None
    end_inspection_id: Optional[int] = None


class VehicleSession(VehicleSessionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


# ---------------- VehicleInspection ----------------
# Акт приёмки (kind="start") или сдачи (kind="end") машины.
class VehicleInspectionBase(SQLModel):
    session_id: Optional[int] = Field(default=None, foreign_key="vehiclesession.id")
    driver_id: int = Field(foreign_key="driver.id")
    truck_id: int = Field(foreign_key="truck.id")
    kind: str  # "start" | "end"
    odometer: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class VehicleInspection(VehicleInspectionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


# ---------------- InspectionItem ----------------
# Один пункт чеклиста внутри акта (блоки 1, 2, 3).
class InspectionItemBase(SQLModel):
    inspection_id: int = Field(foreign_key="vehicleinspection.id")
    block: int  # 1 = состояние авто, 2 = документы, 3 = комплектация
    label: str
    status: str = ""   # "yes" | "no" | ""
    note: str = ""
    item_count: Optional[int] = None  # для "Путевые листы"


class InspectionItem(InspectionItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


# ---------------- InspectionDamage ----------------
# Повреждение, зафиксированное при осмотре (Блок 1). Фото сжимается
# фоново через Pillow после ответа (BackgroundTasks в роутере).
class InspectionDamageBase(SQLModel):
    inspection_id: int = Field(foreign_key="vehicleinspection.id")
    description: str = ""
    photo_path: str = ""  # имя файла в PHOTOS_DIR (/photos/ в Docker)


class InspectionDamage(InspectionDamageBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


# Pydantic-схемы для POST /api/vehicle-inspections/
class InspectionSubmitItem(SQLModel):
    block: int
    label: str
    status: str = ""
    note: str = ""
    item_count: Optional[int] = None


class InspectionSubmitDamage(SQLModel):
    description: str = ""
    photo_path: str = ""  # уже загруженный через /photo


class InspectionSubmitRequest(SQLModel):
    truck_id: int
    kind: str  # "start" | "end"
    odometer: Optional[int] = None
    items: List[InspectionSubmitItem] = []
    damages: List[InspectionSubmitDamage] = []


# ══════════════════════════════════════════════════════════════════════════════
# Журнал транзакций водителя (2026-07-05)
# Корректировки баланса сверх базового weekly_pnl: компенсации, авансы, штрафы.
# amount > 0 = начисление в пользу водителя (компенсация).
# amount < 0 = удержание с водителя (штраф, аванс).
# Полный баланс = weekly_pnl_unpaid + SUM(DriverTransaction.amount).
# ══════════════════════════════════════════════════════════════════════════════
DRIVER_TX_TYPES = ["compensation", "advance", "fine_pdd", "fine_company"]
DRIVER_TX_TYPE_LABELS: dict[str, str] = {
    "compensation": "Компенсация",
    "advance":      "Аванс",
    "fine_pdd":     "Штраф ПДД",
    "fine_company": "Штраф от компании",
}


class DriverTransaction(SQLModel, table=True):
    """Запись корректировки баланса водителя.

    amount > 0 — начисление в пользу водителя.
    amount < 0 — удержание с водителя.
    Полный баланс = weekly_pnl_unpaid + SUM(DriverTransaction.amount по driver_id).
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    driver_id: int = Field(foreign_key="driver.id")
    date: _Date = Field(default_factory=_Date.today)  # _Date alias — иначе Pydantic v2 mis-resolves date: date
    tx_type: str  # см. DRIVER_TX_TYPES — "type" конфликтует с Python builtin в Pydantic v2
    amount: float  # signed: positive = credit, negative = debit
    description: str = ""  # обязателен для fine_company
    ref_type: str = ""  # "compensation_request" | "" — тип связанного объекта
    ref_id: Optional[int] = None  # ID связанного объекта (CompensationRequest.id и т.п.)
    created_by_user_id: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DriverTransactionCreate(SQLModel):
    """Payload для ручного создания транзакции (admin/foreman/accountant).
    Разрешённые типы: advance, fine_pdd, fine_company.
    amount — положительное число; сервер сам ставит знак по типу.
    """
    driver_id: int
    date: _Date
    tx_type: str
    amount: float  # всегда > 0; сервер негатирует для debit-типов
    description: str = ""
