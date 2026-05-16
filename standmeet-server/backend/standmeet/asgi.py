import os
from contextlib import asynccontextmanager

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "standmeet.settings")
django.setup()

from django.core.asgi import get_asgi_application
from starlette.applications import Starlette
from starlette.routing import Mount

from interfaces.mcp.server import mcp

django_app = get_asgi_application()
mcp_app = mcp.streamable_http_app()


@asynccontextmanager
async def lifespan(app):
    async with mcp.session_manager.run():
        yield


app = Starlette(
    routes=[
        Mount("/mcp", app=mcp_app),
        Mount("", app=django_app),
    ],
    lifespan=lifespan,
)

application = app
