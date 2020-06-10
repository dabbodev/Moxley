var fs = require('fs');
const {parse, stringify} = require('flatted');

class DB {
    constructor() {
        this._children = []
        this._id = "0"
        this._root = this
    }

    create(n) {
        this._children.push(new DN({}, this, n))
    }

    store(o, n=undefined) {
        if (typeof(o) == "array") {
            var a = []
            for (var b = 0; b < o.length; b++) {
                a.push(this.store(o[b]))
            }
            return a
        } else {
            return this._children[this._children.push(new DN(o, this, n)) - 1]
        }
    }

    set(o, n=undefined) {
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
    }

    collect(i, n) {
        if (!this[n]) {
            this[n] = []
        }
        switch(typeof(i)) {
            case "array":
                i.forEach(function (e) { this.collect(e, n) })
                break
            case "string":
                this[n].push(this._root.getById(i))
                break
            default:
                this[n].push(i)
        }
    }

    pull(i, n) {
        switch(typeof(i)) {
            case "array":
                i.forEach(function (e) { this.pull(e, n) })
                break
            case "string":
                this.pull(this._root.getById(i), n)
                break
            default:
                var a = this[n].indexOf(i)
                this[n].splice(a, 1)
        }
    }

    query(f, s = undefined) {
        var r = this._children.filter(f)
        if (s) {
            r.sort(s)
        }
        return r
    }

    queryCollection(c, f, s = undefined) {
        var r = this[c].filter(f)
        if (s) {
            r.sort(s)
        }
        return r
    }

    getById(i) {
        var a = this._id.split("-")
        var b = i.split("-")
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

    link(i, n) {
        if (typeof(i) == "string") {
            i = this._root.getById(i)
        }
        if (!this[n]) {
            this[n] = i
        }
    }

    backup(p) {
        var b = []
        b.push(this)
        for (var a = 0; a < this._children.length; a++) {
            b.push(this._children[a])
        }
        var wstream = fs.createWriteStream(p)
        wstream.write(stringify(this))
        wstream.end()
    }

    read(p) {
        return new Promise(function (resolve, reject) {
            fs.readFile(p, 'utf8', function (err,data) {
                if (err) {
                  return console.log(err);
                }
                resolve(parse(data))
              })
        })
        
    }
}

class DN extends DB {
    constructor(o, p, n=undefined) {
        super()
        this._parent = p
        this._root = p._root
        this._id = p._id + "-" + (p._children.length)
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
        }
    }
}

module.exports = DB