# HyperTessera 完整网站架构与可演示 HTML 设计方案

**版本：** 1.0  
**日期：** 2026-08-03  
**状态：** 架构边界已由用户确认，待文档复核后进入实现计划  
**适用目录：** `webpage/工作台`

## 1. 文档目的

本文定义 HyperTessera 除 Homepage 外的完整网站结构，并规定一个可独立打开、可切换页面、可模拟钱包与网络、可使用账号密码登录内部审核后台、可完成 Vault 审核和 Products 模拟上架的单文件 HTML Demo。

本文只定义产品结构、页面、交互、模拟数据和未来集成边界，不在当前阶段实现真实链上交易、真实登录服务、数据库或文件上传。

## 2. 已确认的核心决策

1. 网站采用“业务导航 + My Access”的混合架构。
2. 公开 Products、资产发行、Vault 管理和角色工作台属于用户网站。
3. 用户网站的真实权限将来来源于所选网络、连接钱包和链上合约。
4. 角色授权、替换和撤销继续保留在现有角色控制台，不新增独立角色授权页面。
5. Vault 上架审核不是 Governor、不是钱包角色，也不是任何智能合约角色。
6. Vault 上架审核使用独立的内部账号密码后台。
7. 审核结果不写入链上，只控制 Vault 是否出现在网站 Products 页面。
8. 当前先制作前端演示；审核登录、申请、上架和下架均使用 Mock Data。
9. Demo 应当是一个可直接演示的简单 HTML 文件，不依赖真实后端和真实钱包。

## 3. 依据与现有项目基线

### 3.1 业务依据

- `HyperTessera_角色权限与职责修改方案_完整版.docx` 负责定义权限和职责。
- `HyperTessera_网站前端结构与角色工作台跳转修改方案.docx` 负责提供网站页面结构参考。
- 两份文件冲突时，以角色权限完整版定义的权限边界为准。
- Vault 审核边界以本轮确认结果为准：普通网站后台账号审核，不属于链上权限系统。

### 3.2 合约与 SDK 基线

- `main` 仍是旧的协议全局角色模型，不应作为最终页面角色发现逻辑。
- PR #12 `feat/vault-local-rbac` 是目标权限模型：Governor 协议级，Vault 和资产权限本地化。
- 当前 SDK 已覆盖较多业务交易，但权限发现、动态对象枚举、角色审计和完整角色管理封装仍不充分。
- 当前 Indexer 主要覆盖 Deposit、Redeem、Settlement 和 NAV，尚不足以生成完整的钱包权限清单。
- Demo 不依赖这些缺口；未来真实集成必须在统一 Adapter 层完成，不能把 Mock 与 SDK 调用散落在页面组件里。

### 3.3 现有前端基线

当前 React/Vite 项目已经具有：

- Homepage、Products、产品详情、About 等公开页面。
- 资产发行、包装资产、Vault 创建与管理页面。
- `/workspaces` 角色工作台 Shell 和现有角色路由。
- 网络、钱包、交易上下文和部分 SDK Adapter。
- 现有设计 Token、Header、Footer、产品卡片和工作台组件。

后续正式实现必须复用现有 `src/styles/tokens.css`、Header、Footer、页面容器和工作台视觉语言。单文件 Demo 应视觉接近现有网站，但保持代码隔离，不改动现有 React 页面行为。

## 4. 产品边界

### 4.1 系统一：公开网站与 Web3 用户工作台

身份方式：

- 公开页面无需登录。
- 业务操作页面先选择网络，再连接钱包。
- 真实版本根据当前网络和钱包查询链上角色与对象。
- Demo 使用模拟网络和模拟钱包连接，不请求真实签名。

负责内容：

- Homepage 和 Products。
- 资产发行与资产管理。
- Vault 创建与 Vault 管理。
- My Access 权限与待办汇总。
- 每个对象内部的角色工作台。
- Vault Owner 的网站上架申请入口。

### 4.2 系统二：内部 Vault 上架审核后台

身份方式：

- 普通账号密码登录。
- 不连接钱包。
- 不查询 Governor 角色。
- 不发送链上交易。

负责内容：

- 查看 Vault 上架申请。
- 检查模拟的链上只读快照和申请材料。
- 要求补充材料、驳回或批准。
- 把批准的 Vault 模拟上架到 Products。
- 暂停展示和下架。
- 查看审核历史。

### 4.3 禁止混合的概念

- 审核员账号不得称为 Governor。
- “通过并上架”不得称为“授权 Vault”或“批准合约”。
- 网站下架不得暗示 Vault 已被链上冻结。
- 内部审核后台不得出现 Connect Wallet、签名、Gas Fee 或链上角色授权按钮。
- Web3 角色控制台不得出现内部审核员账号管理。

