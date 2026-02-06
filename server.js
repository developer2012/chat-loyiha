const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 30000,
    pingInterval: 10000
});

const PORT = process.env.PORT || 3000;
const users = new Map();
const rooms = new Map();
const queues = { "A1":[], "A2":[], "B1":[], "B2":[], "C1":[], "C2":[] };

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`[CONNECTED] ID: ${socket.id}`);

    socket.on('register_user', (data) => {
        if (!data.name || !data.level) return;
        
        const userProfile = { 
            id: socket.id, 
            name: data.name, 
            level: data.level,
            joinedAt: Date.now()
        };
        users.set(socket.id, userProfile);

        // MATCHMAKING ALGORITHM
        const currentQueue = queues[data.level];
        if (currentQueue.length > 0) {
            const partner = currentQueue.shift();
            const partnerSocket = io.sockets.sockets.get(partner.id);

            if (partnerSocket && partnerSocket.id !== socket.id) {
                const roomId = "session_" + uuidv4();
                socket.join(roomId);
                partnerSocket.join(roomId);
                
                socket.roomId = roomId;
                partnerSocket.roomId = roomId;

                rooms.set(roomId, [socket.id, partnerSocket.id]);

                // ROLES FOR WEBRTC
                socket.emit('match_found', { 
                    partner: { name: users.get(partnerSocket.id).name }, 
                    role: 'initiator' 
                });
                partnerSocket.emit('match_found', { 
                    partner: { name: users.get(socket.id).name }, 
                    role: 'receiver' 
                });
            } else {
                queues[data.level].push({ id: socket.id });
            }
        } else {
            queues[data.level].push({ id: socket.id });
        }
    });

    // WEBRTC SIGNALING RELAY
    socket.on('signal', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('signal', data);
        }
    });

    socket.on('message', (msg) => {
        if (socket.roomId && users.has(socket.id)) {
            io.to(socket.roomId).emit('message', {
                sender: users.get(socket.id).name,
                text: msg,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner_disconnected');
            rooms.delete(socket.roomId);
        }
        users.delete(socket.id);
        Object.keys(queues).forEach(lvl => {
            queues[lvl] = queues[lvl].filter(u => u.id !== socket.id);
        });
        console.log(`[DISCONNECTED] ID: ${socket.id}`);
    });
});

server.listen(PORT, () => console.log(`>>> LANGPRO ENTERPRISE CORE ON PORT ${PORT} <<<`));