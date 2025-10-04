const { InlineKeyboard } = require('grammy');
const { sanitizeText } = require('../utils/sanitize');
const { ADMIN_IDS, TARGET_CHAT_ID } = require('../config');

async function postHandler(ctx) {
  const from = ctx.from;
  const text = ctx.match ? ctx.match : ctx.message?.text?.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Uso: /post testo del messaggio');

  // authorization: solo admin
  if (ADMIN_IDS.length && !ADMIN_IDS.includes(from.id)) {
    return ctx.reply('Comando riservato agli admin.');
  }

  const safe = sanitizeText(text, 4000);
  const keyboard = new InlineKeyboard().url('Visita sito', 'https://example.com');

  try {
    await ctx.api.sendMessage(TARGET_CHAT_ID, safe, { reply_markup: keyboard });
    await ctx.reply('Messaggio pubblicato.');
  } catch (err) {
    console.error('Errore invio canale:', err);
    await ctx.reply('Errore invio messaggio al canale. Controlla permessi.');
  }
}

module.exports = { postHandler };
