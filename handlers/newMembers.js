const { sanitizeText } = require('../utils/sanitize');

async function newMembersHandler(ctx) {
  const msg = ctx.message;
  if (!msg || !msg.new_chat_members) return;
  for (const member of msg.new_chat_members) {
    // evita di salutare bot
    if (member.is_bot) continue;
    const text = `Benvenuto ${member.first_name || ''}! Scrivi /help per iniziare.`;
    try { await ctx.reply(sanitizeText(text)); } catch (e) { console.error(e); }
  }
}

module.exports = { newMembersHandler };
