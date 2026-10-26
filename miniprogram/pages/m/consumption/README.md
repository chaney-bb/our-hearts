# 消费申请 · 页面占坑

> 状态：**未实现**（`core/modules.js` 里 `enabled: false`，首页不会显示）。

实现时在这里建四个文件：

```
pages/m/consumption/
├─ index.js     加载列表 / 新建申请 / 审批
├─ index.json   { "navigationBarTitleText": "消费申请" }
├─ index.wxml   申请列表 + 待我审批
└─ index.wxss
```

页面只调 `modules/consumption/api.js`，**不直接写 action 字符串**（照抄 `modules/checkin/api.js` 的形状）。

云函数那边的模块说明见 `cloudfunctions/api/modules/consumption/README.md`。