## 5. 用户类型与主要任务

| 用户 | 身份方式 | 主要任务 | 默认入口 |
| --- | --- | --- | --- |
| 访客 / 投资者 | 无 | 浏览 Products、查看 Vault 和资产详情 | `/`、`/products` |
| Web3 普通用户 | 网络 + 钱包 | Deposit、Redeem、Wrap、Unwrap 等公共操作 | `/app/access` 或产品详情 |
| 发行与 Vault 运营人员 | 网络 + 钱包 | 资产发行、Vault 管理、角色任务 | `/app/access` |
| Vault Owner | 网络 + 钱包 | 管理 Vault，并填写网站上架申请 | `/app/vaults/:vault/listing` |
| 内部 Vault 审核员 | 账号 + 密码 | 审核、上架、暂停展示和下架 | `/ops/login` |

## 6. 顶层导航结构

### 6.1 公开网站 Header

建议顺序：

1. Products
2. 资产发行
3. Vault 管理
4. Resources
5. 网络选择
6. 钱包连接
7. My Access

内部审核后台不放在公开 Header 中。演示时可以通过单独的“内部演示入口”或直接 URL 打开，不向普通访客展示。

### 6.2 My Access 左侧导航

通用区域：

- 今日待办
- 我的 Vault
- 我的资产
- 我的包装资产
- 功能身份
- Activity

My Access 不再包含 Vault 审核队列。Vault 审核只存在于 `/ops`。

### 6.3 对象角色工作台左侧导航

顺序：

1. 对象选择器
2. 对象概览
3. 当前钱包拥有的正式角色
4. 当前钱包拥有的功能身份
5. 对象相关 Activity

钱包没有的角色不显示。只有一个角色时可以自动进入该角色，但仍保留对象和角色上下文，不把用户跳出工作台 Shell。

## 7. 页面与子页面分布

### 7.1 公开网站

| 路由 | 页面 | 主要内容 |
| --- | --- | --- |
| `/` | Homepage | 品牌、核心产品、数据概览、入口 |
| `/products` | Products Hub | 产品分类和筛选 |
| `/products/vaults` | Vault Products | 只显示 `listed` 的 Vault |
| `/products/vaults/:vault` | Vault Product Detail | 公开资料、链上只读数据、风险、投资入口 |
| `/products/assets` | Asset Products | 已公开资产列表 |
| `/products/assets/:assetId` | Asset Detail | 资产信息、PoR、包装资产关系 |
| `/resources` | Resources | 资源中心 |
| `/development-docs` | Development Docs | 开发文档 |
| `/blog` | Blog | 内容页 |
| `/about` | About | 公司与联系信息 |

### 7.2 My Access

| 路由 | 页面 | 主要内容 |
| --- | --- | --- |
| `/app/connect` | Connect | 选择网络和连接钱包 |
| `/app/access` | Access Overview | 全部对象、角色、功能身份和待办 |
| `/app/access/vaults` | My Vault Access | 钱包在各 Vault 的角色 |
| `/app/access/assets` | My Asset Access | 钱包在各资产的角色 |
| `/app/access/wrapped` | My Wrapped Access | Wrapper Controller 和 PSM 身份 |
| `/app/access/identities` | Functional Identities | NAV、Data Provider、PSM Signer |
| `/app/activity` | Activity | 当前账户操作记录 |

### 7.3 资产发行与包装资产

| 路由 | 页面 | 主要内容 |
| --- | --- | --- |
| `/assets/issue` | Issuance Hub | 发行概览和入口 |
| `/assets/issue/new` | New Asset | 创建 / 注册资产 |
| `/assets/issue/manage` | Manage Assets | 资产列表和对象选择 |
| `/assets/issue/oracle` | Oracle Data | NAV 数据入口 |
| `/assets/wrap` | Wrap Asset | 包装资产入口 |
| `/assets/wrap/manage` | Manage Wrapped Assets | 包装资产列表 |
| `/workspaces/asset-owner/:assetId` | Asset Owner | 资产 Owner / Issuer 工作台 |
| `/workspaces/token-agent/:assetId` | Token Agent | Mint / Burn 审批 |
| `/workspaces/proof-publisher/:assetId` | Proof Publisher | 发布 Proof of Reserve |
| `/workspaces/wrapper-controller/:assetId` | Wrapper Controller | 包装资产参数和暂停 |
| `/workspaces/nav-signer/:vault` | NAV Signer | NAV 签名与提交 |
| `/workspaces/adapter-data-provider/:adapter` | Data Provider | 更新 Adapter 外部数据 |
| `/workspaces/psm-authorized-signer/:assetId` | PSM Signer | PSM 授权签名 |

