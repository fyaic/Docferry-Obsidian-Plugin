# importer

需求 2：拿到分享 URL 后，快速导入到本地 Obsidian。

当前 alpha 通过 CLI 和 Obsidian 插件提供最小闭环：

```bash
python ../cli/docferry.py import-url https://share.example/s/abc123 --output /path/to/vault/Imported --password "optional"
```

当前能力：

- 读取单个分享 URL 的 import payload：`GET /s/{slug}/import`。
- 密码分享先调用 `/s/{slug}/password` 获取临时 cookie。
- CLI 写入用户指定目录或文件。
- Obsidian 插件命令 `Fuyou Share: Import share URL` 默认写入当前 vault 的 `Docferry Imports/`。
- 保留原始 Markdown 正文，并恢复 import payload 中列出的显式引用附件。

边界：

- 不提供分享列表。
- 不从 URL 推断 owner、vault、目录或其他 share。
- 不扫描来源 vault、folder 或同目录文件。
- 附件只从当前 share 的 asset manifest 下载，并限制在导入目录内。

后续可选路径：

- 浏览器插件识别分享页 URL。
- 调用本地 Obsidian URI 或本地桥接服务。
- 保留必要 frontmatter 和附件。
