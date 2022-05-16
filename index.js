var fs = require('fs');
const {parse, stringify} = require('flatted');

class DB { // DataBase (root node)
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

    _create(name) { // Creates a new child node with a given name
        var newChild = this._children[this._children.push(new WillSmith({}, this, name).dn) - 1]
        if (this._childTemplate) {
            newChild._template = this._childTemplate
            newChild._initTemplate()
        }
        this._updateBindings(newChild)
        this._saveState()
        return newChild
    }

    _store(data, name=undefined) {        // Stores data as a new child node with a given name 
        if (typeof(data) == "array") { // If a primitive is given, a child will be created and the primitive will be stored under the key "data"
            var out = []
            for (var i = 0; i < o.length; i++) {
                out.push(this._store(data[i]))
            }
            this._saveState()
            return out
        } else {
            var newChild = this._children[this._children.push(new WillSmith({}, this, name).dn) - 1]
            if (this._childTemplate) {
                newChild._template = this._childTemplate
                newChild._initTemplate()
            }
            newChild._set(data)
            this._updateBindings(newChild)
            this._saveState()
            return newChild
        }
    }

    _set(data, key=undefined) { // Sets the value of a key on the current node to the value given in data
        switch(typeof(data)) { // If data is an array it will iterate over each item, if data is an object it will copy the object's keys to the current node
            case "array":
                data.forEach((entry) => { this.set(entry) })
            case "object":
                Object.keys(data).forEach((entry) => { this[entry] = data[entry] })
                break
            default:
                if (key) {
                    this[key] = data
                } else {
                    this.data = data
                }
                break
        }
        this._saveState()
    }

    _link(target, name) { // Links another node to this node as a named key
        if (typeof(target) == "string") {
            target = this._root._getById(target)
        }
        if (!this[name]) {
            this[name] = target
        }
    }

    _getSnapshot() {
        var out = {}
        this._keys.map((key) => {
            var temp = this[key]
            var rules = ["DN", "DC", "DB", "DT", "Function"]
            if (rules.indexOf(temp.constructor.name) == -1) {
                out[key] = temp
            }
        })
        return out
    }

    //=======================
    //COLLECTION FUNCTIONS
    //=======================

    _createCollection(name, options=undefined) { // Creates a new collection interface with options
        this[name] = new Tupac(this, name, options).dc
        this._saveState()
        return this[name]
    }  

    _collect(target, name, options=undefined) { // Collects a node into a collectionon the current node, if no collection exists, one will be created with options
        if (!this[name]) {
            this[name] = new Tupac(this, name, options).dc
        }
        switch(typeof(target)) {
            case "array":
                target.forEach((entry) => { this._collect(entry, name) })
                break
            case "string":
                this[name].push(this._root._getById(target))
                break
            default:   
                this[name]._add(target)
        }
    }

