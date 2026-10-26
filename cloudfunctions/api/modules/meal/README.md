# 吃饭点餐模块（占坑）

> 状态：**只有目录，还没实现**。第三批做。

## 它是干什么的

"今天吃什么"这个人类终极难题：两边各点想吃的，系统撮合出一个结果。
本质是一个**双人协商 + 随机/投票**的玩法，带菜单数据。

## 计划中的形状

```
cloudfunctions/api/modules/meal/
├─ index.js        契约：summary / detail / act
├─ store.js        只碰 m_meal_dishes、m_meal_rounds
└─ rules.js        撮合规则（投票 / 轮盘 / 记录谁赢了）

miniprogram/pages/m/meal/index.*   菜品池 + 今日投票 + 结果
```

## 数据（计划）

```
m_meal_dishes    openid, coupleId, name, emoji, tags[], weight, active
m_meal_rounds    coupleId, dateKey, votes: [{openid, dishId}],
                 resultDishId, status: 'voting' | 'decided', decidedAt
```

## 与内核的关系

- 需要 `ctx.dateKey` —— 每天一轮
- 需要 `ctx.partner` —— 投票要等对方
- **不需要** `ledger`（吃什么是快乐，不该有奖惩）；如果以后想"吃了三天外卖扣爱心"，那是事后加一个
  `ctx.penalize`，同样不改内核
- 可能需要**通知**：对方投完票了叫他来看结果

## 开工前要回答的问题

1. 撮合方式：各点一个然后随机二选一？还是多选投票？还是"冰箱有什么"？
2. 要不要收藏/历史（"上周吃过了，换一个"）？
3. 菜品池是两人共用的，还是各自维护自己的？
4. 要不要接外卖平台？（**不要**，这是另一个量级的事）
