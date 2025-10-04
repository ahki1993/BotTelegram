const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const { BOT_TOKEN, ADMIN_IDS, TARGET_CHAT_ID, PORT, ADMIN_TOKEN } = require('../config');
const { InputFile } = require('grammy');
const bot = require('../bot');

// multer may be optional in some environments; try to require it and provide a no-op
// fallback so the web server still starts even if multer is not installed.
let upload;
let hasMulter = false;
try {
  const multer = require('multer');
  const uploadDir = path.join(__dirname, '..', '..', 'uploads');
  // ensure upload directory exists so multer can write files there
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (mkdirErr) {
    console.warn('Could not create upload directory', mkdirErr && mkdirErr.message);
  }
  
  // Configure multer storage to preserve file extensions
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      // Generate unique filename while preserving extension
      const crypto = require('crypto');
      const uniqueSuffix = crypto.createHash('md5').update(`${Date.now()}-${file.originalname}`).digest('hex');
      const ext = path.extname(file.originalname);
      cb(null, uniqueSuffix + ext);
    }
  });
  
  upload = multer({ storage: storage });
  hasMulter = true;
  console.log('multer loaded, uploads enabled at', uploadDir);
} catch (e) {
  console.warn("multer not installed; file uploads disabled. To enable, run: npm install multer");
  // provide a minimal no-op replacement with the same interface used below
  upload = {
    array: () => (req, res, next) => {
      req.files = [];
      next();
    },
  };
}

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'static')));

// redirect root to admin UI
app.get('/', (req, res) => {
  return res.redirect('/home');
});

// simple auth middleware using ADMIN_TOKEN
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!ADMIN_TOKEN || token === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Helper function to determine media type and send accordingly
function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(ext)) {
    return 'photo';
  } else if (['.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v', '.3gp', '.flv', '.wmv'].includes(ext)) {
    return 'video';
  }
  return 'document'; // fallback for other file types
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.avi': 'video/avi',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.m4v': 'video/mp4',
    '.3gp': 'video/3gpp',
    '.flv': 'video/x-flv',
    '.wmv': 'video/x-ms-wmv',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function sendMediaWithCaption(chatId, filePath, caption, replyMarkup) {
  const mediaType = getMediaType(filePath);
  const mimeType = getMimeType(filePath);
  const fileStream = new InputFile(fs.createReadStream(filePath));
  
  switch (mediaType) {
    case 'photo':
      return await bot.api.sendPhoto(chatId, fileStream, { 
        caption, 
        reply_markup: replyMarkup 
      });
    case 'video':
      return await bot.api.sendVideo(chatId, fileStream, { 
        caption, 
        reply_markup: replyMarkup,
        supports_streaming: true
      });
    default:
      return await bot.api.sendDocument(chatId, fileStream, { 
        caption, 
        reply_markup: replyMarkup
      });
  }
}

