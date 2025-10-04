const bot = require('./bot');
const { startHandler } = require('./handlers/start');
const { joinRequestHandler } = require('./handlers/joinRequest');
const { newMembersHandler } = require('./handlers/newMembers');
const { postHandler } = require('./handlers/post');
const { idsHandler } = require('./handlers/debug');
const { videoHandler } = require('./handlers/video');

// Registrazione handler in maniera modulare
bot.command('start', async (ctx) => startHandler(ctx));
bot.command('help', async (ctx) => ctx.reply('Comandi disponibili: /start, /post'));
// /post testo...
bot.command('post', async (ctx) => postHandler(ctx));
// debug: mostra chat.id e user.id
bot.command('ids', async (ctx) => idsHandler(ctx));

// handler per chat_join_request (update type specifico)
bot.on('chat_join_request', async (ctx) => joinRequestHandler(ctx));

// handler per nuovi membri in gruppi (filter corretto per grammy)
// usa 'message:new_chat_members' (minuscolo, conforme ai filtri supportati)
bot.on('message:new_chat_members', async (ctx) => newMembersHandler(ctx));

// handler per video MP4
bot.on('message:video', async (ctx) => videoHandler(ctx));

// start polling
(async () => {
  console.log('Avvio bot...');
  await bot.start();
  console.log('Bot in esecuzione');
})();

// Avvia anche il server web per l'interfaccia admin
try {
  const web = require('./web/server');
  // on Windows, launch the electron console app (if available) so users see the native GUI
      try {
    if (process.platform === 'win32') {
      // Do not auto-launch the electron console when running the packaged portable exe
      // or when explicitly disabled via DISABLE_ELECTRON_CONSOLE=1.
      // Additionally, make auto-launch opt-in: only launch when the npm lifecycle
      // is 'start:console' or when ENABLE_ELECTRON_CONSOLE=1 is set. This prevents
      // `npm start` (the bot) from automatically opening the GUI.
      const path = require('path');
      const execBase = String(path.basename(process.execPath || '')).toLowerCase();
      const disabledByEnv = String(process.env.DISABLE_ELECTRON_CONSOLE || '').toLowerCase() === '1';
      const lifecycle = String(process.env.npm_lifecycle_event || '');
      const enableByEnv = String(process.env.ENABLE_ELECTRON_CONSOLE || '').toLowerCase() === '1';
      const requestedConsole = lifecycle === 'start:console' || enableByEnv;
      if (execBase.includes('telegramlinearity') || disabledByEnv) {
        console.log('Skipping auto-launch of electron console (packaged or explicitly disabled).');
      } else if (!requestedConsole) {
        console.log('Skipping auto-launch of electron console: not requested (npm lifecycle=' + lifecycle + ').');
      } else {
        // Check whether 'npm' is available on PATH before trying to spawn it.
        let hasNpm = false;
        try {
          const { execSync } = require('child_process');
          execSync('where npm', { stdio: 'ignore' });
          hasNpm = true;
        } catch (errWhere) {
          hasNpm = false;
        }
        if (!hasNpm) {
          console.warn('npm non trovato in PATH: salto l\'auto-launch della console Electron.');
        } else {
          const { spawn } = require('child_process');
          const electronConsoleDir = path.join(__dirname, '..', 'electron-console');
          // run npm run start in electron-console (detached)
          const child = spawn('npm', ['run', 'start'], { cwd: electronConsoleDir, shell: true, detached: true, stdio: 'ignore' });
          child.unref();
        }
      }
    }
  } catch (e) {
    console.warn('Could not auto-launch electron console:', e && e.message ? e.message : e);
  }
} catch (e) {
  console.error('Web server non avviato:', e.message || e);
}
