<p align="center">
  <img src="docferry-cloud-logo.svg" alt="DocFerry cloud logo" width="112">
</p>

<h1 align="center">DocFerry Plugin Package</h1>

Obsidian 插件主体。此目录包含运行时 manifest、前端源码、样式、构建脚本和发布产物入口。

## 当前标识

- manifest id: `docferry`
- display name: `DocFerry`
- runtime manifest: [`manifest.json`](manifest.json)
- root review manifest: [`../manifest.json`](../manifest.json)

`manifest.id` 已收敛到产品名 `docferry`。登录回调使用 `obsidian://docferry-auth?...`。

## 当前能力

- 右键 Markdown 文件发布分享链接。
- 命令面板发布当前文档、复制分享链接、停止分享。
- 命令面板导入单个 DocFerry 分享 URL 到当前 vault。
- 命令面板查看当前分享的内部链接解析状态。
- 设置页提供 Fuyonder account 登录入口，按钮文案为 `Log in / Sign up`。
- 设置页拆分为 Account、Shares、Import、Settings。
- Account 页显示本地缓存的 display-only 账号信息、插件 instance 状态和免费 5-document quota 状态。
- Account 页提供 `Request more quota`，用于 beta list 用户申请额外免费额度。
- Shares 页调用 `GET /v0/shares` 展示当前 owner 的已发布文档、密码状态、有效期、停止状态，并提供复制/打开链接。
- Import 页支持单个 DocFerry URL 导入，并以 bullet list 展示默认导入文件夹、范围和资产说明。
- Fuyonder account 登录时向服务端提供低敏插件实例上下文，并保存返回的 `product_instance_id`，用于后续同账号跨产品联动。
- Fuyonder account 登录成功后，设置页显示 display-only 的账号邮箱/昵称；这些展示字段只保存在本地插件设置中。
- 调用 `GET /v0/health` 测试连接，并校验当前认证方式是否可用。
- 调用 `POST /v0/shares` 创建分享。
- 调用 `PUT /v0/shares/{share_id}` 更新分享。
- 调用 `GET /v0/shares` 获取当前 owner 的管理列表。
- 更新分享时，如果本地 frontmatter 中的旧 `share_id` 已被服务端删除或不存在，会自动重新发布一个新链接并写回 frontmatter。
- 调用 `DELETE /v0/shares/{share_id}` 停止分享。
- 写回并读取 `df_*` frontmatter。
- 发布成功后自动复制 URL。
- 首次安装、更新或首次发布前展示上传 disclosure。插件不会自动上传 vault；只有用户主动发布时，当前文档和显式引用的本地资产才会发送到 DocFerry 服务端。
- 发布弹窗支持确认或修改标题；默认标题使用 Obsidian 文件名。
- 发布时生成 Obsidian HTML snapshot。
- 发布本地图片和显式引用附件到 DocFerry 后端，并在 snapshot 中使用 asset id 占位。
- 设置页显示当前 Image quality 策略；当前公开构建上传原始图片字节，优化档位未在插件 UI 中启用。
- 多个本地资产会以有限并发上传，降低多图文档发布时间。
- 发布时上传当前阅读视图的 CSS snapshot；上传失败时降级为服务端默认阅读样式。
- URL 导入会恢复 Markdown 和 import payload 中列出的显式引用附件。
- 内部链接状态可在插件内查看：resolved、unpublished、ambiguous、unsupported。
- 设置页显示当前加载的插件版本，用于确认 Obsidian 是否已经重载最新插件。

## 当前限制

- 内部链接跳转依赖服务端 resolver；目标文档必须也已通过 DocFerry 发布。
- URL 导入只导入单个 share，不会扫描或同步对方 vault、folder 或其他未发布文档。
- Theme sync 当前是基础 CSS snapshot，不承诺完整复刻第三方 Obsidian theme。
- 当前公开构建不压缩图片；如果图片仍显得模糊，应优先排查前端展示尺寸、截图源分辨率和中间层转换。
- 超大文档首次发布可能较慢，主要耗时来自 Obsidian 本地 HTML snapshot 渲染和资产上传。
- Fuyonder account 登录依赖云端账号基础设施。
- product instance 注册失败不会阻断登录，但会导致设置页显示 `Instance registration pending`，后续跨产品联动不可用。
- 停止分享会清理当前文档的 `df_*` frontmatter。

## 开发命令

```bash
npm ci
npm run build
node --check main.js
```

从仓库根目录验证完整插件构建：

```bash
npm ci
npm --prefix plugin ci
npm run check:plugin
```

## 隐私和审核边界

- 插件不会自动扫描或上传整个 vault。
- 发布是用户主动触发的动作；只上传被发布的当前文档、渲染 snapshot、有限 CSS snapshot 和显式引用的本地资产。
- 内部链接不会自动发布目标文档；目标文档必须由用户单独发布。
- 账号 token 保存在 Obsidian 插件本地数据中。
- 剪贴板只在用户点击复制链接后写入，插件不读取剪贴板内容。
- 详细说明见仓库根目录 [`PRIVACY.md`](../PRIVACY.md)。
