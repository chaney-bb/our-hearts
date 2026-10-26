# 吃饭点餐 · 页面占坑

> 状态：**未实现**（`core/modules.js` 里 `enabled: false`，首页不会显示）。

实现时在这里建四个文件：

```
pages/m/meal/
├─ index.js     菜品池 / 今日投票 / 结果
├─ index.json   { "navigationBarTitleText": "今天吃什么" }
├─ index.wxml
└─ index.wxss
```

页面只调 `modules/meal/api.js`，不直接写 action 字符串。

云函数那边的模块说明见 `cloudfunctions/api/modules/meal/README.md`。
