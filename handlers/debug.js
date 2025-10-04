const { sanitizeText } = require('../utils/sanitize');

// /ids: risponde con chat.id e user id (solo per debug)
async function idsHandler(ctx) {
  const chat = ctx.chat || (ctx.message && ctx.message.chat) || null;
  const user = ctx.from || null;
  const chatId = chat ? chat.id : 'private';
  const userId = user ? user.id : 'unknown';

  const text = `chat.id: ${chatId}\nuser.id: ${userId}`;
  console.log('DEBUG /ids ->', { chatId, userId });
  try {
    await ctx.reply(sanitizeText(text, 200));
  } catch (e) {
    console.error('Errore reply /ids:', e);
  }
}

module.exports = { idsHandler };
