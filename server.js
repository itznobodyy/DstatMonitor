const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

let metrics = {
    startTime: Date.now(),
    requests: 0,
    bytesIn: 0,
    requestRate: 0,
    attacksDetected: 0
};

let lastRequestCount = 0;

// Contar requests
app.use((req, res, next) => {
    metrics.requests++;
    metrics.bytesIn += JSON.stringify(req.body).length + req.url.length;
    res.on('finish', () => {});
    next();
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// API de métricas
app.get('/api/metrics', (req, res) => res.json(getMetrics()));

// WebSocket
wss.on('connection', (ws) => {
    const interval = setInterval(() => {
        metrics.requestRate = metrics.requests - lastRequestCount;
        lastRequestCount = metrics.requests;
        
        if (metrics.requestRate > 100) metrics.attacksDetected++;
        
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(getMetrics()));
        }
    }, 1000);

    ws.on('close', () => clearInterval(interval));
});

function getMetrics() {
    const uptime = Math.floor((Date.now() - metrics.startTime) / 1000);
    const seconds = (Date.now() - metrics.startTime) / 1000;
    const gbps = ((metrics.bytesIn / seconds) * 8) / 1e9;
    
    return {
        uptime,
        uptimeFormatted: formatTime(uptime),
        bandwidth: Math.min(gbps, 99.99),
        requestRate: metrics.requestRate,
        attacksDetected: metrics.attacksDetected
    };
}

function formatTime(s) {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Servidor corriendo en: http://0.0.0.0:${PORT}\n`);
});