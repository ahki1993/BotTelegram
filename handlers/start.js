const fs = require('fs');
const path = require('path');
const { InputFile, InlineKeyboard } = require('grammy');
const { sanitizeText } = require('../utils/sanitize');
const { TARGET_CHAT_ID } = require('../config');

// Helper function to determine media type
function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
    return 'photo';
  } else if (['.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v'].includes(ext)) {
    return 'video';
  }
  return 'document';
}

const START_CONFIG_FILE = path.join(__dirname, '..', 'web', 'start-config.json');
const SEEN_FILE = path.join(__dirname, '..', 'web', 'seen-start.json');

function readStartConfig() {
  try { return JSON.parse(fs.readFileSync(START_CONFIG_FILE, 'utf8')); } catch (e) { return null; }
}

function readSeen() {
  try { return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')).seen || []; } catch (e) { return []; }
}

function addSeen(userId) {
  try {
    const s = readSeen();
    if (!s.includes(userId)) s.push(userId);
    fs.writeFileSync(SEEN_FILE, JSON.stringify({ seen: s }, null, 2));
  } catch (e) {
    try { fs.writeFileSync(SEEN_FILE, JSON.stringify({ seen: [userId] }, null, 2)); } catch (e2) { /* ignore */ }
  }
}

// /start handler: for first-time users check channel membership and provide different flows
async function startHandler(ctx) {
  const user = ctx.from || {};
  const userId = user.id;

  // determine if this is the user's first /start (simple file-backed persistence)
  let seen = readSeen();
  const isFirst = userId && !seen.includes(userId);

  // If first time, check membership in TARGET_CHAT_ID
  if (isFirst && userId) {
    let isMember = false;
    try {
      const member = await ctx.api.getChatMember(TARGET_CHAT_ID, userId).catch(() => null);
      if (member && typeof member.status === 'string') {
        const notMemberStatuses = ['left', 'kicked'];
        if (!notMemberStatuses.includes(member.status)) isMember = true;
      }
    } catch (e) {
      // could not determine membership, treat as non-member
      console.warn('startHandler: getChatMember failed', e && e.message ? e.message : e);
    }

    if (isMember) {
      // show list of commands and a quick /menu reply button suggestion
      try {
        const cmds = await ctx.api.getMyCommands().catch(() => []);
        let txt = 'Benvenuto! Ecco i comandi disponibili:\n\n';
        if (Array.isArray(cmds) && cmds.length) {
          for (const c of cmds) txt += `/${c.command} - ${c.description || ''}\n`;
        } else txt += '/start - Avvia\n';

        txt += '\nPuoi anche premere il pulsante "Menu" oppure inviare il comando /menu per aprire la lista.';

        // reply keyboard with /menu button
        await ctx.reply(sanitizeText(txt, 4096), { reply_markup: { keyboard: [[{ text: '/menu' }]], resize_keyboard: true, one_time_keyboard: true } });
      } catch (e) {
        console.error('startHandler: errore mostrando comandi', e);
        await ctx.reply('Benvenuto! Usa il comando /menu per vedere i comandi disponibili.');
      }

      addSeen(userId);
      return;
    } else {
      // non membro: show welcome and invite button to join the channel
      let inviteLink = null;
      try {
        const res = await ctx.api.createChatInviteLink(TARGET_CHAT_ID, { name: `invite_${userId || 'u'}_${Date.now()}`, creates_join_request: false, member_limit: 0 }).catch(() => null);
        if (res && res.invite_link) inviteLink = res.invite_link;
      } catch (e) { /* ignore */ }
      try {
        if (!inviteLink) inviteLink = await ctx.api.exportChatInviteLink(TARGET_CHAT_ID).catch(() => null);
      } catch (e) { /* ignore */ }

      // prefer configured welcome message if present
      const cfg = readStartConfig();
      const welcome = cfg && cfg.message ? cfg.message : `Ciao ${user.first_name || ''}, benvenuto!`;
      const safe = sanitizeText(welcome, 4096);
      const kb = inviteLink ? new InlineKeyboard().url('AGGIUNGIMI AL CANALE', inviteLink) : null;
      try {
        if (kb) await ctx.reply(safe, { reply_markup: kb }); else await ctx.reply(safe);
      } catch (e) {
        console.error('startHandler: errore invio welcome', e);
      }

      addSeen(userId);
      return;
    }
  }

  // non-first-time or cannot determine: fall back to saved start-config behavior
  const cfg = readStartConfig();
  try {
    if (cfg && (cfg.message || (cfg.buttons && cfg.buttons.length) || cfg.image)) {
      // build inline_keyboard like createpost: array of rows, each row = [{ text, url }]
      let inline_keyboard = undefined;
      if (Array.isArray(cfg.buttons) && cfg.buttons.length) {
        inline_keyboard = cfg.buttons.map(b => [{ text: String(b.text || '').slice(0, 64), url: String(b.url || '') }]);
      }

      const safeMessage = sanitizeText(String(cfg.message || (`Ciao ${user.first_name || ''}!`)), 4096);

      // If media specified, try to send photo/video with caption
      if (cfg.image) {
        // cfg.image is a relative path like 'uploads/xxx'
        const mediaPath = path.join(__dirname, '..', '..', cfg.image);
        if (fs.existsSync(mediaPath)) {
          const input = new InputFile(fs.createReadStream(mediaPath));
          const chatId = ctx.from && ctx.from.id ? ctx.from.id : ctx.chat.id;
          
          // Determine media type based on file extension
          const mediaType = cfg.mediaType || getMediaType(mediaPath);
          
          try {
            if (mediaType === 'video') {
              await ctx.api.sendVideo(chatId, input, {
                caption: safeMessage,
                reply_markup: inline_keyboard ? { inline_keyboard } : undefined
              });
            } else {
              await ctx.api.sendPhoto(chatId, input, {
                caption: safeMessage,
                reply_markup: inline_keyboard ? { inline_keyboard } : undefined
              });
            }
            return;
          } catch (sendErr) {
            console.error('startHandler: errore invio media', sendErr);
            // Fallback to text message
          }
        } else {
          console.warn('startHandler: media start-config non trovato:', mediaPath);
        }
      }

      // send plain message with inline keyboard if no image or image missing
      await ctx.reply(safeMessage, { reply_markup: inline_keyboard ? { inline_keyboard } : undefined });
      return;
    }
  } catch (err) {
    console.error('Errore nell invio del start-config:', err);
    // fallthrough to legacy behavior
  }

  // Legacy behavior: crea invite link (con createChatInviteLink se il bot è admin)
  const text = `Ciao ${user.first_name || ''}! Premi il pulsante per richiedere l'iscrizione.`;
  let inviteLink;
  try {
    const res = await ctx.api.createChatInviteLink(TARGET_CHAT_ID, {
      name: `invite_${user.id || 'anon'}_${Date.now()}`,
      creates_join_request: true,
      member_limit: 0
    });
    inviteLink = res.invite_link;
  } catch (err) {
    try {
      inviteLink = await ctx.api.exportChatInviteLink(TARGET_CHAT_ID);
    } catch (e) {
      console.error('Impossibile generare invite link:', e);
    }
  }

  const safe = sanitizeText(text, 1000);
  const keyboard = inviteLink
    ? new InlineKeyboard().url('Richiedi iscrizione', inviteLink)
    : new InlineKeyboard().text('Contatta admin', 'contact_admin');

  await ctx.reply(safe, { reply_markup: keyboard });
}

module.exports = { startHandler };
