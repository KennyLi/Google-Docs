const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const sharedb = require('sharedb');
const richText = require('rich-text');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');

sharedb.types.register(richText.type);

const uri = "mongodb+srv://kenny:7zym9sA3Sf1oMq5N@google-docs.zqske8e.mongodb.net/?retryWrites=true&w=majority";
const db = require('sharedb-mongo')(uri);
const backend = new sharedb({db});

//const backend = new sharedb();

var app = express();
var server = http.createServer(app);
var webSocketServer = new WebSocket.Server({server: server});

webSocketServer.on('connection', (webSocket) => {
  var stream = new WebSocketJSONStream(webSocket);
  backend.listen(stream);
});

server.listen(8080, () => console.log('App is Running'));
//const httpServer = http.createServer(app);
//httpServer.listen(8080, () => console.log("HTTP Server running on port 8080!"));


// This was in the mongo server and the mongodb became localhost
// The reconnecting websocket would be the IP address with the correct port number