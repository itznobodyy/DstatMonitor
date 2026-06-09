const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// --- Estado global ---
const startTime = Date.now();
let totalRequests = 0;
let totalBytes = 0;

let reqThisSecond = 0;
let bytesThisSecond = 0;
let currentRps = 0;
let currentBps = 0;

const rpsHistory = [];
const ipCount = new Map();
let peakRps = 0;
let peakBps = 0;

// Contar bytes a nivel de socket TCP — captura TODO el tráfico real
server.on('connection', (socket) => {
    socket.on('data', (chunk) => {
        totalBytes += chunk.length;
        bytesThisSecond += chunk.length;
    });
});

// IP pública real — resolver el dominio de Railway
let publicIp = '...';

function resolvePublicIp() {
    // Primero intentar con el dominio de Railway
    const railwayHost = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || null;
    if (railwayHost) {
        const dns = require('dns');
        const hostname = railwayHost.replace(/^https?:\/\//, '').split('/')[0];
        dns.lookup(hostname, (err, addr) => {
            if (!err && addr) { publicIp = addr; return; }
            fallbackIp();
        });
    } else {
        fallbackIp();
    }
}

function fallbackIp() {
    // Usar whatismyipaddress o similar que devuelve la IP de salida real
    https.get('https://api64.ipify.org', (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { publicIp = d.trim(); });
    }).on('error', () => {
        // Último fallback: resolver propio hostname
        const dns = require('dns');
        const os = require('os');
        dns.lookup(os.hostname(), (err, addr) => {
            if (!err) publicIp = addr;
        });
    });
}

resolvePublicIp();
// Re-resolver cada 2 minutos por si Railway rota la IP
setInterval(resolvePublicIp, 120000);

// --- Middleware: contar requests e IPs ---
app.use((req, res, next) => {
    if (req.url === '/api/metrics') return next();

    totalRequests++;
    reqThisSecond++;

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?')
        .split(',')[0].trim();
    ipCount.set(ip, (ipCount.get(ip) || 0) + 1);

    next();
});

// Ticker cada 1 segundo — calcular métricas y notificar clientes WS
setInterval(() => {
    currentRps = reqThisSecond;
    currentBps = bytesThisSecond;
    if (currentRps > peakRps) peakRps = currentRps;
    if (currentBps > peakBps) peakBps = currentBps;

    rpsHistory.push({ rps: currentRps, bps: currentBps, t: Date.now() });
    if (rpsHistory.length > 60) rpsHistory.shift();

    reqThisSecond = 0;
    bytesThisSecond = 0;

    const payload = JSON.stringify(getMetrics());
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    });
}, 1000);

// --- Rutas ---
app.use('/img', express.static(path.join(__dirname, 'img')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/info', (req, res) => {
    res.json({ ip: publicIp, port: 443 });
});

// Ruta que acepta cualquier método y path — para absorber tráfico de ataque
app.all('/flood*', (req, res) => res.sendStatus(200));
app.all('/attack*', (req, res) => res.sendStatus(200));
app.all('/test*', (req, res) => res.sendStatus(200));
app.all('/ping', (req, res) => res.sendStatus(200));

// --- WebSocket ---
wss.on('connection', (ws) => {
    // Mandar estado actual al conectar
    ws.send(JSON.stringify(getMetrics()));
});

function getMetrics() {
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    // Top 5 IPs más activas
    const topIps = [...ipCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ip, count]) => ({ ip, count }));

    // Gbps estimado
    const gbps = (currentBps * 8) / 1e9;
    const peakGbps = (peakBps * 8) / 1e9;

    return {
        uptime,
        uptimeFormatted: formatTime(uptime),
        publicIp,
        port: PORT,
        totalRequests,
        totalBytes,
        currentRps,
        currentBps,
        peakRps,
        gbps,
        peakGbps,
        uniqueIps: ipCount.size,
        topIps,
        rpsHistory: rpsHistory.slice(-60),
        underAttack: currentRps > 50,
    };
}

function formatTime(s) {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Servidor corriendo en: http://0.0.0.0:${PORT}`);
    console.log(`📡 Listo para recibir ataques\n`);
});
