const DB = require("./index.js")

async function main() {
    
    //var db = await new DB("./db/").db._loadFromDir()

    var db = new DB("./db/").db

    var node1 = db._create("node1")

    node1._createTemplate({
        strict: false,
        keys: {
            counter: {
                type: "Number",
                default: 0
            }
        }
    })

    var node2 = node1._create("node2")
    console.log(node2.counter)
}

main()

/*
var node1 = db._create("node1")

node1._createTemplate({
    strict: false,
    keys: {
        counter: {
            type: "Number",
            default: 1
        }
    }
})

var node2 = node1._create("node2")

console.log(node2.counter) // 1

node2.counter = "test" // "Invalid type String set to parameter test. Expected Number"

console.log(node2.counter) // 1

var node1 = db._create("node1")

var increment = (x) => {return x+1}

node1._set(1, "counter")
console.log(node1.counter)

node1._set(increment, "increment")
    
node1.counter = node1.increment(node1.counter)
console.log(node1.counter)

var node1 = db._store(1)
var node2 = db._store(2)
var node3 = db._store(3)

var test = db._store("test", "test")

test._collect(node2, "col", {indexBy: "data", keySort: "(a, b) => { return b - a }"})
test._collect(node1, "col")
test._collect(node3, "col")
console.log(test)


var x = db.store({ test: "test" }, "test")

var y = db.store({ test: "test2" }, "test2")

x.link(y, 'test3')

console.log(x.test3)



console.log(w)

console.log(w.test)

db.store({ next: "next" })

db._children[1].store({ another: "test" })

db.create("users")

var q = function(child) {
    return child.test == "test"
}

db._children[1].collect("0-0", "list")

var i = db._children[1].queryCollection("list", q)

console.log(w)

console.log(i)

db.backup("backup")

var t = new DB("db/").db

t.read("backup").then((data) => {
    t = data
    console.log(t)
})

var i = db._children[1].queryCollection("list", q)

console.log(i)

*/