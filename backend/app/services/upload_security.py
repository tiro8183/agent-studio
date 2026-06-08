from pathlib import Path
from typing import Iterable

from fastapi import HTTPException, UploadFile


async def read_limited_upload(
    file: UploadFile,
    *,
    max_bytes: int,
    allowed_content_types: Iterable[str],
    allowed_extensions: Iterable[str],
) -> bytes:
    safe_name = Path(file.filename or "").name
    suffix = Path(safe_name).suffix.lower()
    content_type = (file.content_type or "application/octet-stream").split(";", 1)[0].strip().lower()
    content_types = {item.lower() for item in allowed_content_types}
    extensions = {item.lower() for item in allowed_extensions}
    if content_type not in content_types and suffix not in extensions:
        raise HTTPException(status_code=415, detail="仅支持文本类文件")

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail=f"文件不能超过 {max_bytes // 1024 // 1024} MB")
        chunks.append(chunk)
    return b"".join(chunks)
