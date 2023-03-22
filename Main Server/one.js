const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const sharedb = require('sharedb/lib/client')
const ReconnectingWebSocket = require('reconnecting-websocket')
const richText = require('rich-text');
const Delta = require('quill-delta')
const HTMLConverter = require('quill-delta-to-html').QuillDeltaToHtmlConverter;
const session = require('express-session');
const redisStore = require("connect-redis")(session);
const redis = require('redis');
const multer  = require('multer')
const mongoose = require('mongoose');
const Users = require('./model/user');
const Documents = require('./model/document');
const List = require('./model/list');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
var MongoClient = require('mongodb').MongoClient;
const elasticsearch = require('elasticsearch');


var app = express();

app.set('view engine', 'ejs');

setInterval(async function(){
   //console.log("Timer up, updating function")
   updateSearch();
}, 10000);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json( {limit: '10MB'}));
app.use(express.urlencoded({ extended: true }));

//Printing out the information in the collection
// MongoClient.connect(url, function(err, db) {
//    if (err) throw err;
//    var dbo = db.db("sharedb");
//    dbo.collection("documents").find({}).toArray(function(err, result) {
//      if (err) throw err;
//      console.log(result);
//      db.close();
//    });
//  });

//Elastic Client

const elasticClient = new elasticsearch.Client({
   host: '209.94.59.43:9200',
   //log: 'trace'
});

elasticClient.ping({
   requestTimeout: 30000,
}, function(error){
   if(error){
      console.log("Elastic Client not running");
   } else {
      console.log("Elastic Client Running");
   }
});

elasticClient.indices.create({
   "index": "document",
   "body": {
      "settings" :{
         "index" :{
            "highlight":{
               "max_analyzed_offset" : 10000000
            }
         }
      },
      "mappings":{
         "properties":{
               "content" :{ 
                  "type": "text", 
                  "fielddata": true
               }
            }
         }
      }
   }, function(error, response){
       if(error){
          console.log("Document already Created");
       } else {
          console.log("Creating new index");
       }
});

//Middleware
const middleware = (req, res, next) => {
   if(!req.session.email){
       res.set('X-CSE356', '61fabe3a756da8341262e078');
       res.json({error: true, message: 'User is not signed in'});
   }else{
       next();
   }
}
// Connecting to Mongo
mongoose.connect('mongodb://209.151.149.163:27017/accounts', {
    useNewUrlParser:true,
    useUnifiedTopology:true,
})

const redisClient = redis.createClient({ legacyMode: true });
redisClient.connect().catch(console.error)

//Creating the session cookie
app.use(session({
   store: new redisStore({client : redisClient}),
   secret: "CatOnTopOfATree",
   resave: false,
   saveUninitialized: true,
   cookie:{ maxAge: 12 * 60 * 60 * 1000}
}))

sharedb.types.register(richText.type);
const options = {
   WebSocket: WebSocket,
   connectionTimeout: 1000,
   maxRetries: 10,
};
var socket = new ReconnectingWebSocket('ws://209.151.149.163:8080', [], options);
var connection = new sharedb.Connection(socket);

//Creating the transporter to send email from Gmail

const transporter = nodemailer.createTransport({
   host: 'localhost',
   port: 25,
   tls: {rejectUnauthorized: false}
});
//doc.del();

// doc.fetch(function(err) {
//    if (err) console.error(err);
//    console.log(doc.data);
// });

const storage = multer.diskStorage({
   destination: function (req, file, cb) {
     cb(null, './images/')
   },
   filename: function (req, file, cb) {
     const temp = uuidv4();
     const type = file.mimetype;
     var ext = "";
     if(file.mimetype === 'image/jpeg') {
        ext = ".jpeg"
     } else if (file.mimetype === 'image/png') {
        ext = ".png"
     } else if (file.mimetype === 'image/gif') {
        ext = ".gif"
     }
     cb(null, temp + ext);
   }
})

const upload = multer({ 
   storage: storage, 
   fileFilter: (req, file, cb) => {
      if (file.mimetype == "image/png" || file.mimetype == "image/jpeg" || file.mimetype == "image/gif") {
        cb(null, true);
      } else {
        cb(null, false);
        //return cb(new Error('Only .png, .jpg and .jpeg format allowed!'));
      }
    }
});

