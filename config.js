const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

const required = ['BOT_TOKEN','TARGET_CHAT_ID'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required env vars:', missing.join(', '));
  // Non terminare forzatamente: lasciamo che l'app mostri errore in fase di avvio
}

const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(',').map(s => Number(s.trim())).filter(Boolean)
  : [];

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  TARGET_CHAT_ID: process.env.TARGET_CHAT_ID,
  ADMIN_IDS,
  PORT: process.env.PORT || 3000,
  // how to handle blocked commands: 'silence' (no response), 'log' (console.log), 'message' (reply to user)
  COMMAND_BLOCK_MODE: (process.env.COMMAND_BLOCK_MODE || 'silence').toLowerCase(),
  // message text used when COMMAND_BLOCK_MODE='message'
  COMMAND_BLOCK_MESSAGE: process.env.COMMAND_BLOCK_MESSAGE || 'Comando non disponibile.'
};
