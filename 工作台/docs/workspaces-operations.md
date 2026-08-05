# HyperTessera Workspaces 运维手册

## 入口与支持范围

从站点导航进入 `/workspaces`。入口页只选择对象与角色，不会请求签名或发送交易。当前清单只支持 BNB Smart Chain Testnet：

| 项目 | 当前值 |
| --- | --- |
| Chain ID | `97` |
| 网络 | BNB Smart Chain Testnet |
| 浏览器 | `https://testnet.bscscan.com` |
| Profile | `legacy`，界面显示 `Legacy Compatible` |
| 上游来源提交 | `7a49a6f5668e2ea9e76938a20535eabb6b99e552` |

`Legacy Compatible` 表示动作有经审阅的当前 SDK/ABI 映射，并且仍会在执行前检查钱包、网络、对象、暂停状态、业务状态、权限和 adapter 支持。`Target` 表示目标产品需要的方法或模块尚未在当前部署中得到经审阅的安全映射；这类按钮故意禁用，不会猜 ABI、地址或函数参数。

## 钱包、网络与对象

1. 使用站点或 Context Bar 的连接按钮连接 EIP-1193 钱包。
2. 切换到 Chain ID 97。错误网络下不创建 SDK，也不请求写入。
3. 在入口页选择 Vault、Asset 或 Adapter，填写有效地址或正整数 Asset ID，然后打开角色页。
4. 执行前再次核对 Context Bar 中的钱包、网络、部署 profile 和选中对象。
5. 仅当能力状态为可用时执行。断开钱包、错误网络、权限不足、对象缺失、暂停、状态不匹配、部署不支持和 Target-only 都会 fail closed。

不要把私钥、助记词、keystore 密码或硬件钱包恢复信息粘贴到前端、签名导入框、浏览器控制台或工单。前端只通过已连接钱包请求签名；任何要求粘贴私钥的流程都应立即终止。

## 角色与公共功能边界

管理角色严格是以下 15 个：

1. Governor
2. Vault Owner
3. Curator
4. Guardian
5. Allocator
6. Settlement Operator
7. Keeper
8. Asset Owner / Issuer
9. Token Agent
10. Proof Publisher
11. Wrapper Controller
12. NAV Signer
13. Adapter Data Provider
14. PSM Authorized Signer
15. Relayer

`/workspaces/public` 单独承载 Asset Creator、Vault Creator、Wrapper Creator 和普通用户的 deposit、redeem、cancel、refund、wrap、unwrap 操作；它们不是管理角色，也不能作为角色授权来源。

当前限制：

- Vault Creator 保持 Target-only，因为当前 SDK 没有经审阅的显式 permissionless factory 映射。
- Wrapper Creator 保持 Target-only，因为 legacy `deployWrappedToken` 路径要求 Governor；前端不会把它伪装成 permissionless。
- Legacy PSM 签名与提交保持禁用，因为部署合约的签名 digest 没有认证 `documentId`。在目标合约/ABI 修复前，不得绕过此限制。

## 交易与恢复

交易活动使用 `prepared → awaitingWallet → submitted → confirmed` 状态；钱包拒绝显示 `rejected`，其他安全失败显示 `failed`。Activity 数据只用于当前浏览器 session 的操作摘要，不是链上最终事实。

- `awaitingWallet`：查看钱包弹窗；如用户拒绝，应重新核对对象和参数后主动重试，不把它记为已提交。
- `submitted`：使用 Activity 中由部署清单派生的 explorer 链接核对哈希。不要因页面刷新而重复提交同一业务动作。
- 长时间未确认：先在 BscScan 核对哈希、发送账户和 nonce，再决定是否由钱包执行加速或取消；前端不自动替换交易。
- `Unauthorized`：确认当前账户是该 legacy 全局角色、Vault/Asset 所有者或 Settlement Operator。切换账户后页面会重新读取权限，不能沿用旧账户结果。
- `Wrong network` / `Unsupported deployment`：切回 Chain 97，并核对部署清单和钱包 RPC；不要手动输入任意合约地址绕过清单。
- `Invalid state` / `Paused`：根据链上生命周期、周期、暂停位和时间前置条件处理；Keeper 的时间与其他前置条件最终由链上执行验证。
- `Target-only`：这是部署能力边界，不是钱包故障。等待目标 ABI、SDK 和地址经过审阅后再启用。

## 签名工作区到 Relayer

NAV Signer 或 Settlement Operator 在各自工作区签名后，必须显式点击导出，再由操作者把完整 v2 envelope 交给 Relayer 的导入框并点击验证。前端不会自动跨角色传递签名，也不会自动提交。

Relayer 在启用提交前会重新校验 envelope 版本、kind、Chain ID、验证合约、对象 scope、字段集合、digest、签名恢复地址、live authorization、expiry 和 replay 状态。NAV v2 还包含 attestation，防止只验证业务签名而忽略导出 envelope。验证失败时不要手改 JSON 或签名；回到签名工作区，重新读取链上状态并生成新 payload。

Legacy PSM envelope 无论是否修改 `documentId` 都应被拒绝，因为现有 onchain digest 没有覆盖该字段。只有新的、明确认证 `documentId` 的目标合约和 ABI 才能解除禁用。

## 更新部署地址与上游 provenance

升级必须把地址、ABI、SDK、类型和来源提交当作一个原子变更审阅：

1. 在 `src/workspaces/config/deployments.js` 更新 chainName、explorerUrl、profile、`sourceCommit` 和经链上核验的地址。页面不得硬编码第二份地址。
2. 从 `alliancechuan/hyperTessera` 的一个精确提交同步 `offchain/src/sdk.ts`、`offchain/src/types.ts` 和 `control-panel/abis.json` 到 `src/integrations/hypertessera/upstream/`。
3. 同步更新 `src/integrations/hypertessera/upstream-meta.json` 的 repository、commit 和 source paths。`abis.ts` 只保留已记录的浏览器 JSON import 适配，不悄悄改写上游语义。
4. 对照实际部署 bytecode/verified source 复核每个 ABI 名称、参数顺序、权限语义和地址绑定；在 `currentAdapter` 或目标 adapter 中显式声明 `supports` 与 `execute`，不得在页面创建任意 Contract 逃生口。
5. 对任何签名变更重新复核 Chain ID、verifying contract、scope、字段完整性、decimal 来源、expiry、nonce/replay、live authorization、EIP-191/EIP-712 domain 与 v2 attestation。不得混用 legacy 与 target digest。
6. 先运行 ABI、SDK、adapter、签名交换和集成测试，再运行完整验证命令。目标方法只有在 ABI、地址、权限和签名域全部明确后才能从 Target-only 改为可用。

## 验证命令

在项目目录运行：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run verify
```

机械检查：

```powershell
rg -n "governor|vault-owner|curator|guardian|allocator|settlement-operator|keeper|asset-owner|token-agent|proof-publisher|wrapper-controller|nav-signer|adapter-data-provider|psm-authorized-signer|relayer" src/workspaces/config/roleDefinitions.js
rg -n "targetOnly|supports\(|execute\(" src/workspaces
git diff --check
```

## 已知问题

工作台自己的移动抽屉会在关闭时设置 `inert`/`aria-hidden`，打开后聚焦关闭按钮，Escape 返回触发器。保留的全站营销 Header 另有一个既有可访问性问题：在移动宽度关闭营销菜单后，其抽屉内仍有 5 个不可见控件留在 Tab 顺序。它不会阻止到达工作台控件，但键盘焦点会短暂经过不可见项；修复该全站 Header 应作为独立任务处理，避免在部署工作台改动中改变营销页面行为。
