# HyperTessera 全角色后台与 SDK 接入设计规格

日期：2026-07-31

状态：已确认采用方案 A，待书面规格复核

适用前端：`webpage/frontend`

需求优先级：老板提供的《HyperTessera_角色权限与职责修改方案_完整版》高于当前仓库的旧权限实现

## 1. 决策摘要

本项目采用“目标权限模型优先、当前链能力兼容”的双配置实现：

1. 按老板文档建立完整的角色工作台和业务动作。
2. 当前合约和 SDK 已支持的动作直接接入钱包、签名、交易和回执。
3. 老板文档要求但当前合约尚未实现的动作完整展示，但明确标记为“需要新版合约/SDK”，禁止发送错误交易或模拟成功。
4. 通过统一的 Capability Adapter 隔离当前合约与目标合约差异。新版合约部署后替换适配器，不重写页面。
5. URL 只负责打开工作台，不作为权限依据。每个动作都必须基于当前网络、连接钱包、目标对象和链上状态重新判断权限。

## 2. 输入与事实基线

### 2.1 权威需求

老板文档定义的目标边界为：

- 协议全局权限只保留 Governor。
- Vault Owner、Curator、Guardian、Allocator、Settlement Operator、Keeper 改为 Vault 本地身份。
- Asset Owner/Issuer、Token Agent、Proof Publisher 改为 Asset 本地身份。
- Wrapper Controller 改为 Wrapper 或 Asset 本地身份。
- NAV Signer、Adapter Data Provider、PSM Authorized Signer 是特定业务范围的签名或数据身份。
- Relayer 是无许可提交者，不应因为提交交易而自动获得业务授权。
- Vault Creator、Asset Creator、Wrapper Creator 和普通用户属于公共功能，不作为管理角色授权源。

### 2.2 当前仓库基线

核对的私有仓库主分支提交：

`7a49a6f5668e2ea9e76938a20535eabb6b99e552`

当前实现与目标方案存在以下差异：

- `HyperAccessControl.sol` 仍定义 12 个全局角色：
  `GOVERNOR`、`CURATOR`、`GUARDIAN`、`ALLOCATOR`、`SETTLEMENT`、`ISSUER`、
  `TOKEN_AGENT`、`OPERATOR`、`KEEPER`、`STRATEGY`、`DATA_PROVIDER`、`COMPLIANCE`。
- `BaseVault.sol` 尚无 Vault Owner 和 Vault 本地角色存储。
- `VaultFactory.sol` 仍要求全局 Governor 创建 Vault，尚未同时部署或绑定 VaultTimelock、AdapterRegistry。
- `ProtocolTimelock.sol` 是协议级全局 Timelock，尚未按 Vault 隔离。
- `Settlement.sol` 使用全局 operators 和全局 threshold，尚未按 Vault 配置。
- `MintBurnController.sol` 仍读取全局 Issuer 和 Token Agent。
- `ReservePSM.sol` 已与 Vault、StateManager、Settlement、UnifiedPool 解耦，但尚无每 Asset 的 Wrapper Controller。
- `AssetRegistry.sol` 已支持 permissionless register 并把调用者设为 owner，属于部分符合目标设计。
- `STRATEGY_ROLE` 当前定义但未被有效业务逻辑使用，不应据此创建独立后台。

### 2.3 当前 SDK 基线

当前 `offchain/src/sdk.ts` 已覆盖：

- 合约实例读取和角色读取
- 文档哈希
- Vault 状态、NAV、余额和资产读取
- 生命周期推进
- NAV 更新
- Mint/Burn 发起与批准
- Settlement hash、operator、threshold、submitBatch
- UnifiedPool 分发、还款和 operator transfer
- Wrapper 部署、wrap、mintWithAuthorization、unwrap
- 申购赎回请求、claim、cancel、refund

当前 SDK 尚未覆盖目标方案中的：

- Vault 本地 `setCurator`、`setGuardian`、`setAllocator`、`setKeeper`
- Vault 本地 Settlement signers 和 threshold
- Vault Owner 转移
- VaultTimelock 的 Vault 绑定、动作白名单和本地管理
- AdapterRegistry
- Asset 本地 Token Agent、Proof Publisher
- Asset 或 Wrapper 本地 Wrapper Controller
- 新版 capability discovery

