const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataPath } = require('../utils/dataPath');
const { ADMIN_IDS } = require('../config');

async function videoHandler(ctx) {
  const from = ctx.from;
  
  // Authorization: solo admin possono inviare video
  if (ADMIN_IDS.length && !ADMIN_IDS.includes(from.id)) {
    return ctx.reply('Solo gli admin possono inviare video.');
  }

  const video = ctx.message.video;
  if (!video) {
    return ctx.reply('Nessun video ricevuto.');
  }

  try {
    // Genera un nome file univoco
    const fileName = crypto.createHash('md5').update(`${Date.now()}-${video.file_id}`).digest('hex');
    
    // Crea la cartella uploads se non esiste
    const uploadsDir = dataPath('uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    const filePath = path.join(uploadsDir, fileName);
    
    // Ottieni il file da Telegram
    const file = await ctx.api.getFile(video.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    
    // Scarica il file
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Salva il file
    fs.writeFileSync(filePath, buffer);
    
    // Informazioni sul video
    const videoInfo = {
      file_id: video.file_id,
      file_name: fileName,
      file_size: video.file_size,
      duration: video.duration,
      width: video.width,
      height: video.height,
      mime_type: video.mime_type || 'video/mp4',
      saved_at: new Date().toISOString(),
      saved_by: from.id,
      saved_by_username: from.username || from.first_name
    };
    
    console.log('Video salvato:', videoInfo);
    
    const sizeInMB = (video.file_size / (1024 * 1024)).toFixed(2);
    const duration = video.duration ? `${Math.floor(video.duration / 60)}:${(video.duration % 60).toString().padStart(2, '0')}` : 'N/A';
    
    await ctx.reply(
      `✅ Video ricevuto e salvato con successo!\n\n` +
      `📁 Nome file: ${fileName}\n` +
      `📏 Dimensioni: ${video.width}x${video.height}\n` +
      `⏱️ Durata: ${duration}\n` +
      `💾 Dimensione: ${sizeInMB} MB\n` +
      `🎬 Formato: ${video.mime_type || 'video/mp4'}`
    );
    
  } catch (error) {
    console.error('Errore durante la gestione del video:', error);
    await ctx.reply('❌ Si è verificato un errore durante il salvataggio del video. Riprova più tardi.');
  }
}

module.exports = { videoHandler };
