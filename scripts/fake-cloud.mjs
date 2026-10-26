/**
 * 假的 wx-server-sdk（仅供命令行测试用，不参与小程序运行）
 *
 * 目的：不连真云开发，也能把 cloudfunctions/api/index.js 完整跑一遍。
 * 支持我们用到的那些 API：where/limit/get/count/add/doc/update/remove，
 * 以及 command 的 gte/lte/and/inc/push。
 */

class Query {
  constructor(db, name, where) {
    this.db = db
    this.name = name
    this.where = where || {}
    this._limit = 100
  }

  limit(n) {
    this._limit = n
    return this
  }

  get() {
    const docs = this.db._read(this.name)
    const hit = docs.filter((d) => this.db._match(d, this.where)).slice(0, this._limit)
    return Promise.resolve({ data: hit.map((d) => ({ ...d })) })
  }

  count() {
    const docs = this.db._read(this.name)
    const total = docs.filter((d) => this.db._match(d, this.where)).length
    return Promise.resolve({ total })
  }
}

class DocRef {
  constructor(db, name, id) {
    this.db = db
    this.name = name
    this.id = id
  }

  get() {
    const doc = this.db._read(this.name).find((d) => d._id === this.id)
    if (!doc) return Promise.reject(new Error('[fake] document not exist'))
    return Promise.resolve({ data: { ...doc } })
  }

  update({ data }) {
    const docs = this.db._read(this.name)
    const doc = docs.find((d) => d._id === this.id)
    if (!doc) return Promise.reject(new Error('[fake] document not exist'))
    for (const key of Object.keys(data)) {
      const v = data[key]
      if (v && v.__op === 'inc') doc[key] = (doc[key] || 0) + v.v
      else if (v && v.__op === 'push') doc[key] = (doc[key] || []).concat(v.v)
      else doc[key] = v
    }
    return Promise.resolve({ stats: { updated: 1 } })
  }

  // 云开发的 doc(id).set 是"不存在就创建"，钱包用 _id = openid 靠它
  set({ data }) {
    const docs = this.db._read(this.name)
    const i = docs.findIndex((d) => d._id === this.id)
    const doc = Object.assign({}, data, { _id: this.id })
    if (i >= 0) docs[i] = doc
    else docs.push(doc)
    return Promise.resolve({ stats: { updated: 1 } })
  }

  remove() {
    const docs = this.db._read(this.name)
    const i = docs.findIndex((d) => d._id === this.id)
    if (i >= 0) docs.splice(i, 1)
    return Promise.resolve({ stats: { removed: i >= 0 ? 1 : 0 } })
  }
}

function cmd(op, v) {
  return {
    __op: op,
    v,
    and(other) {
      return { __op: 'and', ops: [this, other] }
    }
  }
}

export function createFakeCloud() {
  const store = Object.create(null)
  const missing = new Set()
  let seq = 0

  const db = {
    _read(name) {
      if (missing.has(name)) {
        const err = new Error(
          'errCode: -502005 database collection not exists | errMsg: [ResourceNotFound] Db or Table not exist: ' + name
        )
        throw err
      }
      if (!store[name]) store[name] = []
      return store[name]
    },

    _match(doc, where) {
      const one = (val, cond) => {
        if (cond && cond.__op === 'and') return cond.ops.every((c) => one(val, c))
        if (cond && cond.__op === 'gte') return val >= cond.v
        if (cond && cond.__op === 'lte') return val <= cond.v
        return val === cond
      }
      return Object.keys(where || {}).every((k) => one(doc[k], where[k]))
    },

    collection(name) {
      return {
        where: (q) => new Query(db, name, q),
        limit: (n) => new Query(db, name, {}).limit(n),
        add: ({ data }) => {
          const docs = db._read(name)
          const doc = { ...data, _id: 'doc_' + ++seq }
          docs.push(doc)
          return Promise.resolve({ _id: doc._id })
        },
        doc: (id) => new DocRef(db, name, id),
        count: () => new Query(db, name, {}).count(),
        get: () => new Query(db, name, {}).get()
      }
    },

    command: {
      gte: (v) => cmd('gte', v),
      lte: (v) => cmd('lte', v),
      inc: (v) => cmd('inc', v),
      push: (v) => cmd('push', v)
    }
  }

  const state = {
    openid: 'openid_A',
    setOpenid(v) {
      state.openid = v
    },
    drop(name) {
      missing.add(name)
    },
    restore(name) {
      missing.delete(name)
    },
    all(name) {
      return (store[name] || []).slice()
    },
    reset() {
      Object.keys(store).forEach((k) => delete store[k])
      missing.clear()
    }
  }

  const sdk = {
    DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
    init() {},
    database() {
      return db
    },
    getWXContext() {
      return { OPENID: state.openid, APPID: 'wxtest', UNIONID: '' }
    }
  }

  return { sdk, db, state }
}