因此本期前端不能声称这些目标动作已经可以在当前链上执行。

## 3. 产品范围

### 3.1 本期交付

- 角色工作台入口与路由
- 钱包连接、网络状态和对象选择
- 统一权限与能力判断
- 每个角色的概览、操作表单、历史和说明
- 当前 SDK 的真实读取、签名和交易接入
- 目标 SDK 的类型契约和适配边界
- 未支持动作的可解释禁用状态
- 交易确认、Pending、成功、失败和用户拒绝状态
- 响应式布局、键盘操作、焦点状态和基础无障碍支持
- 单元、组件、集成和浏览器级测试

### 3.2 不在本期伪造的能力

- 不修改或部署私有仓库中的 Solidity 合约。
- 不通过前端绕过链上权限。
- 不把旧全局角色伪装成已经完成的新本地角色改造。
- 不为未实现的目标方法发送猜测 calldata。
- 不使用纯前端 Mock 显示虚假交易成功。
- 不代替 Indexer 构造不可验证的完整历史数据。

## 4. 信息架构

### 4.1 顶层入口

- `/workspaces`：角色与对象工作台选择器
- `/workspaces/activity`：当前钱包的签名与交易活动
- `/workspaces/public`：公共创建、申购、赎回、wrap/unwrap 等非角色功能

### 4.2 角色路由

| 身份 | 路由 | 作用域 |
| --- | --- | --- |
| Governor | `/workspaces/governor` | Protocol |
| Vault Owner | `/workspaces/vault-owner/:vault` | Vault |
| Curator | `/workspaces/curator/:vault` | Vault |
| Guardian | `/workspaces/guardian/:vault` | Vault |
| Allocator | `/workspaces/allocator/:vault` | Vault |
| Settlement Operator | `/workspaces/settlement-operator/:vault` | Vault |
| Keeper | `/workspaces/keeper/:vault` | Vault |
| Asset Owner / Issuer | `/workspaces/asset-owner/:assetId` | Asset |
| Token Agent | `/workspaces/token-agent/:assetId` | Asset |
| Proof Publisher | `/workspaces/proof-publisher/:assetId` | Asset |
| Wrapper Controller | `/workspaces/wrapper-controller/:assetId` | Asset / Wrapper |
| NAV Signer | `/workspaces/nav-signer/:vault` | Vault |
| Adapter Data Provider | `/workspaces/adapter-data-provider/:adapter` | Adapter |
| PSM Authorized Signer | `/workspaces/psm-authorized-signer/:assetId` | Asset |
| Relayer | `/workspaces/relayer` | Permissionless submission |

Vault Creator、Asset Creator、Wrapper Creator 和普通用户进入 `/workspaces/public`，不创建伪角色权限。

### 4.3 工作台通用结构

每个工作台统一包含：

1. 左侧导航：角色、对象和功能分组。
2. 顶部上下文栏：钱包、网络、当前对象、合约配置版本。
3. Capability Banner：显示 Target、Legacy Compatible、Read Only、Unsupported 或 Unauthorized。
4. 概览区：关键链上状态和待办事项。
5. 操作区：按风险和业务阶段分组的表单。
6. 活动区：本会话交易和可获得的链上事件。
7. 交易抽屉：预检查、钱包确认、哈希、确认数、回执和错误。

## 5. 角色动作矩阵

### 5.1 Governor

目标动作：

- 管理 Governor 成员。
- 协议级模块 pause/unpause。
- 管理协议级安全配置。
- 管理 PSM 的协议级暂停边界。
- 管理 RevenuePool treasury 等明确保留的全局配置。

约束：

- Governor 不代替 Vault Owner 配置 Vault 本地人员。
- Governor 不代替 Asset Owner 配置 Asset 本地人员。
- 高风险动作必须显示目标地址、函数、参数、网络和风险确认。

### 5.2 Vault Owner

目标动作：

