/**
 * 前端模块注册表
 *
 * 加一个新功能 = 新建一个页面目录 + 在这里加一行。
 * 首页只会照着这个表渲染宫格，不认识任何具体功能。
 *
 * enabled: false = 占坑未实现（显示成灰卡「待上线」，点了不跳转）
 */
module.exports = [
  {
    key: 'checkin',
    name: '早睡早起',
    emoji: '🌙',
    desc: '一起睡个好觉',
    color: 'pink',
    page: '/pages/m/checkin/index',
    order: 1,
    enabled: true
  },
  {
    key: 'consumption',
    name: '消费申请',
    emoji: '🧾',
    desc: '花之前先报备',
    color: 'blue',
    page: '/pages/m/consumption/index',
    order: 2,
    enabled: false
  },
  {
    key: 'meal',
    name: '吃饭点餐',
    emoji: '🍚',
    desc: '今天吃点什么',
    color: 'orange',
    page: '/pages/m/meal/index',
    order: 3,
    enabled: false
  }
]
