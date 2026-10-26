/**
 * 打卡模块 · 数据访问
 *
 * 只操作 checkins 这一个集合（在 index.js 的 collections 里声明过）。
 * 集合访问一律走 ctx.db，内核会拦住越权访问。
 */
const { _, COL } = require('../../core/db.js')
const clock = require('../../core/clock.js')

const COLL = COL.checkins

/** 某天我的打卡记录 -> { sleep: { at }, wake: { at } } */
async function getRecords(ctx, dateKey) {
  const res = await ctx.db.collection(COLL).where({ openid: ctx.openid, date: dateKey }).get()
  const records = {}
  res.data.forEach(function (d) {
    records[d.type] = { at: d.at }
  })
  return records
}

/** 某天我某个类型打过没 */
async function countType(ctx, openid, dateKey, type) {
  const res = await ctx.db.collection(COLL).where({ openid: openid, date: dateKey, type: type }).count()
  return res.total
}

async function add(ctx, dateKey, type) {
  return ctx.db.collection(COLL).add({
    data: {
      openid: ctx.openid,
      coupleId: ctx.coupleId,
      date: dateKey,
      type: type,
      at: ctx.now,
      source: 'normal'
    }
  })
}

/** 往回 N 天里，"两项都完成"的日期列表（用来算连续天数） */
async function getFullDayKeys(ctx, todayKey, lookbackDays) {
  const start = clock.shiftKey(todayKey, -(lookbackDays - 1))
  const res = await ctx.db
    .collection(COLL)
    .where({ openid: ctx.openid, date: _.gte(start).and(_.lte(todayKey)) })
    .limit(500)
    .get()

  const map = {}
  res.data.forEach(function (d) {
    if (!map[d.date]) map[d.date] = {}
    map[d.date][d.type] = true
  })

  return Object.keys(map).filter(function (k) {
    return map[k].sleep && map[k].wake
  })
}

/** 某个月的打卡 -> { '2026-10-26': { sleep: true, wake: true } } */
async function getMonth(ctx, month) {
  const res = await ctx.db
    .collection(COLL)
    .where({ openid: ctx.openid, date: _.gte(month + '-01').and(_.lte(month + '-31')) })
    .limit(500)
    .get()

  const days = {}
  res.data.forEach(function (d) {
    if (!days[d.date]) days[d.date] = { sleep: false, wake: false }
    days[d.date][d.type] = true
  })
  return days
}

module.exports = {
  getRecords: getRecords,
  countType: countType,
  add: add,
  getFullDayKeys: getFullDayKeys,
  getMonth: getMonth
}