var docDict = [];
var topTenList = [];
var allDocs = []; //{docid : name}

function connectNewClient(req, res, next) {
   //console.log("[Connecting new client] uid: " + req.params.uid + " docid: " + req.params.docid);
   const headers = {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache, no-transform'
   };
   res.writeHead(200, headers);
   
   const docid = req.params.docid;
   let doc = docDict[docid];
   //let presence = null;
   if(!doc) {
      const temp = Documents.findOne({docID: docid});
      if(!temp) {
         res.json({error: true, message: "Document doesn't exist"});
      }
      doc = connection.get('documents', docid);

      doc.subscribe((error) => {
          if (error) throw error;
          // If doc.type is undefined, the document has not been created, so let's create it
          if (!doc.type) {
             doc.create([], 'rich-text', (error) => {
                if (error) console.error(error);
             });
          };
       });
    
      doc.on('op', function(op, source) {
         const local = `data: ${JSON.stringify({ack : op.ops})}\n\n`;
         const remote = `data: ${JSON.stringify(op.ops)}\n\n`;
         const uid = source[0];
         const docid = source[1];
         //console.log("[Received OP] op: " + op  + " from uid: " + uid + " on docid: " + docid);
         const clients = docDict[docid].clients;
         clients.forEach(client => client.id === uid ? client.res.write(local) : client.res.write(remote));
      });

      docDict[docid] = {"shareDB" : doc, "version" : 1, "clients" : [], "update": false};
   } else {
      doc = doc.shareDB;
   }

   doc.fetch(function(err) {
      if (err) console.error(err);
      //doc.del();
      //console.log("[Fetching doc] uid: " + req.params.uid + " docid: " + req.params.docid);
      //console.log("[Sending initial data] " + data);
      if(doc.data) {
         const initial = {content : doc.data.ops, version : docDict[docid].version};
         const data = `data: ${JSON.stringify(initial)}\n\n`;
         res.write(data);
      } else {
         const initial = {content : [], version : docDict[docid].version};
         const data = `data: ${JSON.stringify(initial)}\n\n`;
         res.write(data);
      }
      //console.log(doc.data)
   });

   // const temp = await Users.findOne({email: req.session.email});
   const uid = req.params.uid;

   const newClient = {
      id: uid,
      name: req.session.name,
      email: req.session.email,
      //presence: localPresence,
      res: res,
   };

   docDict[docid].clients.push(newClient);
   //console.log(docDict);
   //console.log(presence);
   //console.log("[Opening] " + docDict[docid].clients.map(client => client.id));
   req.on('close', () => {
      docDict[docid].clients = docDict[docid].clients.filter(client => client.id !== uid);
      //console.log("[Closing] " + docid);
      //console.log("[Closing] " + docDict[docid].clients.map(client => client.id));
   });
}

function sendOp(req, res) {
   const docid = req.params.docid;
   const uid = req.params.uid;
   const doc = docDict[docid].shareDB;

   const version = docDict[docid].version;
   //console.log("server version: " + version + ", client version: " + req.body.version + ", op: " + JSON.stringify(req.body.op));
   if(version === req.body.version) {
      docDict[docid].version = version + 1;
      // let index = topTenList.indexOf(docid)
      // if(index != -1){
      //    topTenList.splice(index, 1);
      // }
      // topTenList.splice(0,0, docid)
      // if(topTenList.length > 10){
      //    topTenList.splice(10, 1);
      // }
      res.json({status : "ok"});
      docDict[docid].update = true;
      doc.submitOp(new Delta(req.body.op), {source: [uid, docid] });
         // , function(err) {
         //    if (err) console.error(err);
         //    console.log("server version: " + doc.version + ", op: " + JSON.stringify(req.body.op));
         // });
   } else {
      res.json({status : "retry"});
   }
   // req.body.forEach(element => {
   //    console.log(element)
   // })
   // req.body.forEach(oplist => doc.submitOp(new Delta(oplist), {source: [uid, docid] }));
   //const delta = new Delta(req.body);
   //console.log(delta);
}

