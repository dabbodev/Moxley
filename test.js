const DB = require("./index.js")

async function main() {
    
    //var db = await new DB("./db/").db._loadFromDir()

    
    var db = await new DB("./db/").db

    var node1 = db._create("node1")
    var node2 = db._create("node2")

    var collection = node2._createCollection("collection", {indexBy:"data"})
    node1._bind(collection)

    var child1 = node1._store("child1")
    var child2 = node1._store("child2")

    node1._unbind(collection)

    var child3 = node1._store("child3")
    
    console.log(db.node2.collection)
}

main()

/*

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