// endpoint to create a post with optional inline button
// api: post con possibilità di multiple inline buttons e immagini/video
app.post('/api/post', requireAuth, upload.array('media', 5), async (req, res) => {
  // text, buttons, channelId (channelId può essere string o number)
  const { text, buttons, channelId } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Missing text' });

  // Normalizza channelId: accetta @username, ID numerico, oppure URL Telegram
  function normalizeChannelId(raw) {
    if (!raw) return raw;
    if (typeof raw === 'string') {
      // Se è un URL Telegram, estrai username
      const m = raw.match(/t\.me\/(.+)$/i);
      if (m) return '@' + m[1].replace(/^@/, '');
      // Se inizia con @ o è numerico, ok
      if (raw.startsWith('@') || /^-?\d+$/.test(raw)) return raw;
    }
    return raw;
  }

  let targetChannelId = channelId;
  if (!targetChannelId && req.body && req.body.channelId) targetChannelId = req.body.channelId;
  if (!targetChannelId && req.fields && req.fields.channelId) targetChannelId = req.fields.channelId;
  // fallback: se non specificato, usa TARGET_CHAT_ID
  if (!targetChannelId) targetChannelId = TARGET_CHAT_ID;
  targetChannelId = normalizeChannelId(targetChannelId);

  let inline_keyboard;
  try {
    const parsed = buttons ? JSON.parse(buttons) : [];
    if (Array.isArray(parsed) && parsed.length) {
      inline_keyboard = parsed.map(b => [{ text: b.text, url: b.url }]);
    }
  } catch (e) {
    console.warn('Invalid buttons json', e.message);
  }

  try {
    const files = req.files || [];
    if (files.length) {
      if (files.length === 1) {
        const f = files[0];
        const sent = await sendMediaWithCaption(targetChannelId, f.path, text, inline_keyboard ? { inline_keyboard } : undefined);
        return res.json({ ok: true, media_count: 1, message_id: sent.message_id });
      } else {
        const first = files[0];
        const main = await sendMediaWithCaption(targetChannelId, first.path, text, inline_keyboard ? { inline_keyboard } : undefined);
        const media = [];
        for (const f of files.slice(1)) {
          const mediaType = getMediaType(f.path);
          media.push({ 
            type: mediaType === 'video' ? 'video' : mediaType === 'photo' ? 'photo' : 'document', 
            media: new InputFile(fs.createReadStream(f.path)) 
          });
        }
        if (media.length) {
          await bot.api.sendMediaGroup(targetChannelId, media);
        }
        return res.json({ ok: true, media_count: files.length, message_id: main.message_id });
      }
    }

    const sent = await bot.api.sendMessage(targetChannelId, text, { reply_markup: inline_keyboard ? { inline_keyboard } : undefined });
    return res.json({ ok: true, message_id: sent.message_id });
  } catch (err) {
    console.error('API /post error', err);
    return res.status(500).json({ error: 'send_failed', details: err.message });
  }
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

// presets storage (simple file-backed)
const { dataPath } = require('../utils/dataPath');
const PRESETS_FILE = dataPath('web', 'presets.json');
function readPresets(){
  try{ return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')).presets || []; }catch(e){ return []; }
}
function writePresets(presets){
  // ensure directory exists
  try { fs.mkdirSync(path.dirname(PRESETS_FILE), { recursive: true }); } catch (e) {}
  fs.writeFileSync(PRESETS_FILE, JSON.stringify({ presets }, null, 2));
}

// Channels storage (file in data folder next to exe when packaged)
const CHANNELS_FILE = dataPath('channels.json');
function readChannels(){ try { return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8')).channels || []; } catch(e) { return []; } }
function writeChannels(channels){
  try { fs.mkdirSync(path.dirname(CHANNELS_FILE), { recursive: true }); } catch (e) {}
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify({ channels }, null, 2));
}

// Channels API: list, add, delete
app.get('/api/channels', requireAuth, (req, res) => {
  try {
    const channels = readChannels();
    return res.json({ channels });
  } catch (e) { return res.status(500).json({ error: e && e.message ? e.message : String(e) }); }
});

app.post('/api/channels', requireAuth, express.json(), (req, res) => {
  try {
    const { name, link } = req.body || {};
    if (!name || !link) return res.status(400).json({ error: 'missing_fields' });
    const channels = readChannels();
    // normalize link to id if possible: try parse number
    let id = null;
    const n = Number(link);
    if (!isNaN(n) && isFinite(n)) id = n;
    else id = link; // keep as string (username or url)
    // avoid duplicates by name or id
    if (channels.find(c => c.name === name || String(c.id) === String(id))) return res.status(409).json({ error: 'exists' });
    const obj = { id, name };
    channels.push(obj);
    writeChannels(channels);
    return res.json({ ok: true, channel: obj });
  } catch (e) { console.error('channels post err', e); return res.status(500).json({ error: e && e.message ? e.message : String(e) }); }
});

app.delete('/api/channels', requireAuth, express.json(), (req, res) => {
  try {
    const { id } = req.body || {};
    if (typeof id === 'undefined' || id === null) return res.status(400).json({ error: 'missing_id' });
    const channels = readChannels();
    const filtered = channels.filter(c => String(c.id) !== String(id));
    writeChannels(filtered);
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: e && e.message ? e.message : String(e) }); }
});

// start command config
const START_CFG_FILE = path.join(__dirname, 'start-config.json');
function readStartConfig(){
  try{ return JSON.parse(fs.readFileSync(START_CFG_FILE, 'utf8')); }catch(e){ return { description: '', message: '', buttons: [], image: null }; }
}
function writeStartConfig(cfg){
  fs.writeFileSync(START_CFG_FILE, JSON.stringify(cfg, null, 2));
}


app.get('/api/presets', (req, res) => {
  return res.json({ presets: readPresets() });
});

// CREAZIONE NUOVO PRESET
app.post('/api/presets', express.json(), (req, res) => {
  try {
    const { title, buttons } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ ok: false, error: 'missing_title' });
    }
    if (!Array.isArray(buttons) || !buttons.length) {
      return res.status(400).json({ ok: false, error: 'missing_buttons' });
    }
    // validazione pulsanti
    const validButtons = buttons.filter(b => b && typeof b.text === 'string' && b.text.trim());
    if (!validButtons.length) {
      return res.status(400).json({ ok: false, error: 'invalid_buttons' });
    }
    // carica preset esistenti
    const presets = readPresets();
    // genera nuovo id numerico
    let newId = 1;
    if (presets.length) {
      newId = Math.max(...presets.map(p => typeof p.id === 'number' ? p.id : 0)) + 1;
    }
    const newPreset = { id: newId, title: title.trim(), buttons: validButtons };
    presets.push(newPreset);
    writePresets(presets);
    return res.json({ ok: true, preset: newPreset });
  } catch (e) {
    console.error('Errore creazione preset', e);
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});

