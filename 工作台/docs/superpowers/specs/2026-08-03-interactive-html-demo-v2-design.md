# HyperTessera 交互式 HTML Demo V2 设计方案

**日期：** 2026-08-03  
**状态：** 已由用户确认  
**交付位置：** `demo/hypertessera-interactive-demo-v2.html`

## 目标

在不修改现有 React 项目的前提下，新增一个可直接打开、可完整点击演示的单文件 HTML。它需要让非技术观众清楚理解 HyperTessera 的公开产品浏览、Web3 钱包权限工作台，以及独立账号密码制 Vault 上架审核后台。

## 核心边界

1. 这是前端 Mock Demo，不连接真实钱包、合约、SDK、后端或数据库。
2. Web3 用户先选网络，再连接模拟钱包；钱包权限随网络和预设账户变化。
3. 左侧只显示当前账户在当前网络拥有的角色，并按资产发行与资产管理分组。
4. Vault 上架审核不属于任何链上角色，不出现 Governor、Connect Wallet、Gas 或签名语义。
5. 审核结果只影响 Demo Products 页面是否展示 Vault，不写入链上。
6. 使用 `localStorage` 保存页面、钱包、审核和上架状态，并提供重置入口。
7. 使用 Hash Router，使刷新后可恢复当前场景。

## 视觉与交互方向

延续上一版浅色蓝灰金融控制台风格，提升为完整产品壳：固定顶栏、场景级导航、上下文状态栏、左侧角色导航和右侧内容工作台。强调可读性、状态语义与演示节奏，不使用夸张渐变或装饰动画。

桌面采用 1360px 内容宽度和 260px 侧栏；平板收窄侧栏；手机端侧栏改为横向可滚动角色列表。主要圆角为 14px，强调色为深蓝，成功、警告和危险状态各自使用稳定语义色。

## 页面范围

- 首页 / 演示入口
- Products Vault 列表
- Vault 产品详情
- My Access 权限总览
- 资产发行中心
- Vault 管理中心
- 统一角色工作台，可切换全部已定义角色
- Vault 上架申请
- Ops 账号密码登录
- Ops Dashboard
- 审核队列
- 审核详情
- 已上架 Vault
- 审核历史

## 角色范围

协议级：Governor。  
Vault 级：Vault Owner、Curator、Guardian、Allocator、Settlement Operator、Keeper。  
资产与功能身份：Asset Owner、Token Agent、Proof Publisher、Wrapper Controller、NAV Signer、Adapter Data Provider、PSM Authorized Signer、Relayer。

这些角色都可以在同一个可复用工作台中演示，但页面只展示当前模拟钱包拥有的角色。

## 关键流程

### Web3 用户流程

首页 -> 选择网络 -> 连接预设钱包 -> My Access -> 选择资产发行或资产管理 -> 选择对象和角色 -> 执行模拟操作 -> 查看 Activity。

### Vault 上架流程

Vault Owner 工作台 -> 填写上架申请 -> 提交 -> Ops 账号密码登录 -> 打开审核详情 -> 要求补充、驳回或通过并上架 -> Products 页面同步变化。

### Ops 演示凭据

- 账号：`reviewer@hypertessera.demo`
- 密码：`Demo2026!`

页面必须显著标注这是演示凭据，不是真实认证。

## 数据与状态

使用 `hypertessera_interactive_demo_v2` 作为 `localStorage` Key。状态包含当前路由、网络、模拟钱包、角色集合、交易活动、Vault 列表、上架申请、审核会话和审核历史。所有写操作先显示确认界面或提交状态，再写入 Mock 状态。

## 验收标准

1. 单文件 HTML 双击或静态服务器打开均可使用。
2. 中文无乱码，页面在 1440px 和 390px 宽度下可用。
3. 网络、钱包、业务域、对象和角色切换会更新页面内容。
4. 至少三种预设钱包能演示无角色、单角色和多角色状态。
5. Ops 未登录不能访问审核后台。
6. 错误凭据显示行内错误，正确凭据进入后台。
7. 审核通过后对应 Vault 出现在 Products；暂停或下架后不再展示。
8. 刷新页面后状态和路由可恢复。
9. 重置 Demo 能恢复初始数据。
10. 浏览器控制台无错误，主要交互均经过实际点击验证。
