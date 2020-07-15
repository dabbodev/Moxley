const DB = require("./index.js")

var db = new DB("db/").db

console.log(db)

var w = db.store({ test: "test" }, "test")

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