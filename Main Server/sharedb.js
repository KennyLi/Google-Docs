const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const sharedb = require('sharedb');
const richText = require('rich-text');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');

sharedb.types.register(richText.type);

const db = require('sharedb-mongo')('mongodb://209.151.149.163:27017/sharedb');
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

// This was in the mongo server and the mongodb became localhost
// The reconnecting websocket would be the IP address with the correct port number