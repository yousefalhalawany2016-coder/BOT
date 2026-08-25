/**
 * KrakenSMP - Web-based Bot Manager (Persistent 24/7)
 * يحفظ البوتات في Firestore لتبقى بعد أي تحديث للموقع
 */
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const possibleRoots = [path.join(__dirname, '..'), __dirname, path.join(__dirname, '..', 'krakensmp')];
for (const r of possibleRoots) {
  if (fs.existsSync(path.join(r, 'index.html'))) {
    app.use(express.static(r));
    console.log(`[Server] Serving static from ${r}`);
    break;
  }
}
if (!fs.existsSync(path.join(__dirname, '..', 'index.html')) && !fs.existsSync(path.join(__dirname, 'index.html'))) {
  app.use(express.static(__dirname));
}

const runningBots = new Map();
const MAX_LOGS = 200;

// ===== Firestore Persistence =====
const firebaseConfig = {
  apiKey: "AIzaSyBc_iexTpvL8YSWySjbU-kHvOSAgLw3qRY",
  authDomain: "y-group-games.firebaseapp.com",
  projectId: "y-group-games",
  storageBucket: "y-group-games.firebasestorage.app",
  messagingSenderId: "1089942756101",
  appId: "1:1089942756101:web:f751962e64633891a1f56c"
};
let db = null;
async function initFirestore(){
  try{
    const { initializeApp, getApps, getApp } = await import('firebase/app');
    const { getFirestore } = await import('firebase/firestore');
    const fapp = getApps().length ? getApp() : initializeApp(firebaseConfig);
    db = getFirestore(fapp);
    console.log("[Firestore] Connected");
    // استرجاع البوتات المحفوظة وإعادة تشغيلها
    await restoreBots();
  }catch(e){
    console.warn("[Firestore] Failed:", e.message);
  }
}
async function saveBotToFirestore(botName, data){
  if(!db) return;
  try{
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'bots', botName), data, { merge: true });
  }catch(e){ console.warn("saveBot failed", e.message); }
}
async function deleteBotFromFirestore(botName){
  if(!db) return;
  try{
    const { doc, deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(db, 'bots', botName));
  }catch(e){}
}
async function restoreBots(){
  if(!db) return;
  try{
    const { collection, getDocs } = await import('firebase/firestore');
    const snap = await getDocs(collection(db, 'bots'));
    for(const d of snap.docs){
      const data = d.data();
      const botName = d.id;
      if(runningBots.has(botName)) continue;
      console.log(`[Restore] Respawning ${botName} -> ${data.serverIp}`);
      spawnBotInternal(data.serverIp, botName, data.botPassword || '', data.version || '', false);
    }
    console.log(`[Restore] Done - ${snap.size} bots restored`);
  }catch(e){ console.warn("restore failed", e.message); }
}

function spawnBotInternal(serverIp, botName, botPassword, version, persist=true){
  let host = serverIp;
  let port = '25565';
  if(serverIp.includes(':')){
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
  const child = spawn('node', [templatePath], { env, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
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
  child.on('spawn', () => console.log(`[Manager] Bot "${botName}" spawned PID=${child.pid}`));
  child.on('error', (err) => { console.error(`[Manager] Failed ${botName}:`, err.message); runningBots.delete(botName); });
  child.on('close', (code) => console.log(`[Manager] Bot "${botName}" closed code=${code}`));

  runningBots.set(botName, {
    process: child,
    pid: child.pid,
    serverIp: `${host}:${port}`,
    version: version || 'auto',
    startedAt: new Date().toISOString(),
    logs, pushLog,
    botPassword, // للاسترجاع
  });
  if(persist) saveBotToFirestore(botName, { serverIp: `${host}:${port}`, botPassword, version: version||'', createdAt: new Date().toISOString() });
  return child;
}

app.post('/start-bot', (req, res) => {
  let { serverIp, botName, botPassword, version } = req.body;
  if (!serverIp || !botName) return res.status(400).json({ success: false, message: 'serverIp و botName مطلوبان' });
  serverIp = String(serverIp).trim();
  botName = String(botName).trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (!botName) return res.status(400).json({ success: false, message: 'اسم البوت غير صالح' });
  if (runningBots.has(botName)) return res.status(409).json({ success: false, message: `الاسم "${botName}" مستخدم — اختر اسماً آخر` });

  spawnBotInternal(serverIp, botName, botPassword, version, true);
  return res.json({ success: true, message: `تم تشغيل البوت "${botName}" بنجاح` });
});

app.post('/stop-bot', async (req, res) => {
  const { botName } = req.body;
  if (!botName || !runningBots.has(botName)) return res.status(404).json({ success: false, message: 'البوت غير موجود' });
  const entry = runningBots.get(botName);
  try { entry.process.kill('SIGTERM'); setTimeout(() => { try { entry.process.kill('SIGKILL'); } catch(e){} }, 2000); } catch(e) {}
  runningBots.delete(botName);
  await deleteBotFromFirestore(botName);
  return res.json({ success: true, message: `تم إيقاف "${botName}"` });
});

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

app.get('/logs/:botName', (req, res) => {
  const entry = runningBots.get(req.params.botName);
  if(!entry) return res.json({ success: false, logs: [], message: 'البوت غير موجود' });
  res.json({ success: true, logs: entry.logs || [] });
});

app.get('/', (req, res) => {
  const candidates = [
    path.join(__dirname, '..', 'bot-generator.html'),
    path.join(__dirname, 'bot-generator.html'),
    path.join(__dirname, '..', 'krakensmp', 'bot-generator.html'),
    path.join(__dirname, '..', 'index.html'),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).send('bot-generator.html not found');
});

initFirestore().then(()=>{
  app.listen(PORT, () => {
    console.log(`[Server] KrakenSMP Bot Manager running on http://localhost:${PORT}`);
  });
});