- 设置 Curator、Guardian、Allocator、Keeper。
- 设置 Vault Settlement Operators 和 threshold。
- 选择或更换 Settlement、UnifiedPool、Gate、NAV Signer。
- 管理 Vault AdapterRegistry。
- 管理 VaultTimelock 所允许的 Owner 动作。
- 转移 Vault Owner。

当前状态：

- 以上大部分属于目标合约能力，当前合约无 Vault Owner 存储，默认显示为 Target-only。
- 当前由 Governor 完成的相似动作只能在 Legacy Compatible 模式明确展示，不能标记为 Vault Owner 原生能力。

### 5.3 Curator

目标动作：

- 设置费用和业务参数。
- 管理允许使用的 Adapter。
- 创建和管理需要资产配置判断的订单。
- 设置数据新鲜度、NAV 容差、桥接目标等策略参数。
- 执行文档中明确授予 Curator 的解冻或配置动作。

当前状态：

- 当前 SDK 已能支持部分 fee 和 Vault 读取。
- AdapterRegistry 和多数本地参数需目标合约。

### 5.4 Guardian

目标动作：

- 紧急暂停 Vault。
- 取消危险或过期订单。
- 冻结 Allocator。
- 取消尚未执行的 VaultTimelock 操作。

约束：

- Guardian 主要是阻止和撤销，不获得任意资金转移权限。
- 紧急动作必须要求二次确认并展示影响范围。

### 5.5 Allocator

目标动作：

- 执行 buy、sell、rebalance。
- 清理或关闭 deal。
- 在允许的 Adapter 和参数范围内执行 bridge。

约束：

- 仅能作用于指定 Vault。
- Adapter 必须通过 Vault AdapterRegistry。
- 页面必须显示余额、限额、滑点、目标链和预期结果。

### 5.6 Settlement Operator

目标动作：

- 对指定 Vault 的 settlement instruction 或 batch digest 签名。
- 查看当前签名阈值、已签名成员和待提交批次。

约束：

- Operator 负责授权签名，不因为持有签名身份自动成为 Relayer。
- `submitBatch` 放在 Relayer 工作台，任何地址均可提交已满足阈值的批次。
- 前端必须防止跨 Vault、跨链和过期签名复用。

### 5.7 Keeper

目标动作：

- 推进允许的 Vault 生命周期。
- 标记 refundable。
- 记录或推进 claim 等维护动作。
- 执行文档明确列出的自动化维护函数。

约束：

- Keeper 不配置费用、人员或资金接收地址。
- 每个按钮先读取状态机，只显示当前状态允许的迁移。

### 5.8 Asset Owner / Issuer

目标动作：

- 注册和管理 Asset。
- 更新 metadata 和 ownership。
- deactivate Asset。
- 设置 Token Agent 和 Proof Publisher。
- 发起 mint/burn。
- 配置该 Asset 明确允许的合规或发行参数。

当前状态：

- permissionless asset registration 和 owner 基础已部分存在。
- Token Agent、Proof Publisher 本地化和完整 owner 管理仍需目标接口。

### 5.9 Token Agent

目标动作：

- 审核并批准指定 Asset 的 mint/burn 请求。
- 查看待处理请求、资产状态、请求摘要和已批准记录。

约束：

- 不允许跨 Asset 批准。
- 必须显示请求哈希、数量、收款地址、发起方和过期状态。

### 5.10 Proof Publisher

目标动作：

- 发布或更新 Asset 对应的证明哈希、文档引用或证明状态。
- 查看最近证明、关联发行请求和链上确认状态。

约束：

- 具体写方法以目标 AssetRegistry 或证明模块 ABI 为准。
- 在目标 ABI 未落地前，该工作台提供真实读取和 Target-only 写操作说明，不猜测函数。

### 5.11 Wrapper Controller

目标动作：

- 部署或登记 Wrapper。
- 配置 PSM Authorized Signer。
- 对指定 Asset 的 Wrapper/PSM 流程执行 pause/unpause。
- 管理该 Wrapper 明确允许的业务参数。

当前状态：