// GET start config
app.get('/api/commands/start-config', requireAuth, (req, res) => {
  try {
    const cfg = readStartConfig();
    return res.json({ ok: true, config: cfg });
  } catch (e) {
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.get('/api/presets/:id', (req, res) => {
  const id = Number(req.params.id);
  const found = readPresets().find(p => p.id === id);
  if (!found) return res.status(404).json({ error: 'not_found' });
  return res.json({ preset: found });
});

app.put('/api/presets/:id', requireAuth, express.json(), (req, res) => {
  const id = Number(req.params.id);
  const presets = readPresets();
  const idx = presets.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  // expect full preset object in body
  presets[idx] = req.body;
  writePresets(presets);
  return res.json({ ok: true, preset: presets[idx] });
});

// DELETE a preset
app.delete('/api/presets/:id', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid_id' });
    const presets = readPresets();
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not_found' });
    presets.splice(idx, 1);
    writePresets(presets);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error deleting preset', e);
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// Save start command config (supports optional image/video upload)
app.post('/api/commands/start-config', requireAuth, upload.array('media', 1), async (req, res) => {
  try {
    const { description, message, buttons } = req.body || {};
    let parsedButtons = [];
    try { parsedButtons = buttons ? JSON.parse(buttons) : []; } catch(e) { parsedButtons = []; }

    const cfg = { description: description || `Esegui /start`, message: message || '', buttons: Array.isArray(parsedButtons) ? parsedButtons : [], image: null, mediaType: null };
    // handle uploaded media (image or video)
    if (req.files && req.files.length) {
      const f = req.files[0];
      // store relative path and media type - filename now includes extension
      cfg.image = path.join('uploads', path.basename(f.filename));
      cfg.mediaType = getMediaType(f.filename);
    }

    // save to disk
    writeStartConfig(cfg);

    // update command description on Telegram
    try {
      const global = await bot.api.getMyCommands().catch(() => []);
      let newGlobal = Array.isArray(global) ? global.slice() : [];
      const idx = newGlobal.findIndex(c => c.command === 'start');
      if (idx !== -1) newGlobal[idx].description = cfg.description || `Esegui /start`;
      else newGlobal.push({ command: 'start', description: cfg.description || `Esegui /start` });
      await bot.api.setMyCommands(newGlobal);
      if (typeof bot._reloadCommands === 'function') await bot._reloadCommands();
    } catch (e) {
      console.error('Failed to update /start description on Telegram', e);
    }

    return res.json({ ok: true, config: cfg });
  } catch (e) {
    console.error('Error saving start config', e);
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// serve admin UI
app.get('/home', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'home.html'));
});

// keep /admin as redirect to /home for backwards compatibility
app.get('/admin', requireAuth, (req, res) => {
  return res.redirect('/home');
});

app.get('/createpost', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'createpost.html'));
});

// API: show commands configuration (for admin UI)
app.get('/api/commands', requireAuth, async (req, res) => {
  try {
  // force reload commands from Telegram so UI sees the latest state
  try { if (typeof bot._reloadCommands === 'function') await bot._reloadCommands(); } catch(e){}
  // get global commands
  // ensure browsers don't cache this endpoint
  res.set('Cache-Control', 'no-store');
  const global = await bot.api.getMyCommands().catch(() => []);
    // try to get scoped commands for admins if ADMIN_IDS available
    const adminCommands = [];
    if (Array.isArray(ADMIN_IDS)) {
      for (const aid of ADMIN_IDS) {
        try {
          const cmds = await bot.api.getMyCommands({ scope: { type: 'chat', chat_id: aid } }).catch(() => []);
          adminCommands.push({ admin: aid, commands: cmds });
        } catch (e) {
          adminCommands.push({ admin: aid, commands: [] });
        }
      }
    }
  return res.json({ global: global || [], admin: adminCommands });
  } catch (e) {
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// Update privileges for a command
// body: { command: 'start', allowAdmin: true|false, allowUser: true|false }
app.post('/api/commands/privileges', requireAuth, express.json(), async (req, res) => {
  const { command, allowAdmin, allowUser } = req.body || {};
  if (!command) return res.status(400).json({ error: 'missing_command' });
  try {
    // get global commands
    const global = await bot.api.getMyCommands().catch(() => []);
    let newGlobal = Array.isArray(global) ? global.slice() : [];
    const existsGlobal = newGlobal.findIndex(c => c.command === command);
    if (allowUser) {
      if (existsGlobal === -1) newGlobal.push({ command, description: `Esegui /${command}` });
    } else {
      if (existsGlobal !== -1) newGlobal.splice(existsGlobal, 1);
    }
    // update global
    const errors = [];
    try {
      await bot.api.setMyCommands(newGlobal);
    } catch (e) {
      errors.push({ scope: 'global', error: e && e.message ? e.message : String(e) });
      console.error('Failed to set global commands:', e);
    }

    // update per-admin scoped commands
    if (Array.isArray(ADMIN_IDS)) {
      for (const aid of ADMIN_IDS) {
        const scoped = await bot.api.getMyCommands({ scope: { type: 'chat', chat_id: aid } }).catch(() => []);
        let newScoped = Array.isArray(scoped) ? scoped.slice() : [];
        const idx = newScoped.findIndex(c => c.command === command);
        if (allowAdmin) {
          if (idx === -1) newScoped.push({ command, description: `Esegui /${command}` });
        } else {
          if (idx !== -1) newScoped.splice(idx, 1);
        }
        try {
          await bot.api.setMyCommands(newScoped, { scope: { type: 'chat', chat_id: aid } });
        } catch (e) {
          errors.push({ scope: `admin:${aid}`, error: e && e.message ? e.message : String(e) });
          console.error(`Failed to set commands for admin ${aid}:`, e);
        }
      }
    }

  // reload bot command cache so middleware will reflect the changes immediately
  try { if (typeof bot._reloadCommands === 'function') await bot._reloadCommands(); } catch (e) {}

    // log to console so the PowerShell GUI shows the change immediately
    try {
      const visible = allowUser ? 'now visible to users' : 'now hidden from users';
      const adminPart = allowAdmin ? 'and visible to admins' : 'and hidden for admins';
      console.log(`Command /${command} privileges updated: ${visible} ${adminPart}. Changes applied and reloaded.`);
    } catch (e) {}

    // return the updated commands so the UI can refresh without relying on cached GET
    try {
      res.set('Cache-Control', 'no-store');
      const updatedGlobal = await bot.api.getMyCommands().catch(() => []);
      const updatedAdmin = [];
      if (Array.isArray(ADMIN_IDS)) {
        for (const aid of ADMIN_IDS) {
          try {
            const cmds = await bot.api.getMyCommands({ scope: { type: 'chat', chat_id: aid } }).catch(() => []);
            updatedAdmin.push({ admin: aid, commands: cmds });
          } catch (e) { updatedAdmin.push({ admin: aid, commands: [] }); }
        }
      }
      return res.json({ ok: true, global: updatedGlobal || [], admin: updatedAdmin, errors });
    } catch (e) {
      return res.json({ ok: true, errors });
    }
  } catch (e) {
    console.error('Error updating command privileges', e);
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// Update a command (description) - for now used to edit /start
// body: { command: 'start', description: 'Nuova descrizione' }
app.post('/api/commands/update', requireAuth, express.json(), async (req, res) => {
  const { command, description } = req.body || {};
  if (!command) return res.status(400).json({ error: 'missing_command' });
  if (typeof description !== 'string') return res.status(400).json({ error: 'missing_description' });
  try {
    const errors = [];
    // update global
    const global = await bot.api.getMyCommands().catch(() => []);
    let newGlobal = Array.isArray(global) ? global.slice() : [];
    const idxGlobal = newGlobal.findIndex(c => c.command === command);
    if (idxGlobal !== -1) {
      newGlobal[idxGlobal].description = description || `Esegui /${command}`;
    } else {
      // if command not present, add it
      newGlobal.push({ command, description: description || `Esegui /${command}` });
    }
    try { await bot.api.setMyCommands(newGlobal); } catch (e) { errors.push({ scope: 'global', error: e && e.message ? e.message : String(e) }); console.error('Failed to set global commands (update):', e); }

    // update per-admin scoped commands
    if (Array.isArray(ADMIN_IDS)) {
      for (const aid of ADMIN_IDS) {
        const scoped = await bot.api.getMyCommands({ scope: { type: 'chat', chat_id: aid } }).catch(() => []);
        let newScoped = Array.isArray(scoped) ? scoped.slice() : [];
        const idx = newScoped.findIndex(c => c.command === command);
        if (idx !== -1) {
          newScoped[idx].description = description || `Esegui /${command}`;
        } else {
          newScoped.push({ command, description: description || `Esegui /${command}` });
        }
        try { await bot.api.setMyCommands(newScoped, { scope: { type: 'chat', chat_id: aid } }); } catch (e) { errors.push({ scope: `admin:${aid}`, error: e && e.message ? e.message : String(e) }); console.error(`Failed to set commands for admin ${aid} (update):`, e); }
      }
    }

    // reload cache and return updated lists
    try { if (typeof bot._reloadCommands === 'function') await bot._reloadCommands(); } catch (e) {}
    try {
      res.set('Cache-Control', 'no-store');
      const updatedGlobal = await bot.api.getMyCommands().catch(() => []);
      const updatedAdmin = [];
      if (Array.isArray(ADMIN_IDS)) {
        for (const aid of ADMIN_IDS) {
          try {
            const cmds = await bot.api.getMyCommands({ scope: { type: 'chat', chat_id: aid } }).catch(() => []);
            updatedAdmin.push({ admin: aid, commands: cmds });
          } catch (e) { updatedAdmin.push({ admin: aid, commands: [] }); }
        }
      }
      return res.json({ ok: true, global: updatedGlobal || [], admin: updatedAdmin, errors });
    } catch (e) {
      return res.json({ ok: true, errors });
    }
  } catch (e) {
    console.error('Error updating command', e);
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// Serve commands admin page
app.get('/commands', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'commands.html'));
});

// simple bot control endpoints and console UI
let botRunning = false;
// try to infer initial state (best-effort)
bot.api.getMe().then(() => { botRunning = true; }).catch(() => {});

app.get('/console', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'console.html'));
});

app.post('/api/bot/start', requireAuth, async (req, res) => {
  try {
    await bot.start();
    botRunning = true;
    return res.json({ ok: true, action: 'started' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/bot/stop', requireAuth, async (req, res) => {
  try {
    await bot.stop();
    botRunning = false;
    return res.json({ ok: true, action: 'stopped' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/bot/restart', requireAuth, async (req, res) => {
  try {
    await bot.stop();
    await bot.start();
    botRunning = true;
    return res.json({ ok: true, action: 'restarted' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/api/bot/status', requireAuth, (req, res) => {
  return res.json({ ok: true, running: !!botRunning });
});


console.log('[DEBUG] Avvio server Express sulla porta:', PORT);
const server = app.listen(PORT, (err) => {
  if (err) {
    console.error('[ERROR] Errore avvio server:', err);
  } else {
    console.log(`Web UI listening on http://localhost:${PORT}`);
  }
});

server.on('error', (err) => {
  console.error('[ERROR] Evento server.on("error"):', err);
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Please free the port or set a different PORT env var.`);
    process.exit(1);
  }
});

module.exports = app;
