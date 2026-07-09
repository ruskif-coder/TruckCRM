import os

from sqlalchemy import event, inspect, text
from sqlmodel import SQLModel, create_engine, Session

# Overridable via env so Docker can point this at a mounted volume
# (e.g. sqlite:////data/transport_crm.db) instead of the container's
# ephemeral filesystem.
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./transport_crm.db")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)

# WAL mode: снижает конкуренцию на запись при нескольких одновременных
# пользователях (читатели не блокируют записывающего и наоборот).
# synchronous=NORMAL — безопасно для WAL: данные сбрасываются на диск
# в нужные моменты, без лишних fsync на каждый commit.
# Применяется только для SQLite; при переходе на PostgreSQL — игнорируется.
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_wal_mode(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

# `create_all()` only creates tables that don't exist yet - it never alters
# an existing table to add a newly-added model field. Since this app has no
# migration tool (Alembic etc.), any field added to a model after the table
# already has data needs a manual entry here, or the row would 500 on the
# missing column. (Added 2026-06-19 for Trip.source / Trip.carrier_name.)
_PENDING_COLUMNS: dict[str, list[tuple[str, str, str]]] = {
    "trip": [
        ("source", "VARCHAR", "''"),
        ("carrier_name", "VARCHAR", "''"),
        # Added 2026-06-26 for the "Штраф" column the user added to the
        # import template (see models.TripBase.fines).
        ("fines", "FLOAT", "0"),
    ],
    # Added 2026-06-23 for the Автомобили admin form (see models.TruckBase).
    # `truck` already has 3 real rows (auto-created by the importers with
    # only label/plate set), so these need the ALTER TABLE treatment too.
    "truck": [
        ("vehicle_type", "VARCHAR", "''"),
        ("body_type", "VARCHAR", "''"),
        ("osago_date", "DATE", "NULL"),
        ("kasko_date", "DATE", "NULL"),
        ("tech_inspection_date", "DATE", "NULL"),
        # Added 2026-06-24 - document numbers, split out of the free-text
        # `notes` field per user request.
        ("vin", "VARCHAR", "''"),
        ("chassis_number", "VARCHAR", "''"),
        ("pts_number", "VARCHAR", "''"),
        ("sts_number", "VARCHAR", "''"),
        # Added 2026-07-03 — блок документов в карточке авто.
        ("osago_number", "VARCHAR", "''"),
        ("kasko_number", "VARCHAR", "''"),
        ("tech_inspection_number", "VARCHAR", "''"),
        ("sts_date", "DATE", "NULL"),
        ("sts_scan", "VARCHAR", "''"),
        ("osago_scan", "VARCHAR", "''"),
        ("kasko_scan", "VARCHAR", "''"),
        ("tech_inspection_scan", "VARCHAR", "''"),
    ],
    # Added 2026-06-19 for the driver registration-card fields (see
    # models.DriverBase). `driver` rows already exist (auto-created by the
    # trip/fuel importers), so these need the same ALTER TABLE treatment.
    "driver": [
        ("active", "BOOLEAN", "1"),
        ("mobile_app_enabled", "BOOLEAN", "0"),
        ("mobile_login", "VARCHAR", "''"),
        ("mobile_password", "VARCHAR", "''"),
        ("last_name", "VARCHAR", "''"),
        ("first_name", "VARCHAR", "''"),
        ("middle_name", "VARCHAR", "''"),
        ("birth_date", "DATE", "NULL"),
        ("birth_place", "VARCHAR", "''"),
        ("email", "VARCHAR", "''"),
        ("passport_number", "VARCHAR", "''"),
        ("passport_issued_date", "DATE", "NULL"),
        ("passport_issued_by", "VARCHAR", "''"),
        ("registration_address", "VARCHAR", "''"),
        ("residence_address", "VARCHAR", "''"),
        ("license_number", "VARCHAR", "''"),
        ("license_issued_date", "DATE", "NULL"),
        ("license_valid_until", "DATE", "NULL"),
        ("skzi_card_number", "VARCHAR", "''"),
        ("skzi_issued_date", "DATE", "NULL"),
        ("skzi_valid_until", "DATE", "NULL"),
    ],
    # Added 2026-06-28 for роли по API: links a User row to a Driver row so
    # the "driver" role can be scoped to its own trips/fuel (see
    # models.UserBase.driver_id, crud.py own_filter_field). `user` already
    # has 1 row (admin), so this needs the ALTER TABLE treatment too.
    # Added 2026-07-04: email (для сброса пароля) и consent_given_at (152-ФЗ).
    "user": [
        ("driver_id", "INTEGER", "NULL"),
        ("email", "VARCHAR", "NULL"),
        ("consent_given_at", "DATETIME", "NULL"),
        # Added 2026-07-07: отметка последней активности для блока "Сейчас в системе"
        ("last_seen_at", "DATETIME", "NULL"),
    ],
    # Added 2026-06-28 для кнопки «Провести в расходы» на странице «Топливо»
    # (см. models.CashFlowEntryBase.fuel_source_key, routers/fuel.py::
    # post_fuel_to_expenses). SQLModel's default table name for CashFlowEntry
    # is the lowercased class name with no underscores - "cashflowentry" -
    # and the table already has manually-entered rows, so it needs the same
    # ALTER TABLE treatment as the others above.
    "cashflowentry": [
        ("fuel_source_key", "VARCHAR", "''"),
    ],
    # Added 2026-06-29 for the "Пробеги" tab (см. models.MileageLogBase.driver_id,
    # own_filter_field в main.py) - таблица mileagelog уже существовала
    # (дормант фича с 2026-06-28), так что новое поле тоже нужно через ALTER TABLE.
    "mileagelog": [
        ("driver_id", "INTEGER", "NULL"),
    ],
    # Added 2026-07-03 — журнал заявок на ремонт: привязка к машине и фото.
    # 2026-07-03 v2: priority (обычная/срочная) и close_comment (итог при закрытии).
    "repairrequest": [
        ("truck_id", "INTEGER", "NULL"),
        ("photo_paths", "VARCHAR", "''"),
        ("priority", "VARCHAR", "'обычная'"),
        ("close_comment", "VARCHAR", "''"),
    ],
}


def _ensure_indexes():
    """Create performance indexes on frequently-filtered columns.
    Uses CREATE INDEX IF NOT EXISTS — идемпотентно, безопасно повторять
    при каждом старте. Охватывает только SQLite; при PostgreSQL — пропуск
    (там индексы добавляются через Alembic-миграции).
    Индексы не создаются create_all() для уже существующих таблиц,
    поэтому добавляем их явно здесь."""
    if not DATABASE_URL.startswith("sqlite"):
        return
    indexes = [
        # Trip: основные фильтры в реестре поездок и в weekly_pnl
        ("idx_trip_dep_at",          "trip",          "dep_at"),
        ("idx_trip_truck_id",        "trip",          "truck_id"),
        ("idx_trip_driver_id",       "trip",          "driver_id"),
        # FuelRecord: фильтр по дате и машине
        ("idx_fuelrecord_date",      "fuelrecord",    "date"),
        ("idx_fuelrecord_truck_id",  "fuelrecord",    "truck_id"),
        # CashFlowEntry: реестр расходов + фильтр Топливо в weekly_pnl
        ("idx_cashflowentry_date",     "cashflowentry", "date"),
        ("idx_cashflowentry_category", "cashflowentry", "category"),
        ("idx_cashflowentry_truck_id", "cashflowentry", "truck_id"),
        # ActionLog: сортировка по дате в журнале
        ("idx_actionlog_created_at", "actionlog",     "created_at"),
        # DriverTransaction: фильтр по водителю и сортировка по дате (2026-07-05)
        ("idx_drivertx_driver_id",   "drivertransaction", "driver_id"),
        ("idx_drivertx_date",        "drivertransaction", "date"),
    ]
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for idx_name, table, column in indexes:
            if table not in existing_tables:
                continue
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({column})"))


def _add_missing_columns():
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table_name, columns in _PENDING_COLUMNS.items():
            if table_name not in existing_tables:
                continue  # fresh DB - create_all() already added it with all current fields
            existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
            for name, sql_type, default_sql in columns:
                if name not in existing_cols:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {name} {sql_type} DEFAULT {default_sql}"))


def _backfill_driver_names():
    """One-time data backfill (not a schema change): existing drivers were
    auto-created by the import matching logic with only a combined `name`
    ("Фамилия Имя"), never the structured last_name/first_name added above.
    That's known data, just not split out yet - so split it, rather than
    leaving the new registration-form fields blank for drivers the system
    already has a name for. Safe to re-run: only touches rows where
    last_name is still empty."""
    inspector = inspect(engine)
    if "driver" not in inspector.get_table_names():
        return
    existing_cols = {c["name"] for c in inspector.get_columns("driver")}
    if "last_name" not in existing_cols:
        return  # column not added yet on this boot - nothing to backfill into
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT id, name FROM driver WHERE (last_name IS NULL OR last_name = '') AND name IS NOT NULL AND name != ''")
        ).fetchall()
        for row in rows:
            tokens = (row.name or "").strip().split()
            if not tokens:
                continue
            last_name = tokens[0]
            first_name = " ".join(tokens[1:]) if len(tokens) > 1 else ""
            conn.execute(
                text("UPDATE driver SET last_name = :last_name, first_name = :first_name WHERE id = :id"),
                {"last_name": last_name, "first_name": first_name, "id": row.id},
            )


def init_db():
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()
    _ensure_indexes()
    _backfill_driver_names()


def get_session():
    with Session(engine) as session:
        yield session
