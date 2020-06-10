const DB = require("./index.js")

var db = new DB()

var w = db.store({ test: "test" }, "test")

db.store({ next: "next" })

db._children[1].store({ another: "test" })

db.create("users")

var q = function(child) {
    return child.test == "test"
}

db._children[1].collect("0-0", "list")

var i = db._children[1].queryCollection("list", q)

console.log(w)

//console.log(i)

db.backup("backup")

var t = new DB()

t.read("backup").then((data) => {
    t = data
    //console.log(t)
})