### 7.4 Vault 管理

| 路由 | 页面 | 主要内容 |
| --- | --- | --- |
| `/vaults/create` | Create Vault | 创建 Vault |
| `/vaults/manage` | Manage Vault | 全部 / 我的 Vault |
| `/app/vaults/:vault` | Vault Overview | 状态、周期、资产、角色和风险 |
| `/app/vaults/:vault/requests` | Requests | Deposit / Redeem 队列 |
| `/app/vaults/:vault/settlement` | Settlement | 周期与结算 |
| `/app/vaults/:vault/adapters` | Adapters | Adapter 和资产配置 |
| `/app/vaults/:vault/timelock` | Timelock | 参数变更队列 |
| `/app/vaults/:vault/listing` | Listing Application | 网站上架申请和状态 |
| `/workspaces/vault-owner/:vault` | Vault Owner | Vault 本地角色与配置 |
| `/workspaces/curator/:vault` | Curator | 策略、Adapter、费用和风险参数 |
| `/workspaces/guardian/:vault` | Guardian | 紧急、取消待执行变更、降低风险 |
| `/workspaces/allocator/:vault` | Allocator | 执行配置范围内的资金分配 |
| `/workspaces/settlement-operator/:vault` | Settlement Operator | 结算批次与签名 |
| `/workspaces/keeper/:vault` | Keeper | 生命周期与自动化任务 |

### 7.5 内部审核后台

| 路由 | 页面 | 主要内容 |
| --- | --- | --- |
| `/ops/login` | Ops Login | 模拟账号密码登录 |
| `/ops` | Ops Dashboard | 待审核、待补充、已上架统计 |
| `/ops/vault-reviews` | Review Queue | 筛选和查看申请 |
| `/ops/vault-reviews/:applicationId` | Review Detail | 核验材料并作出结论 |
| `/ops/listings` | Listed Vaults | 已上架、暂停展示和下架 |
| `/ops/history` | Review History | 审核与状态变化时间线 |

## 8. 关键页面布局

### 8.1 Products Vault 列表

布局：

- 顶部标题、说明和网络筛选。
- 搜索、Vault 类型、风险等级、状态筛选。
- 产品卡片网格。
- 卡片显示名称、网络、底层资产、状态、关键指标和风险标签。
- 数据源只接受 `listingStatus === "listed"` 的记录。

空状态：

- 无搜索结果时提供“清除筛选”。
- 没有任何已上架 Vault 时显示解释，不展示待审核 Vault。

### 8.2 Vault Product Detail

布局：

- 产品 Header：名称、网络、Vault 地址、上架状态。
- Overview：策略、资产和关键指标。
- Performance：演示图表或数据卡。
- Risk：风险等级、费用、Adapter、Gate、Timelock。
- Documents：风险披露和材料。
- Actions：连接钱包后进入 Deposit / Redeem。

必须显示：“网站上架不代表协议或投资担保”。

### 8.3 My Access

布局：

- 顶部 Context Bar：网络、钱包、刷新时间。
- 四个摘要：可操作 Vault、可操作资产、待办、功能身份。
- 待办列表按紧急程度排序。
- 权限按 Vault / Asset / Wrapped / Functional Identity 分组。
- 无角色时仍显示 Permissionless Actions。

### 8.4 角色工作台

布局：

- 左侧对象和角色导航。
- 顶部显示网络、钱包、对象、角色和权限来源。
- 主区按“摘要、待办、操作、历史”组织。
- 写操作未来必须显示即时 / 钱包确认 / 多签 / Timelock 标签。
- Demo 只模拟操作状态，不发送交易。

### 8.5 Vault Listing Application

步骤：

1. 确认 Vault 和网络。
2. 产品名称、简介、收益和风险说明。
3. 上传材料的模拟 UI。
4. Products 卡片与详情预览。
5. 提交模拟申请。

只有 Vault Owner 语义上的演示账户才能看到入口；Demo 可用固定数据模拟该条件。

### 8.6 Ops Login

字段：

- 账号。
- 密码。
- 登录按钮。
- 演示账号提示。
- 错误提示。

演示凭据：

- 账号：`reviewer@hypertessera.demo`
- 密码：`Demo2026!`

登录成功后进入 `/ops`。错误账号或密码显示行内错误，不刷新页面。

页面必须显示 Demo 标识，避免被误认为真实认证。

