const fs = require('fs');
const path = require('path');
const { createConversation } = require('@grammyjs/conversations');
const { ADMIN_IDS } = require('../config');
const { dataPath } = require('../utils/dataPath');

const PRESETS_FILE = dataPath('web', 'presets.json');
const NAV_ROW = [{ text: '↩️ Torna indietro', callback_data: 'nav:back' }, { text: '❌ Termina', callback_data: 'nav:abort' }];

function readPresets(){ try { return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')).presets || []; } catch(e){ return []; } }
function writePresets(presets){
  try { fs.mkdirSync(path.dirname(PRESETS_FILE), { recursive: true }); } catch (e) {}
  fs.writeFileSync(PRESETS_FILE, JSON.stringify({ presets }, null, 2));
}

function checkTerminate(waitResult){ if (!waitResult) return false; let text = null; if (typeof waitResult === 'string') text = waitResult; if (!text && waitResult.message && typeof waitResult.message.text === 'string') text = waitResult.message.text; return text === 'nav:abort' || text === 'nav:back'; }

async function createPresetConversation(conversation, ctx){
  const userId = ctx.from && ctx.from.id;
  if (!userId || !ADMIN_IDS || !Array.isArray(ADMIN_IDS) || !ADMIN_IDS.includes(userId)) {
    await ctx.reply('Non autorizzato. Solo amministratori possono usare questo comando.');
    return;
  }

  while (true) {
    const presets = readPresets();
    const keyboard = presets.map(p => [{ text: p.title, callback_data: `preset:${p.id}` }]);
    keyboard.push([{ text: '➕ Nuovo preset', callback_data: 'preset:new' }]);
    keyboard.push([NAV_ROW[0], NAV_ROW[1]]);
    await ctx.reply('Scegli un preset da modificare o crea uno nuovo:', { reply_markup: { inline_keyboard: keyboard } });

    const sel = await conversation.wait();
    if (checkTerminate(sel)) return;
    if (!sel || !sel.update || !sel.update.callback_query) continue;
    const cbq = sel.update.callback_query;
    const who = cbq.from && cbq.from.id;
    if (who !== userId) { await ctx.api.answerCallbackQuery(cbq.id, { text: 'Questo pulsante non è per te' }).catch(()=>{}); continue; }
    await ctx.api.answerCallbackQuery(cbq.id, { text: 'Scelta ricevuta' }).catch(()=>{});
    const data = cbq.data || '';
    if (data === 'preset:new') {
      const r = await newPresetFlow(conversation, ctx); if (r === 'finish') return; continue;
    }
    if (data.startsWith('preset:')) {
      const id = Number(data.split(':')[1]);
      const preset = presets.find(p => p.id === id);
      if (!preset) { await ctx.reply('Preset non trovato.'); continue; }
      const actionKb = [ [{ text: 'Modifica nome', callback_data: 'action:rename' }], [{ text: 'Aggiungi pulsante', callback_data: 'action:addbtn' }], [{ text: 'Rimuovi pulsante', callback_data: 'action:rembtn' }], [{ text: 'Elimina preset', callback_data: 'action:delete' }], [NAV_ROW[0], NAV_ROW[1]] ];
      await ctx.reply(`Preset: ${preset.title}`, { reply_markup: { inline_keyboard: actionKb } });
      const a = await conversation.wait();
      if (checkTerminate(a)) return;
      if (!a || !a.update || !a.update.callback_query) continue;
      const ab = a.update.callback_query;
      if ((ab.from && ab.from.id) !== userId) { await ctx.api.answerCallbackQuery(ab.id, { text: 'Questo pulsante non è per te' }).catch(()=>{}); continue; }
      await ctx.api.answerCallbackQuery(ab.id, { text: 'Scelta ricevuta' }).catch(()=>{});
      const action = ab.data || '';
      if (action === 'action:rename') {
        await ctx.reply('Inserisci il nuovo nome del preset:');
        let tm;
        while (true) { tm = await conversation.wait(); if (checkTerminate(tm)) return; if (tm && tm.message && tm.message.text) break; }
        preset.title = tm.message.text.trim();
        const all = readPresets(); const idx = all.findIndex(p => p.id === preset.id); if (idx !== -1){ all[idx] = preset; writePresets(all); }
        await ctx.reply('Nome aggiornato');
      } else if (action === 'action:addbtn') {
        await ctx.reply('Inserisci testo pulsante:'); let tmsg; while (true){ tmsg = await conversation.wait(); if (checkTerminate(tmsg)) return; if (tmsg && tmsg.message && tmsg.message.text) break; }
        const t = tmsg.message.text.trim(); await ctx.reply('Inserisci URL per il pulsante:'); let umsg; while(true){ umsg = await conversation.wait(); if (checkTerminate(umsg)) return; if (umsg && umsg.message && umsg.message.text) break; }
        const u = umsg.message.text.trim(); preset.buttons = preset.buttons || []; preset.buttons.push({ text: t, url: u }); const all2 = readPresets(); const idx2 = all2.findIndex(p => p.id === preset.id); if (idx2 !== -1){ all2[idx2] = preset; writePresets(all2); }
        await ctx.reply('Pulsante aggiunto');
      } else if (action === 'action:rembtn') {
        if (!preset.buttons || !preset.buttons.length) { await ctx.reply('Nessun pulsante da rimuovere'); continue; }
        const kb = preset.buttons.map((b,i)=> [{ text: `${i+1}. ${b.text}`, callback_data: `rem:${i}` }]); kb.push([NAV_ROW[0], NAV_ROW[1]]);
        await ctx.reply('Scegli pulsante da rimuovere', { reply_markup: { inline_keyboard: kb } });
        const rm = await conversation.wait(); if (checkTerminate(rm)) return; if (!rm || !rm.update || !rm.update.callback_query) continue; const rb = rm.update.callback_query; await ctx.api.answerCallbackQuery(rb.id, { text: 'Scelta ricevuta' }).catch(()=>{});
        if (rb.data && rb.data.startsWith('rem:')){ const idx3 = Number(rb.data.split(':')[1]); if (!Number.isNaN(idx3) && idx3>=0 && idx3 < (preset.buttons||[]).length){ const removed = preset.buttons.splice(idx3,1); const all3 = readPresets(); const idxx = all3.findIndex(p => p.id === preset.id); if (idxx!==-1){ all3[idxx]=preset; writePresets(all3); } await ctx.reply('Pulsante rimosso'); } }
      } else if (action === 'action:delete') {
        await ctx.reply('Confermi eliminazione preset? (si/no)'); let conf; while(true){ conf = await conversation.wait(); if (checkTerminate(conf)) return; if (conf && conf.message && conf.message.text) break; }
        const t = conf.message.text.trim().toLowerCase(); if (t==='si' || t==='s'){ const all4 = readPresets(); const idx4 = all4.findIndex(p => p.id === preset.id); if (idx4!==-1){ all4.splice(idx4,1); writePresets(all4); await ctx.reply('Preset eliminato'); } } else { await ctx.reply('Operazione annullata'); }
      }
      // loop back to list
    }
  }
}

async function newPresetFlow(conversation, ctx){
  await ctx.reply('🆕 Creazione nuovo preset — inserisci il titolo:');
  let titleMsg; while(true){ titleMsg = await conversation.wait(); if (checkTerminate(titleMsg)) return 'finish'; if (titleMsg && titleMsg.message && titleMsg.message.text) break; }
  const title = titleMsg.message.text.trim();
  await ctx.reply('Quanti pulsanti vuoi aggiungere? (numero)');
  let numMsg; while(true){ numMsg = await conversation.wait(); if (checkTerminate(numMsg)) return 'finish'; if (numMsg && numMsg.message && numMsg.message.text) break; }
  const num = parseInt(numMsg.message.text.trim()||'0',10) || 0;
  const buttons = [];
  for (let i=0;i<num;i++){ await ctx.reply(`Testo pulsante #${i+1}`); let tmsg; while(true){ tmsg = await conversation.wait(); if (checkTerminate(tmsg)) return 'finish'; if (tmsg && tmsg.message && tmsg.message.text) break; } const t = tmsg.message.text.trim(); await ctx.reply('URL pulsante'); let umsg; while(true){ umsg = await conversation.wait(); if (checkTerminate(umsg)) return 'finish'; if (umsg && umsg.message && umsg.message.text) break; } const u = umsg.message.text.trim(); buttons.push({ text: t, url: u }); }
  const all = readPresets(); const newId = Math.max(0, ...all.map(p=>p.id||0))+1; const np = { id: newId, title, buttons }; all.push(np); writePresets(all); await ctx.reply('Preset creato'); return np;
}

module.exports = createConversation(createPresetConversation, 'createPresetConversation');