- Wrapper deploy、wrap、unwrap、mintWithAuthorization 已有 SDK 基础。
- 本地 Controller 和按 Asset 的 pause 权限仍需目标合约。

### 5.12 NAV Signer

目标动作：

- 读取 Vault 当前 NAV 状态。
- 构造规范化 NAV payload。
- 显示签名方案、chainId、Vault、NAV 和 timestamp；若目标方案增加 nonce/deadline，也必须展示。
- 严格按当前部署合约的签名方案请求钱包签名。
- 导出或交给 Relayer 提交。

约束：

- NAV Signer 负责签名，`updateNAV` 的链上提交由 Relayer 或任何获准提交者完成。
- Legacy 合约使用 EIP-191 personal-sign digest；若目标合约改为 EIP-712，必须以目标 ABI 和 domain 为准，禁止把两种签名方案混用。

### 5.13 Adapter Data Provider

目标动作：

- 查看指定 Adapter/deal 的当前数据。
- 构造并提交或签署 `updateDealData` 所需数据。
- 显示数据时间戳、新鲜度和来源说明。

约束：

- 数据权限按 Adapter 或 deal 限定。
- 过期、逆序或越界数据在发送前阻止。

### 5.14 PSM Authorized Signer

目标动作：

- 构造 DOCUMENT_PROOF 授权。
- 显示 Asset、接收地址、数量、文档哈希、nonce 和 deadline。
- 严格按当前部署合约定义的字段顺序和签名方案请求钱包签名。
- 把签名交给 Relayer。

约束：

- Signer 不直接获得任意 mint 权限。
- Legacy 合约使用 EIP-191 personal-sign digest，并绑定 chainId、验证合约、Asset、数量、接收人、nonce 和 expiry；目标合约若改用 EIP-712，必须使用目标合约的真实 domain 和 type。

### 5.15 Relayer

目标动作：

- 提交已满足阈值的 Settlement batch。
- 提交已授权的 NAV update。
- 提交 `mintWithAuthorization`。
- 执行已到期的 VaultTimelock 操作。

约束：

- Relayer 是 permissionless 身份。
- 提交前验证签名、nonce、deadline、目标网络、目标合约和当前状态。
- Relayer 页面不显示其拥有业务审批权。

## 6. Capability 模型

### 6.1 状态枚举

每个动作必须解析为以下状态之一：

- `available`：当前钱包、网络、对象、合约和 SDK 均支持，可执行。
- `readOnly`：可读取但当前钱包不能写。
- `unauthorized`：合约支持，但当前钱包没有所需权限。
- `wrongNetwork`：网络不匹配。
- `walletRequired`：需要连接钱包。
- `objectRequired`：需要选择 Vault、Asset、Wrapper 或 Adapter。
- `targetOnly`：老板方案要求，但当前部署或 SDK 尚未实现。
- `paused`：模块或对象处于暂停状态。
- `invalidState`：状态机不允许当前动作。
- `unsupportedDeployment`：当前网络部署清单缺少模块或 ABI 版本不兼容。

### 6.2 双配置

`legacy` 配置：

- 对应当前私有仓库主分支。
- 从全局 `HyperAccessControl`、当前 owner、operators 和 threshold 读取能力。
- 页面显著显示“Legacy Compatible”。
- 只调用当前 SDK 中已经存在且经过参数校验的方法。

`target` 配置：

- 对应老板文档的目标合约。
- 从 Vault、Asset、Wrapper 和 Adapter 的本地存储读取能力。
- 支持 VaultTimelock、AdapterRegistry 和本地 Settlement 配置。
- 在目标 ABI 和部署地址可用后启用。

### 6.3 解析顺序

1. 校验钱包。
2. 校验 chainId。
3. 校验部署清单和合约版本。
4. 校验对象参数和对象是否存在。
5. 读取 pause 和状态机。
6. 读取对象级 owner、role、signer 或 permissionless 条件。
7. 校验 SDK 方法可用性。
8. 返回能力状态和可读原因。

## 7. SDK 适配设计

### 7.1 分层