### 8.7 Ops Review Queue

列表字段：

- 申请编号。
- Vault 名称和地址。
- 网络。
- 提交人。
- 提交时间。
- 当前状态。
- 更新时间。

筛选：

- 待审核。
- 待补充。
- 已通过。
- 已驳回。
- 全部。

### 8.8 Ops Review Detail

左侧主区：

- 申请基本信息。
- Vault 链上只读快照。
- 角色配置完整性。
- 费用、Adapter、Gate 和 Timelock。
- 产品展示资料。
- 风险和法律材料。
- Products 卡片 / 详情预览。
- 操作时间线。

右侧固定审核区：

- 审核意见。
- 要求补充材料。
- 驳回。
- 通过并上架到网站。

所有按钮只修改 Mock Listing 状态。

## 9. Vault 上架状态机

```text
draft
  -> submitted
  -> needs_information -> submitted
  -> approved -> listed
  -> rejected

listed -> suspended -> listed
listed -> delisted
```

规则：

- `draft`：申请人尚未提交。
- `submitted`：等待审核。
- `needs_information`：审核员要求补充，Products 不展示。
- `approved`：审核通过但发布步骤尚未完成。
- `listed`：Products 展示。
- `rejected`：申请结束，可复制后重新申请。
- `suspended`：暂时停止展示，可恢复。
- `delisted`：正式下架，保留历史。

## 10. 单文件 HTML Demo 设计

### 10.1 交付形式

建议文件：

`webpage/工作台/demo/hypertessera-full-demo.html`

特性：

- 单 HTML 文件。
- CSS 和 JavaScript 内嵌。
- 无构建步骤。
- 可直接打开或通过本地静态服务器运行。
- 使用 Hash Router 模拟页面切换。
- 不修改现有 React 应用。

### 10.2 Demo 页面范围

必须可切换：

- Homepage。
- Products Vault 列表。
- Vault 产品详情。
- My Access。
- 资产发行总览。
- Vault 管理总览。
- 一个 Vault 角色工作台示例。
- 一个资产角色工作台示例。
- Vault 上架申请。
- Ops Login。
- Ops Dashboard。
- Review Queue。
- Review Detail。
- Listed Vaults。
- Review History。

其余角色通过同一工作台模板和角色切换器演示，不为每个角色复制一套完整 HTML。

### 10.3 Hash Route

建议：

```text
#/home
#/products
#/products/vault/:vaultId
#/access
#/issuance
#/vaults
#/workspace/vault/:role
#/workspace/asset/:role
#/vault-listing/:vaultId
#/ops/login
#/ops/dashboard
#/ops/reviews
#/ops/review/:applicationId
#/ops/listings
#/ops/history
```

刷新后应根据 Hash 恢复当前页面。

### 10.4 Mock 数据模型

```js
demoState = {
  version: 1,
  wallet: {
    connected: false,
    network: "Ethereum",
    address: "0x71A...92C"
  },
  opsSession: {
    authenticated: false,
    reviewerName: "Demo Reviewer"
  },
  vaults: [],
  assets: [],
  accessInventory: [],
  listingApplications: [],
  reviewHistory: []
}
```

建议 localStorage Key：

`hypertessera_full_demo_v1`

### 10.5 模拟登录

- 仅对 Demo 凭据返回成功。
- 登录成功将 `opsSession.authenticated` 设为 `true`。
- 未登录访问任何 `#/ops/*` 路由时跳转到 `#/ops/login`。
- 退出登录只清除 Ops Session，不清除审核数据。
- “重置演示数据”恢复初始申请和 Products 状态。
- 页面显著标注这是演示认证，严禁作为生产登录方案。

### 10.6 模拟审核闭环

演示路径：

1. Products 中没有 Nova Credit Vault。
2. 打开 Ops Login。
3. 输入演示账号密码。
4. 进入 Review Queue。
5. 打开 Nova Credit Vault。
6. 填写审核意见并点击“通过并上架到网站”。
7. 状态变为 `listed`，写入 Review History。
8. 返回 Products，Nova Credit Vault 卡片出现。
9. 打开 Vault 产品详情。
10. 刷新页面，状态仍保留。
11. 点击“重置演示数据”，恢复初始状态。

### 10.7 模拟钱包和网络

- Connect Wallet 只切换 Demo 状态。
- 网络可在 Ethereum、Base、BNB Smart Chain Testnet 间切换。
- 切换网络后更新展示的 Mock 对象与角色。
- 不调用浏览器钱包，不弹签名请求。
- 工作台操作按钮可以演示 `ready -> confirming -> success`，但必须显示 Demo 标记。

