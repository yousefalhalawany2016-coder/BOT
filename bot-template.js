/**
 * KrakenSMP - Bot Template (Mineflayer 24/7)
 * يعمل عبر Environment Variables من server.js
 * SERVER_IP, SERVER_PORT, BOT_USERNAME, BOT_PASSWORD, BOT_VERSION
 */
const mineflayer = require('mineflayer');

// قراءة المتغيرات من Environment
const SERVER_IP = process.env.SERVER_IP; // مثل krakensmp.falixsrv.me
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '25565', 10);
const BOT_USERNAME = process.env.BOT_USERNAME || 'KrakenWatcher';
const BOT_PASSWORD = process.env.BOT_PASSWORD || ''; // اختياري
const BOT_VERSION = process.env.BOT_VERSION || false; // false = auto-detect, أو مثل "1.20.4"

if (!SERVER_IP) {
  console.error('[Bot] SERVER_IP missing!');
  process.exit(1);
}

console.log(`[Bot] Starting as ${BOT_USERNAME} -> ${SERVER_IP}:${SERVER_PORT} [${BOT_VERSION || 'auto'}]`);

// متغير القفل لمنع تكرار الجيم مود
let hasModeChanged = false;
let bot = null;

function createBot() {
  console.log(`[Bot] Connecting to ${SERVER_IP}:${SERVER_PORT} as ${BOT_USERNAME}`);

  bot = mineflayer.createBot({
    host: SERVER_IP,
    port: SERVER_PORT,
    username: BOT_USERNAME,
    version: BOT_VERSION || false,
    // auth: 'offline' // للسيرفرات المكركة
  });

  bot.on('login', () => {
    console.log('[Bot] Logged in (login event)');
  });

  bot.on('spawn', () => {
    console.log('[Bot] Spawned - waiting for login sequence...');

    // نظام الحماية والتحقق (AuthMe / LoginSecurity)
    if (BOT_PASSWORD) {
      setTimeout(() => {
        try {
          bot.chat(`/register ${BOT_PASSWORD} ${BOT_PASSWORD}`);
          console.log('[Auth] Sent /register');
        } catch (e) {}
        setTimeout(() => {
          try {
            bot.chat(`/login ${BOT_PASSWORD}`);
            console.log('[Auth] Sent /login');
          } catch (e) {}
        }, 1200);
      }, 3000);
    }

    // نظام المشاهد (Spectator Mode Lock)
    const totalDelay = BOT_PASSWORD ? 3000 + 5000 + 1500 : 5000;
    setTimeout(() => {
      if (hasModeChanged) return;
      try {
        bot.chat(`/gamemode spectator ${BOT_USERNAME}`);
        hasModeChanged = true;
        console.log('[Spectator] Sent /gamemode spectator - LOCKED');
      } catch (e) {
        console.error('[Spectator] Failed:', e.message);
      }
    }, totalDelay);
  });

  bot.on('chat', (username, message) => {
    console.log(`[Chat] <${username}> ${message}`);
  });

  bot.on('kicked', (reason) => {
    console.warn('[Kicked]', typeof reason === 'string' ? reason : JSON.stringify(reason));
  });

  bot.on('error', (err) => {
    console.error('[Error]', err.message);
  });

  // إعادة تعيين القفل عند الانقطاع وإعادة الاتصال
  bot.on('end', (reason) => {
    console.warn(`[End] Disconnected: ${reason || 'unknown'} - hasModeChanged reset`);
    hasModeChanged = false;
    console.log('[Reconnect] Reconnecting in 5000ms...');
    setTimeout(createBot, 5000);
  });
}

createBot();

// إبقاء العملية حية + دعم pm2 / systemd
process.on('uncaughtException', (e) => console.error('[Uncaught]', e));
process.on('unhandledRejection', (e) => console.error('[Unhandled]', e));
process.on('SIGINT', () => { console.log('[SIGINT] Shutting down'); try { bot && bot.quit(); } catch(e){} process.exit(0); });
process.on('SIGTERM', () => { console.log('[SIGTERM] Shutting down'); try { bot && bot.quit(); } catch(e){} process.exit(0); });
