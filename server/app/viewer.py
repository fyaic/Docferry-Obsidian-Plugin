from __future__ import annotations

import re
from datetime import datetime, timezone
from html import escape, unescape
from urllib.parse import quote

from .markdown import render_markdown
from .models import Share


def document_page(
    share: Share,
    markdown: str,
    html_snapshot: str | None,
    title: str | None = None,
    asset_refs: list[dict[str, str]] | None = None,
) -> str:
    title = title if title is not None else share.title
    content = html_snapshot if html_snapshot else render_markdown(markdown)
    content = polish_content_html(rewrite_internal_link_urls(rewrite_asset_urls(content, share, asset_refs), share))
    updated = format_timestamp(share.updated_at)
    render_label = "Obsidian snapshot" if html_snapshot else "Markdown fallback"
    css_asset_link = share_css_asset_link(share)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>{escape(title)}</title>
  <style>{base_css()}</style>
  {css_asset_link}
  <style>{reader_guard_css()}</style>
</head>
<body class="reader-page">
  <header class="share-topbar" aria-label="Share information">
    <div class="share-topbar-inner">
      <div class="brand-mark" aria-label="DocFerry">
        <span class="brand-logo" aria-hidden="true">DF</span>
        <span>DocFerry</span>
      </div>
      <div class="share-meta-line">
        <span>Single document share</span>
        <span>{escape(render_label)}</span>
      </div>
    </div>
  </header>
  <main class="reader-shell">
    <section class="doc-header">
      <p class="doc-kicker">Shared note</p>
      <h1>{escape(title)}</h1>
      <p class="doc-meta">Updated <time>{escape(updated)}</time></p>
    </section>
    <article class="markdown-body markdown-preview-view markdown-rendered">{content}</article>
  </main>
</body>
</html>"""


def status_page(title: str, message: str, status: str = "Unavailable") -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>{escape(title)}</title>
  <style>{base_css()}</style>
</head>
<body class="state-page">
  <main class="state-shell" aria-labelledby="state-title">
    <p class="doc-kicker">{escape(status)}</p>
    <div class="state-rule"></div>
    <h1 id="state-title">{escape(title)}</h1>
    <p>{escape(message)}</p>
  </main>
</body>
</html>"""


def password_page(slug: str, title: str, error: str | None = None) -> str:
    error_html = f'<p class="error">{escape(error)}</p>' if error else ""
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Password required</title>
  <style>{base_css()}</style>
</head>
<body class="state-page">
  <main class="state-shell password-shell" aria-labelledby="password-title">
    <p class="doc-kicker">Protected share</p>
    <div class="state-rule"></div>
    <h1 id="password-title">{escape(title)}</h1>
    <p>This document is protected. Enter the password set for this single share link.</p>
    {error_html}
    <form method="post" action="/s/{escape(slug)}/password">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Open document</button>
    </form>
  </main>
</body>
</html>"""


def format_timestamp(value: datetime) -> str:
    if value.tzinfo:
        value = value.astimezone(timezone.utc)
    else:
        value = value.replace(tzinfo=timezone.utc)
    return value.strftime("%Y-%m-%d %H:%M UTC")


def share_css_asset_link(share: Share) -> str:
    if not share.css_asset_id:
        return ""
    href = f"/s/{escape(share.slug)}/assets/{escape(share.css_asset_id)}"
    return f'<link rel="stylesheet" href="{href}" data-docferry-theme-snapshot="true">'


def reader_guard_css() -> str:
    return """
