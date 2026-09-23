"""Rate limiter singleton для защиты от брутфорса.

Подключается в main.py (app.state.limiter + exception handler),
используется через @limiter.limit() в роутерах (см. routers/auth.py).

Ключ лимита — реальный IP клиента. За nginx/Docker request.client.host — это
IP контейнера nginx, один на всех, поэтому лимит логина применялся бы
глобально (один атакующий выжигает бакет на всех + распределённый брутфорс
не режется). Берём последний IP из X-Forwarded-For — его добавляет nginx
($proxy_add_x_forwarded_for), поэтому он не подделывается клиентом при одном
прокси; если заголовка нет (прямое обращение/локальная разработка) —
откатываемся на remote address (аудит 2026-09-23).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def client_ip(request: Request) -> str:
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return get_remote_address(request)


limiter = Limiter(key_func=client_ip)
