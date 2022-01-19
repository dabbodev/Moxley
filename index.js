var fs = require('fs');
const {parse, stringify} = require('flatted');

class DB {
    constructor(loc) {
        this._loc = loc
        this._children = []
        this._id = "0"
        this._root = this
        this._name = "root"
        this._keys = []
        this._bindings = []
        this._scanLocation(loc)
    }

    _findCollection(id) {
        var sep = id.lastIndexOf('/')
        var name = id.substring(sep + 1)
        id = id.substring(0, sep)
        return this._getById(id)[name]
    }

    _bind(col) {
        this._bindings.push(col._id)
    }

    _unbind(col) {
        var i = this._bindings.indexOf(col._id)
        if (i >= 0) {
            this._bindings.splice(i, 1)
        }
    }

    async _scanLocation(loc) {
        if (!fs.existsSync(loc)){
            fs.mkdirSync(loc)
            this._saveState()
        } 
    }

    _saveState() {
        var state = {
            _loc: this._loc,
            _id: this._id,
            _name: this._name,
            _keys: this._keys,
            _bindings: this._bindings
        }
        var filename = this._loc + "_state.ms"
        fs.writeFileSync(filename, stringify(state))
    }

    async _loadState(loc) {
        var filename = loc + "_state.ms"
        if (fs.existsSync(filename)) {
            return await parse(fs.readFileSync(filename))
        }
    }

    async _loadFromDir(loc = this._loc) {
        var statecheck = loc + '_state.ms'
        if (fs.existsSync(statecheck)) {
            var savedstate = await this._loadState(this._loc)
            this._keys = savedstate._keys
            this._bindings = savedstate._bindings
            var entries = fs.readdirSync(loc)
            
            for (var a = 0; a < entries.length; a++) {
                var entry = entries[a]
                var d = entry.indexOf('.')
                if (d == -1) {
                    var next = this._loc + '/' + entry + '/'
                    statecheck = next + '_state.ms'
                    if (fs.existsSync(statecheck)) {
                        var childstate = await this._loadState(next)
                        var i = this._children.push(new WillSmith({}, this, childstate._name).dn) - 1
                        await this._children[i]._loadFromDir()
                    } else {
                        this[entry] = new Tupac(this, entry).dc
                    }
                } 
            }
        }
        return this
    }

    _updateBindings(item) {
        this._bindings.map((b) => { this._root._findCollection(b)._add(item) })
    }

    _create(n) {
        var i = this._children.push(new WillSmith({}, this, n).dn) - 1
        this._updateBindings(this._children[i])
        this._saveState()
        return this._children[i]
    }

    _createCollection(n, o=undefined) {
        this[n] = new Tupac(this, n, o).dc
        this._saveState()
        return this[n]
    }

    _store(o, n=undefined) {
        if (typeof(o) == "array") {
            var a = []
            for (var b = 0; b < o.length; b++) {
                a.push(this._store(o[b]))
            }
            this._saveState()
            return a
        } else {
            var i = this._children[this._children.push(new WillSmith({}, this, n).dn) - 1]
            i._set(o)
            this._updateBindings(i)
            this._saveState()
            return i
        }
    }

    _set(o, n=undefined) {
        switch(typeof(o)) {
            case "array":
                o.forEach(function (e) { this.set(e) })
            case "object":
                var k = Object.keys(o)
                for (var a = 0; a < k.length; a++) {
                    this[k[a]] = o[k[a]]
                }
                break
            default:
                if (n) {
                    this[n] = o
                } else {
                    this.data = o
                }
                break
        }
        this._saveState()
    }

    _collect(i, n, o) {
        if (!this[n]) {
            this[n] = new Tupac(this, n, o).dc
        }
        switch(typeof(i)) {
            case "array":
                i.forEach(function (e) { this._collect(e, n) })
                break
            case "string":
                this[n].push(this._root._getById(i))
                break
            default:   
                var c = this[n]
                c._add(i)
        }
    }

