const express = require('express');
const http = require('http');
const https = require('https');
const net = require('net');
const WebSocket = require('ws');
const path = require('path');
const dns = require('dns');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// Target que se monitorea
let target = { ip: '152.55.176.151', port: 443 };

// Historial de pings (últimos 60 segundos)
let pingHistory = [];
let probeStats = {
    startTime: Date.now(),
    totalProbes: 0,
    successProbes: 0,
    failedProbes: 0,
    lastLatency: null,
    minLatency: Infinity,
    maxLatency: 0,
    avgLatency: 0,
    latencySum: 0,
    downEvents: 0,
    wasDown: false,
    currentStatus: 'checking', // 'online' | 'offline' | 'checking'
};

let serverIp = '0.0.0.0';

// Resolver IP pública del servidor de monitoreo
https.get('https://api.ipify.org', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => { serverIp = data.trim(); });
}).on('error', () => {
    dns.lookup(os.hostname(), (err, addr) => {
        if (!err) serverIp = addr;
    });
});

// Función para hacer un probe TCP al objetivo
function probeTarget(ip, port, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const socket = new net.Socket();

        socket.setTimeout(timeoutMs);

        socket.connect(port, ip, () => {
            const latency = Date.now() - start;
            socket.destroy();
            resolve({ success: true, latency });
        });

        socket.on('error', () => {
            socket.destroy();
            resolve({ success: false, latency: null });
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve({ success: false, latency: null });
        });
    });
}

// Loop de monitoreo: probe cada 500ms
async function monitorLoop() {
    while (true) {
        const result = await probeTarget(target.ip, target.port);
        const now = Date.now();

        probeStats.totalProbes++;

        if (result.success) {
            probeStats.successProbes++;
            probeStats.lastLatency = result.latency;
            probeStats.latencySum += result.latency;
            probeStats.avgLatency = Math.round(probeStats.latencySum / probeStats.successProbes);
            if (result.latency < probeStats.minLatency) probeStats.minLatency = result.latency;
            if (result.latency > probeStats.maxLatency) probeStats.maxLatency = result.latency;
            probeStats.currentStatus = 'online';
            probeStats.wasDown = false;

            pingHistory.push({ t: now, latency: result.latency, ok: true });
        } else {
            probeStats.failedProbes++;
            probeStats.lastLatency = null;
            probeStats.currentStatus = 'offline';

            if (!probeStats.wasDown) {
                probeStats.downEvents++;
                probeStats.wasDown = true;
            }

            pingHistory.push({ t: now, latency: null, ok: false });
        }

        // Mantener solo los últimos 120 pings (~60s a 500ms)
        if (pingHistory.length > 120) pingHistory.shift();

        await new Promise(r => setTimeout(r, 500));
    }
}

monitorLoop();

// Middleware primero, antes de las rutas
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/info', (req, res) => res.json({ ip: target.ip, port: target.port }));

app.get('/api/metrics', (req, res) => res.json(getMetrics()));

// Actualizar target via POST
app.post('/api/target', (req, res) => {
    const { ip, port } = req.body;
    if (ip) target.ip = ip;
    if (port) target.port = parseInt(port);
    // Reset stats al cambiar objetivo
    probeStats = {
        startTime: Date.now(),
        totalProbes: 0, successProbes: 0, failedProbes: 0,
        lastLatency: null, minLatency: Infinity, maxLatency: 0,
        avgLatency: 0, latencySum: 0, downEvents: 0,
        wasDown: false, currentStatus: 'checking'
    };
    pingHistory = [];
    res.json({ ok: true, target });
});

// WebSocket — push métricas cada segundo
wss.on('connection', (ws) => {
    const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(getMetrics()));
        }
    }, 1000);
    ws.on('close', () => clearInterval(interval));
});

function getMetrics() {
    const uptime = Math.floor((Date.now() - probeStats.startTime) / 1000);
    const uptimePct = probeStats.totalProbes > 0
        ? ((probeStats.successProbes / probeStats.totalProbes) * 100).toFixed(2)
        : '0.00';

    // Calcular packet loss en los últimos 20 pings
    const recent = pingHistory.slice(-20);
    const recentLoss = recent.length > 0
        ? (((recent.filter(p => !p.ok).length) / recent.length) * 100).toFixed(0)
        : 0;

    return {
        target: target,
        uptime,
        uptimeFormatted: formatTime(uptime),
        status: probeStats.currentStatus,
        lastLatency: probeStats.lastLatency,
        minLatency: probeStats.minLatency === Infinity ? null : probeStats.minLatency,
        maxLatency: probeStats.maxLatency,
        avgLatency: probeStats.avgLatency,
        totalProbes: probeStats.totalProbes,
        successProbes: probeStats.successProbes,
        failedProbes: probeStats.failedProbes,
        uptimePct: parseFloat(uptimePct),
        packetLoss: parseInt(recentLoss),
        downEvents: probeStats.downEvents,
        pingHistory: pingHistory.slice(-60),
    };
}

function formatTime(s) {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Monitor corriendo en: http://0.0.0.0:${PORT}\n`);
    console.log(`📡 Monitoreando: ${target.ip}:${target.port}\n`);
});