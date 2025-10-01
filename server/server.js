// server.js - Minimal Working Version
const WebSocket = require('ws');
const http = require('http');

console.log('🚀 Starting server...');

// Create HTTP server with proper error handling
const server = http.createServer((req, res) => {
    console.log(`📨 HTTP Request: ${req.method} ${req.url}`);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Health check endpoint
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
        });
        res.end(JSON.stringify({ 
            status: 'ok',
            message: 'Video Call Server is running',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        }));
        return;
    }
    
    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// WebSocket server
const wss = new WebSocket.Server({ 
    noServer: true
});

// Simple room storage
const rooms = new Map();

wss.on('connection', (ws, req) => {
    console.log('🔗 New WebSocket connection');
    
    const clientId = Math.random().toString(36).substring(7);
    ws.id = clientId;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            console.log(`📨 Message from ${clientId}:`, message.type);
            
            switch (message.type) {
                case 'create-room':
                    createRoom(ws, message.roomId);
                    break;
                case 'join-room':
                    joinRoom(ws, message.roomId);
                    break;
                case 'leave-room':
                    leaveRoom(ws);
                    break;
                case 'offer':
                case 'answer':
                case 'ice-candidate':
                    broadcastToRoom(ws.roomId, ws, message);
                    break;
            }
        } catch (error) {
            console.error('❌ Error handling message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log(`🔌 Client disconnected: ${clientId}`);
        leaveRoom(ws);
    });
    
    ws.on('error', (error) => {
        console.error(`💥 WebSocket error:`, error);
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connected',
        clientId: clientId
    }));
});

function createRoom(ws, roomId) {
    if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    
    if (rooms.has(roomId)) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Room already exists'
        }));
        return;
    }
    
    rooms.set(roomId, new Set([ws.id]));
    ws.roomId = roomId;
    
    ws.send(JSON.stringify({
        type: 'room-created',
        roomId: roomId
    }));
    
    console.log(`✅ Room created: ${roomId}`);
}

function joinRoom(ws, roomId) {
    if (!rooms.has(roomId)) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Room not found'
        }));
        return;
    }
    
    const room = rooms.get(roomId);
    room.add(ws.id);
    ws.roomId = roomId;
    
    ws.send(JSON.stringify({
        type: 'room-joined',
        roomId: roomId,
        participants: Array.from(room)
    }));
    
    // Notify others
    broadcastToRoom(roomId, ws, {
        type: 'user-joined',
        userId: ws.id
    });
    
    console.log(`✅ User joined room: ${roomId}`);
}

function leaveRoom(ws) {
    if (!ws.roomId) return;
    
    const room = rooms.get(ws.roomId);
    if (room) {
        room.delete(ws.id);
        
        if (room.size === 0) {
            rooms.delete(ws.roomId);
            console.log(`🗑️ Room deleted: ${ws.roomId}`);
        } else {
            broadcastToRoom(ws.roomId, ws, {
                type: 'user-left',
                userId: ws.id
            });
        }
    }
    
    ws.roomId = null;
}

function broadcastToRoom(roomId, sender, message) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    wss.clients.forEach(client => {
        if (client !== sender && 
            client.readyState === WebSocket.OPEN && 
            room.has(client.id)) {
            client.send(JSON.stringify(message));
        }
    });
}


server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});


// Error handling
server.on('error', (error) => {
    console.error('💥 Server error:', error);
});

process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎉 Server successfully started!`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`📍 Health: http://localhost:${PORT}/health`);
    console.log(`🔗 WebSocket: ws://localhost:${PORT}`);
    console.log(`🏠 HTTP: http://localhost:${PORT}/`);
});