function sendPresence(req, res) {
   const docid = req.params.docid
   const uid = req.params.uid;
   const cursor = req.body;
   cursor.name = req.session.name;
   const temp = { presence : { id: uid, cursor: cursor}}
   const data = `data: ${JSON.stringify(temp)}\n\n`;
   //console.log(data);
   // const localPresence = docDict[docid].clients.find(client => client.id === uid).presence;
   // localPresence.submit(req.body);
   const clients = docDict[docid].clients;
   const filterList = clients.filter(client => client.id !== uid);
   filterList.forEach(client => client.res.write(data));
   res.json({});
}

function sendHTML(req, res, next){
   const docID = req.params.docid;
   // console.log(docID);
   // console.log(docDict);
   // let doc = docDict[docID].shareDB;
   // const temp = doc.data.ops
   // //console.log(doc.data.ops[0].insert);
   // const converter = new HTMLConverter(temp, {});
   // const html = converter.convert();
   const html = convertToHTML(docID);
   res.set('X-CSE356', '61fabe3a756da8341262e078');
   res.set('Content-Type', 'text/html');
   res.send(Buffer.from(html));
}

async function signup(req, res, next){
   const {name, password, email} = req.body;
   var ex_email = null;
   ex_email = await Users.findOne({email: email});
   const key = uuidv4();
   if(ex_email){
       res.json({error: true, message: 'Email already in use'});
   } else {
       const unverified = false;
       user = new Users({
           name: name,
           password: password,
           email: email,
           verify: unverified,
           key: key
       });
       await user.save();
       //console.log(user);
       //Sending Verification Email
       const message = await transporter.sendMail({
          from: '"Arvin Wang" ZeroAndOneTesting@gmail.com',
          to: email,
          subject: 'Verification',
          text: "http://zero-and-one.cse356.compas.cs.stonybrook.edu/users/verify?email=" + encodeURIComponent(email) + "&key=" + key,
       })
       res.set('X-CSE356', '61fabe3a756da8341262e078');
       res.json({})
   }
}

async function login(req, res, next){
   const {email, password} = req.body;
   var user = null;
   user = await Users.findOne({email: email});
   res.set('X-CSE356', '61fabe3a756da8341262e078');
   //console.log(user);
   if(!user || !user.verify) {
      res.json({error: true, message: 'Account has not been verified'});
   } else {
       if(req.session.email) { // Already has a session
         res.redirect('/home');
       } else {
           //console.log(user);
           if(user.password != password){
               res.json({error: true, message: 'Incorrect Password'});
           } else {
              //Comment out when submitting
               //
               req.session.email = email;
               req.session.name = user.name;
               res.json({name: user.name});
           }
       }
   }
}

async function verify(req, res, next){
   const {email, key} = req.query
   const user = await Users.findOne({email: email})
   res.set('X-CSE356', '61fabe3a756da8341262e078');
   if(key == user.key) {
       const verified = true;
       const updated = await Users.updateOne({email: email}, {verify: verified});
       //console.log(updated)
       if(updated){
           res.json({})
       }else{
         res.json({error: true, message: 'Already Verified'});
       }
   } else {
      res.json({error: true, message: 'Wrong Key'});
   }
}

async function createDoc(req, res, next){
   const {name} = req.body
   const newId = uuidv4();
   const document = new Documents({
      name: name,
      docID: newId
   });
   await document.save();
   
   topTenList.splice(0,0, newId)
   if(topTenList.length > 10){
      topTenList.splice(10, 1)
   }
   allDocs[document.docID] = name
   const tempArray = await List.findOne({id : '1'})
   if(!tempArray) { 
      const newList = new List({
         docs: topTenList,
         id: '1',
      });
      await newList.save();
   } else {
      //const updated = await List.updateOne({id: '1'}, {docs: topTenList});
   }

   // let doc = connection.get('documents', newId);
   
   // doc.subscribe((error) => {
   //    if (error) throw error;
   //    // If doc.type is undefined, the document has not been created, so let's create it
   //    if (!doc.type) {
   //       doc.create([], 'rich-text', (error) => {
   //          if (error) console.error(error);
   //       });
   //    };
   // });

   // doc.on('op', function(op, source) {
   //    const local = `data: ${JSON.stringify({ack : op.ops})}\n\n`;
   //    const remote = `data: ${JSON.stringify(op.ops)}\n\n`;
   //    const uid = source[0];
   //    const docid = source[1];
   //    console.log("[Received OP] op: " + op  + " from uid: " + uid + " on docid: " + docid);
   //    const clients = docDict[docid].clients;
   //    clients.forEach(client => client.id === uid ? client.res.write(local) : client.res.write(remote));
   // });

   // docDict[newId] = {"shareDB" : doc, "version" : 1, "clients" : [], "update" : false};

   //console.log(docDict);
   res.json({docid: newId});
}

