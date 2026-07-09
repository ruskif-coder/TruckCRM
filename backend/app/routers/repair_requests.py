"""Заявки на ремонт (дашборд водителя, 2026-06-30) - "Заявка на ремонт"
текстовая заметка водителя о неисправностях/замечаниях по машине.
Бригадир видит все заявки и меняет статус (новая → в работе → выполнено);
водитель видит только свои (own_filter_field="driver_id" в make_router,
аналогично MileageLog/Trip). Создаются с мобильного дашборда DriverDashboard.tsx.
"""
from .. import models
from ..crud import make_router

router = make_router(
    table_model=models.RepairRequest,
    create_model=models.RepairRequestCreate,
    update_model=models.RepairRequestUpdate,
    prefix="/api/repair-requests",
    tag="repair-requests",
    zone="repair_requests",
    own_filter_field="driver_id",
)
