const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

// ── Configuration ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// Find Local IP Address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  
  // 1. Try to find the Wi-Fi adapter first
  for (const name of Object.keys(interfaces)) {
    if (name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wlan') || name.toLowerCase().includes('wireless')) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  }

  // 2. Fallback to any other physical-looking adapter
  for (const name of Object.keys(interfaces)) {
    if (name.toLowerCase().includes('vmware') || name.toLowerCase().includes('virtual') || name.toLowerCase().includes('vethernet') || name.toLowerCase().includes('wsl')) continue;
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const HOST = getLocalIP();

// ── App Setup ────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  maxHttpBufferSize: 5e7,
  cors: { origin: "*" } // Ensure cross-device connectivity
});

app.use(express.static(__dirname));

app.get('/mobile', (req, res) => {
  res.sendFile(path.join(__dirname, 'mobile.html'));
});

// Setup Socket.IO
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Send server info to help desktop app identify its network URL
  socket.emit('server-info', { ip: HOST, port: PORT });

  socket.on('send-image', (data) => {
    console.log(`Image received from mobile for: ${data.target}`);
    socket.broadcast.emit('receive-image', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('=============================================');
  console.log('🚀 AuraSync Engineering Server Active');
  console.log('=============================================');
  console.log(`🖥️  Desktop:  http://localhost:${PORT}`);
  console.log(`📱 Mobile:   http://${HOST}:${PORT}/mobile`);
  console.log('=============================================');
  console.log('Note: Ensure your phone is on the SAME WiFi.');
});
