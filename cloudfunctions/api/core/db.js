/**
 * 内核 · 数据库入口
 *
 * 全项目只有这里初始化 wx-server-sdk，也只在这里定义集合名。
 * 集合命名规则：内核用核心名，模块用 m_<模块key>_<实体>
 *   （当前打卡模块沿用老名字 checkins，不为了整齐而搬数据）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COL = {
  profiles: 'profiles', // 内核：用户登记信息
  couples: 'couples', // 内核：情侣关系 +（暂时）共享爱心余额
  hearts: 'heart_logs', // 内核：爱心流水
  settings: 'core_settings', // 内核：各模块的规则覆盖（P3 才用）
  checkins: 'checkins' // 打卡模块：打卡记录（模块自己声明）
}

module.exports = { cloud, db, _, COL }
