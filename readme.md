
# Moxley

Moxley is a flexible and lightweight class based database system that can scale to any size or complexity. Moxley uses in-memory references to chain nodes together in any pattern allowing you to get what you need when you need it. Moxley only stores an index of linked keys to your data in local memory, and acts as a proxy of itself to read and write the data to the file system in real time. This means that other than the structure itself, Moxley only loads the data actively being used into RAM. 

## Installation

Use npm to install it into any nodejs project with:

```
npm install moxley-db
```

## Usage

Moxley aims to make data easy to access at any scope within it's structure, and allows you to link data nodes together for quick and easy referencing.

### Initialization

To start using Moxley first require it into your project to access it with:

```javascript
const DB = require("moxley-db")
```

From here you just need to initialize the main DB node by passing it the path to a folder where it will save your data with:

```javascript
var db = new DB(path).db
```

And that's it! Moxley is ready for your data!

### Storing and Retrieving Data
#### Node Structure

Moxley uses a circular node-based reference structure to store and reference nodes of data. Every node can also be a parent to any number of child nodes.

#### Creating Nodes

There are 2 main ways of creating data nodes in Moxley: Creating an empty "parent" node, or storing data into a "child" node.

*Keep in mind that these commands can be used at any level in your data structure as every node extends all node functionality.*

To create an empty parent node we can simply use:

```javascript
db._create("Node")
```

This will create an empty node at the given location with the given name.

Alternatively, we can create a child node with set data using one of these methods:

```javascript
db._store(data)
db._store(data, name)
db._store({ object })
db._store({ object }, name)
db._store([ array ])
```

As you can see, we can instantiate a node using data in any form alone to create an unnamed node. Feeding this function an object instead will add all keys in the object to the node's class properties. Adding the name parameter will name the node. Using an array will create a node for each entry in the array. Finally, any data given without a key will default to the node's "data" property .

For example:

```javascript
var node1 = db._store("apple")
var node2 = db._store({ fruit: "banana" })
var nodes = db._store(["pear", "lemon"])
console.log(node1.data) // "apple"
console.log(node2.fruit) // "banana"
console.log(nodes[0].data, nodes[1].data) // "pear", "lemon"
```

#### Naming Nodes

Naming nodes allows us to more easily categorize and search node structures. Creating a node with a name will create a reference to that child node at the named parameter of the parent node.

```javascript
var node1 = db._store("apple", "fruit")
console.log(db.fruit.data) // "apple"
```

When creating an empty parent node, the name given helps us to better separate these structures.

```javascript
var node1 = db._create("fruits")
var nodes = node1._store(["apple", "banana", "pear", "lemon"])
console.log(db.fruits._children[0].data) // "apple"
```

#### Setting Data

Once a node has already been created you can add data to it at any time using the set function. 

```javascript
node._set(data)
node._set(data, name)
```

Using a name will set the data passed to a parameter of that name, or if passing an object, the data of the object will be set to parameters of each named key.

```javascript
node1._set("apple")
node2._set("banana", "fruit")
node3._set({ fruits: ["pear", "lemon"]})
console.log(node1.data) // "apple"
console.log(node2.fruit) // "banana"
console.log(node3.fruits) // ["pear", "lemon"]
```

#### Storing Functions

Moxley can save a function to any key just like any other piece of data, and then let's you call it from that key at any time

```javascript
var node1 = db._create("node1")

var increment = (x) => {return x+1}

node1._set(1, "counter")
console.log(node1.counter)  // 1

node1._set(increment, "increment")
    
node1.counter = node1.increment(node1.counter)
console.log(node1.counter) // 2
```

#### Templates

Moxley can now use templates to enforce rules on nodes! Simply use the ._createTemplate function on a node and all nodes generated from it will have the template applied. Usage of the template follows 3 main parameters: strict, keys, and apply. Setting strict to "true" will stop the node from creating any new keys other than the ones supplied in the template. The keys object should contain a list of the keys you want each child node to start with, as well as the typing and default parameters for the key. Moxley also accepts a parameter for each key called validator that accept a validation function that should return true if the value is valid and false if invalid. Moxley will pass the value as well as a reference the node that is being updated Setting the default value of a key to a function will run the function when the child is created. Moxley also has an apply template parameter that will run as a function on the child at creation using the child as the this scope for the activation. Here are some examples:

Setting a default key and value
```javascript
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
```

