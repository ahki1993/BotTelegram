// Semplice sanitizzazione: rimuove caratteri di controllo e limita la lunghezza
function sanitizeText(text, max = 4000) {
  if (!text) return '';
  // rimuovi caratteri di controllo except newline/tab
  const cleaned = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return cleaned.slice(0, max);
}

module.exports = { sanitizeText };