    _pull(target, name) { // Removes a node from a collection on the current node
        switch(typeof(target)) {
            case "array":
                target.forEach((entry) => { this._pull(entry, name) })
                break
            case "string":
                this._pull(this._root._getById(target), name)
                break
            default:
                this[name]._pull(target)
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
        this._bindings.forEach((b) => { this._root._findCollection(b)._add(item) })
    }

    //=======================
    //TEMPLATE FUNCTIONS
    //=======================
    
    _createTemplate(options) { // Creates a new template at the current node with options. New nodes created from this node will follow this template
        this._childTemplate = new DT(options)
        this._saveState()
    }

    _destroyTemplate() { // Removes the template from the current node.
        this._childTemplate = undefined
        this._saveState()
    }

    _initTemplate() { // Initializes this node with it's given template
        Object.keys(this._template.keys).forEach((key) => { 
            var d = this._template.keys[key].default 
            if (typeof(d) == "function") {
                var initFunc = eval(this._template.keys[key].default).bind(this)
                this[key] = Reflect.apply(initFunc, this, [])
            } else {
                this[key] = this._template.keys[key].default 
            }
        })
        if (this._template.apply) {
            var applyFunc = eval(this._template.apply).bind(this)
            Reflect.apply(applyFunc, this, [])
        }
        this._saveState()
    }

    //=======================
    //UTILITY FUNCTIONS
    //=======================

    _query(filter, sort = undefined) { // Queries the children of the current node using filter function f and sort function s
        var results = this._children.filter(filter)
        if (sort) {
            results.sort(sort)
        }
        return results
    }

    _getById(id) { // Gets a reference to a node using its id
        var id1 = this._id.split("/")
        var id2 = id.split("/")
        var selected = this
        for (var i = 0; i < id2.length; i++) {
            if (id1[i]) {
                if (id1[i] != id2[i]) {
                    if (selected._children[id2[i]]) {
                        selected = selected._children[id2[i]]
                    } else {
                        return null
                    }
                }
            } else {
                if (selected._children[id2[i]]) {
                    selected = selected._children[id2[i]]
                } else {
                    return null
                }
            }
        }
        return selected
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
        return this._getById(id)[name].bind(this._getById(id))
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
            fs.readdirSync(loc).forEach(async (entry) => {
                var dot = entry.indexOf('.')
                if (dot == -1) {
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
            })
        }
        return this
    }
    
}

class DN extends DB { // DataNode (extended root)
    constructor(data, parent, name=undefined) {
        var loc = parent._loc + (parent._children.length) + "/"
        super(loc)
        this._parent = parent
        this._root = parent._root
        this._id = parent._id + "/" + (parent._children.length)
        
        if (typeof(data) === "object") {
            Object.keys(data).forEach((key) => { this[key] = data[key] })
        } else {
            this.data = data
        }
        if (name) {
            this._name = name
            if (!parent[name]) {
                parent[name] = this
            }
        } else if (this.name) {
            this._name = this.name
            if (!parent[this.name]) {
                parent[this.name] = this
            }
        } else {
            this._name = ""
        }
    }
}

class DC { // DataCollection
    constructor(parent, name, options={keySort: undefined, itemSort: undefined, indexBy: undefined, accept: undefined}) {
        this._parent = parent
        this._root = parent._root
        this._name = name
        this._loc = this._parent._loc + name + '/'
        this._id = this._parent._id + '/' + this._name
        this._parent[name] = this
        this._keys = []
        this._items = []
        this._keySort = options.keySort
        this._itemSort = options.itemSort
        this._indexBy = options.indexBy
        this._accept = options.accept
        if (!fs.existsSync(this._loc)){
            fs.mkdirSync(this._loc)
        } else {
            this._loadState()
        }
    }

    _queryKeys(filter, sort = undefined) {
        var results = this._keys.filter(filter)
        if (sort) {
            results.sort(sort)
        }
        return results
    }

    _queryItems(filter, sort = undefined) {
        var results = this._items.filter(filter)
        if (sort) {
            results.sort(sort)
        }
        return results
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
        this._keys.forEach((key) => {
            if (!this[key]) {
                var file = this._loc + key + '.ml'
                var id = String(fs.readFileSync(file))
                var item = this._parent._root.getById(id)
                var x = this._items.push(item) - 1
                this[key] = this._items[x]
            }
        })
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

class DT { // DataTemplate
    constructor(options) {
        this.strict = options.strict ? options.strict : false
        this.apply = options.apply ? options.apply.toString() : undefined
        this.keys = {}
        Object.keys(options.keys).forEach((key) => { 
            this.keys[key] = {}
            Object.keys(options.keys[key]).forEach((prop) => {
                if (typeof(options.keys[key][prop]) == "function") {
                    this.keys[key][prop] = options.keys[key][prop].toString() 
                } else {
                    this.keys[key][prop] = options.keys[key][prop]
                } 
            })
        })
    }

    toString() {
        var out = {strict: this.strict, apply: this.apply, keys: {}}
        Object.keys(this.keys).forEach((key) => { 
            out.keys[key] = {}
            Object.keys(this.keys[key]).forEach((prop) => {
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
            var numKeys = Reflect.get(obj, "_keys").length
            var numItems = Reflect.get(obj, "_items").length
            if (numKeys > numItems) {
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
            var keys = Reflect.get(obj, "_keys")
            if (keys.indexOf(prop) == -1) {
                keys.push(prop)
                Reflect.set(obj, "_keys", keys)
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
                    var validator = eval(template[prop].validator).bind(origin)
                    var result = Reflect.apply(validator, origin, [arg, origin])
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
                    var keys = Reflect.get(obj, "_keys")
                    if (keys.indexOf(prop) == -1) {
                        keys.push(prop)
                        Reflect.set(obj, "_keys", keys)
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
            var keys = Reflect.get(obj, "_keys")
            if (keys.indexOf(prop) == -1) {
                keys.push(prop)
                Reflect.set(obj, "_keys", keys)
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
    }
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