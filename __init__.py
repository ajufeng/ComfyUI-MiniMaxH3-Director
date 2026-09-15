# -*- coding: utf-8 -*-
from .nodes import NODE_CLASS_MAPPINGS as _N1, NODE_DISPLAY_NAME_MAPPINGS as _D1
from .studio_node import NODE_CLASS_MAPPINGS as _N2, NODE_DISPLAY_NAME_MAPPINGS as _D2

NODE_CLASS_MAPPINGS = {**_N1, **_N2}
NODE_DISPLAY_NAME_MAPPINGS = {**_D1, **_D2}

WEB_DIRECTORY = "./web"

try:
    from . import routes
    routes.register_routes()
except Exception as e:
    print("[H3导演台] 路由注册失败:", e)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]