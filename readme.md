
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

Along with the new Collections interface there are 3 new persistent options for Collections: indexBy, keySort, and itemSort. Without supplying these options, the collection will operate as a normal collection under default conditions but using these allows us to configure automatic sorting within the collection.

The indexBy option accepts a string containing the a key from the objects in the collection to use as the main index of the collection. All objects in the collection will then be available through the collection's key interface

For Example:

```javascript
var fruits = db._store(["apple", "banana", "pear"])
var customer = db._store({ firstName: "John" })
customer._collect(fruits, "fruits", {indexBy: "data"})
console.log(customer.fruits["apple"].data) // "apple"
```

The new keySort and itemSort options accept a string containing a javascript sort function that will execute whenever a new item is added to the collection

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

The one thing to keep in mind is because of loading order, collections must be populated after loading from a directory to access the references stored in the collection. 
To do this we use ._populate command on the collection object

```javascript
db.collection._populate()
```

And then all your references in the collection will be accessible again!

#### Other Internals

In Moxley these can be used with any data node:

._root can be used to automatically retrieve a reference the root node of the data structure

```javascript
node._root
```

._parent can be used to automatically retrieve a reference to the parent node of any data node

```javascript
node._parent
```

._children contains an array of references to all child nodes of a given node

```javascript
node._children
node._children[0]
```

._keys contains an array of all currently stored keys in a node

```javascript
node._keys
```
