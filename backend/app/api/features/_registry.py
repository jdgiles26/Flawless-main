"""Feature route registration utilities.

During migration, these utilities reuse production-validated handlers while only
splitting URL ownership into separate files. When business implementations move
later, replace the same-named runtime handlers without changing the frontend contract.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from fastapi import APIRouter


RouteSpec = tuple[str, str, str]


def build_feature_router(
    runtime: Mapping[str, Any],
    routes: Sequence[RouteSpec],
    *,
    tag: str,
) -> APIRouter:
    """Register routes from the feature manifest and validate handler availability at startup."""
    router = APIRouter(tags=[tag])
    for method, path, handler_name in routes:
        handler: Callable[..., Any] | None = runtime.get(handler_name)
        if handler is None:
            raise RuntimeError(f"Feature route {tag} is missing handler: {handler_name}")
        router.add_api_route(path, handler, methods=[method])
    return router

