from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


CLI_PATH = Path(__file__).parents[2] / "cli" / "docferry.py"
spec = importlib.util.spec_from_file_location("docferry_cli", CLI_PATH)
assert spec and spec.loader
docferry_cli = importlib.util.module_from_spec(spec)
sys.modules["docferry_cli"] = docferry_cli
spec.loader.exec_module(docferry_cli)


def test_import_asset_output_path_preserves_safe_relative_path(tmp_path: Path) -> None:
    output = docferry_cli.resolve_asset_output_path(tmp_path, "attachments/brief.pdf", "brief.pdf")

    assert output == tmp_path / "attachments" / "brief.pdf"


def test_import_asset_output_path_blocks_parent_traversal(tmp_path: Path) -> None:
    output = docferry_cli.resolve_asset_output_path(tmp_path, "../secret.pdf", "secret.pdf")

    assert output == tmp_path / "secret.pdf"
    assert output.resolve().is_relative_to(tmp_path.resolve())
