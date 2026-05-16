from __future__ import annotations

from dataclasses import dataclass


@dataclass
class GlobalPackage:
    name: str
    version: str
