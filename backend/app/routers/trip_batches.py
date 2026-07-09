# Plain CRUD only - reserved for the future dashboard feature.
# The weekly-aggregation import endpoint that used to live here was moved
# to routers/trips.py (raw, ungrouped Trip list is now the live import
# target - see importers/trip_registry.py module docstring). The
# aggregation logic itself (import_trip_registry) is untouched and can be
# wired back in here later when the dashboard feature is built.
# Роли по API (2026-06-28): неактивная фича (см. комментарий выше), не
# упомянута в схеме "Разделение по зонам" - admin-only по умолчанию, а не
# предположение про чужую зону.
from .. import models
from ..crud import make_router

router = make_router(
    table_model=models.TripBatch,
    create_model=models.TripBatchCreate,
    update_model=models.TripBatchUpdate,
    prefix="/api/trip-batches",
    tag="trip-batches",
    read_roles=["admin"],
    write_roles=["admin"],
)
