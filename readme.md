
# Moxley

Moxley is a flexible and lightweight class based database system that can scale to any size or complexity. Moxley uses in-memory references to chain nodes together in any pattern allowing you to get what you need when you need it.

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

From here you just need to initialize the main DB node with:

```javascript
var db = new DB()
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
db.create("Node")
```

This will create an empty node at the given location with the given name.

Alternatively, we can create a child node with set data using one of these methods:

```javascript
db.store(data)
db.store(data, name)
db.store({ object })
db.store({ object }, name)
db.store([ array ])
```

As you can see, we can instantiate a node using data in any form alone to create an unnamed node. Feeding this function an object instead will add all keys in the object to the node's class properties. Adding the name parameter will name the node. Using an array will create a node for each entry in the array. Finally, any data given without a key will default to the node's "data" property .

For example:

```javascript
var node1 = db.store("apple")
var node2 = db.store({ fruit: "banana" })
var nodes = db.store(["pear", "lemon"])
console.log(node1.data) // "apple"
console.log(node2.fruit) // "fruit"
console.log(nodes[0].data, nodes[1].data) // "pear", "lemon"
```

#### Naming Nodes

Naming nodes allows us to more easily categorize and search node structures. Creating a node with a name will create a reference to that child node at the named parameter of the parent node.

```javascript
var node1 = db.store("apple", "fruit")
console.log(db.fruit.data) // "apple"
```

When creating an empty parent node, the name given helps us to better separate these structures.

```javascript
var node1 = db.create("fruits")
var nodes = node1.store(["apple", "banana", "pear", "lemon"])
console.log(db.fruits._children[0].data) // "apple"
```

#### Setting Data

Once a node has already been created you can add data to it at any time using the set function. 

```javascript
node.set(data)
node.set(data, name)
```

Using a name will set the data passed to a parameter of that name, or if passing an object, the data of the object will be set to parameters of each named key.

```javascript
node1.set("apple")
node2.set("banana", "fruit")
node3.set({ fruits: ["pear", "lemon"]})
console.log(node1.data) // "apple"
console.log(node2.fruit) // "banana"
console.log(node3.fruits) // ["pear", "lemon"]
```

#### Links

In Moxley, you can create references to any node at any scope of the structure with the link function. If you don't have an active reference to a node to pass to the link function, passing the _id string of a node will work as well.

```javascript
node1.link(node2, name)
```

For example:
```javascript
var node1 = db.store({ firstName: "Bob" })
var node2 = db.store({ firstName: "Daniel" })
node1.link(node2, "father")
console.log(node1.firstName) // "Bob"
console.log(node1.father.firstName) // "Daniel"
```

```javascript
var node1 = db.store({ firstName: "Bob" })
var node2 = db.store({ firstName: "Daniel" })
var id = node2._id
node1.link(id, "father")
console.log(node1.firstName) // "Bob"
console.log(node1.father.firstName) // "Daniel"
```

#### Collections

Moxley can also store arrays of reference links as a collection. Simply pass a node/id or array of nodes/ids to the collect function with the name you'd like them to be collected under. If a collection by that name doesn't exist, it will automatically be created.

```javascript
node1.collect(node2, name)
```

```javascript
var fruits = db.store(["apple", "banana", "pear"])
var customer = db.store({ firstName: "John" })
customer.collect(fruits, "fruits")
console.log(customer.fruits[0].data) // "apple"
```

To remove a node from a collection simply use the pull function.

```javascript
node1.pull(node2, name)
```

#### Node IDs

Every node is created with an identifier that represents its position in the data structure. This ID can be read at any time using `node._id` and you can retrieve a node using it's ID by calling the getById function on the root of the database.

```javascript
db.getById(id)
```

### Querying Data

Moxley can query data from any node using two main methods: querying the children of a node, and querying a collection of a node. To query with Moxley simply pass a filtering method and an optional sorting method to the query function of your choice.

#### Querying Children

To query children of a node, simply pass your methods to the query function of the root or any node.

```javascript
db.query(filter, sort)
```

For example:

```javascript
db.store([ { fruit: "apple", color: "red", quantity: 14 }, { fruit: "banana", color: "yellow", quantity: 7 }, {fruit: "orange", color: "orange", quantity: 22 ])

var filter1 = (node) => { return node.fruit == "banana" }
var q1 = db.query(filter1)
console.log(q1[0].color) // "yellow"

var filter2 = (node) => { return node }
var sort = (a, b) => { return b.quantity - a.quantity }
var q2 = db.query(filter2, sort)
console.log(q2[0].fruit) // "orange"
```

#### Querying Collections

Querying a collection in a node works exactly the same except the syntax is a little different as we need to pass the name of the collection as well

```javascript
db.queryCollection(name, filter, sort)
```

## Backing Up and Reading Data

To create a backup of a Moxley instance simply use the backup function with a file path where the data should be stored

```javascript
db.backup(filePath)
```

Reading data from a backup is pretty simple as well

```javascript
db.read(filePath).then((data) => { db = data })
```