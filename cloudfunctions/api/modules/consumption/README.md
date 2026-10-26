# 消费申请模块（占坑）

> 状态：**只有目录，还没实现**。等打卡模块跑顺、架构验收（P4）通过后再开工。

## 它是干什么的

两个人花较大一笔钱之前，先在小程序里"报备"一下，对方批了才算数。
本质是一个**双人审批流**，和打卡那种"单人每日动作"完全不同 —— 正好用来验证架构撑不撑得住另一种形态。

## 计划中的形状

```
cloudfunctions/api/modules/consumption/
├─ index.js        契约：summary / detail / act / history
├─ store.js        只碰 m_consumption_requests
└─ rules.js        审批规则（金额门槛、是否需要对方确认、超时自动通过？）

miniprogram/pages/m/consumption/index.*   申请列表 + 新建申请 + 审批
```

## 数据（计划）

```
m_consumption_requests
  openid(申请人), coupleId, amount, purpose, category,
  status: 'pending' | 'approved' | 'rejected' | 'cancelled',
  reviewerOpenid, reviewedAt, createdAt
```

## 与内核的关系（提前想清楚，避免到时候乱塞）

- 需要 `ctx.me` / `ctx.partner` —— 审批要知道"对方是谁"
- 需要 `ctx.dateKey` —— 按月统计花了多少
- **不需要**动 `ledger`：消费申请用的是真钱，不是爱心。爱心是打卡/学习这类"努力"的奖励，
  两者不要混在一起（这也是为什么这个模块能反过来检验内核边界划得对不对）
- 可能需要**通知**：申请提交后提醒对方审批 → 用 `notify.send()`，等内核长出通知服务

## 开工前要回答的问题

1. 申请要不要设金额门槛（比如 50 元以下不用报备）？
2. 对方不处理会怎样：一直挂着 / 48 小时后自动通过 / 自动拒绝？
3. 审批后要记账吗（本月花了多少、超预算提醒）？
4. 能不能修改已提交的申请？（建议不能，撤回重提）
