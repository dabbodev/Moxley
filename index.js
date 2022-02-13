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
        this._template = undefined
        this._childTemplate = undefined
        this._scanLocation(loc)
    }

    //=======================
    //MAIN STORAGE FUNCTIONS
    //=======================

    _create(n) { // Creates a new child node with name n
        var i = this._children[this._children.push(new WillSmith({}, this, n).dn) - 1]
        if (this._childTemplate) {
            i._template = this._childTemplate
            i._initTemplate()
        }
        this._updateBindings(i)
        this._saveState()
        return i
    }

    _store(o, n=undefined) {        // Stores object o as a child node with name n, n can also be supplied in the object. 
        if (typeof(o) == "array") { // If a primitive is given, a child will be created and the primitive will be stored under the key "data"
            var a = []
            for (var b = 0; b < o.length; b++) {
                a.push(this._store(o[b]))
            }
            this._saveState()
            return a
        } else {
            var i = this._children[this._children.push(new WillSmith({}, this, n).dn) - 1]
            if (this._childTemplate) {
                i._template = this._childTemplate
                i._initTemplate()
            }
            i._set(o)
            this._updateBindings(i)
            this._saveState()
            return i
        }
    }

    _set(o, n=undefined) { // Sets the value of a key n on the current node to the value given o 
        switch(typeof(o)) { // If o is an array it will iterate over each item, if o is an object it will copy the object's keys to the current node
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

    _link(i, n) { // Links another node i to this node as key n
        if (typeof(i) == "string") {
            i = this._root._getById(i)
        }
        if (!this[n]) {
            this[n] = i
        }
    }

    //=======================
    //COLLECTION FUNCTIONS
    //=======================

    _createCollection(n, o=undefined) { // Creates a new collection interface named n on the current node with options o
        this[n] = new Tupac(this, n, o).dc
        this._saveState()
        return this[n]
    }  

    _collect(i, n, o=undefined) { // Collects a node i into a collection named "n" on the current node, if no collection exists, one will be created with o options
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

    _pull(i, n) { // Removes a node i from a collection named n on the current node
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

    _bind(col) { // Binds this node to a collection col. New nodes created from this node will be automatically added to the collection. 
        this._bindings.push(col._id) // This can also be validated using the accept option during collection creation
        this._saveState()
    }

    _unbind(col) { // Unbinds this node from a collection col. 
        var i = this._bindings.indexOf(col._id)
        if (i >= 0) {
            this._bindings.splice(i, 1)
        }
        this._saveState()
    }

    _updateBindings(item) { // This function adds the new child created on this node to each of it's bound collections
        this._bindings.map((b) => { this._root._findCollection(b)._add(item) })
    }

    //=======================
    //TEMPLATE FUNCTIONS
    //=======================
    
    _createTemplate(o) { // Creates a new template at the current node with options o. New nodes created from this node will follow this template
        this._childTemplate = new DT(o)
        this._saveState()
    }

    _destroyTemplate() { // Removes the template from the current node.
        this._childTemplate = undefined
        this._saveState()
    }

    _initTemplate() { // Initializes this node with it's given template
        var k = Object.keys(this._template.keys)
        k.map((key) => { 
            var d = this._template.keys[key].default 
            if (typeof(d) == "function") {
                var t = eval(this._template.keys[key].default).bind(this)
                this[key] = Reflect.apply(t, this, [])
            } else {
                this[key] = this._template.keys[key].default 
            }
        })
        if (this._template.apply) {
            var t = eval(this._template.apply).bind(this)
            Reflect.apply(t, this, [])
        }
        this._saveState()
    }

    //=======================
    //UTILITY FUNCTIONS
    //=======================

    _query(f, s = undefined) { // Queries the children of the current node using filter function f and sort function s
        var r = this._children.filter(f)
        if (s) {
            r.sort(s)
        }
        return r
    }

    _getById(i) { // Gets a reference to a node using its id
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

    _findCollection(id) { // Gets a reference to a collection using its id
        var sep = id.lastIndexOf('/')
        var name = id.substring(sep + 1)
        id = id.substring(0, sep)
        return this._getById(id)[name]
    }

    _findFunction(id) { // Gets a reference to a function using its id
        var sep = id.lastIndexOf('/')
        var name = id.substring(sep + 1)
        id = id.substring(0, sep)
        return this._getById(id)[name]
    }

    _scanLocation(loc) { // Check for existing directory
        if (!fs.existsSync(loc)){
            fs.mkdirSync(loc)
            this._saveState()
        } 
    }

    _saveState() { // Saves the state of this node
        var state = {
            _loc: this._loc,
            _id: this._id,
            _name: this._name,
            _keys: this._keys,
            _bindings: this._bindings
        }
        if (this._childTemplate) {
            state._childTemplate = this._childTemplate.toString()
        }
        var filename = this._loc + "_state.ms"
        fs.writeFileSync(filename, stringify(state))
    }

    async _loadState(loc) { // Loads a state file from loc and returns it as an object
        var filename = loc + "_state.ms"
        if (fs.existsSync(filename)) {
            return await parse(fs.readFileSync(filename))
        }
    }

    async _loadFromDir(loc = this._loc) { // Loads the current node from the file system and steps forward if needed
        var statecheck = loc + '_state.ms'
        if (fs.existsSync(statecheck)) {
            var savedstate = await this._loadState(this._loc)
            this._keys = savedstate._keys
            this._bindings = savedstate._bindings
            if (savedstate._childTemplate) {
                this._childTemplate = new DT(parse(savedstate._childTemplate))
            }
            if (this._parent) {
                if (this._parent._childTemplate) {
                    this._template = this._parent._childTemplate
                }
            }
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
    constructor(p, n, o={keySort: undefined, itemSort: undefined, indexBy: undefined, accept: undefined}) {
        this._parent = p
        this._root = p._root
        this._name = n
        this._loc = this._parent._loc + n + '/'
        this._id = this._parent._id + '/' + this._name
        this._parent[n] = this
        this._keys = []
        this._items = []
        this._keySort = o.keySort
        this._itemSort = o.itemSort
        this._indexBy = o.indexBy
        this._accept = o.accept
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
        if (this._accept) {
            if (!this._accept(item)) {
                return false
            }
        }
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
        } else {
            var x = this._items.indexOf(item)
            this._keys.splice(x, 1)
            this._items.splice(x, 1)
        }
    }

    _populate() {
        for (var a = 0; a < this._keys.length; a++) {
            var k = this._keys[a]
            var f = this._loc + k + '.ml'
            var id = String(fs.readFileSync(f))
            var item = this._parent._root.getById(id)
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
            state._keySort = this._keySort.toString()
        }
        if (this._itemSort) { 
            state._itemSort = this._itemSort.toString()
        }
        if (this._accept) { 
            state._accept = this._accept.toString()
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
                this._keySort = eval(savedstate._keySort)
            }
            if (savedstate._itemSort) { 
                this._itemSort = eval(savedstate._itemSort)
            }
            if (savedstate._accept) { 
                this._accept = eval(savedstate._accept)
            }
            this._indexBy = savedstate._indexBy
            
        }
    }
}

class DT {
    constructor(o) {
        this.strict = o.strict ? o.strict : false
        this.apply = o.apply ? o.apply.toString() : undefined
        this.keys = {}
        var k = Object.keys(o.keys)
        k.map((key) => { 
            this.keys[key] = {}
            var k2 = Object.keys(o.keys[key])
            k2.map((prop) => {
                if (typeof(o.keys[key][prop]) == "function") {
                    this.keys[key][prop] = o.keys[key][prop].toString() 
                } else {
                    this.keys[key][prop] = o.keys[key][prop]
                } 
            })
        })
    }

    toString() {
        var out = {strict: this.strict, apply: this.apply, keys: {}}
        var k = Object.keys(this.keys)
        k.map((key) => { 
            out.keys[key] = {}
            var k2 = Object.keys(this.keys[key])
            k2.map((prop) => {
                if (typeof(this.keys[key]) == "function") {
                    out.keys[key][prop] = this.keys[key][prop].toString() 
                } else {
                    out.keys[key][prop] = this.keys[key][prop]
                }
            })
        })
        return stringify(out)
    }
}

const handler = {
    hook: function(val, obj, hooks) {
        var root = Reflect.get(obj, "_root")
        var origin = root._getById(obj._id)
        hooks.map((target) => {
            root._findFunction(target)(val, origin)
        })
    },
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
                var root = Reflect.get(obj, "_root")
                var origin = root._getById(obj._id)
                var t = eval(String(fs.readFileSync(filename))).bind(origin)
                return t
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
            if (arg.constructor.name == "DN" || arg.constructor.name == "DC" || arg.constructor.name == "DT") {
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
        if (Reflect.get(obj, "_template") && arg) {
            var template = obj._template.keys
            if (template[prop]) {
                if (arg.constructor.name != template[prop].type) {
                    console.log("Invalid type " + arg.constructor.name + " set to parameter " + prop + ". Expected " + template[prop].type)
                    return false
                }
                if (template[prop].validator) {
                    var root = Reflect.get(obj, "_root")
                    var origin = root._getById(obj._id)
                    var t = eval(template[prop].validator).bind(origin)
                    var result = Reflect.apply(t, origin, [arg, origin])
                    if (!result) {
                        console.log("New value rejected: Failed validation")
                        return false
                    }
                }
            } else if (obj._template.strict == true) {
                console.log("Strict template enabled, no new keys allowed")
                return false
            }
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
            } else {
                if (Reflect.get(obj, "_template") && arg) {
                    var template = obj._template.keys
                    if (template[prop]) {
                        if (template[prop].hooks) {
                            this.hook(arg, obj, template[prop].hooks)
                        }
                    }
                }
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