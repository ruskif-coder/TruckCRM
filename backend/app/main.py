import os
import shutil
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlmodel import Session

from . import models
from .auth import get_current_user, seed_default_admin
from .limiter import limiter
from .crud import make_router
from .database import engine, init_db
from .permissions import seed_default_role_permissions, upgrade_legacy_driver_defaults
from .routers.expense_categories import seed_expense_categories
from .routers import audit_log as audit_log_router
from .routers import auth as auth_router
from .routers import cash_flow as cash_flow_router
from .routers import compensation_requests as compensation_requests_router
from .routers import dashboard, settings as settings_router
from .routers import driver_dashboard as driver_dashboard_router
from .routers import foreman_dashboard as foreman_dashboard_router
from .routers import driver_rates as driver_rates_router
from .routers import drivers as drivers_router
from .routers import expense_categories as expense_categories_router
from .routers import fuel as fuel_router
from .routers import repair_journal as repair_journal_router
from .routers import repair_requests as repair_requests_router
from .routers import role_permissions as role_permissions_router
from .routers import vehicle_inspections as vehicle_inspections_router
from .routers import trip_batches, trips as trips_router, trucks as trucks_router, users as users_router
from .routers import maintenance as maintenance_router
from .routers import driver_transactions as driver_transactions_router
from .routers import counterparties as counterparties_router
from .routers import carrier_balance as carrier_balance_router