- `wallet`：EIP-6963 provider、账户、chainId、签名和交易 provider。
- `deployments`：按 chainId 管理地址、ABI 版本和 profile。
- `sdk/current`：包装当前 `HyperTesseraSDK`。
- `sdk/target`：定义老板方案所需的方法契约。
- `capabilities`：把链上事实解析为页面动作状态。
- `actions`：把表单输入转换为 SDK 调用。
- `transactions`：统一 simulation、send、receipt 和错误解析。
- `queries`：统一只读数据、刷新和缓存。

### 7.2 页面不可直接调用合约

页面组件只能调用语义动作，例如：

- `vaultOwner.setCurator`
- `curator.setFees`
- `guardian.pauseVault`
- `settlementOperator.signBatch`
- `tokenAgent.approveMint`
- `navSigner.signNav`
- `relayer.submitSettlementBatch`

语义动作内部根据 deployment profile 选择 current 或 target adapter。这样可以避免把 ABI 差异扩散到所有组件。

### 7.3 动作注册表

每个动作注册项至少包含：

- 稳定 action id
- 角色
- 对象作用域
- 风险等级
- capability resolver
- 表单 schema
- current adapter 方法或 `null`
- target adapter 方法
- simulation 要求
- 成功后应刷新数据
- 用户可读的 unsupported 原因

### 7.4 未支持动作规则

当 current adapter 方法为 `null` 时：

- 页面保留动作说明和所需输入。
- 主按钮 disabled。
- 显示缺少的目标模块或 SDK 方法。
- 可复制目标接口名称，便于合约团队联调。
- 不生成 calldata，不请求钱包签名，不出现成功 toast。

## 8. 关键交互流程

### 8.1 进入工作台

1. 用户打开角色路由。
2. 页面读取钱包和网络。
3. 用户选择或输入作用域对象。
4. 系统读取部署 profile。
5. Capability Resolver 判断各动作状态。
6. 页面展示可操作、只读和不可用原因。

### 8.2 发送链上交易

1. 表单本地校验。
2. 重新读取关键链上状态。
3. 展示交易预览和风险说明。
4. 尽可能执行 estimate/simulation。
5. 请求钱包确认。
6. 显示交易哈希和 Pending。
7. 等待 receipt。
8. 解析事件并刷新相关 query。
9. 成功或失败均保留可复制详情。

### 8.3 离线签名

1. 根据 deployment profile 构造合约实际验证的签名 payload。
2. Legacy 模式展示 EIP-191 digest 和字段摘要；Target 模式只有在 ABI 明确时才展示 EIP-712 domain、types 和 message。
3. 校验 nonce 和 deadline。
4. 请求钱包签名。
5. 本地 recover signer。
6. 导出 JSON 或交给 Relayer 流程。
7. 签名本身不显示为链上成功。

## 9. 视觉与交互规范

本次属于现有产品的扩展，不重做营销网站：

- 保留现有 HyperTessera 品牌色、字体语气、Logo 和公开页面 URL。
- 后台采用浅色、高信息密度、低装饰的产品界面。
- 设计参数：视觉变化 3/10，动效 2/10，信息密度 7/10。
- 使用一个可访问的组件体系，不混用多套设计系统。
- 动效只用于加载、状态变化、交易进度和抽屉切换。
- 危险动作使用清晰警告和二次确认，不只依赖颜色。
- 移动端保留读取、签名和核心操作能力，复杂表格转换为分组列表或横向滚动。

建议实施时采用 Radix Themes 作为可访问基础组件，并用项目 CSS tokens 覆盖成 HyperTessera 品牌。若依赖安装受限，则使用现有 React 和原生可访问组件实现相同接口，不混入第二套视觉系统。

## 10. 错误与安全处理

必须处理：

- 未连接钱包
- 钱包切换账户
- 钱包切换网络
- 不支持的网络
- 部署地址缺失
- ABI/profile 不匹配
- 对象不存在
- 权限不足
- 模块或对象暂停
- 状态机不允许
- 数据过期
- 参数越界
- simulation/estimate 失败
- 用户拒绝签名或交易
- 交易替换、revert、超时或 RPC 不稳定
- receipt 成功但索引数据暂未更新