Using a function to initialize a value at creation
```javascript
var node1 = db._create("node1")

node1._createTemplate({
    strict: false,
    keys: {
        createdDate: {
            type: "Date",
            default: () => { return new Date() }
        }
    }
})

var node2 = node1._create("node2")

console.log(node2.createdDate) // date at creation

node2.createdDate = "test" // "Invalid type set to parameter test. Expected Date"

console.log(node2.createdDate) // date at creation
```

Using strict mode to block new keys
```javascript
var node1 = db._create("node1")

node1._createTemplate({
    strict: true,
    keys: {
        counter: {
            type: "Number",
            default: 1
        }
    }
})

var node2 = node1._create("node2")

node2.test = "test" // "Strict template enabled, no new keys allowed"
```

Using validator to apply validation to a key

```javascript
var node1 = db._create("node1")

node1._createTemplate({
    strict: false,
    keys: {
        data: {
            type: "String",
            default: "test",
            validator: (newVal, obj) => { return newVal.length < 5 }
        }
    }
})

var node2 = node1._create("node2")
node2.data = "testing" // "New value rejected: Failed validation
console.log(node2.data) // "test"
```

Using apply to affect a child at creation
```javascript
var node1 = db._create("node1")

node1._createTemplate({
    strict: false,
    keys: {
        counter: {
            type: "Number",
            default: 0
        }
    },
    apply: () => {
        this.counter++
    }
})

var node2 = node1._create("node2")
console.log(node2.counter) // 1
```

Moxley now also allows for a new template parameter for each key call hooks. Using the hook system, Moxley can trigger any stored function whenever a value in a template is updated. The hooks parameter accept a list of id strings to each function you would like triggered on updates. The format for the id string of a stored function can be found by adding the name of the function to the id of the node it's stored in. Mosley will pass the new value set, as well as a reference to the node that was updated as arguments to the function.

For example:

```javascript
var node1 = db._create("node1")

node1.hookReport = (val, obj) => { console.log("Hook Triggered")  }

node1._createTemplate({
    strict: false,
    keys: {
        data: {
            type: "String",
            default: "test",
            hooks: ['0/0/hookReport']
        }
    }
})

var node2 = node1._create("node2")
node2.data = "testing" // "Hook Triggered"
```

#### Links

In Moxley, you can create references to any node at any scope of the structure with the link function. If you don't have an active reference to a node to pass to the link function, passing the _id string of a node will work as well.

```javascript
node1._link(node2, name)
```

For example:
```javascript
var node1 = db._store({ firstName: "Bob" })
var node2 = db._store({ firstName: "Daniel" })
node1._link(node2, "father")
console.log(node1.firstName) // "Bob"
console.log(node1.father.firstName) // "Daniel"
```

```javascript
var node1 = db._store({ firstName: "Bob" })
var node2 = db._store({ firstName: "Daniel" })
var id = node2._id
node1._link(id, "father")
console.log(node1.firstName) // "Bob"
console.log(node1.father.firstName) // "Daniel"
```

#### Collections

Collection are now a unique class object in Moxley! This allows for several benefits in managing collected information! To create a new collection simply use the ._collect or ._createCollection commands

```javascript
node1._collect(node2, name, options*)
node1._createCollection(name, options*)
```

For Example:

```javascript
var fruits = db._store(["apple", "banana", "pear"])
var customer = db._store({ firstName: "John" })
customer._collect(fruits, "fruits")
console.log(customer.fruits[0].data) // "apple"
```

To remove a node from a collection simply use the pull function.

```javascript
node1._pull(node2, name)
node1.name._pull(node2)
```

Collections now have 4 persistent options: indexBy, keySort, itemSort, and accept. Without supplying these options, the collection will operate as a normal collection under default conditions but using these allows us to configure automatic sorting within the collection.

The indexBy option accepts a string containing the a key from the objects in the collection to use as the main index of the collection. All objects in the collection will then be available through the collection's key interface

For Example:

```javascript
var fruits = db._store(["apple", "banana", "pear"])
var customer = db._store({ firstName: "John" })
customer._collect(fruits, "fruits", {indexBy: "data"})
console.log(customer.fruits["apple"].data) // "apple"
```

The accept option allows us to supply a conditional requirement for an item to be added to the collection

```javascript
var db = new DB("./db/").db

var node1 = db._create("node1")

var node2 = db._create("node2")

node2._createCollection("collection", {accept: (item) => { return item.data == "accepted" }})

node1._bind(node2.collection)

var child1 = node1._store("rejected")

var child2 = node1._store("accepted")

console.log(node2.collection[0].data) // "accepted"
```