protected = [Depends(get_current_user)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with Session(engine) as session:
        seed_default_admin(session)
        # Дозаполняет матрицу доступа (Настройки -> Роли, 2026-06-28)
        # дефолтами = старое зашитое в коде поведение - см. permissions.py.
        seed_default_role_permissions(session)
        # Одноразово поднимает уже засеянные строки driver/mileage_logs и
        # driver/trucks до нового дефолта 2026-06-29 ("журнал пробегов") -
        # seed_default_role_permissions() выше их не трогает, см.
        # permissions.py::upgrade_legacy_driver_defaults.
        upgrade_legacy_driver_defaults(session)
        # Засеваем справочник статей расходов из CASHFLOW_CATEGORIES (2026-07-04).
        # Идемпотентно — не трогает уже существующие записи.
        seed_expense_categories(session)
    yield


app = FastAPI(
    title="Транспорт CRM API",
    lifespan=lifespan,
    # SECURITY (аудит-2026-07-13): Swagger/ReDoc отключены в production —
    # раскрывали структуру API без авторизации. Для временного включения
    # в dev замени на docs_url="/docs", redoc_url="/redoc".
    docs_url=None,
    redoc_url=None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: в production задай переменную окружения CORS_ORIGINS с реальным доменом,
# например: CORS_ORIGINS=https://transport.example.ru
# Для локальной разработки можно оставить "*", но в прод это недопустимо.
_cors_env = os.environ.get("CORS_ORIGINS", "")
_cors_origins: list[str] = (
    [o.strip() for o in _cors_env.split(",") if o.strip()]
    if _cors_env.strip() and _cors_env.strip() != "*"
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
    allow_credentials=_cors_origins != ["*"],
)

# Public — no auth required.
app.include_router(auth_router.router)

# Everything below requires a valid bearer token (login). Per-role
# enforcement (2026-06-28, "Разделение по зонам", переведено на
# конфигурируемую таблицу тем же числом - "Настройки -> Роли") is layered on
# top per router/route via auth.require_zone() (операционные зоны,
# permissions.py) или auth.require_role()/require_staff (зафиксированный
# admin-only набор - users/settings/driver_rates/trip_batches, см.
# permissions.py module docstring) - see each router's own comment for its
# zone. `protected` here only proves "logged in"; it does not imply
# unrestricted access.
app.include_router(trucks_router.router, dependencies=protected)
app.include_router(drivers_router.router, dependencies=protected)
app.include_router(
    make_router(
        table_model=models.Route,
        create_model=models.RouteCreate,
        update_model=models.RouteUpdate,
        prefix="/api/routes",
        tag="routes",
        zone="routes",
    ),
    dependencies=protected,
)
app.include_router(
    make_router(
        table_model=models.Carrier,
        create_model=models.CarrierCreate,
        update_model=models.CarrierUpdate,
        prefix="/api/carriers",
        tag="carriers",
        zone="carriers",
    ),
    dependencies=protected,
)
app.include_router(trips_router.router, dependencies=protected)
app.include_router(trip_batches.router, dependencies=protected)
app.include_router(fuel_router.router, dependencies=protected)
# /api/expenses used to be the generic Expense CRUD router - that model was
# dormant (0 rows, no frontend, see models.ExpenseBase comment) and is
# superseded by this dedicated router for the real "Реестр расходов"
# feature (CashFlowEntry).
app.include_router(cash_flow_router.router, dependencies=protected)
app.include_router(
    make_router(
        table_model=models.MileageLog,
        create_model=models.MileageLogCreate,
        update_model=models.MileageLogUpdate,
        prefix="/api/mileage-logs",
        tag="mileage-logs",
        zone="mileage_logs",
        # 2026-06-29 ("журнал пробегов"): водитель видит в списке только
        # свои записи (по MileageLog.driver_id), как trips/fuel ниже.
        own_filter_field="driver_id",
    ),
    dependencies=protected,
)
app.include_router(
    make_router(
        table_model=models.Document,
        create_model=models.DocumentCreate,
        update_model=models.DocumentUpdate,
        prefix="/api/documents",
        tag="documents",
        zone="documents",
    ),
    dependencies=protected,
)
app.include_router(users_router.router, dependencies=protected)
app.include_router(driver_rates_router.router, dependencies=protected)
app.include_router(dashboard.router, dependencies=protected)
app.include_router(settings_router.router, dependencies=protected)
app.include_router(role_permissions_router.router, dependencies=protected)
app.include_router(audit_log_router.router, dependencies=protected)
# Дашборд водителя (мобильный, 2026-06-30): заявки на ремонт + быстрый
# ввод расхода + баланс/рейсы за неделю. Auth-only (не zone-gated),
# работает только с данными самого вошедшего пользователя.
app.include_router(driver_dashboard_router.router, dependencies=protected)
# Дашборд бригадира (мобильный, 2026-07-04): виджет «Требует внимания»,
# список водителей с ролями, сводные счётчики для бейджа-алерта.
# Доступен admin и foreman (проверка роли внутри каждого эндпойнта).
app.include_router(foreman_dashboard_router.router, dependencies=protected)
# Справочник статей расходов (2026-07-04): единый источник для реестра и
# кабинета водителя. GET открыт всем, POST/PUT/DELETE — только admin.
app.include_router(expense_categories_router.router, dependencies=protected)
# Заявки на компенсацию (2026-07-04): /journal/ и /pending-count/ подключены
# ПЕРВЫМИ — иначе они захватываются /{id}/approve и /{id}/reject.
app.include_router(compensation_requests_router.router, dependencies=protected)
# Журнал заявок на ремонт (обогащённый: имя водителя + номер авто).
# Включается ПЕРВЫМ чтобы /journal/ не захватывался {item_id} из make_router ниже.
app.include_router(repair_journal_router.router, dependencies=protected)
# make_router для заявок на ремонт - бригадир видит/управляет статусами всех,
# водитель видит только свои (own_filter_field="driver_id").
app.include_router(
    repair_requests_router.router,
    dependencies=protected,
)
# Приёмка-передача авто (2026-07-02): сессии, акты, фото.
# Auth-only (не zone-gated) — водитель работает только со своими данными,
# admin/foreman видят все сессии (см. vehicle_inspections.py).
app.include_router(vehicle_inspections_router.router, dependencies=protected)
# Техническое обслуживание системы: очистка фото, статус диска (admin-only).
app.include_router(maintenance_router.router, dependencies=protected)
# Журнал транзакций водителя (2026-07-05): корректировки баланса (компенсации,
# штрафы, авансы). Auth-only — водитель видит только свои, staff — по driver_id.
app.include_router(driver_transactions_router.router, dependencies=protected)
# Справочник контрагентов (2026-07-12): GET — все залогиненные, POST/PUT/DELETE — только admin.
# Роутер не был подключён при создании — добавлен 2026-07-13 (аудит-фикс).
app.include_router(counterparties_router.router, dependencies=protected)
# Баланс перевозчиков (2026-07-12): финансовая сводка, только для staff.
# Роутер не был подключён при создании — добавлен 2026-07-13 (аудит-фикс).
app.include_router(carrier_balance_router.router, dependencies=protected)

# Статические файлы фото приёмки: /photos/<filename>
# PHOTOS_DIR задаётся env (docker-compose: /photos → ./data/photos на хосте).
_photos_dir = os.environ.get("PHOTOS_DIR", "./photos")
os.makedirs(_photos_dir, exist_ok=True)
app.mount("/photos", StaticFiles(directory=_photos_dir), name="photos")

# Статические файлы скан-документов машин: /truck-scans/<filename>
# TRUCK_SCANS_DIR задаётся env (docker-compose: /truck-scans → ./data/truck_scans).
_truck_scans_dir = os.environ.get("TRUCK_SCANS_DIR", "./truck_scans")
os.makedirs(_truck_scans_dir, exist_ok=True)
app.mount("/truck-scans", StaticFiles(directory=_truck_scans_dir), name="truck-scans")


@app.get("/api/health")
def health():
    """Публичный healthcheck для uptime-ботов и docker healthcheck.
    SECURITY (аудит-2026-07-13): возвращает только {"status": "ok"} — без
    размеров БД, диска, фото. Детальная диагностика — только через авторизованный
    эндпойнт /api/maintenance/... (admin-only, см. maintenance router)."""
    return {"status": "ok"}


@app.get("/api/health/details", dependencies=protected)
def health_details(user: models.User = Depends(get_current_user)):
    """Расширенный healthcheck: диск, БД, фото. Только для admin.
    SECURITY (аудит-2026-07-13): инфраструктурная информация доступна
    только авторизованным пользователям."""
    if user.role != "admin":
        from fastapi import HTTPException
        raise HTTPException(403, "Только для admin")

    info: dict = {"status": "ok"}

    # Путь к файлу БД из env
    db_url = os.environ.get("DATABASE_URL", "sqlite:///./transport_crm.db")
    if db_url.startswith("sqlite:////"):
        db_file = db_url[len("sqlite:///"):]   # /absolute/path
    elif db_url.startswith("sqlite:///"):
        db_file = db_url[len("sqlite:///"):]   # ./relative/path
    else:
        db_file = None

    # Размер файла БД
    try:
        if db_file and os.path.isfile(db_file):
            info["db_size_mb"] = round(os.path.getsize(db_file) / 1_048_576, 2)
    except Exception:
        pass

    # Свободное место на диске
    try:
        check_path = db_file if (db_file and os.path.exists(db_file)) else "/"
        usage = shutil.disk_usage(check_path)
        info["disk_free_gb"] = round(usage.free / 1_073_741_824, 2)
        info["disk_total_gb"] = round(usage.total / 1_073_741_824, 2)
        info["disk_used_pct"] = round((usage.used / usage.total) * 100, 1)
    except Exception:
        pass

    # Размер папки фото
    try:
        total_bytes = 0
        total_count = 0
        for dirpath, _dirs, filenames in os.walk(_photos_dir):
            for fname in filenames:
                try:
                    total_bytes += os.path.getsize(os.path.join(dirpath, fname))
                    total_count += 1
                except OSError:
                    pass
        info["photos_size_mb"] = round(total_bytes / 1_048_576, 2)
        info["photos_count"] = total_count
    except Exception:
        pass

    return info
