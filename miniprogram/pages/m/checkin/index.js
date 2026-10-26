var checkinApi = require('../../../modules/checkin/api.js')
var rules = require('../../../utils/rules.js')

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

// 每天的标记等级：0 没打卡 / 1 只打了半套 / 2 打满但有一项 0 分 / 3 打满且都得分
function levelOf(slot) {
  if (!slot) return 0
  const has = (v) => v !== null && v !== undefined
  const done = (has(slot.sleep) ? 1 : 0) + (has(slot.wake) ? 1 : 0)
  if (!done) return 0
  if (done < 2) return 1
  return (slot.sleep || 0) + (slot.wake || 0) > 0 ? 3 : 2
}

Page({
  data: {
    ready: false,
    streak: 0,
    dayLabel: '',
    monthLabel: '',
    monthText: '',
    monthReached: false,
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    cells: [],
    misses: [],
    showMenu: false,
    items: [],
    clock: '',
    float: '',
    floatSub: '',
    error: '',
    errorRaw: ''
  },

  onShow: function () {
    this.load()
  },

  onHide: function () {
    this.stopTick()
  },

  onUnload: function () {
    this.stopTick()
  },

  onPullDownRefresh: function () {
    var self = this
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  load: function () {
    var self = this
    return checkinApi.detail().then(function (d) {
      if (!d || !d.ok) {
        self.setData({
          ready: false,
          error: (d && d.message) || '加载失败',
          errorRaw: (d && (d.detail || d.raw)) || ''
        })
        return
      }

      self.offset = (d.serverNow || Date.now()) - Date.now()
      self.detail = d
      self.cfg = d.config || rules.DEFAULTS

      var month = (d.calendar && d.calendar.month) || (d.today.date || '').slice(0, 7)
      var cells = self.buildCells(month, (d.calendar && d.calendar.days) || {}, d.today.date)

      self.setData({
        ready: true,
        streak: d.streak,
        dayLabel: d.today.date,
        monthLabel: month.replace('-', ' 年 ') + ' 月',
        monthText: d.month ? d.month.fullCount + ' / ' + d.month.requiredDays : '',
        monthReached: !!(d.month && d.month.reached),
        misses: d.misses || [],
        cells: cells,
        error: '',
        errorRaw: ''
      })
      self.render()
      self.startTick()
    })
  },

  buildCells: function (month, days, todayKey) {
    var arr = String(month).split('-')
    var y = Number(arr[0])
    var m = Number(arr[1])
    var total = new Date(Date.UTC(y, m, 0)).getUTCDate()
    var firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
    var lead = (firstDow + 6) % 7
    var cells = []
    var i, d, key, row

    for (i = 0; i < lead; i++) cells.push({ blank: true, id: 'lead-' + i })

    for (d = 1; d <= total; d++) {
      key = y + '-' + pad2(m) + '-' + pad2(d)
      row = days[key] || null
      cells.push({
        blank: false,
        id: key,
        day: d,
        meLevel: row ? levelOf(row.me) : 0,
        taLevel: row ? levelOf(row.partner) : 0,
        isToday: key === todayKey
      })
    }

    while (cells.length % 7 !== 0) cells.push({ blank: true, id: 'tail-' + cells.length })
    return cells
  },

  render: function () {
    var d = this.detail
    if (!d) return

    var now = Date.now() + (this.offset || 0)
    var cfg = this.cfg || rules.DEFAULTS
    var today = rules.describeToday(d.today.records, now, cfg)

    this.setData({
      items: today.items,
      clock: rules.timeKey(now)
    })
  },

  startTick: function () {
    this.stopTick()
    var self = this
    this.timer = setInterval(function () {
      self.render()
    }, 1000)
  },

  stopTick: function () {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  onCheckin: function (e) {
    var self = this
    var type = e.currentTarget.dataset.type
    var item = null
    for (var i = 0; i < this.data.items.length; i++) {
      if (this.data.items[i].key === type) item = this.data.items[i]
    }
    if (!item) return

    if (item.done) {
      wx.showToast({ title: '这一晚已经打过啦', icon: 'none' })
      return
    }
    if (!item.canCheck) {
      wx.showToast({
        title: item.state === 'expired' ? '这一晚的打卡已经结束了' : '还没到打卡时间',
        icon: 'none'
      })
      return
    }
    if (this.busy) return

    this.busy = true
    checkinApi.act(type).then(function (res) {
      self.busy = false
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.message) || '打卡失败', icon: 'none' })
        return
      }

      var r = res.reward || { delta: 0, reasons: [] }
      self.showFloat(r.delta, r.reasons)
      try {
        wx.vibrateShort({ type: 'light' })
      } catch (err) {}

      // 打卡会改变日历、连续天数、缺卡列表，直接重拉最稳
      self.load()
    })
  },

  showFloat: function (delta, reasons) {
    var self = this
    if (!delta) {
      if (reasons && reasons.length) {
        wx.showToast({ title: reasons[0], icon: 'none' })
      }
      return
    }
    this.setData({ float: '+' + delta, floatSub: (reasons || []).join(' · ') })
    clearTimeout(this.floatTimer)
    this.floatTimer = setTimeout(function () {
      self.setData({ float: '', floatSub: '' })
    }, 1800)
  },

  // 右上角 ⋯ 菜单（自绘，不依赖 wx.showActionSheet）
  openMenu: function () {
    this.setData({ showMenu: true })
  },

  closeMenu: function () {
    this.setData({ showMenu: false })
  },

  gotoRules: function (e) {
    var mode = e.currentTarget.dataset.mode
    var self = this
    this.setData({ showMenu: false })

    var url = '/pages/m/checkin/rules/index'
    if (mode === 'edit') url += '?mode=edit'

    wx.navigateTo({
      url: url,
      fail: function (err) {
        console.error('[打开规则页失败]', err)
        wx.showModal({
          title: '打不开规则页',
          content: '可能是小程序版本太旧，试试重启小程序；还不行就把这行发我：' + JSON.stringify(err),
          showCancel: false
        })
      }
    })
    void self
  },

  // 缺卡申诉
  onAppeal: function (e) {
    var self = this
    var dayKey = e.currentTarget.dataset.day
    var type = e.currentTarget.dataset.type

    wx.showModal({
      title: '说明一下',
      editable: true,
      placeholderText: '比如：那天加班到两点',
      success: function (res) {
        if (!res.confirm) return
        var reason = String(res.content || '').trim()
        if (reason.length < 2) {
          wx.showToast({ title: '写一句说明吧', icon: 'none' })
          return
        }
        checkinApi.appeal(dayKey, type, reason).then(function (r) {
          if (!r || !r.ok) {
            wx.showToast({ title: (r && r.message) || '提交失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '已发给 TA，等 TA 处理', icon: 'none' })
          self.load()
        })
      }
    })
  },

  retry: function () {
    this.setData({ ready: false, error: '', errorRaw: '' })
    this.load()
  }
})
