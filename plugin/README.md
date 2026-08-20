<p align="center">
  <img src="docferry-logo-256.png" alt="DocFerry logo" width="120">
</p>

<h1 align="center">DocFerry Obsidian Plugin</h1>

付费版 DocFerry 插件源码、样式、manifest 和构建入口。

这是 DocFerry 的主产品形态。用户安装桌面插件后，通过系统默认浏览器登录
Bondie；Free 用户可以立即使用核心的单文档 Share、DocFerry Share Import 和
普通链接保存，Pro 用户在此基础上获得 Folder Share、完整主题、更高额度和
Advanced Import。插件不要求用户配置模型或 API key。

## Current Package

- manifest id: `docferry`
- display name: `DocFerry`
- paid-line corrective candidate: `0.0.67`
- current Community release until promotion: `0.0.66`
- production service: `https://docferry.bondie.io`
- account provider: Bondie account
- product-return protocol: `obsidian://docferry` for explicit billing/import
  returns; login never uses an Obsidian URI

## Requirements And First Use

- Obsidian desktop `1.12.7` or newer。
- 一个 Bondie account；登录本身不要求先订阅。
- DocFerry 已存在于 Obsidian Community Plugins；普通用户从 Community Plugins
  搜索并安装。当前公开版本仍是 `0.0.66`；`0.0.67` 已完成纠正实现、自动化门禁、
  现有账号真实 GUI 登录和旧 vault 迁移取消验收，等待公开发布、生产部署及外部
  Community 审查。全新邮箱注册与验证续接仍需一次独立人工观察。

首次使用：

1. 在 Obsidian 中启用 DocFerry，从 ribbon 打开主页面。
2. 选择 Bondie 登录；插件调用系统默认浏览器，在网页确认账号后回到 Obsidian，
   插件通过私有一次性状态完成登录，不触发外部 URI 操作确认。
3. 在 `Save to Obsidian` 粘贴一个链接。插件自动判断是导入 DocFerry Share、
   保存普通链接，还是发起符合权限的 Pro Advanced Import。
4. 需要分享时，从文件菜单、命令面板或首页拖拽目标选择一个 Markdown 笔记或
   Pro 文件夹，并在发布前确认。

公开 Free/Pro 权益和服务端实际限制见
[`access-tiers.md`](../docs/product/strategy/access-tiers.md)，对应实现、测试和生产
证据见
[`public-benefit-verification-matrix.md`](../docs/product/strategy/public-benefit-verification-matrix.md)。

## User Experience

Ribbon 的 DocFerry 图标打开一个 Obsidian workspace tab：

- 首页只有一个 `Save to Obsidian` 链接入口。用户粘贴 DocFerry share、网页、
  视频或音频链接后，插件自动选择直接导入、保存普通链接或 Pro Advanced
  Import；不要求用户先理解处理模式。下方仅保留 `Shares`、`Dashboard`、
  `Preferences` 三个低权重入口。
- `Open shared links` 命令打开当前 owner 的跨 vault 笔记和文件夹列表，常驻
  Copy / Open / Links / Update，停止分享放在独立的 More 菜单；stopped 或
  expired 记录只保留 Delete，不再显示失效的 Open/Update。
- 将一个 Markdown 笔记或文件夹拖到首页时，Import 面板会用轻量动效显示目标
  名称和类型，随后进入正常确认流程，不会直接发布；非 Markdown 文件不触发
  分享反馈，Shares 页面只负责管理已有分享。
- `Open account` 命令打开 display-only 账号、套餐和用量；主操作进入 DocFerry
  Dashboard。Bondie Account Center 只从网页 Dashboard 的个人信息与隐私区域
  进入。
- 发布当前笔记或文件夹继续使用文件菜单和命令面板，不占用 Import 首页。
- Obsidian 设置按 Account / Sharing / Imports / Advanced 分页；账号、发布默认
  值、导入目录和诊断不会混在一个长页面里。

详细交互事实见
[`docs/product/experience/obsidian-dashboard-ux.md`](../docs/product/experience/obsidian-dashboard-ux.md)。

## Capabilities

- 发布或更新当前 Markdown 笔记，成功后自动复制 share URL。
- 从文件菜单或主工作区拖拽入口发布一个用户明确选择的 Pro 文件夹。
- Pro 文件夹使用独立 revision、导航、密码、停止和资源边界；不会改变单笔记
  share 合同。
- Pro theme styling 只保存安全、语义化的颜色、边框、圆角、正文和代码样式
  token，不复制主题布局；不满足安全合同的旧快照会回退稳定 Reader 样式。
- 停止已有分享，查看内部链接解析状态。
- 导入一个 DocFerry share 及 payload 中显式列出的附件。
- Share Import 会先完成路径预检和附件下载，再统一写入；写入失败会恢复被覆盖的
  本地文件，不留下显示失败但实际已导入一半的状态。
- Advanced Import 可在等待期间取消；活动任务会保存在本地插件状态中，Obsidian
  重启后由创建任务的同一 Bondie 账户继续查询并恢复预览，不会重复创建远程
  处理任务。注册、切换或断开账户前必须先成功取消该任务。
- 发布 Obsidian 渲染后的 HTML、语义主题 token 和显式引用的本地资产。
- 使用 Bondie account 管理 owner 身份和 SynapseHub 投射的访问额度。
- 付款返回 Obsidian 后刷新 membership，并在投射延迟时进行有限重试。
- 会话失效或全局撤销时 fail closed，清理本地失效 product session。
- Stripe 返回 `obsidian://docferry` 后触发有限次数的 membership 自动刷新，不再
  误入登录 callback。

## Product Boundary

- 一次只发布一个用户主动选择的笔记或文件夹；不会扫描整个 vault、digital
  garden 或未发布的链接目标。
- Import 不读取对方 vault，只消费一个 share payload。
- 插件不保存 Auth0 raw token、Stripe 数据、webhook 或 provider reference。
- 正式插件不允许编辑 production Server URL，也不兼容历史域名。
- 账号展示信息只保存在本地插件设置中。
- 用户提交公共网页、音视频链接时，只有当前 Pro entitlement 与服务端 source gate
  同时允许，插件才会自动创建 Advanced Import；否则保存为普通链接笔记。用户会
  看到简短的后台准备状态、预览和写入确认；Managed AI 的 provider key、模型和
  路由永远不进入插件。正式服务采用 Pro 用户受控放量、低并发和月度次数限制，并
  可由服务器开关立即回退。

完整隐私说明见 [`PRIVACY.md`](../PRIVACY.md)。

## Build And Test

从仓库根目录运行：

```bash
npm ci
npm --prefix plugin ci
npm run lint
npm run check:plugin
npm run test:plugin
npm run test:e2e:obsidian
```

真实 Obsidian E2E 使用隔离 vault 和内存态账号 fixture，不会连接生产账号或
产生收费数据。完整 PR/nightly/release profile 见仓库根目录 README 和
[`test-automation-runbook.md`](../docs/operations/runbooks/test-automation-runbook.md)。

## Runtime Files

Obsidian GitHub Release 只需要：

```text
manifest.json
main.js
styles.css
```

构建、版本、Tag、校验和、公开源码与许可证门禁见
[`obsidian-community-release.md`](../docs/operations/runbooks/obsidian-community-release.md)。
