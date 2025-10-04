const fs = require('fs');
const path = require('path');
const { InputFile } = require('grammy');
const { createConversation } = require('@grammyjs/conversations');
const { ADMIN_IDS } = require('../config');
const { dataPath } = require('../utils/dataPath');

const CHANNELS_FILE = dataPath('channels.json');
const PRESETS_FILE = dataPath('web', 'presets.json');
const NAV_ROW = [{ text: '↩️ Torna indietro', callback_data: 'nav:back' }, { text: '❌ Termina', callback_data: 'nav:abort' }];
function readPresets(){
  try { return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')).presets || []; } catch(e) { return []; }
}

// helper: check if a conversation.wait() result indicates a forced terminate
function checkTerminate(waitResult, ctx) {
  if (!waitResult) return false;
  // normalize possible shapes into a text string
  let text = null;

  // direct string
  if (typeof waitResult === 'string') text = waitResult;

  // common ctx-like object with .message
  if (!text && waitResult.message && typeof waitResult.message.text === 'string') text = waitResult.message.text;
  // qui puoi aggiungere altre normalizzazioni se servono
  // ritorna true se il testo è "nav:abort" o "nav:back" ecc.
  return text === 'nav:abort' || text === 'nav:back';
}

    // ...existing code...

    async function createPostConversation(conversation, ctx) {
      const userId = ctx.from && ctx.from.id;
      if (!userId || !ADMIN_IDS || !Array.isArray(ADMIN_IDS) || !ADMIN_IDS.includes(userId)) {
        await ctx.reply('Non autorizzato. Solo amministratori possono usare questo comando.');
        return;
      }

      // 1) Scegli il canale di destinazione
      let channels = [];
      try {
        channels = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8')).channels || [];
      } catch(e) { channels = []; }
      if (!channels.length) {
        await ctx.reply('Nessun canale configurato.');
        return;
      }
  const channelKeyboard = channels.map(c => [{ text: c.name, callback_data: `channel:${encodeURIComponent(String(c.id))}` }]);
      channelKeyboard.push([NAV_ROW[0], NAV_ROW[1]]);
      await ctx.reply('In quale canale vuoi inviare il post?', { reply_markup: { inline_keyboard: channelKeyboard } });
      let channelId = null;
      let channelName = null;
      while (true) {
        const chCtx = await conversation.wait();
        if (checkTerminate(chCtx, ctx)) return;
        if (!chCtx || !chCtx.update || !chCtx.update.callback_query) continue;
        const cbq = chCtx.update.callback_query;
        if (typeof cbq.data !== 'string') continue;
        if (cbq.data === 'nav:back') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Torna indietro' }).catch(()=>{}); continue; }
        if (cbq.data === 'nav:abort') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Terminato' }).catch(()=>{}); return; }
        if (cbq.data.startsWith('channel:')) {
          // decode original id (may be numeric id, @username, or t.me link)
          const raw = decodeURIComponent(cbq.data.slice('channel:'.length));
          // normalize for sending via Telegram API
          let target;
          if (/^-?\d+$/.test(raw)) {
            // pure integer id
            target = Number(raw);
          } else if (/^(?:https?:\/\/)?t\.me\//i.test(raw)) {
            // t.me/username or https://t.me/username -> use @username
            const uname = raw.replace(/^(?:https?:\/\/)?t\.me\//i, '').replace(/^@/, '');
            target = `@${uname}`;
          } else if (raw.startsWith('@')) {
            target = raw;
          } else {
            // assume username string
            target = raw;
          }
          // find matching channel entry by comparing strings
          const ch = channels.find(c => String(c.id) === String(raw));
          channelName = ch ? ch.name : null;
          channelId = target;
          await ctx.api.answerCallbackQuery(cbq.id, { text: `Canale selezionato: ${channelName || raw}` }).catch(()=>{});
          break;
        }
      }

      // 2) Scegli il preset (come prima)
      let presets = readPresets();
      let chosenPreset = null;
      const inline_keyboard = [];
      for (const p of presets) {
        inline_keyboard.push([{ text: p.title, callback_data: `preset:${p.id}` }]);
      }
      inline_keyboard.push([{ text: 'Libero', callback_data: 'preset:free' }]);
      const promptText = 'Prima di creare un post, scegli il preset di comandi desiderato oppure, se ne hai la necessità usa il tasto "Modifica" per poter modificare i preset a disposizione';
      inline_keyboard.push([{ text: 'MODIFICA PRESET', callback_data: 'preset:modify' }]);
      inline_keyboard.push([NAV_ROW[0], NAV_ROW[1]]);
      await ctx.reply(promptText, { reply_markup: { inline_keyboard } });
      let cbCtx;
      while (true) {
        cbCtx = await conversation.wait();
        if (checkTerminate(cbCtx && (cbCtx.update || cbCtx.message) ? (cbCtx.update || cbCtx.message) : cbCtx, ctx)) return;
        if (!cbCtx || !cbCtx.update || !cbCtx.update.callback_query) continue;
        const cbq = cbCtx.update.callback_query;
        if (typeof cbq.data !== 'string') {
          await ctx.api.answerCallbackQuery(cbq.id, { text: 'Callback senza dati', show_alert: false }).catch(()=>{});
          continue;
        }
        try {
          const who = cbq.from && cbq.from.id;
          if (who !== userId) {
            await ctx.api.answerCallbackQuery(cbq.id, { text: "Questo pulsante non è per te", show_alert: false });
            continue;
          }
        } catch (e) {}
        if (cbq.data === 'nav:back') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Torna indietro' }).catch(()=>{}); continue; }
        if (cbq.data === 'nav:abort') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Terminato' }).catch(()=>{}); return; }
        try { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Scelta ricevuta' }); } catch (e) {}
        if (cbq.data === 'preset:modify') {
          try {
            const modResult = await handlePresetModification(conversation, ctx);
            if (modResult === 'finish') {
              await ctx.reply('Modifiche terminate. Torno alla chat principale.');
              return;
            }
            presets = readPresets();
            continue;
          } catch (e) {
            await ctx.reply('Errore durante la modifica preset: ' + e.message);
            continue;
          }
        }
        break;
      }
      const data = (cbCtx.update.callback_query && cbCtx.update.callback_query.data) ? cbCtx.update.callback_query.data : '';
      if (data === 'preset:free') {
        chosenPreset = null;
        await ctx.reply('Hai scelto: Libero');
      } else if (data.startsWith('preset:')) {
        const id = Number(data.split(':')[1]);
        if (isNaN(id)) {
          chosenPreset = null;
        } else {
          chosenPreset = presets.find(p => p.id === id) || null;
          if (chosenPreset) {
            let s = `Hai scelto preset: ${chosenPreset.title}\n`;
            if (chosenPreset.buttons && chosenPreset.buttons.length) {
              s += 'Bottoni:\n';
              for (const b of chosenPreset.buttons) s += `- ${b.text}: ${b.url}\n`;
            }
            await ctx.reply(s);
          }
        }
      } else {
        let choiceMsg;
        while (true) {
          choiceMsg = await conversation.wait();
          if (checkTerminate(choiceMsg, ctx)) return;
          if (choiceMsg && choiceMsg.message && choiceMsg.message.text) break;
        }
        const choiceText = choiceMsg.message.text.trim();
        if (choiceText.toLowerCase() !== 'libero') {
          const id = Number(choiceText);
          chosenPreset = presets.find(p => p.id === id) || null;
        }
      }
      // Dopo la scelta di un preset non proponiamo più la modifica immediata;
      // si procede direttamente alla composizione del post. Se si vuole
      // modificare i preset, si usa l'opzione "MODIFICA PRESET" nella schermata iniziale.

      // 2) ask for text
      await ctx.reply('Inserisci il testo del post:');
      let textMsg;
      while (true) {
        textMsg = await conversation.wait();
        if (textMsg && textMsg.message && textMsg.message.text) break;
      }
      const text = textMsg.message.text;

      // 3) ask for images
      await ctx.reply('Invia fino a 5 immagini (una per messaggio). Quando hai finito scrivi "fine".');
      const images = [];
      while (images.length < 5) {
        const m = await conversation.wait();
        if (checkTerminate(m, ctx)) return;
        if (m && m.message && typeof m.message.text === 'string' && m.message.text.trim().toLowerCase() === 'fine') break;
        // accetta solo se m.message esiste e ha photo
        if (m && m.message && Array.isArray(m.message.photo) && m.message.photo.length) {
          // get highest quality
          const photo = m.message.photo[m.message.photo.length - 1];
          images.push(photo.file_id);
          await ctx.reply(`Ricevuta immagine (${images.length})`);
        } else {
          await ctx.reply('Per favore invia una foto oppure scrivi "fine" per continuare.');
        }
      }

      // 4) preview
      let preview = `Anteprima:\n${text}\n`;
      if (chosenPreset && chosenPreset.buttons && chosenPreset.buttons.length) {
        preview += 'Pulsanti:\n';
        for (const b of chosenPreset.buttons) preview += `- ${b.text}: ${b.url}\n`;
      }
      await ctx.reply(preview + '\nConfermi invio? (si/no)');
      let confMsg;
      while (true) {
        confMsg = await conversation.wait();
        if (checkTerminate(confMsg, ctx)) return;
        if (confMsg && confMsg.message && confMsg.message.text) break;
      }
      const conf = confMsg.message.text.trim().toLowerCase();
      if (conf !== 'si' && conf !== 's') { await ctx.reply('Operazione annullata'); return; }

      // 5) invia al canale selezionato
      try {
        console.log('createpost sending to', channelId, 'channelName=', channelName);
        const inline_keyboard = chosenPreset && chosenPreset.buttons ? chosenPreset.buttons.map(b => [{ text: b.text, url: b.url }]) : undefined;
        if (images.length === 0) {
          await ctx.api.sendMessage(channelId, text, { reply_markup: inline_keyboard ? { inline_keyboard } : undefined });
        } else if (images.length === 1) {
          await ctx.api.sendPhoto(channelId, images[0], { caption: text, reply_markup: inline_keyboard ? { inline_keyboard } : undefined });
        } else {
          await ctx.api.sendPhoto(channelId, images[0], { caption: text, reply_markup: inline_keyboard ? { inline_keyboard } : undefined });
          const media = images.slice(1).map(fid => ({ type: 'photo', media: fid }));
          if (media.length) await ctx.api.sendMediaGroup(channelId, media);
        }
        await ctx.reply('Post inviato con successo');
      } catch (err) {
        console.error('createpost conv send err', err);
        // improve feedback for chat not found
        if (err && err.message && /chat not found/i.test(err.message)) {
          await ctx.reply('Errore nell\'invio: chat non trovata. Controlla il valore del canale configurato (ID/link).');
        } else {
          await ctx.reply('Errore nell\'invio: ' + (err.message || err));
        }
      }
  }
  // ...fine createPostConversation...

// Helper functions for preset management
function writePresets(presets){
  // sanitize: remove duplicate buttons per preset and duplicate presets
  const cleaned = [];
  for (const p of presets) {
    const seen = new Set();
    const buttons = (p.buttons || []).filter(b => {
      const k = `${b.text}||${b.url}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    cleaned.push({ ...p, buttons });
  }
  // remove duplicate presets by title+buttons JSON
  const finalPresets = [];
  const seenPresets = new Set();
  for (const p of cleaned) {
    const key = `${p.title}||${JSON.stringify(p.buttons)}`;
    if (seenPresets.has(key)) continue;
    seenPresets.add(key);
    finalPresets.push(p);
  }
  fs.writeFileSync(PRESETS_FILE, JSON.stringify({ presets: finalPresets }, null, 2));
}

async function handlePresetModification(conversation, ctx) {
  // loop so user can modify multiple presets or finish
  const userId = ctx.from && ctx.from.id;
  while (true) {
    const presets = readPresets();
    // Ask: modify or add preset?
    const modifyKeyboard = [];
    for (const p of presets) {
      modifyKeyboard.push([{ text: p.title, callback_data: `modifypreset:${p.id}` }]);
    }
    modifyKeyboard.push([{ text: 'NUOVO PRESET', callback_data: 'modifypreset:new' }]);
    // add navigation row
    modifyKeyboard.push([NAV_ROW[0], NAV_ROW[1]]);

    await ctx.reply('Vuoi modificare o aggiungere un preset?', { reply_markup: { inline_keyboard: modifyKeyboard } });

    // Wait for selection
    let modifyCtx;
    while (true) {
      modifyCtx = await conversation.wait();
      if (!modifyCtx || !modifyCtx.update || !modifyCtx.update.callback_query) continue;
      const cbq = modifyCtx.update.callback_query;
      if (typeof cbq.data !== 'string') {
        await ctx.api.answerCallbackQuery(cbq.id, { text: 'Callback senza dati', show_alert: false }).catch(()=>{});
        continue;
      }
      if (cbq.data === 'nav:back') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Torna indietro' }).catch(()=>{}); continue; }
      if (cbq.data === 'nav:abort') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Terminato' }).catch(()=>{}); return 'finish'; }
      // ignore presses from other users
      try {
        if (cbq.from && cbq.from.id && userId && cbq.from.id !== userId) {
          await ctx.api.answerCallbackQuery(cbq.id, { text: "Questo pulsante non è per te", show_alert: false }).catch(()=>{});
          continue;
        }
      } catch (e) {}
      await ctx.api.answerCallbackQuery(cbq.id, { text: 'Scelta ricevuta' }).catch(()=>{});
      break;
    }

    const modifyData = modifyCtx.update.callback_query.data;

    if (modifyData === 'modifypreset:new') {
      await handleNewPreset(conversation, ctx);
    } else if (modifyData.startsWith('modifypreset:')) {
      const id = Number(modifyData.split(':')[1]);
      const preset = presets.find(p => p.id === id);
      if (preset) {
        await handleExistingPreset(conversation, ctx, preset);
      }
    }

    // after saving, offer what to do next
    const nextKeyboard = [
      [{ text: 'Termina modifiche', callback_data: 'modify_done:finish' }],
      [{ text: 'Modifica altri preset', callback_data: 'modify_done:more' }]
    ];
    await ctx.reply('Cosa vuoi fare adesso?', { reply_markup: { inline_keyboard: nextKeyboard } });

    // wait for user's choice
    let nextCtx;
    while (true) {
      nextCtx = await conversation.wait();
      if (!nextCtx || !nextCtx.update || !nextCtx.update.callback_query) continue;
      const cbq2 = nextCtx.update.callback_query;
      if (typeof cbq2.data !== 'string') continue;
      try {
        if (cbq2.from && cbq2.from.id && userId && cbq2.from.id !== userId) {
          await ctx.api.answerCallbackQuery(cbq2.id, { text: "Questo pulsante non è per te", show_alert: false }).catch(()=>{});
          continue;
        }
      } catch (e) {}
      await ctx.api.answerCallbackQuery(cbq2.id, { text: 'Scelta ricevuta' }).catch(()=>{});
      const choice = cbq2.data;
      if (choice === 'modify_done:finish') {
        // finish modifications and return to caller
        return 'finish';
      } else if (choice === 'modify_done:more') {
        // loop again to show presets list
        await ctx.reply('Ritorni alla schermata di modifica...');
        break; // continue outer while
      }
    }
  }
}

async function handleNewPreset(conversation, ctx) {
  await ctx.reply('🆕 **Nuovo Preset** 🆕', { parse_mode: 'Markdown' });
  
  // Ask for title
  await ctx.reply('Inserisci il nome del nuovo preset:');
  let titleMsg;
  while (true) {
  titleMsg = await conversation.wait();
  if (checkTerminate(titleMsg, ctx)) return 'finish';
  if (titleMsg && titleMsg.update && titleMsg.update.callback_query && typeof titleMsg.update.callback_query.data === 'string') {
      const d = titleMsg.update.callback_query.data;
      if (d === 'nav:abort') { await ctx.api.answerCallbackQuery(titleMsg.update.callback_query.id, { text: 'Terminato' }).catch(()=>{}); return 'finish'; }
      if (d === 'nav:back') { await ctx.api.answerCallbackQuery(titleMsg.update.callback_query.id, { text: 'Torna indietro' }).catch(()=>{}); return 'back'; }
    }
    if (titleMsg && titleMsg.message && titleMsg.message.text) break;
  }
  const title = titleMsg.message.text.trim();
  
  // Ask for buttons
  await ctx.reply('Quanti pulsanti vuoi aggiungere? (numero)');
  let numMsg;
  while (true) {
  numMsg = await conversation.wait();
  if (checkTerminate(numMsg, ctx)) return 'finish';
  if (numMsg && numMsg.update && numMsg.update.callback_query && typeof numMsg.update.callback_query.data === 'string') {
      const d = numMsg.update.callback_query.data;
      if (d === 'nav:abort') { await ctx.api.answerCallbackQuery(numMsg.update.callback_query.id, { text: 'Terminato' }).catch(()=>{}); return 'finish'; }
      if (d === 'nav:back') { await ctx.api.answerCallbackQuery(numMsg.update.callback_query.id, { text: 'Torna indietro' }).catch(()=>{}); return 'back'; }
    }
    if (numMsg && numMsg.message && numMsg.message.text) break;
  }
  const num = parseInt(numMsg.message.text.trim() || '0', 10) || 0;
  
  const buttons = [];
  for (let i = 0; i < num; i++) {
    await ctx.reply(`Testo per pulsante #${i+1}:`);
    let textMsg;
    while (true) {
  textMsg = await conversation.wait();
  if (checkTerminate(textMsg, ctx)) return 'finish';
  if (textMsg && textMsg.update && textMsg.update.callback_query && typeof textMsg.update.callback_query.data === 'string') {
        const d = textMsg.update.callback_query.data;
        if (d === 'nav:abort') { await ctx.api.answerCallbackQuery(textMsg.update.callback_query.id, { text: 'Terminato' }).catch(()=>{}); return 'finish'; }
        if (d === 'nav:back') { await ctx.api.answerCallbackQuery(textMsg.update.callback_query.id, { text: 'Torna indietro' }).catch(()=>{}); return 'back'; }
      }
      if (textMsg && textMsg.message && textMsg.message.text) break;
    }
    const text = textMsg.message.text.trim();
    
    await ctx.reply(`URL per pulsante #${i+1}:`);
    let urlMsg;
    while (true) {
  urlMsg = await conversation.wait();
  if (checkTerminate(urlMsg, ctx)) return 'finish';
  if (urlMsg && urlMsg.update && urlMsg.update.callback_query && typeof urlMsg.update.callback_query.data === 'string') {
        const d = urlMsg.update.callback_query.data;
        if (d === 'nav:abort') { await ctx.api.answerCallbackQuery(urlMsg.update.callback_query.id, { text: 'Terminato' }).catch(()=>{}); return 'finish'; }
        if (d === 'nav:back') { await ctx.api.answerCallbackQuery(urlMsg.update.callback_query.id, { text: 'Torna indietro' }).catch(()=>{}); return 'back'; }
      }
      if (urlMsg && urlMsg.message && urlMsg.message.text) break;
    }
    const url = urlMsg.message.text.trim();
    
    buttons.push({ text, url });
  }
  
  // Save new preset
  // persist safely and avoid duplicates
  const presetsAll = readPresets();
  const newId = Math.max(0, ...presetsAll.map(p => p.id || 0)) + 1;
  const newPreset = { id: newId, title, buttons };
  const duplicate = presetsAll.find(p => p.title === title && JSON.stringify(p.buttons) === JSON.stringify(buttons));
  if (!duplicate) {
    presetsAll.push(newPreset);
    writePresets(presetsAll);
  }
  
  await ctx.reply(`✅ Nuovo preset "${title}" creato con successo!`);
  // after creation, offer nav choices
  const navKb = [[NAV_ROW[0], NAV_ROW[1]]];
  await ctx.reply('Cosa vuoi fare adesso?', { reply_markup: { inline_keyboard: navKb } });
  const after = await conversation.wait();
  if (checkTerminate(after, ctx)) return 'finish';
  if (after && after.update && after.update.callback_query && typeof after.update.callback_query.data === 'string') {
    const d = after.update.callback_query.data;
    if (d === 'nav:abort') { await ctx.api.answerCallbackQuery(after.update.callback_query.id, { text: 'Terminato' }).catch(()=>{}); return 'finish'; }
    if (d === 'nav:back') { await ctx.api.answerCallbackQuery(after.update.callback_query.id, { text: 'Torna indietro' }).catch(()=>{}); return 'back'; }
  }
}

async function handleExistingPreset(conversation, ctx, preset) {
  await ctx.reply('📝 **Modifica Preset** 📝', { parse_mode: 'Markdown' });
  
  // Ask if wants to modify name
  const nameKeyboard = [
    [{ text: 'SI', callback_data: 'modifyname:yes' }],
    [{ text: 'NO', callback_data: 'modifyname:no' }]
  ];
  // add nav row
  nameKeyboard.push([NAV_ROW[0], NAV_ROW[1]]);
  
  await ctx.reply('Vuoi modificare il NOME del preset?', { reply_markup: { inline_keyboard: nameKeyboard } });
  
  // Wait for name choice
  let nameCtx;
  while (true) {
  nameCtx = await conversation.wait();
  if (checkTerminate(nameCtx, ctx)) return 'finish';
    if (!nameCtx || !nameCtx.update || !nameCtx.update.callback_query) continue;
    const cbq = nameCtx.update.callback_query;
    if (typeof cbq.data !== 'string') continue;
    await ctx.api.answerCallbackQuery(cbq.id, { text: 'Scelta ricevuta' }).catch(()=>{});
    break;
  }
  
  if (nameCtx.update.callback_query.data === 'modifyname:yes') {
    await ctx.reply('INSERISCI IL NUOVO NOME DEL PRESET:');
    let nameMsg;
    while (true) {
      nameMsg = await conversation.wait();
      if (nameMsg && nameMsg.message && nameMsg.message.text) break;
    }
    preset.title = nameMsg.message.text.trim();
    await ctx.reply(`✅ Nome cambiato in: "${preset.title}"`);
  }
  
  // Ask about buttons
  const buttonActionKeyboard = [
    [{ text: 'MODIFICA', callback_data: 'btnaction:modify' }],
    [{ text: 'AGGIUNGERE', callback_data: 'btnaction:add' }],
    [{ text: 'RIMUOVERE', callback_data: 'btnaction:remove' }]
  ];
  // add nav row
  buttonActionKeyboard.push([NAV_ROW[0], NAV_ROW[1]]);
  
  await ctx.reply('VUOI MODIFICARE UN PULSANTE OPPURE AGGIUNGERNE O RIMUOVERNE UNO?', { reply_markup: { inline_keyboard: buttonActionKeyboard } });
  
  // Wait for button action choice
  let actionCtx;
  while (true) {
    actionCtx = await conversation.wait();
    if (!actionCtx || !actionCtx.update || !actionCtx.update.callback_query) continue;
    const cbq = actionCtx.update.callback_query;
    if (typeof cbq.data !== 'string') continue;
    await ctx.api.answerCallbackQuery(cbq.id, { text: 'Scelta ricevuta' }).catch(()=>{});
    break;
  }
  
  const action = actionCtx.update.callback_query.data;
  
  if (action === 'btnaction:modify') {
    const r = await handleModifyButtons(conversation, ctx, preset);
    if (r === 'finish') return 'finish';
    if (r === 'back') { /* continue */ }
  } else if (action === 'btnaction:add') {
    const r = await handleAddButton(conversation, ctx, preset);
    if (r === 'finish') return 'finish';
    if (r === 'back') { /* continue */ }
  } else if (action === 'btnaction:remove') {
    const r = await handleRemoveButton(conversation, ctx, preset);
    if (r === 'finish') return 'finish';
    if (r === 'back') { /* continue */ }
  }
  
  // Save changes
  const allPresets = readPresets();
  const idx = allPresets.findIndex(p => p.id === preset.id);
  if (idx !== -1) {
    allPresets[idx] = preset;
    writePresets(allPresets);
    await ctx.reply('✅ Preset salvato con successo!');
  }
}

async function handleModifyButtons(conversation, ctx, preset) {
  if (!preset.buttons || preset.buttons.length === 0) {
    await ctx.reply('Questo preset non ha pulsanti da modificare.');
    return;
  }
  
  // Show current buttons
  const buttonKeyboard = [];
  for (let i = 0; i < preset.buttons.length; i++) {
    const btn = preset.buttons[i];
    buttonKeyboard.push([{ text: `${i+1}. ${btn.text}`, callback_data: `modifybtn:${i}` }]);
  }
  // add nav row
  buttonKeyboard.push([NAV_ROW[0], NAV_ROW[1]]);
  
  await ctx.reply('Quale pulsante vuoi modificare?', { reply_markup: { inline_keyboard: buttonKeyboard } });
  
  // Wait for button selection
  let btnCtx;
  while (true) {
    btnCtx = await conversation.wait();
    if (!btnCtx || !btnCtx.update || !btnCtx.update.callback_query) continue;
    const cbq = btnCtx.update.callback_query;
    if (typeof cbq.data !== 'string') continue;
    if (cbq.data === 'nav:back') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Torna indietro' }).catch(()=>{}); return 'back'; }
    if (cbq.data === 'nav:abort') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Terminato' }).catch(()=>{}); return 'finish'; }
    if (!cbq.data.startsWith('modifybtn:')) continue;
    await ctx.api.answerCallbackQuery(cbq.id, { text: 'Scelta ricevuta' }).catch(()=>{});
    break;
  }
  
  const btnIndex = Number(btnCtx.update.callback_query.data.split(':')[1]);
  if (btnIndex >= 0 && btnIndex < preset.buttons.length) {
    const button = preset.buttons[btnIndex];
    
    // Modify text
    await ctx.reply(`Inserisci il nuovo testo per il pulsante (attuale: "${button.text}"):`);
    let textMsg;
    while (true) {
      textMsg = await conversation.wait();
  if (checkTerminate(textMsg, ctx)) return 'finish';
  if (textMsg && textMsg.message && textMsg.message.text) break;
    }
    button.text = textMsg.message.text.trim();
    
    // Modify URL
    await ctx.reply(`Inserisci il nuovo URL per il pulsante (attuale: "${button.url}"):`);
    let urlMsg;
    while (true) {
      urlMsg = await conversation.wait();
  if (checkTerminate(urlMsg, ctx)) return 'finish';
  if (urlMsg && urlMsg.message && urlMsg.message.text) break;
    }
    button.url = urlMsg.message.text.trim();
    // persist modification
    try {
      const all = readPresets();
      const idx2 = all.findIndex(p => p.id === preset.id);
      if (idx2 !== -1) { all[idx2] = preset; writePresets(all); }
    } catch (e) {
      console.error('Error saving preset after modify button', e);
    }
    await ctx.reply('✅ Pulsante modificato!');
    return; // return control after modification
  }
}

async function handleAddButton(conversation, ctx, preset) {
  await ctx.reply('Inserisci il testo del nuovo pulsante:');
  let textMsg;
  while (true) {
    textMsg = await conversation.wait();
    if (textMsg && textMsg.message && textMsg.message.text) break;
  }
  const text = textMsg.message.text.trim();
  
  await ctx.reply('Inserisci l\'URL del nuovo pulsante:');
  let urlMsg;
  while (true) {
    urlMsg = await conversation.wait();
    if (urlMsg && urlMsg.message && urlMsg.message.text) break;
  }
  const url = urlMsg.message.text.trim();
  
  if (!preset.buttons) preset.buttons = [];
  const exists = preset.buttons.find(b => b.text === text && b.url === url);
  if (exists) {
    await ctx.reply('Il pulsante esiste già, nessuna azione eseguita.');
    return;
  }
  preset.buttons.push({ text, url });
  // persist immediately
  try {
    const all = readPresets();
    const idx = all.findIndex(p => p.id === preset.id);
    if (idx !== -1) { all[idx] = preset; writePresets(all); }
  } catch (e) {
    console.error('Error saving preset after add button', e);
  }
  // confirm and nav options
  const keyboard = [ [ { text: 'OK', callback_data: 'addbtn:ok' } ], [NAV_ROW[0], NAV_ROW[1]] ];
  await ctx.reply('✅ Nuovo pulsante aggiunto!', { reply_markup: { inline_keyboard: keyboard } });
  while (true) {
    const a = await conversation.wait();
    if (!a || !a.update || !a.update.callback_query) continue;
    const d = a.update.callback_query.data;
    if (d === 'nav:abort') { await ctx.api.answerCallbackQuery(a.update.callback_query.id, { text: 'Terminato' }).catch(()=>{}); return 'finish'; }
    if (d === 'nav:back') { await ctx.api.answerCallbackQuery(a.update.callback_query.id, { text: 'Torna indietro' }).catch(()=>{}); return 'back'; }
    if (d === 'addbtn:ok') { await ctx.api.answerCallbackQuery(a.update.callback_query.id, { text: 'OK' }).catch(()=>{}); break; }
  }
  return;
}

async function handleRemoveButton(conversation, ctx, preset) {
  if (!preset.buttons || preset.buttons.length === 0) {
    await ctx.reply('Questo preset non ha pulsanti da rimuovere.');
    return;
  }
  
  // Show current buttons
  const buttonKeyboard = [];
  for (let i = 0; i < preset.buttons.length; i++) {
    const btn = preset.buttons[i];
    buttonKeyboard.push([{ text: `${i+1}. ${btn.text}`, callback_data: `removebtn:${i}` }]);
  }
  // add nav row
  buttonKeyboard.push([NAV_ROW[0], NAV_ROW[1]]);
  
  await ctx.reply('Quale pulsante vuoi rimuovere?', { reply_markup: { inline_keyboard: buttonKeyboard } });
  
  // Wait for button selection
  let btnCtx;
  while (true) {
    btnCtx = await conversation.wait();
    if (!btnCtx || !btnCtx.update || !btnCtx.update.callback_query) continue;
    const cbq = btnCtx.update.callback_query;
    if (typeof cbq.data !== 'string') continue;
    if (cbq.data === 'nav:back') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Torna indietro' }).catch(()=>{}); return 'back'; }
    if (cbq.data === 'nav:abort') { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Terminato' }).catch(()=>{}); return 'finish'; }
    if (!cbq.data.startsWith('removebtn:')) continue;
    await ctx.api.answerCallbackQuery(cbq.id, { text: 'Scelta ricevuta' }).catch(()=>{});
    break;
  }
  
  const btnIndex = Number(btnCtx.update.callback_query.data.split(':')[1]);
  if (btnIndex >= 0 && btnIndex < preset.buttons.length) {
    const removedButton = preset.buttons.splice(btnIndex, 1)[0];
    // persist
    try {
      const all2 = readPresets();
      const idx3 = all2.findIndex(p => p.id === preset.id);
      if (idx3 !== -1) { all2[idx3] = preset; writePresets(all2); }
    } catch (e) {
      console.error('Error saving preset after remove button', e);
    }
    await ctx.reply(`✅ Pulsante "${removedButton.text}" rimosso!`);
    return;
  }
}

// Register conversation with explicit name that matches the command enter call
// Esporta il middleware della conversazione (compatibile con bot.use)
module.exports = createConversation(createPostConversation, 'createPostConversation');
