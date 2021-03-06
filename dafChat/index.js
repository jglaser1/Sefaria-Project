'use strict';

var socketIO = require('socket.io');
const fetch = require('node-fetch');
const jwt_decode = require('jwt-decode');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db/chatrooms.db');
db.run(`DROP TABLE IF EXISTS "chatrooms"`);
db.run(`CREATE TABLE IF NOT EXISTS "chatrooms" ("name"	TEXT UNIQUE, "clients"	INTEGER DEFAULT 0, "roomStarted"	INTEGER, PRIMARY KEY("name"));`)
console.log('creating and clearing db');
var os = require('os');

var nodeStatic = require('node-static');
var http = require('http');

var PORT = process.env.PORT || 8080;
var fileServer = new(nodeStatic.Server)();
var app = http.createServer(function(req, res) {
    fileServer.serve(req, res);
    // console.log(req.headers)
}).listen(PORT);

var io = socketIO.listen(app);

const TURN_SERVER = `turn:${process.env.TURN_SERVER}?transport=udp`;

const pcConfig = {
  'iceServers': [{
      'urls': 'stun:stun.l.google.com:19302'
    },
    {
      'urls': TURN_SERVER,
      'credential': process.env.TURN_USER,
      'username': process.env.TURN_SECRET
    }
  ]
};


io.sockets.on('connection', function(socket) {

  socket.on('message', function(message) {
    var roomId = (Object.keys(socket.rooms).filter(item => item!=socket.id))[0]
    socket.to(roomId).emit('message', message);
  });

  function createNewRoom() {
    var room = Math.random().toString(36).substring(7);
    socket.join(room);
    console.log(`${socket.id} created room ${room}`)
    socket.emit('created', room, socket.id);
    db.run(`INSERT INTO chatrooms(name, clients, roomStarted) VALUES(?, ?, ?)`, [room, 1, +new Date], function(err) {
      if (err) {
        console.log(err.message);
      }
    });
  }

  socket.on('how many rooms', function() {

    db.get(`SELECT COUNT(*) FROM chatrooms`, (err, rows) => {
      if (err) {
        return console.error(err.message);
      }

      const numRows = rows["COUNT(*)"]
      socket.broadcast.emit('return rooms', numRows);
      socket.emit('route new user', numRows, pcConfig);

    });


  });


  socket.on('new room', function() {
    console.log(`${socket.id} searching for a room`)
    createNewRoom();
  });

  socket.on('create or join', function(joinOverride=false) {

    console.log(`${socket.id} searching for a room`)
    // log('Received request to create or join room ' + room);
      db.all(`SELECT name name, clients, clients from chatrooms WHERE clients = ? ORDER BY roomStarted`, [1], (err, rows) => {
        if (err) {
          return console.error(err.message);
        }
        if (rows.length >= 2 || (joinOverride == true && rows.length > 0))  {
          var row = rows[0];
          var room = row.name;
          console.log('Client ID ' + socket.id + ' joined room ' + room);

          io.sockets.in(room).emit('join', room);
          socket.join(room);
          socket.emit('joined', room, socket.id);
          io.sockets.in(room).emit('ready');
          db.run(`UPDATE chatrooms SET clients=? WHERE name=?`, [row.clients+1, room])
        }
        else {
          createNewRoom();
        }
      });

  });

  socket.on('ipaddr', function() {
    var ifaces = os.networkInterfaces();
    for (var dev in ifaces) {
      ifaces[dev].forEach(function(details) {
        if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
          socket.emit('ipaddr', details.address);
        }
      });
    }
  });

  socket.on('report user', function(room){
    socket.to(room).emit('user reported');
  });

  socket.on('bye', function(room){
    console.log(`bye received from ${socket.id} for room ${room}`)
    db.run(`DELETE FROM chatrooms WHERE name=?`, room);
    socket.leave(room);
    socket.to(room).emit('message', 'bye');
  })

  socket.on('send user info', function(userName, uid, room) {
    socket.to(room).emit('got user name', userName, uid);
  })

});
