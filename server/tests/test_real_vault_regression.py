from __future__ import annotations

from pathlib import Path

from scripts.real_vault_regression import (
    build_basename_index,
    extract_image_refs,
    markdown_metrics,
    relative_source_path,
    resolve_image_refs,
)


def test_markdown_metrics_counts_complex_elements() -> None:
    markdown = (
        "# Title\n\n"
        "> [!note]\n"
        "> Body\n\n"
        "| A | B |\n"
        "| - | - |\n\n"
        "```mermaid\n"
        "graph TD\n"
        "```\n\n"
        "![[image.png]]\n"
        "[[Other Note]]\n"
    )

    metrics = markdown_metrics(markdown)

    assert metrics["chars"] == len(markdown)
    assert metrics["headings"] == 1
    assert metrics["tables"] == 2
    assert metrics["callouts"] == 1
    assert metrics["code_fences"] == 2
    assert metrics["wiki_links"] == 2
    assert metrics["wiki_images"] == 1


def test_extract_image_refs_supports_wiki_and_markdown_images() -> None:
    markdown = (
        "![[folder/chart.png|Chart]]\n"
        "![Alt](images/a.webp)\n"
        "![Remote](https://example.com/a.png)\n"
    )

    assert extract_image_refs(markdown) == ["folder/chart.png", "images/a.webp"]


def test_resolve_image_refs_uses_relative_vault_and_basename(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    note_dir = vault / "Notes"
    image_dir = vault / "Images"
    note_dir.mkdir(parents=True)
    image_dir.mkdir()
    source = note_dir / "source.md"
    source.write_text("![[local.png]]\n![[global.webp]]\n![[missing.png]]", encoding="utf-8")
    (note_dir / "local.png").write_bytes(b"local")
    (image_dir / "global.webp").write_bytes(b"global")
    index = build_basename_index(vault)

    resolved, unresolved = resolve_image_refs(
        markdown=source.read_text(encoding="utf-8"),
        source_file=source,
        vault_root=vault,
        basename_index=index,
        max_assets=10,
    )

    assert [item.original_path for item in resolved] == ["local.png", "global.webp"]
    assert unresolved == ["missing.png"]


def test_relative_source_path_does_not_require_doc_inside_vault(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    inside = vault / "folder" / "note.md"
    inside.parent.mkdir()
    inside.write_text("", encoding="utf-8")
    outside = tmp_path / "outside.md"
    outside.write_text("", encoding="utf-8")

    assert relative_source_path(vault, inside) == "folder/note.md"
    assert relative_source_path(vault, outside) == "outside.md"