app.get('/', function(req, res) {
   if(req.session.email) {
      res.redirect('/home');
   } else {
      res.redirect('/users/login');
   }
});

app.get('/upload', function(req, res){
   res.sendFile(path.join(__dirname, 'image.html'));
})

app.get('/users/signup', function(req, res){
   res.set('X-CSE356', '61fabe3a756da8341262e078');
   res.sendFile(path.join(__dirname, 'register.html'))
});

app.get('/users/login', function(req, res){
   if(req.session.email) {
      res.redirect('/home')
   } else {
       res.set('X-CSE356', '61fabe3a756da8341262e078');
       res.sendFile(path.join(__dirname, 'login.html'));
   }
});

app.post('/users/login', login);

app.post('/users/logout', async function(req, res){
   res.set('X-CSE356', '61fabe3a756da8341262e078');
   const email = req.session.email;
   req.session.destroy(function(err){
       if(err){
         res.json({error: true, message: 'Unable to Logout'});
       }
       for (key in docDict){
         const document = docDict[key]
         document.clients = document.clients.filter(client => client.email != email);
       }
       res.json({});
   });
})

app.post('/users/signup', signup);

app.get('/users/verify', verify);

app.post('/collection/create', middleware, createDoc);

app.get('/collection/list', middleware, async function(req, res){
   var docsArray = [];
   var document = {}
   for (let i = topTenList.length-1; i <= 0; i--){
      document.id = topTenList[i];
      document.name = allDocs[topTenList[i]];
      //console.log(document)
      docsArray.push({...document})
   }
   const updated = await List.updateOne({id: '1'}, {docs: topTenList});
   //console.log(docsArray);
   res.json( docsArray);
});

app.post('/collection/delete', middleware, async function(req, res){
   let index = topTenList.indexOf(req.body.docid); // Deletes from topTenList
   topTenList.splice(index, 1);
   const updated = await List.updateOne({id: '1'}, {docs: topTenList}); // Updates the TopTenList Collection
   let document = docDict[req.body.docid] // Deletes from Dictionary
   if(document) {
      let doc = document.shareDB;
      doc.destroy();
      document.shareDB = null;
      if(document.clients.length == 0){ //Checking if there are any more clients left in the document before deleting
         //console.log("Deleting document from dictionary")
         delete docDict[req.body.docid];
      }
   }
   const deleted = await Documents.deleteOne({docID: req.body.docid}); // Updates the Mongo Collections
   
   //BREAKS IF DOCUMENT IS NEVER WRITTEN IN
   await elasticClient.delete({ // Deleting contents from elastic Search
      index: 'document',
      id: req.body.docid,
   });
   if(deleted){
      res.json({})
   }
})

app.post('/media/upload', middleware, upload.single('file'), function (req, res) {
   if(req.file){
      res.json({mediaid: req.file.filename});
   } else {
      res.json({error: true, message: "Invalid file"});
   }
});

app.get('/media/access/:mediaid', middleware, function(req, res){
   const mediaID = req.params.mediaid
   //console.log(mediaID)
   const periodIndex = mediaID.lastIndexOf('.');
   const extension = mediaID.substring(periodIndex+1);
   const imageType = 'image/' + extension
   if(extension === 'jpeg' || extension === 'png' || extension === 'gif'){
      res.set('Content-Type', imageType);
   }
   res.sendFile(path.join(__dirname,'./images/' + req.params.mediaid));
})

app.get('/doc/edit/:docid', middleware, function(req, res) {
   res.sendFile(path.join(__dirname, 'index.html'))
});

app.get('/doc/connect/:docid/:uid', middleware, connectNewClient);

app.post('/doc/op/:docid/:uid', middleware, sendOp);

app.post('/doc/presence/:docid/:uid', middleware, sendPresence);

app.get('/doc/get/:docid/:uid', middleware, sendHTML);

