const { sanitizeText } = require('../utils/sanitize');
const { isAllowed } = require('../utils/rateLimiter');

// Gestisce chat_join_request update
async function joinRequestHandler(ctx) {
  const req = ctx.update.chat_join_request;
  if (!req) return;
  const userId = req.from.id;
  const chatId = req.chat.id;

  // rate limiting per user
  if (!isAllowed(`join_${userId}`)) {
    try { await ctx.api.declineChatJoinRequest(chatId, userId); } catch(e){}
    return;
  }

  // Approviamo automaticamente (puoi aggiungere logica di controllo qui)
  try {
    await ctx.api.approveChatJoinRequest(chatId, userId);
    // invia messaggio di benvenuto nel gruppo (se il bot ha permessi per inviare messaggi)
    const welcome = `Benvenuto ${req.from.first_name || ''}!`;
    await ctx.api.sendMessage(chatId, sanitizeText(welcome));
  } catch (err) {
    console.error('Errore approvazione join request:', err);
  }
}

module.exports = { joinRequestHandler };
