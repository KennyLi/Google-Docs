const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const sharedb = require('sharedb/lib/client')
const ReconnectingWebSocket = require('reconnecting-websocket');
const richText = require('rich-text');
const Delta = require('quill-delta');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const MongoClient = require('mongodb').MongoClient;

const app = express();

app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json( {limit: '10MB'}));
app.use(express.urlencoded({ extended: true }));

sharedb.types.register(richText.type);
const options = {
   WebSocket: WebSocket,
   connectionTimeout: 1000,
   maxRetries: 10,
};
let socket = new ReconnectingWebSocket('ws://localhost:8080', [], options);
//let socket = new ReconnectingWebSocket('ws://test.emailgravely.com:8080/', [], options);
let connection = new sharedb.Connection(socket);


let doc = null;
let version = 1;
let clients = [];

function connectNewClient(req, res, next) {
   const headers = {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache, no-transform'
   };
   res.writeHead(200, headers);
   
   const uid = req.params.uid;
   clients.push({uid: uid, res: res});
   //console.log(clients)
   //console.log(doc)
   if(!doc) {
      doc = connection.get('documents', "testdocument");
      
      doc.subscribe((error) => {
         console.log("test");
         if (error) throw error;
         // If doc.type is undefined, the document has not been created, so let's create it
         if (!doc.type) {
            console.log(doc);
            doc.create([], 'rich-text', (error) => {
               console.log("done");
               if (error) console.error(error);
            });
         };
      });

      doc.on('op', function(op, source) {
         const local = `data: ${JSON.stringify({ack : op.ops})}\n\n`;
         const remote = `data: ${JSON.stringify(op.ops)}\n\n`;
         const uid = source;
         clients.forEach(client => client.uid === uid ? client.res.write(local) : client.res.write(remote));
      });
   }

   doc.fetch(function(err) {
      if (err) console.error(err);
      if(doc.data) {
         //console.log(version)
         const initial = {content : doc.data.ops, version : version};
         const data = `data: ${JSON.stringify(initial)}\n\n`;
         res.write(data);
      } else {
         const initial = {content : [], version : version};
         const data = `data: ${JSON.stringify(initial)}\n\n`;
         res.write(data);
      }
   });

   req.on('close', () => {
      clients = clients.filter(client => client.uid !== uid);
   });
}

function sendOp(req, res) {
   if(version === req.body.version) {
      version++;
      res.json({status : "ok"});
      doc.submitOp(new Delta(req.body.op), {source: req.params.uid });
   } else {
      res.json({status : "retry"});
   }
}

app.get('/', function(req, res) {
   res.sendFile(path.join(__dirname, 'index.html'))
});

app.get('/connect/:uid', connectNewClient);

app.post('/op/:uid', sendOp);


app.listen(3000, () => console.log('App is Running'));
//const httpServer = http.createServer(app);
//httpServer.listen(80, () => console.log("HTTP Server running on port 80!"));