.reader-page .markdown-body {
  color: var(--ink) !important;
  opacity: 1 !important;
}
.reader-page .markdown-body :is(h1, h2, h3, h4, h5, h6) {
  color: var(--ink) !important;
  opacity: 1 !important;
}
.reader-page .markdown-body :is(p, li, blockquote, figcaption) {
  opacity: 1 !important;
}
.reader-page .markdown-body :is(p, li) {
  color: var(--ink-soft) !important;
}
.reader-page .markdown-body :is(strong, b) {
  color: var(--ink) !important;
}
.reader-page .markdown-body a,
.reader-page .markdown-body .internal-link {
  color: var(--accent-ink) !important;
  opacity: 1 !important;
}
.reader-page .markdown-body img {
  image-rendering: auto !important;
  opacity: 1 !important;
}
"""


def rewrite_asset_urls(content: str, share: Share, asset_refs: list[dict[str, str]] | None = None) -> str:
    for asset_ref in asset_refs if asset_refs is not None else share.assets:
        asset_id = asset_ref.get("asset_id")
        if not asset_id:
            continue
        content = content.replace(
            f"docferry-asset://{asset_id}",
            f"/s/{escape(share.slug)}/assets/{escape(asset_id)}",
        )
    return content


INTERNAL_LINK_OPEN_TAG = re.compile(
    r'<a\b(?=[^>]*\bclass="[^"]*\binternal-link\b)(?=[^>]*\bdata-href="([^"]+)")[^>]*>',
    flags=re.IGNORECASE,
)


def rewrite_internal_link_urls(content: str, share: Share) -> str:
    def replace(match: re.Match[str]) -> str:
        tag = match.group(0)
        target = unescape(match.group(1)).strip()
        if not target:
            return tag

        href = f"/s/{quote(share.slug, safe='')}/link?target={quote(target, safe='')}"
        if re.search(r'\shref="[^"]*"', tag, flags=re.IGNORECASE):
            tag = re.sub(r'\shref="[^"]*"', f' href="{href}"', tag, count=1, flags=re.IGNORECASE)
        else:
            tag = tag[:-1] + f' href="{href}">'
        tag = re.sub(r'\starget="[^"]*"', "", tag, flags=re.IGNORECASE)
        return tag

    return INTERNAL_LINK_OPEN_TAG.sub(replace, content)


def polish_content_html(content: str) -> str:
    unsupported = "This content is only supported in a Feishu Docs"
    replacement = (
        '<div class="unsupported-block">'
        '<div class="unsupported-title">Unsupported source component</div>'
        '<p>This block came from a Feishu Docs-only component. The original note text is preserved, '
        'but the interactive component cannot run in a public read-only share.</p>'
        "</div>"
    )
    content = content.replace(f'<p dir="auto">{unsupported}</p>', replacement)
    content = content.replace(f"<p>{unsupported}</p>", replacement)
    return content


def base_css() -> str:
    return """
