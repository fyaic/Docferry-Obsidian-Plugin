from __future__ import annotations

from pathlib import Path


class FileObjectStorage:
    def __init__(self, root: str) -> None:
        self.root = Path(root).expanduser().resolve()

    def storage_key(self, owner_id: str, content_hash: str) -> str:
        digest = normalize_sha256(content_hash)
        return f"assets/{owner_id}/{digest[:2]}/{digest}"

    def asset_storage_key(self, owner_id: str, asset_id: str) -> str:
        return f"assets/{owner_id}/objects/{asset_id}"

    def put(self, storage_key: str, data: bytes) -> None:
        path = self.path_for_key(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, storage_key: str) -> bytes:
        return self.path_for_key(storage_key).read_bytes()

    def delete(self, storage_key: str) -> bool:
        path = self.path_for_key(storage_key)
        try:
            path.unlink()
        except FileNotFoundError:
            return False
        self.prune_empty_parents(path.parent)
        return True

    def path_for_key(self, storage_key: str) -> Path:
        if storage_key.startswith("/") or ".." in storage_key.split("/"):
            raise ValueError("Invalid storage key.")
        return self.root / storage_key

    def prune_empty_parents(self, start: Path) -> None:
        current = start
        while current != self.root and self.root in current.parents:
            try:
                current.rmdir()
            except OSError:
                return
            current = current.parent


def normalize_sha256(value: str) -> str:
    return value.removeprefix("sha256:")
