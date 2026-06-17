from __future__ import annotations

import re
from html import escape

from markdown_it import MarkdownIt

markdown = MarkdownIt("commonmark", {"html": False, "linkify": False, "typographer": False}).enable("table")


def render_markdown(source: str) -> str:
    prepared, replacements = replace_obsidian_tokens(source)
    rendered = markdown.render(prepared)
    for token, html in replacements.items():
        rendered = rendered.replace(token, html)
    rendered = re.sub(r"<p>\s*(<figure.*?</figure>)\s*</p>", r"\1", rendered, flags=re.DOTALL)
    return enhance_callouts(rendered)


def replace_obsidian_tokens(source: str) -> tuple[str, dict[str, str]]:
    replacements: dict[str, str] = {}

    def image_embed(match: re.Match[str]) -> str:
        raw = match.group(1).strip()
        target, label = split_wiki_target(raw)
        token = placeholder("OBSIDIAN_EMBED", len(replacements))
        replacements[token] = (
            '<figure class="embed embed-missing image-embed">'
            '<div class="embed-placeholder">Image is not included in this fallback render.</div>'
            f"<figcaption>{escape(label or target)}</figcaption>"
            "</figure>"
        )
        return token

    def wiki_link(match: re.Match[str]) -> str:
        raw = match.group(1).strip()
        target, label = split_wiki_target(raw)
        token = placeholder("OBSIDIAN_LINK", len(replacements))
        replacements[token] = (
            f'<a class="internal-link" data-href="{escape(target, quote=True)}" href="#">'
            f"{escape(label or target)}</a>"
        )
        return token

    prepared = re.sub(r"!\[\[([^\]\n]+)\]\]", image_embed, source)
    prepared = re.sub(r"(?<!!)\[\[([^\]\n]+)\]\]", wiki_link, prepared)
    return prepared, replacements


def split_wiki_target(raw: str) -> tuple[str, str | None]:
    parts = raw.split("|", 1)
    target = parts[0].strip()
    label = parts[1].strip() if len(parts) > 1 else None
    return target, label


def placeholder(prefix: str, index: int) -> str:
    return f"DOCFERRY{prefix}{index}TOKEN"


def enhance_callouts(rendered: str) -> str:
    pattern = re.compile(
        r"<blockquote>\s*<p>\[!(?P<kind>[A-Za-z0-9_-]+)\](?P<after>.*?)</p>\s*(?P<body>.*?)</blockquote>",
        re.DOTALL,
    )

    def replace(match: re.Match[str]) -> str:
        kind = match.group("kind").lower()
        title, first_body = split_callout_after_marker(kind, match.group("after"))
        body = f"<p>{first_body}</p>" if first_body else ""
        body += match.group("body")
        return (
            f'<div class="callout" data-callout="{escape(kind, quote=True)}">'
            '<div class="callout-title">'
            f'<span class="callout-icon">{escape(callout_icon(kind))}</span>'
            f'<div class="callout-title-inner">{title}</div>'
            "</div>"
            f'<div class="callout-content">{body}</div>'
            "</div>"
        )

    return pattern.sub(replace, rendered)


def split_callout_after_marker(kind: str, value: str) -> tuple[str, str]:
    if value.startswith("\n"):
        return escape(kind.title()), value.lstrip("\n").strip()

    cleaned = value.strip()
    if not cleaned:
        return escape(kind.title()), ""

    if "\n" not in cleaned:
        return cleaned, ""

    title, body = cleaned.split("\n", 1)
    return title.strip() or escape(kind.title()), body.strip()


def callout_icon(kind: str) -> str:
    if kind in {"warning", "caution", "danger", "error", "bug"}:
        return "!"
    if kind in {"success", "check", "done"}:
        return "+"
    if kind in {"question", "help", "faq"}:
        return "?"
    return "i"
