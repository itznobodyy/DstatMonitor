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
let probeStats = resetStats();

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

// Middleware primero, antes de las rutas
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/info', (req, res) => res.json({ ip: target.ip, port: target.port }));

app.get('/api/metrics', (req, res) => res.json(getMetrics()));

// Actualizar target via POST (para compatibilidad)
app.post('/api/target', (req, res) => {
    const { ip, port } = req.body;
    if (ip) target.ip = ip;
    if (port) target.port = parseInt(port);
    res.json({ ok: true, target });
});

// WebSocket — probe loop por cliente, se reinicia al cambiar target
wss.on('connection', (ws) => {
    let clientTarget = { ip: target.ip, port: target.port };
    let clientStats = resetStats();
    let clientHistory = [];
    let loopActive = false;
    let loopId = 0; // para cancelar loop viejo

    async function probeLoop(id) {
        loopActive = true;
        while (ws.readyState === WebSocket.OPEN && loopId === id) {
            const result = await probeTarget(clientTarget.ip, clientTarget.port);
            if (loopId !== id) break; // target cambió, salir
            const now = Date.now();

            clientStats.totalProbes++;

            if (result.success) {
                clientStats.successProbes++;
                clientStats.lastLatency = result.latency;
                clientStats.latencySum += result.latency;
                clientStats.avgLatency = Math.round(clientStats.latencySum / clientStats.successProbes);
                if (result.latency < clientStats.minLatency) clientStats.minLatency = result.latency;
                if (result.latency > clientStats.maxLatency) clientStats.maxLatency = result.latency;
                clientStats.currentStatus = 'online';
                clientStats.wasDown = false;
                clientHistory.push({ t: now, latency: result.latency, ok: true });
            } else {
                clientStats.failedProbes++;
                clientStats.lastLatency = null;
                clientStats.currentStatus = 'offline';
                if (!clientStats.wasDown) { clientStats.downEvents++; clientStats.wasDown = true; }
                clientHistory.push({ t: now, latency: null, ok: false });
            }

            if (clientHistory.length > 120) clientHistory.shift();

            if (ws.readyState === WebSocket.OPEN && loopId === id) {
                ws.send(JSON.stringify(buildMetrics(clientTarget, clientStats, clientHistory)));
            }

            await new Promise(r => setTimeout(r, 500));
        }
        loopActive = false;
    }

    // Recibir nuevo target desde el cliente
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'setTarget' && data.ip && data.port) {
                clientTarget = { ip: data.ip.trim(), port: parseInt(data.port) };
                clientStats = resetStats();
                clientHistory = [];
                loopId++; // invalida el loop anterior
                probeLoop(loopId);
            }
        } catch(e) {}
    });

    probeLoop(loopId);
    ws.on('close', () => { loopId = -1; });
});

function resetStats() {
    return {
        startTime: Date.now(),
        totalProbes: 0, successProbes: 0, failedProbes: 0,
        lastLatency: null, minLatency: Infinity, maxLatency: 0,
        avgLatency: 0, latencySum: 0, downEvents: 0,
        wasDown: false, currentStatus: 'checking'
    };
}

function buildMetrics(t, s, history) {
    const uptime = Math.floor((Date.now() - s.startTime) / 1000);
    const uptimePct = s.totalProbes > 0
        ? ((s.successProbes / s.totalProbes) * 100).toFixed(2)
        : '0.00';
    const recent = history.slice(-20);
    const recentLoss = recent.length > 0
        ? (((recent.filter(p => !p.ok).length) / recent.length) * 100).toFixed(0)
        : 0;
    return {
        target: t,
        uptime,
        uptimeFormatted: formatTime(uptime),
        status: s.currentStatus,
        lastLatency: s.lastLatency,
        minLatency: s.minLatency === Infinity ? null : s.minLatency,
        maxLatency: s.maxLatency,
        avgLatency: s.avgLatency,
        totalProbes: s.totalProbes,
        successProbes: s.successProbes,
        failedProbes: s.failedProbes,
        uptimePct: parseFloat(uptimePct),
        packetLoss: parseInt(recentLoss),
        downEvents: s.downEvents,
        pingHistory: history.slice(-60),
    };
}

function getMetrics() {
    return buildMetrics(target, probeStats, pingHistory);
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