## 11. 数据来源边界

### 11.1 当前 Demo

- Vault、资产、角色、NAV、申请和历史全部来自内嵌 Mock Data。
- localStorage 只用于保存演示状态。
- 模拟附件只保存文件名和大小，不保存文件内容。

### 11.2 未来真实版本

- 链上合约 / SDK：资金、权限、角色、对象和状态的最终事实。
- Indexer：钱包到对象和角色的快速发现、历史和待办。
- 网站后端：账号、Vault 上架申请、材料、审核意见和 Products 展示状态。
- Products API：只返回允许公开展示的 Listing。

页面必须通过统一数据接口读取，Mock 和真实实现使用相同返回结构：

```text
DemoRepository
  -> AccessRepository
  -> VaultRepository
  -> ListingRepository
  -> AuthRepository

Future API / SDK adapters implement the same contracts.
```

## 12. 错误与边界状态

### 12.1 Ops 登录

- 空账号或密码：字段下方提示。
- 凭据错误：显示“演示账号或密码错误”。
- 已登录再次访问登录页：跳转 Dashboard。

### 12.2 审核

- 未填写审核意见时允许要求补充，但通过和驳回需要确认。
- 重复批准同一申请：保持幂等，不重复写历史。
- 已下架产品不可重复下架。
- Products 与审核状态应在同一浏览器标签即时同步。

### 12.3 钱包与工作台

- 未连接钱包进入 My Access：显示连接引导。
- 错误网络：显示切换网络提示。
- 无角色：显示 Permissionless Actions，不展示空白页。
- 对象不存在：返回列表并显示说明。

### 12.4 数据恢复

- localStorage 解析失败时恢复初始数据。
- 数据版本不兼容时迁移或重置。
- 提供明确的“重置演示数据”按钮。

## 13. 可访问性与响应式要求

- 所有页面可使用键盘导航。
- 表单字段有可见 Label。
- Modal 打开后锁定焦点，关闭后返回触发按钮。
- 状态不能只用颜色表达，必须同时显示文字。
- 桌面端为主要演示尺寸；平板和手机保持可用。
- 表格在窄屏改为卡片或横向滚动。
- 交互按钮最小高度 40px。
- 支持中文和必要的英文角色名。

## 14. 视觉要求

- 复用当前网站的深色导航、蓝色品牌主色、白色内容面板和现有字体层级。
- Ops 后台使用同一品牌体系，但通过紫色/中性色和独立侧边栏表明它是内部系统。
- 不为 Demo 引入新的复杂图片资产。
- Products 页面保持对外产品感；My Access 和 Ops 更偏任务型界面。
- 所有页面应使用真实感内容，不使用 `Lorem ipsum`。

## 15. 验收标准

### 15.1 架构

- Vault 审核不出现在 Governor 或 My Access 角色模块中。
- 内部审核后台不需要网络和钱包。
- 角色授权只存在于原角色工作台。
- Products 只显示 `listed` Vault。

### 15.2 Demo 功能

- 单 HTML 可打开。
- 所有指定页面可以切换。
- Demo 钱包可以连接和断开。
- 网络可以切换。
- Ops 演示账号可以成功登录。
- 错误密码会显示错误。
- 未登录不能进入 Ops 页面。
- 可以通过、驳回、要求补充、暂停展示和下架。
- 审核通过后 Products 立即出现 Vault。
- 刷新后演示状态保留。
- 重置按钮可以恢复初始数据。

### 15.3 质量

- 浏览器控制台无错误。
- 所有按钮和导航均有响应。
- 没有链上审核、Governor 审核或真实认证的误导性文字。
- 桌面、平板和手机布局不溢出。
- 文案中区分“网站上架”和“链上 Vault 状态”。

## 16. 当前阶段明确不实现

- 真实账号注册、找回密码、密码哈希和权限管理。
- 数据库、对象存储和真实文件上传。
- 邮件、短信和消息通知。
- 审核智能合约。
- Governor 审核权限。
- 审核相关钱包签名和链上交易。
- 正式 SDK、Indexer 和合约集成。
- 生产安全认证。

## 17. 后续实施顺序

1. 完成单文件 HTML Demo 的 Hash Router、布局和 Mock Data。
2. 完成模拟钱包、网络和 My Access。
3. 完成 Ops 登录保护和审核页面。
4. 完成 Vault 审核到 Products 上架的闭环。
5. 完成响应式、可访问性和状态恢复。
6. 使用真实演示路径进行浏览器验收。
7. 方案确认后，再拆分为 React 页面和未来真实 API / SDK Adapter。

