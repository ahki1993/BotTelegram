const { Bot } = require('grammy');
let conversations;
try {
  conversations = require('@grammyjs/conversations').conversations;
} catch (e) {
  console.warn('Optional package @grammyjs/conversations not installed. Conversations will be disabled. To enable run: npm install @grammyjs/conversations');
}
const { BOT_TOKEN, ADMIN_IDS, COMMAND_BLOCK_MODE, COMMAND_BLOCK_MESSAGE } = require('./config');

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN non impostato. Controlla .env');
}

const bot = new Bot(BOT_TOKEN);

// simple cache for commands to avoid calling Telegram API on every message
const commandCache = { ts: 0, global: [], scoped: new Map() };
async function loadCommands(force = false) {
  const now = Date.now();
  if (!force && commandCache.ts && (now - commandCache.ts) < 30000) return commandCache;
  try {
    const global = await bot.api.getMyCommands().catch(() => []);
    commandCache.global = Array.isArray(global) ? global : [];
    commandCache.scoped = new Map();
    if (Array.isArray(ADMIN_IDS)) {
      for (const aid of ADMIN_IDS) {
        try {
          const scoped = await bot.api.getMyCommands({ scope: { type: 'chat', chat_id: aid } }).catch(() => []);
          commandCache.scoped.set(String(aid), Array.isArray(scoped) ? scoped : []);
        } catch (e) {
          commandCache.scoped.set(String(aid), []);
        }
      }
    }
    commandCache.ts = Date.now();
  } catch (e) {
    // ignore
  }
  return commandCache;
}

bot._invalidateCommandCache = function(){ commandCache.ts = 0; };

// force reload from Telegram
bot._reloadCommands = async function(){
  try { return await loadCommands(true); } catch(e) { return commandCache; }
};

// Middleware: intercept slash commands and block them for non-authorized users
bot.use(async (ctx, next) => {
  try {
    const text = ctx.message && ctx.message.text ? ctx.message.text : (ctx.update && ctx.update.message && ctx.update.message.text ? ctx.update.message.text : '');
    if (!text || !text.startsWith('/')) return next();
    const cmd = text.split(/[\s@]/)[0].slice(1).trim();
    if (!cmd) return next();
    const uid = ctx.from && ctx.from.id;
    // admins always allowed
    if (Array.isArray(ADMIN_IDS) && uid && ADMIN_IDS.includes(uid)) return next();
    // load cached commands
    const cache = await loadCommands();
    const inGlobal = cache.global && cache.global.some(c => c.command === cmd);
    let allowed = !!inGlobal;
    if (!allowed && uid) {
      const scoped = cache.scoped && cache.scoped.get(String(uid));
      if (Array.isArray(scoped) && scoped.some(c => c.command === cmd)) allowed = true;
    }
    if (!allowed) {
      // handle based on configured mode
      const mode = (COMMAND_BLOCK_MODE || 'silence').toLowerCase();
      try {
        if (mode === 'log') {
          console.log(`Blocked command /${cmd} from user ${uid}`);
        } else if (mode === 'message') {
          // attempt to reply to user with configured message
          try {
            if (ctx.chat && ctx.chat.id) ctx.api.sendMessage(ctx.chat.id, COMMAND_BLOCK_MESSAGE || 'Comando non disponibile.');
          } catch (e) {
            // ignore send errors
          }
        }
      } catch (e) {}
      // do not call next => effectively ignore the command
      return;
    }
  } catch (e) {
    // on error, fail-open and continue
  }
  return next();
});

// enable conversations plugin if available
if (conversations) {
  // lightweight in-memory session store for conversations (sufficient for single-instance use)
  const sessions = new Map();
  bot.use(async (ctx, next) => {
    try {
      const sid = ctx.chat?.id ?? ctx.from?.id ?? 'global';
      if (!sessions.has(sid)) sessions.set(sid, {});
      ctx.session = sessions.get(sid);
    } catch (e) {
      ctx.session = ctx.session || {};
    }
    return next();
  });

  bot.use(conversations());
  // register createpost conversation
  try {
    const createPostConv = require('./handlers/createpost');
  bot.use(createPostConv);
  bot.command('createpost', async ctx => ctx.conversation.enter('createPostConversation'));
  } catch (e) {
    console.warn('createpost handler not available:', e.message);
  }
  // register preset conversation handler
  try {
    const presetConv = require('./handlers/preset');
    bot.use(presetConv);
    bot.command('preset', async ctx => ctx.conversation.enter('createPresetConversation'));
  } catch (e) {
    console.warn('preset handler not available:', e.message);
  }
} else {
  console.warn('/createpost command disabled until @grammyjs/conversations is installed');
}


// utility command to show your Telegram user id (helpful to add to ADMIN_IDS)
bot.command('id', async ctx => {
  if (ctx.from && ctx.from.id) {
    await ctx.reply(`Your Telegram id: ${ctx.from.id}`);
  } else {
    await ctx.reply('Unable to determine your id.');
  }
});
// middleware: basic error handler
bot.catch((err) => {
  console.error('Bot error', err);
});

// Logga le informazioni del bot all'avvio per facilitare il debug
bot.api.getMe().then(me => {
  console.log(`Bot info: @${me.username} (id: ${me.id})`);
}).catch(err => {
  console.error('Impossibile ottenere le info del bot (controlla BOT_TOKEN):', err.message || err);
});

// Imposta comandi visibili nel menu di Telegram e forza il pulsante menu a mostrare i comandi
// Questi comandi appariranno nell'elenco / e possono essere mostrati come icona/menu nella UI Telegram
try {
  // Default commands for all users: only /start
  const defaultCommands = [
    { command: 'start', description: 'Avvia interazione con il bot' }
  ];
  bot.api.setMyCommands(defaultCommands).then(() => {
    console.log('Comandi di default impostati (solo /start per tutti gli utenti).');
  }).catch((e) => {
    console.warn('Impossibile impostare i comandi di default:', e && e.message ? e.message : e);
  });

  // If ADMIN_IDS defined, set scoped commands for each admin (so they see full menu)
  if (Array.isArray(ADMIN_IDS) && ADMIN_IDS.length) {
    const adminCommands = [
  { command: 'createpost', description: 'Crea un post usando i preset' },
  { command: 'preset', description: 'Gestisci i preset' },
      { command: 'id', description: "Mostra il tuo Telegram id" },
      { command: 'start', description: 'Avvia interazione con il bot' }
    ];
    for (const aid of ADMIN_IDS) {
      try {
        // scope by private chat (chat_id = user id) so this user sees these commands in their DM with the bot
        bot.api.setMyCommands(adminCommands, { scope: { type: 'chat', chat_id: aid } }).then(() => {
          console.log(`Comandi impostati per admin ${aid}`);
        }).catch((e) => {
          console.warn(`Impossibile impostare i comandi per admin ${aid}:`, e && e.message ? e.message : e);
        });
      } catch (e) {
        console.warn(`Errore impostando comandi per admin ${aid}:`, e && e.message ? e.message : e);
      }
    }
  }

  // Imposta il menu predefinito per mostrare i comandi (alcuni client Telegram mostreranno l'icona/menu)
  try {
    if (typeof bot.api.setMyMenuButton === 'function') {
      bot.api.setMyMenuButton({ type: 'commands' }).then(() => {
        console.log('Menu del bot impostato per mostrare i comandi.');
      }).catch(() => {});
    }
  } catch (e) {
    // ignore
  }
} catch (e) {
  console.warn('Errore durante la configurazione dei comandi/menu del bot:', e && e.message ? e.message : e);
}

module.exports = bot;
