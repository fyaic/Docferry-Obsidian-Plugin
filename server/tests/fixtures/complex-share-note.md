# Docferry Complex Regression Note

> [!important] Single document boundary
> This fixture verifies that a share URL only exposes one document and its explicitly referenced assets.

## Table

| Capability | Expected behavior |
| --- | --- |
| Image asset | Rewritten to share-scoped asset proxy |
| Internal link | Rendered as a non-navigating Obsidian-style link |
| Stopped share | Document and assets are unavailable |

## Local Image

![[images/regression-chart.png]]

## Markdown Image

![Regression chart](images/regression-chart.png)

## Internal Links

See [[Product/Single Doc Boundary|single document boundary]] and [[Missing Note]].

## Wide Content

This paragraph intentionally contains a long inline value to exercise wrapping behavior:
`docferry-regression-token-0000000000000000000000000000000000000000000000000000000000000000`.

## Unsupported Dynamic Block

```dataview
TABLE file.mtime
FROM "Projects"
```
