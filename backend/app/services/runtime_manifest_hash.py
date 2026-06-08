import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any


def canonical_runtime_manifest(manifest: Any) -> Any:
    if hasattr(manifest, "model_dump"):
        return canonical_runtime_manifest(manifest.model_dump(mode="json"))
    if isinstance(manifest, dict):
        return {
            str(key): canonical_runtime_manifest(value)
            for key, value in sorted(manifest.items(), key=lambda item: str(item[0]))
            if value is not None
        }
    if isinstance(manifest, (list, tuple)):
        return [canonical_runtime_manifest(item) for item in manifest]
    if isinstance(manifest, (datetime, date)):
        return manifest.isoformat()
    if isinstance(manifest, Decimal):
        return float(manifest)
    if isinstance(manifest, Enum):
        return manifest.value
    return manifest


def runtime_manifest_canonical_json(manifest: Any) -> str:
    return json.dumps(
        canonical_runtime_manifest(manifest),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def hash_runtime_manifest(manifest: Any) -> str:
    payload = runtime_manifest_canonical_json(manifest).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
