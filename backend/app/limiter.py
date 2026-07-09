"""Rate limiter singleton для защиты от брутфорса.

Подключается в main.py (app.state.limiter + exception handler),
используется через @limiter.limit() в роутерах (см. routers/auth.py).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
