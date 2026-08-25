/**
 * KrakenSMP - Web-based Bot Generator & Manager (Backend)
 * Node.js + Express + child_process.spawn
 * يستقبل POST /start-bot ويشغل bot-template.js كـ Process مستقل 24/7
 */
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
// يخدم ملفات الموقع - يدعم حالتين: (1) الريبو كامل krakensmp/ (2) مجلد server فقط
const fs = require('fs');
const possibleRoots = [path.join(__dirname, '..'), __dirname, path.join(__dirname, '..', 'krakensmp')];
for (const r of possibleRoots) {
  if (fs.existsSync(path.join(r, 'index.html'))) {
    app.use(express.static(r));
    console.log(`[Server] Serving static from ${r}`);
    break;
  }
}
// fallback: serve server folder itself if index.html not found elsewhere
if (!fs.existsSync(path.join(__dirname, '..', 'index.html')) && !fs.existsSync(path.join(__dirname, 'index.html'))) {
  app.use(express.static(__dirname));
}

// خريطة البوتات النشطة: botName -> { process, serverIp, startedAt, logs: [] }
const runningBots = new Map();
const MAX_LOGS = 200;

/**
 * POST /start-bot
 * Body: { serverIp: "krakensmp.falixsrv.me:25565", botName: "KrakenWatcher", botPassword: "123", version: "1.20.4" }
 */
app.post('/start-bot', (req, res) => {
  let { serverIp, botName, botPassword, version } = req.body;

  // Validation
  if (!serverIp || !botName) {
    return res.status(400).json({ success: false, message: 'serverIp و botName مطلوبان' });
  }

  serverIp = String(serverIp).trim();
  botName = String(botName).trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (!botName) return res.status(400).json({ success: false, message: 'اسم البوت غير صالح' });

  if (runningBots.has(botName)) {
    return res.status(409).json({ success: false, message: `الاسم "${botName}" مستخدم — اختر اسماً آخر` });
  }

  // فصل host و port
  let host = serverIp;
  let port = '25565';
  if (serverIp.includes(':')) {
    const parts = serverIp.split(':');
    host = parts[0];
    port = parts[1] || '25565';
  }

  const env = {
    ...process.env,
    SERVER_IP: host,
    SERVER_PORT: port,
    BOT_USERNAME: botName,
    BOT_PASSWORD: botPassword ? String(botPassword) : '',
    BOT_VERSION: version ? String(version) : '',
  };

  const templatePath = path.join(__dirname, 'bot-template.js');
  console.log(`[Manager] Starting bot "${botName}" -> ${host}:${port} [${version || 'auto'}]`);

  // تشغيل كـ Process مستقل
  const child = spawn('node', [templatePath], {
    env,
    detached: false, // لو true + unref() يبقى حتى لو طفى السيرفر (لكن pm2 أفضل)
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  function pushLog(line){
    const time = new Date().toLocaleTimeString('ar-EG');
    logs.push(`[${time}] ${line}`);
    if(logs.length > MAX_LOGS) logs.shift();
  }
  child.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(`[${botName}] ${text}`);
    text.split('\n').filter(Boolean).forEach(l => pushLog(l));
  });
  child.stderr.on('data', (data) => {
    const text = data.toString();
    process.stderr.write(`[${botName}][ERR] ${text}`);
    text.split('\n').filter(Boolean).forEach(l => pushLog(`[ERR] ${l}`));
  });

  child.on('spawn', () => {
    console.log(`[Manager] Bot "${botName}" spawned PID=${child.pid}`);
  });

  child.on('error', (err) => {
    console.error(`[Manager] Failed to spawn "${botName}":`, err.message);
    runningBots.delete(botName);
  });

  child.on('close', (code, signal) => {
    console.log(`[Manager] Bot "${botName}" closed code=${code} signal=${signal}`);
    // لا نحذف تلقائياً لأن bot-template.js يعمل reconnect داخلي
    // لكن إذا أغلق نهائياً نحذف من الخريطة بعد ثوانٍ
    // runningBots.delete(botName);
  });

  runningBots.set(botName, {
    process: child,
    pid: child.pid,
    serverIp: `${host}:${port}`,
    version: version || 'auto',
    startedAt: new Date().toISOString(),
    logs,
    pushLog,
  });

  return res.json({
    success: true,
    message: `تم تشغيل البوت "${botName}" بنجاح`,
    pid: child.pid,
  });
});

/**
 * POST /stop-bot
 * Body: { botName: "KrakenWatcher" }
 */
app.post('/stop-bot', (req, res) => {
  const { botName } = req.body;
  if (!botName || !runningBots.has(botName)) {
    return res.status(404).json({ success: false, message: 'البوت غير موجود' });
  }
  const entry = runningBots.get(botName);
  try {
    entry.process.kill('SIGTERM');
    setTimeout(() => { try { entry.process.kill('SIGKILL'); } catch(e){} }, 2000);
  } catch(e) {}
  runningBots.delete(botName);
  return res.json({ success: true, message: `تم إيقاف "${botName}"` });
});

/**
 * GET /bots - قائمة البوتات النشطة
 */
app.get('/bots', (req, res) => {
  const list = Array.from(runningBots.entries()).map(([name, info]) => ({
    botName: name,
    pid: info.pid,
    serverIp: info.serverIp,
    version: info.version,
    startedAt: info.startedAt,
    alive: !info.process.killed && info.process.exitCode === null,
  }));
  res.json({ success: true, bots: list });
});

/**
 * GET /logs/:botName - سجل البوت (Console)
 */
app.get('/logs/:botName', (req, res) => {
  const entry = runningBots.get(req.params.botName);
  if(!entry) return res.json({ success: false, logs: [], message: 'البوت غير موجود' });
  res.json({ success: true, logs: entry.logs || [] });
});

// صفحة افتراضية
app.get('/', (req, res) => {
  const candidates = [
    path.join(__dirname, '..', 'bot-generator.html'),
    path.join(__dirname, 'bot-generator.html'),
    path.join(__dirname, '..', 'krakensmp', 'bot-generator.html'),
    path.join(__dirname, '..', 'index.html'),
  ];
  for (const p of candidates) if (require('fs').existsSync(p)) return res.sendFile(p);
  res.status(404).send('bot-generator.html not found - تأكد من رفع ملفات الموقع مع server');
});

app.listen(PORT, () => {
  console.log(`[Server] KrakenSMP Bot Manager running on http://localhost:${PORT}`);
  console.log(`[Server] POST /start-bot -> { serverIp, botName, botPassword, version }`);
});