安全要求：

- 不在浏览器保存私钥。
- 不记录完整敏感签名到分析系统。
- 地址、整数、bytes、deadline 和 chainId 必须严格校验。
- 交易前再次读取权限和状态，不能只依赖初次页面加载。
- 高风险操作显示原始目标合约和函数摘要。
- 所有 target-only 动作 fail closed。

## 11. 测试策略

### 11.1 单元测试

- 角色动作矩阵完整性
- capability resolver
- legacy/target profile 选择
- 地址、金额、deadline、nonce 校验
- typed data 构造
- 合约错误到用户提示的映射

### 11.2 组件测试

- 每种 capability 状态的按钮和说明
- 表单错误
- 危险动作确认
- 交易抽屉状态
- 空、加载、失败和无权限状态

### 11.3 集成测试

- current adapter 对现有 SDK 的方法和参数映射
- target adapter 接口契约
- 钱包账户和网络变化
- 签名恢复
- 交易成功、revert 和用户拒绝
- target-only 动作不会调用 provider

### 11.4 浏览器测试

- `/workspaces` 到每个角色路由
- 无钱包、错误网络、正确网络
- 有权限和无权限钱包
- Vault/Asset/Adapter 切换
- 键盘导航和焦点
- 桌面与移动布局

## 12. 交付阶段

### 阶段 1：基础壳与能力模型

- 路由
- Workspace Shell
- 钱包和网络上下文
- deployment profile
- capability 状态
- transaction drawer

### 阶段 2：当前 SDK 接入

- 只读概览
- 生命周期
- NAV
- Mint/Burn
- Settlement
- Pool
- Wrapper/PSM
- 用户请求

### 阶段 3：所有目标角色页面

- 补齐每个角色的操作分组
- target-only 状态
- 目标接口说明
- 公共工作台

### 阶段 4：测试与体验完善

- 自动化测试
- 错误映射
- 响应式和无障碍
- 构建检查
- 当前部署 smoke test

### 阶段 5：目标合约联调

该阶段依赖合约团队提供：

- 新 ABI
- 部署地址和 chainId
- VaultTimelock
- AdapterRegistry
- Vault/Asset/Wrapper 本地角色读取和写入方法
- 新版 SDK 方法

收到后启用 target adapter，不重构角色页面。

## 13. 验收标准

1. 老板文档中的每个管理或功能身份都有明确工作台。
2. 公共创建者和普通用户不被错误建模为链上管理角色。
3. 当前可执行动作全部通过统一 SDK adapter 调用。
4. 页面组件中不存在散落的直接合约写调用。
5. 未实现目标动作不会请求签名或发送交易。
6. 每个禁用动作都解释缺少的合约或 SDK 能力。
7. URL 不能绕过权限。
8. Settlement Operator、NAV Signer、PSM Signer 与 Relayer 的签名/提交职责清晰分离。
9. Legacy Compatible 与 Target profile 在界面上可识别。
10. 原有公开网站路由和用户现有首页修改不受影响。
11. 构建通过，角色矩阵与关键流程测试通过。
12. 桌面、平板和移动端均可完成关键读取、签名和交易流程。

## 14. 已知注意事项

- 当前链无法实现老板文档的完整本地权限隔离，前端只能准确呈现差异，不能修复链上授权模型。
- 目标文档引用的仓库名称与当前核对的私有仓库名称不同，目标 ABI 到达时需再次按实际提交核对。
- Legacy 的 `PoRRegistry.publishReserveProof` 可用于全局 DATA_PROVIDER 兼容模式；Proof Publisher 的 Asset 本地化授权和最终目标接口仍需按目标 ABI 接入，不自行创造函数。
- 历史和待办数据若缺少 Indexer，只能使用有限事件扫描和本会话记录，并在页面说明数据范围。
- 新增 UI 或链交互依赖前需检查现有 React 19/Vite 版本兼容性。
- 任何目标合约升级都需要重新验证签名 scheme、字段编码顺序、domain separator（如使用 EIP-712）、nonce、deadline 和跨链防重放。