    _pull(i, n) {
        switch(typeof(i)) {
            case "array":
                i.forEach(function (e) { this._pull(e, n) })
                break
            case "string":
                this._pull(this._root._getById(i), n)
                break
            default:
                this[n]._pull(i)
        }
    }

    _query(f, s = undefined) {
        var r = this._children.filter(f)
        if (s) {
            r.sort(s)
        }
        return r
    }

    _getById(i) {
        var a = this._id.split("/")
        var b = i.split("/")
        var s = this
        for (var c = 0; c < b.length; c++) {
            if (a[c]) {
                if (a[c] != b[c]) {
                    if (s._children[b[c]]) {
                        s = s._children[b[c]]
                    } else {
                        return null
                    }
                }
            } else {
                if (s._children[b[c]]) {
                    s = s._children[b[c]]
                } else {
                    return null
                }
            }
        }
        return s
    }

    _link(i, n) {
        if (typeof(i) == "string") {
            i = this._root._getById(i)
        }
        if (!this[n]) {
            this[n] = i
        }
    }
}

class DN extends DB {
    constructor(o, p, n=undefined) {
        var loc = p._loc + (p._children.length) + "/"
        super(loc)
        this._parent = p
        this._root = p._root
        this._id = p._id + "/" + (p._children.length)
        
        if (typeof(o) === "object") {
            var k = Object.keys(o)
            for (var a = 0; a < k.length; a++) {
                this[k[a]] = o[k[a]]
            }
        } else {
            this.data = o
        }
        if (n) {
            this._name = n
            if (!p[n]) {
                p[n] = this
            }
        } else {
            this._name = ""
        }
    }
}

class DC {
    constructor(p, n, o={keySort: undefined, itemSort: undefined, indexBy: undefined}) {
        this._p = p
        this._root = p._root
        this._name = n
        this._loc = this._p._loc + n + '/'
        this._id = this._p._id + '/' + this._name
        this._p[n] = this
        this._keys = []
        this._items = []
        this._keySort = o.keySort
        this._itemSort = o.itemSort
        this._indexBy = o.indexBy
        if (!fs.existsSync(this._loc)){
            fs.mkdirSync(this._loc)
        } else {
            this._loadState()
        }
    }

    _queryKeys(f, s = undefined) {
        var r = this._keys.filter(f)
        if (s) {
            r.sort(s)
        }
        return r
    }

    _queryItems(f, s = undefined) {
        var r = this._items.filter(f)
        if (s) {
            r.sort(s)
        }
        return r
    }

    _add(item) {
        if (!this._indexBy) {
            var x = this._items.push(item) - 1
            this[x] = item
            this._keys.push[x]
        } else {
            var x = item[this._indexBy]
            this[x] = item
            this._keys.push[x]
        }
        if (this._keySort) {
            this._keys.sort(eval(this._keySort))
        }
        if (this._itemSort) {
            this._items.sort(eval(this._itemSort))
        }
        this._saveState()
        return true
    }

    _pull(item) {
        if (this._indexBy) {
            var x = this._keys.indexOf(item[this._indexBy])
            this._keys.splice(x, 1)
            this._items.splice(x, 1)
        }
    }

    _populate() {
        for (var a = 0; a < this._keys.length; a++) {
            var k = this._keys[a]
            var f = this._loc + k + '.ml'
            var id = String(fs.readFileSync(f))
            var item = this._p._root.getById(id)
            var x = this._items.push(item) - 1
            this[k] = this._items[x]
        }
    }

    _saveState() {
        var state = {
            _loc: this._loc,
            _name: this._name,
            _keys: this._keys,
            _indexBy: this._indexBy
        }
        if (this._keySort) { 
            state._keySort = this._keySort
        }
        if (this._itemSort) { 
            state._itemSort = this._itemSort
        }
        var filename = this._loc + "_colstate.mc"
        fs.writeFileSync(filename, stringify(state))
    }