app.get('/home', middleware, async function(req, res) {
   //const docs = await Documents.find({});
   const docs = await Documents.find({});
   if(docs){
      docs.map(doc => allDocs[doc.docID] = doc.name);
   }
   const tempArray = await List.findOne({id : '1'});
   //console.log(topTenList)
   if(tempArray && topTenList.length === 0){
      topTenList = tempArray.docs;
   }
   //const temp = topTenList.map(docID => [allDocs[docID], docID]);
   //console.log(temp);
   var temp = [];
   if(docs) {
      temp = docs.map(doc => [doc.name, doc.docID]);
      temp = temp.slice(0, 10);
   }
   res.render('pages/home', {documents : temp}); 
});

app.get('/index/search', middleware, async function(req, res){ // Implement word stop?
   //await updateSearch();
   console.log(req.query.q)
   let newString = []
   const stopwords = ['i','me','my','myself','we','our','ours','ourselves','you','your','yours','yourself','yourselves','he','him','his','himself','she','her','hers','herself','it','its','itself','they','them','their','theirs','themselves','what','which','who','whom','this','that','these','those','am','is','are','was','were','be','been','being','have','has','had','having','do','does','did','doing','a','an','the','and','but','if','or','because','as','until','while','of','at','by','for','with','about','against','between','into','through','during','before','after','above','below','to','from','up','down','in','out','on','off','over','under','again','further','then','once','here','there','when','where','why','how','all','any','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','s','t','can','will','just','don','should','now']
   const oldString = req.query.q.split(' ');
   oldString.forEach(word => !stopwords.includes(word) ? newString.push(word) : null)
   newString = newString.join(' ');
   //console.log(newString);
   const body = await elasticClient.search({
      index: 'document',
      body:{
         "query": {
            "multi_match": {
               //"operator" : "and",
               "query": newString,
               "type": "phrase_prefix",
               "fields": ["name", "content"]
            }
         },
         highlight:{
            type: "unified",
            fields:{
               content:{
                  fragment_size: 2200,
                  number_of_fragments: 10,
                  order: "score"
               }
            }
         }
      }
   });
   //console.log(body);
   const contents = body.hits.hits
   var searchArr = []
   var searchInfo = {}
   for(let i = 0; i < contents.length; i++){
      searchInfo.docid = contents[i]._id;
      searchInfo.name = contents[i]._source.name;
      if(contents[i].highlight){
         searchInfo.snippet = contents[i].highlight.content[0];
      } else { 
         searchInfo.snippet = {}
      }
      searchArr.push({...searchInfo})
   }
   //console.log(searchArr);
   res.json(searchArr);
})

async function updateSearch(){
   //console.log("Now updating Elastic Search")
   for (let docid in docDict){
      if(docDict[docid].shareDB !== null && docDict[docid].update){
         //console.log("Updating doc " + docid)
         docDict[docid].update = false;
         let htmlContent = convertToHTML(docid);
         if(htmlContent !== null || str !== ''){
            htmlContent = htmlContent.toString()
            htmlContent = htmlContent.replace(/(<([^>]+)>)/ig, '');
         }
         await elasticClient.index({ // Saving the contents into Elastic Search
            index: 'document',
            id: docid,
            body:{
               content: htmlContent,
               name: allDocs[docid]
            }, 
            refresh: true
         });
      }
   }
}

function convertToHTML(docID){
   let doc = docDict[docID].shareDB;
   const temp = doc.data.ops
   const converter = new HTMLConverter(temp, {});
   const html = converter.convert();
   return html;
}

app.get('/index/suggest', async function(req, res){
   //await updateSearch();
   const search = req.query.q + ".*"
   const body = await elasticClient.search({
      index: 'document',
      body:{
         "size": 0,
         "query": {
            "match_phrase_prefix": {
               "content": req.query.q
            }
         },
         "aggs": {
            "suggestions": {
              "significant_terms": {
                "field": "content",
                "include": search,
                "exclude": req.query.q,
                "min_doc_count": 1
              }
            }
         }
      }
   })
   // console.log(body);
   // console.log(body.aggregations.suggestions.buckets);
   let bucket = body.aggregations.suggestions.buckets
   //console.log(bucket)
   let data = []
   for(i = 0; i < bucket.length; i++){
      data.push(bucket[i].key)
   }
   res.json(data);
})

app.listen(3001, () => console.log('App is Running'));