:root {
  color-scheme: light;
  --bg: #f4f7f5;
  --paper: #ffffff;
  --paper-soft: #fafcfb;
  --ink: #17201c;
  --ink-soft: #3a4641;
  --muted: #6d7773;
  --line: #d8e0dc;
  --line-strong: #b7c4bd;
  --accent: #1d6d5a;
  --accent-soft: #e0f1eb;
  --accent-ink: #0f4d3f;
  --code-bg: #111916;
  --code-ink: #eff8f4;
  --danger: #9d342f;
  --warning: #9a641d;
  --shadow: 0 24px 70px rgba(24, 42, 34, 0.10);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.72), rgba(244,247,245,0.88) 28rem),
    radial-gradient(circle at 18% 0%, rgba(29,109,90,0.10), transparent 22rem),
    var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
  line-height: 1.65;
  text-rendering: optimizeLegibility;
}
.share-topbar {
  background: rgba(250, 252, 251, 0.78);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(216, 224, 220, 0.82);
  position: sticky;
  top: 0;
  z-index: 5;
}
.share-topbar-inner {
  align-items: center;
  display: flex;
  gap: 18px;
  justify-content: space-between;
  margin: 0 auto;
  min-height: 58px;
  padding: 0 22px;
  width: min(100%, 1160px);
}
.brand-mark {
  align-items: center;
  color: var(--ink);
  display: inline-flex;
  font-size: 0.92rem;
  font-weight: 760;
  gap: 9px;
}
.brand-logo {
  align-items: center;
  background: var(--accent);
  border-radius: 7px;
  box-shadow: 0 0 0 5px rgba(29, 109, 90, 0.12);
  color: white;
  display: inline-flex;
  font-size: 0.68rem;
  font-weight: 820;
  height: 24px;
  justify-content: center;
  letter-spacing: 0;
  line-height: 1;
  width: 24px;
}
.share-meta-line {
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.82rem;
  gap: 10px 16px;
  justify-content: flex-end;
}
.share-meta-line span + span::before {
  color: var(--line-strong);
  content: "/";
  margin-right: 16px;
}
.reader-shell {
  margin: 0 auto;
  padding: clamp(34px, 7vw, 76px) 0 88px;
  width: min(100% - 34px, 980px);
}
.doc-header {
  margin: 0 0 clamp(28px, 5vw, 46px);
  max-width: 840px;
}
.doc-kicker {
  color: var(--accent-ink);
  font-size: 0.78rem;
  font-weight: 760;
  letter-spacing: 0.12em;
  margin: 0 0 14px;
  text-transform: uppercase;
}
.doc-header h1 {
  font-size: clamp(2.3rem, 6vw, 4.9rem);
  letter-spacing: 0;
  line-height: 1.04;
  margin: 0;
  max-width: 13ch;
}
.doc-meta {
  color: var(--muted);
  font-size: 0.95rem;
  margin: 18px 0 0;
}
.markdown-body {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  overflow: hidden;
  padding: clamp(24px, 5vw, 54px);
}
.markdown-body > :first-child { margin-top: 0; }
.markdown-body > :last-child { margin-bottom: 0; }
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  color: var(--ink);
  letter-spacing: 0;
  line-height: 1.22;
  margin: 2.1em 0 0.72em;
}
.markdown-body h1 { font-size: clamp(1.8rem, 4vw, 2.65rem); }
.markdown-body h2 {
  border-top: 1px solid var(--line);
  font-size: clamp(1.45rem, 3vw, 2rem);
  padding-top: 1.25em;
}
.markdown-body h3 { font-size: 1.2rem; }
.markdown-body h4 { font-size: 1.02rem; }
.markdown-body p,
.markdown-body li { color: var(--ink-soft); }
.markdown-body p { margin: 0.82em 0; }
.markdown-body strong { color: var(--ink); font-weight: 760; }
.markdown-body a {
  color: var(--accent-ink);
  text-decoration-color: rgba(29, 109, 90, 0.32);
  text-underline-offset: 0.18em;
}
.markdown-body a:hover { text-decoration-color: var(--accent); }
.markdown-body .internal-link {
  background: var(--accent-soft);
  border-radius: 5px;
  color: var(--accent-ink);
  padding: 0.05em 0.28em;
  text-decoration: none;
}
.markdown-body ul,
.markdown-body ol { padding-left: 1.5em; }
.markdown-body li + li { margin-top: 0.32em; }
.markdown-body img {
  border-radius: 8px;
  display: block;
  height: auto;
  margin: 1.35rem auto;
  max-width: 100%;
}
.markdown-body figure { margin: 1.5rem 0; }
.markdown-body figcaption {
  color: var(--muted);
  font-size: 0.85rem;
  margin-top: 0.55rem;
  text-align: center;
}
.markdown-body .image-embed,
.markdown-body .internal-embed {
  display: block;
  margin: 1.35rem 0;
}
.markdown-body .embed-placeholder {
  background: var(--paper-soft);
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  color: var(--muted);
  padding: 22px;
  text-align: center;
}
.markdown-body table {
  border-collapse: collapse;
  display: block;
  margin: 1.25rem 0;
  overflow-x: auto;
  width: 100%;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid var(--line);
  min-width: 8rem;
  padding: 9px 11px;
  vertical-align: top;
}
.markdown-body th {
  background: #edf4f1;
  color: var(--ink);
  font-weight: 740;
}
.markdown-body pre {
  background: var(--code-bg);
  border-radius: 8px;
  color: var(--code-ink);
  font-size: 0.9rem;
  line-height: 1.58;
  margin: 1.25rem 0;
  overflow-x: auto;
  padding: 16px 18px;
}
.markdown-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
}
.markdown-body :not(pre) > code {
  background: #edf4f1;
  border: 1px solid rgba(183, 196, 189, 0.55);
  border-radius: 5px;
  color: #174f42;
  padding: 0.08em 0.32em;
}
.markdown-body blockquote {
  border-left: 3px solid var(--line-strong);
  color: var(--ink-soft);
  margin: 1.25rem 0;
  padding: 0.1rem 0 0.1rem 1rem;
}
.markdown-body .callout {
  background: #f4faf7;
  border: 1px solid #c8ded5;
  border-left: 4px solid var(--accent);
  border-radius: 8px;
  margin: 1.35rem 0;
  padding: 14px 16px;
}
.markdown-body .callout[data-callout="warning"],
.markdown-body .callout[data-callout="caution"],
.markdown-body .callout[data-callout="danger"],
.markdown-body .callout[data-callout="error"],
.markdown-body .callout[data-callout="bug"] {
  background: #fff7ed;
  border-color: #ecd2b4;
  border-left-color: var(--warning);
}
.markdown-body .callout-title {
  align-items: center;
  color: var(--ink);
  display: flex;
  font-weight: 760;
  gap: 9px;
  margin-bottom: 6px;
}
.markdown-body .callout-icon {
  align-items: center;
  background: var(--accent);
  border-radius: 999px;
  color: white;
  display: inline-flex;
  font-size: 0.76rem;
  height: 20px;
  justify-content: center;
  line-height: 1;
  width: 20px;
}
.markdown-body .callout-content > :first-child { margin-top: 0; }
.markdown-body .callout-content > :last-child { margin-bottom: 0; }
.markdown-body .task-list-item { list-style: none; }
.markdown-body input[type="checkbox"] {
  accent-color: var(--accent);
  height: 1rem;
  margin: 0 0.45rem 0 -1.35rem;
  width: 1rem;
}
.markdown-body hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 2rem 0;
}
.markdown-body .mermaid,
.markdown-body pre:has(code.language-mermaid) {
  background: #f1f6f3;
  border: 1px solid var(--line);
  color: var(--ink-soft);
}
.markdown-body .mermaid svg {
  height: auto;
  max-width: 100%;
}
.markdown-body .frontmatter,
.markdown-body .metadata-container {
  display: none;
}
.markdown-body .markdown-embed-title {
  color: var(--muted);
  font-size: 0.86rem;
  font-weight: 700;
  margin-bottom: 0.55rem;
}
.markdown-body .unsupported-block {
  background: #f8faf9;
  border: 1px solid var(--line);
  border-left: 4px solid var(--line-strong);
  border-radius: 8px;
  margin: 1.35rem 0;
  padding: 14px 16px;
}
.markdown-body .unsupported-title {
  color: var(--ink);
  font-weight: 760;
  margin-bottom: 4px;
}
.markdown-body .unsupported-block p {
  color: var(--muted);
  margin: 0;
}
.state-shell {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  margin: 15vh auto 0;
  padding: clamp(26px, 5vw, 42px);
  width: min(100% - 34px, 560px);
}
.state-shell h1 {
  font-size: clamp(1.9rem, 5vw, 3rem);
  line-height: 1.08;
  margin: 0 0 14px;
}
.state-shell p {
  color: var(--ink-soft);
  margin: 0.75rem 0;
}
.state-rule {
  background: var(--line);
  height: 1px;
  margin: 0 0 22px;
  width: 100%;
}
label {
  display: block;
  font-weight: 700;
  margin-top: 20px;
}
input {
  background: var(--paper-soft);
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: var(--ink);
  display: block;
  font: inherit;
  margin-top: 8px;
  padding: 12px 13px;
  width: 100%;
}
input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px rgba(29, 109, 90, 0.14);
  outline: none;
}
button {
  background: var(--accent);
  border: 0;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  font: inherit;
  font-weight: 760;
  margin-top: 16px;
  padding: 12px 15px;
}
button:active { transform: translateY(1px); }
.error {
  color: var(--danger);
  font-weight: 700;
}
@media (max-width: 720px) {
  .share-topbar-inner {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 12px;
    padding-top: 12px;
  }
  .share-meta-line { justify-content: flex-start; }
  .share-meta-line span + span::before { display: none; }
  .reader-shell {
    padding-top: 28px;
    width: min(100% - 24px, 980px);
  }
  .markdown-body { padding: 20px 16px; }
  .doc-header h1 { max-width: none; }
}
"""