    async _loadState() {
        var filename = this._loc + "_colstate.mc"
        if (fs.existsSync(filename)) {
            var savedstate = await parse(fs.readFileSync(filename))
            this._name = savedstate._name
            this._keys = savedstate._keys
            if (savedstate._keySort) { 
                this._keySort = savedstate._keySort
            }
            if (savedstate._itemSort) { 
                this._itemSort = savedstate._itemSort
            }
            this._indexBy = savedstate._indexBy
            
        }
    }

    
}

const handler = {
    get: function(obj, prop, arg) {
        var loc = Reflect.get(obj, "_loc")
        if (obj.constructor.name == "DC") {
            var k = Reflect.get(obj, "_keys").length
            var i = Reflect.get(obj, "_items").length
            if (k > i) {
                Reflect.get(obj, "_populate")
            }
        }
        if (Reflect.has(obj, prop)) {
            return Reflect.get(obj, prop, arg)
        } else {
            var filename = loc + prop + ".md"
            if (fs.existsSync(filename)) {
                return parse(fs.readFileSync(filename))
            }
            filename = loc + prop + ".ml"
            if (fs.existsSync(filename)) {
                return Reflect.get(obj, '_root')._getById(String(fs.readFileSync(filename)))
            } 
            filename = loc + prop + ".mf"
            if (fs.existsSync(filename)) {
                return eval(String(fs.readFileSync(filename)))
            } 
            return undefined
        }
    },
    set: function(obj, prop, arg) {
        var loc = Reflect.get(obj, "_loc")
        if (!fs.existsSync(loc)){
            fs.mkdirSync(loc)
        }
        var pass = false
        if (arg) {
            if (arg.constructor.name == "DN" || arg.constructor.name == "DC") {
                pass = true
            }
        }
        if (typeof(arg) == "function" && !Reflect.has(obj, prop)) {
            var filename = loc + prop + ".mf"
            fs.writeFileSync(filename, arg.toString())
            var k = Reflect.get(obj, "_keys")
            if (k.indexOf(prop) == -1) {
                k.push(prop)
                Reflect.set(obj, "_keys", k)
            }
            return true
        }
        if (Reflect.has(obj, prop) || pass == true) {
            if (arg) {
                if (arg.constructor.name == "DN") {
                    var filename = loc + prop + ".ml"
                    fs.writeFileSync(filename, arg._id)
                    var k = Reflect.get(obj, "_keys")
                    if (k.indexOf(prop) == -1) {
                        k.push(prop)
                        Reflect.set(obj, "_keys", k)
                    }
                    return true
                } else {
                    return Reflect.set(obj, prop, arg)
                }
            } else {       
                return Reflect.set(obj, prop)
            }
        } else {
            var filename = loc + prop + ".md"
            fs.writeFileSync(filename, stringify(arg))
            var k = Reflect.get(obj, "_keys")
            if (k.indexOf(prop) == -1) {
                k.push(prop)
                Reflect.set(obj, "_keys", k)
            }
            return true
        }
    },
    apply: function(target, that, args) {
        return Reflect.apply(target, that, args)
    },
    enumerate: function (oTarget, sKey) {
        return Reflect.enumerate(oTarget, sKey)
      },
    ownKeys: function (oTarget, sKey) {
        return Reflect.ownKeys(oTarget, sKey);
      },
      has: function (oTarget, sKey) {
        return Reflect.has(oTarget, sKey)
      },
      getOwnPropertyDescriptor: function (oTarget, sKey) {
        return Reflect.getOwnPropertyDescriptor(oTarget, sKey)
      },
}

class WillSmith {
    constructor(o, p, n=undefined) {
        let shadow = new DN(o, p, n)

        let proxy = new Proxy(shadow, handler)

        this.dn = proxy
    }
}



class Lizzo {
    constructor(loc) {
        let shadow = new DB(loc)

        let proxy = new Proxy(shadow, handler)

        this.db = proxy
    }
}

class Tupac {
    constructor(p, n, o) {
        let shadow = new DC(p, n, o)

        let proxy = new Proxy(shadow, handler)

        this.dc = proxy
    }
}

module.exports = Lizzo