The keySort and itemSort options accept a string containing a javascript sort function that will execute whenever a new item is added to the collection

You can also find a collection by passing it's string form ._id parameter to the ._findCollection function of a root node

#### Binding Collections

You can now bind nodes to collections! This creates an automatically updating link between them so that when a new child is added to the node, it will automatically be passed to the collection! To do this we use the ._bind command

```javascript
var node1 = db._create("node1")
var node2 = db._create("node2")

var collection = node2._createCollection("collection", {indexBy:"data"})
node1._bind(collection)

var child1 = node1._store("child1")
var child2 = node1._store("child2")
var child3 = node1._store("child3")
    
console.log(node2.collection.child1.data) // child1
```

You can also unbind a node from a collection by using ._unbind

```javascript
var db = await new DB("./db/").db

var node1 = db._create("node1")
var node2 = db._create("node2")

var collection = node2._createCollection("collection", {indexBy:"data"})
node1._bind(collection)

var child1 = node1._store("child1")
var child2 = node1._store("child2")

node1._unbind(collection)

var child3 = node1._store("child3")
    
console.log(collection._keys) // ["child1", "child2"]
```

#### Node IDs

Every node is created with an identifier that represents its position in the data structure. This ID can be read at any time using `node._id` and you can retrieve a node using it's ID by calling the getById function on the root of the database.

```javascript
db._getById(id)
```

### Querying Data

Moxley can query data from any node using two main methods: querying the children of a node, and querying a collection of a node. To query with Moxley simply pass a filtering method and an optional sorting method to the query function of your choice.

#### Querying Children

To query children of a node, simply pass your methods to the query function of the root or any node.

```javascript
db._query(filter, sort)
```

For example:

```javascript
db._store([ { fruit: "apple", color: "red", quantity: 14 }, { fruit: "banana", color: "yellow", quantity: 7 }, {fruit: "orange", color: "orange", quantity: 22 ])

var filter1 = (node) => { return node.fruit == "banana" }
var q1 = db._query(filter1)
console.log(q1[0].color) // "yellow"

var filter2 = (node) => { return node }
var sort = (a, b) => { return b.quantity - a.quantity }
var q2 = db._query(filter2, sort)
console.log(q2[0].fruit) // "orange"
```

#### Querying Collections

There are now 2 ways to query a collection! Through querying the Keys stored in memory, or the items in the collection themselves both of which work exactly the same as the query above

```javascript
db.collection._queryKeys(filter, sort)
db.collection._queryItems(filter, sort)
```

## Backing Up and Reading Data

Moxley now loads itself automatically using the data created from previous sessions! Just wait for the promise resolution from the loadFromDir command

```javascript
var db = await new DB("./db/").db._loadFromDir()
```

Moxley can now load data from a CSV file! Just await the result of the ._loadFromCSV command from any node and it will populate with children created from the file.

```javascript
await db._loadFromCSV(filename, delimiter=',', newline='\r\n', hasTitles=true, indexBy=undefined)
```

Paramenters: delimiter (default: ',') & newline (default: '\r\n') for modifying file processing, 
hasTitles (default: true) set this to false if your CSV file doesn't have a first row with column titles
indexBy can be set to the title of a column and will quick set the name of each node to the value in the given column

Example:
```javascript
var node = db._create("node")
await node._loadFromCSV("test.csv")
var row1 = node._children[0]
console.log(row1.name) // Data in Row1, Column titled "name"
```

#### Other Internals

In Moxley these can be used with any data node:

._root can be used to automatically retrieve a reference the root node of the data structure

```javascript
node._root
```

._parent can be used to automatically retrieve a reference to the parent node of any data node, also works with collections

```javascript
node._parent
```

._children contains an array of references to all child nodes of a given node

```javascript
node._children
node._children[0]
```

._keys contains an array of all currently stored keys in a node, also works with collections

```javascript
node._keys
```

._items contains an array of all items linked to a collection

```javascript
collection._items
collection._items[0]
```

Moxley now has a new internal function called ._getSnapshot that gives you a snapshot of all data stored in the node at the current time

```javascript
var node1 = db._store({name: "counterTest", testKey: "test", counter: 0})

node1.increment = (x) => { x.counter++ }

console.log(node1._getSnapshot()) // { name: 'counterTest', testKey: 'test', counter: 0 }

node1.increment(node1)

console.log(node1._getSnapshot()) // { name: 'counterTest', testKey: 'test', counter: 1 }
```