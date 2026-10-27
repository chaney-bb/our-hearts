# AGENTS.md

> 给所有 AI / 自动化 agent 的项目入口说明。
> **完整交接文档在 [`module-dev/项目交接.md`](module-dev/项目交接.md)，开工前请先读它。**

---

## 这是什么项目

「我们的小心动」——只给两个人用的微信小程序：早睡早起打卡 → 得爱心 → 爱心换礼物。
技术栈：微信小程序原生（WXML/WXSS/JS）+ 微信云开发（单云函数 + 云数据库 + 定时触发器）。
不是社交产品，不做多用户/多租户/微服务。

---

## 开工前 60 秒

```powershell
# 1. 跑基线，必须全绿
node scripts/smoke-test.mjs     # 53 条
node scripts/cloud-test.mjs     # 88 条（合计 141）

# 2. 读交接 + 待办
#    module-dev/项目交接.md
#    module-dev/项目待办.md

# 3. 只做一个任务编号
```

---

## 硬约束（违反 = 回滚）

1. **模块只通过 `ctx` 用内核**，不 `require` 另一个模块。
2. **每个模块只读写自己声明的集合**（`collections`），`ctx.db` 会拦越权。
3. **爱心只能走 `ctx.award` / `ctx.penalize`**；不要直接改 `core_wallets`，不要删 `heart_logs`。
4. **规则只改 `shared/`**，然后 `node scripts/sync-rules.mjs`；不要手改生成物：
   - `miniprogram/utils/rules.js`
   - `miniprogram/utils/clock.js`
   - `cloudfunctions/api/core/clock.js`
   - `cloudfunctions/api/modules/checkin/rules.js`
5. **判定用服务器时间 `ctx.now`**；日期用 `ctx.dateKey` / 打卡日 `dayKey`。
6. **写操作必须有防重**：业务唯一记录或 `idemKey`。
7. **加功能 = 新目录 + 注册表 1 行**；改了已有模块就是架构失败。
8. **一次只做一件事**，不顺手重构。
9. **先部署云函数，再编译小程序**。
10. **不要提交密钥/手机号/真实姓名到公开仓库**；图片放 `src/images/`，文档放 `docs/`。

---

## 代码地图（最短）

| 你要改 | 去哪 |
|---|---|
| 小程序数据入口 / 云本地切换 | `miniprogram/core/api.js` |
| 首页宫格 | `miniprogram/core/modules.js` |
| 打卡页 | `miniprogram/pages/m/checkin/index.*` |
| 打卡规则默认值 | `shared/checkin-rules.js` |
| 时间工具 | `shared/clock.js` |
| 云函数路由 | `cloudfunctions/api/index.js` |
| 内核 | `cloudfunctions/api/core/` |
| 打卡模块 | `cloudfunctions/api/modules/checkin/` |
| 加模块注册 | `core/registry.js` + `miniprogram/core/modules.js` |
| 定时触发器 | `cloudfunctions/api/config.json` |

详细逐文件说明：`docs/代码详解.md`。
架构与拓展：`docs/系统架构.md`。
上线/迁移：`docs/部署上线与迁移方案.md`。

---

## 当前状态（2026-10-27）

- 体验版可用，二维码 2026-11-02 到期。
- 正式版未上线（缺：删占位、演示模式、隐私指引、备案）。
- 未做：消费申请、吃饭点餐、礼物商城、订阅消息、App。
- 测试 141 条全绿。
- 已知技术债：[`module-dev/项目交接.md`](module-dev/项目交接.md) 第八节（T33–T76，共 15 项）。

---

## 完成定义（DoD）

- 只改了该改的模块；
- 两套测试全绿（新增功能有新增断言）；
- 真机点过一遍；
- 改了云函数 → 已部署；改了界面 → 已编译；
- 没有改生成物、没有跨模块 require、没有绕过账本；
- 更新了模块文档 + `module-dev/项目交接.md` 的「当前状态」；
- commit 信息带任务编号。

---

## 文档优先级

1. **代码 + 测试** = 事实
2. `module-dev/项目交接.md` = 当前状态与坑
3. `docs/系统架构.md` / `docs/代码详解.md` / `docs/部署上线与迁移方案.md` = 当前解释
4. 更早的设计讨论已从工作区删除，需要时查 git 历史（最后一次完整提交 `4b513cb`）

发现文档与代码不一致：以代码为准，记到 `项目交接.md` 第七、八节，并决定改哪边。
