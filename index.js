/**
 * Architect v1.6.0
 * Developed by Alzhayds
 * Create. Protect. Restore.
 */

const {
  Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ChannelType, AuditLogEvent,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const VERSION       = 'v1.6.0';
const MISTRAL_MODEL = 'mistral-large-latest';

// ── Idiomas ────────────────────────────────────────────────────────────────────
const LANGS = {
  pt: {
    flag: '🇧🇷', name: 'Português',
    langChanged: (n) => `O idioma foi definido para **${n}**.`,
    langTitle: '🇧🇷  Idioma alterado!',
    noPermission: '❌ Você precisa ser **Administrador**!',
    backupSaved: '✅  Backup Salvo!',
    noBackup: '❌ Nenhum backup encontrado!',
    doarTitle: '☕  Apoie o Architect!',
    doarDesc: '> Se o Architect te ajudou, considere fazer uma doação!\n> Todo apoio ajuda a manter o bot no ar e a evoluir cada vez mais. 💜',
    doarThanks: 'Obrigado pelo apoio!',
  },
  en: {
    flag: '🇺🇸', name: 'English',
    langChanged: (n) => `Language has been set to **${n}**.`,
    langTitle: '🇺🇸  Language changed!',
    noPermission: '❌ You need to be an **Administrator**!',
    backupSaved: '✅  Backup Saved!',
    noBackup: '❌ No backup found!',
    doarTitle: '☕  Support Architect!',
    doarDesc: '> If Architect helped you, consider making a donation!\n> Every bit of support helps keep the bot running. 💜',
    doarThanks: 'Thank you for your support!',
  },
  es: {
    flag: '🇪🇸', name: 'Español',
    langChanged: (n) => `El idioma se ha configurado en **${n}**.`,
    langTitle: '🇪🇸  ¡Idioma cambiado!',
    noPermission: '❌ ¡Necesitas ser **Administrador**!',
    backupSaved: '✅  ¡Copia de seguridad guardada!',
    noBackup: '❌ ¡No se encontró ninguna copia de seguridad!',
    doarTitle: '☕  ¡Apoya a Architect!',
    doarDesc: '> ¡Si Architect te ayudó, considera hacer una donación!\n> Todo apoyo ayuda a mantener el bot activo. 💜',
    doarThanks: '¡Gracias por tu apoyo!',
  },
  fr: {
    flag: '🇫🇷', name: 'Français',
    langChanged: (n) => `La langue a été définie sur **${n}**.`,
    langTitle: '🇫🇷  Langue modifiée !',
    noPermission: '❌ Vous devez être **Administrateur** !',
    backupSaved: '✅  Sauvegarde enregistrée !',
    noBackup: '❌ Aucune sauvegarde trouvée !',
    doarTitle: '☕  Soutenez Architect !',
    doarDesc: '> Si Architect vous a aidé, pensez à faire un don !\n> Tout soutien aide à maintenir le bot en ligne. 💜',
    doarThanks: 'Merci pour votre soutien !',
  },
  de: {
    flag: '🇩🇪', name: 'Deutsch',
    langChanged: (n) => `Die Sprache wurde auf **${n}** gesetzt.`,
    langTitle: '🇩🇪  Sprache geändert!',
    noPermission: '❌ Du musst **Administrator** sein!',
    backupSaved: '✅  Backup gespeichert!',
    noBackup: '❌ Kein Backup gefunden!',
    doarTitle: '☕  Unterstütze Architect!',
    doarDesc: '> Wenn Architect dir geholfen hat, erwäge eine Spende!\n> Jede Unterstützung hilft, den Bot am Laufen zu halten. 💜',
    doarThanks: 'Danke für deine Unterstützung!',
  },
};

const guildLangCache = new Map();
async function getGuildLang(guildId) {
  if (guildLangCache.has(guildId)) return guildLangCache.get(guildId);
  if (!mongoDB) return LANGS.pt;
  const setting = await mongoDB.collection('settings').findOne({ guildId });
  const lang = LANGS[setting?.lang] || LANGS.pt;
  guildLangCache.set(guildId, lang);
  return lang;
}


// ── Premium System ─────────────────────────────────────────────────────────────
const PREMIUM_OWNERS = ['1449734825819897936', '1307428996337897553'];
const PREMIUM_PLANS = {
  semanal: { label: 'Semanal', days: 7,   emoji: '⚡' },
  mensal:  { label: 'Mensal',  days: 30,  emoji: '💎' },
  anual:   { label: 'Anual',   days: 365, emoji: '👑' },
};

async function getPremium(userId) {
  if (!mongoDB) return null;
  const doc = await mongoDB.collection('premium').findOne({ userId });
  if (!doc) return null;
  if (new Date(doc.expiresAt) < new Date()) {
    // Expirou — avisa na DM e remove
    try {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) await user.send({ embeds: [new EmbedBuilder()
        .setTitle('⏰  Seu Premium expirou!')
        .setColor(0xe74c3c)
        .setDescription(`Seu plano **${doc.plan}** do Architect expirou.

Para renovar, entre em contato com a equipe Alzhadys.`)
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] }).catch(() => {});
    } catch (e) { console.error('Premium DM:', e.message); }
    await mongoDB.collection('premium').deleteOne({ userId });
    return null;
  }
  return doc;
}

async function setPremium(userId, plan) {
  const days = PREMIUM_PLANS[plan].days;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await mongoDB.collection('premium').updateOne(
    { userId },
    { $set: { userId, plan, expiresAt: expiresAt.toISOString(), grantedAt: new Date().toISOString() } },
    { upsert: true }
  );
  return expiresAt;
}

async function isUserPremium(userId) {
  const doc = await getPremium(userId);
  return !!doc;
}

// Verifica se o dono do servidor onde o comando é usado tem Premium
async function isGuildOwnerPremium(guild) {
  try {
    const owner = await guild.fetchOwner();
    return await isUserPremium(owner.id);
  } catch { return false; }
}

// ── Backup automático Premium (a cada 30 min) ──────────────────────────────────
async function runAutoBackups() {
  try {
    const premiumDocs = await mongoDB.collection('premium').find({}).toArray();
    for (const doc of premiumDocs) {
      if (new Date(doc.expiresAt) < new Date()) continue;
      // Encontra servidores onde esse usuário é dono
      for (const [, guild] of client.guilds.cache) {
        try {
          const owner = await guild.fetchOwner().catch(() => null);
          if (!owner || owner.id !== doc.userId) continue;
          const structure = await captureStructure(guild);
          await saveBackup(guild.id, guild.name, structure);
          console.log(`[AUTO-BACKUP] ${guild.name} (${doc.userId})`);
        } catch (e) { console.error('AutoBackup guild:', e.message); }
      }
    }
  } catch (e) { console.error('AutoBackup:', e.message); }
}

// ── Rate Limit & Queue ─────────────────────────────────────────────────────────
// Fila global para TODAS as chamadas ao Mistral — garante 1 por vez com delay
let mistralBusy = false;
const mistralQueue = [];

async function enqueueMistral(task) {
  return new Promise((resolve, reject) => {
    mistralQueue.push({ task, resolve, reject });
    processMistralQueue();
  });
}

async function processMistralQueue() {
  if (mistralBusy || mistralQueue.length === 0) return;
  mistralBusy = true;
  const { task, resolve, reject } = mistralQueue.shift();
  try { resolve(await task()); }
  catch (e) { reject(e); }
  finally {
    // Espera 2s antes da próxima chamada (respeita 1 req/s com margem)
    await new Promise(r => setTimeout(r, 2000));
    mistralBusy = false;
    processMistralQueue();
  }
}

// Mantido para compatibilidade com generateStructure
const MAX_CONCURRENT = 1;
let activeGenerations = 0;
const generationQueue = [];

async function enqueueGeneration(task) {
  return new Promise((resolve, reject) => {
    generationQueue.push({ task, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (activeGenerations >= MAX_CONCURRENT || generationQueue.length === 0) return;
  const { task, resolve, reject } = generationQueue.shift();
  activeGenerations++;
  try { resolve(await task()); }
  catch (e) { reject(e); }
  finally { activeGenerations--; setTimeout(processQueue, 1100); }
}

// ── MongoDB ────────────────────────────────────────────────────────────────────
let mongoDB;
async function connectDB() {
  const mc = new MongoClient(process.env.MONGO_URI);
  await mc.connect();
  mongoDB = mc.db('architect');
  console.log('✅ MongoDB conectado!');
}

async function saveBackup(guildId, guildName, structure) {
  await mongoDB.collection('backups').updateOne(
    { guildId },
    { $set: { guildId, guildName, structure, savedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

async function getBackup(guildId) {
  if (!mongoDB) await connectDB();
  return await mongoDB.collection('backups').findOne({ guildId });
}

async function setProtection(guildId, val) {
  await mongoDB.collection('backups').updateOne({ guildId }, { $set: { protection: val } });
}

// ── Discord Client ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // [VERIFICAÇÃO] GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    // [VERIFICAÇÃO] GatewayIntentBits.GuildMessageReactions,
    // [VERIFICAÇÃO] GatewayIntentBits.GuildMessages,
    // [VERIFICAÇÃO] GatewayIntentBits.MessageContent,
  ],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION'],
});

// ── Anti-Nuke Tracker ──────────────────────────────────────────────────────────
const nukeTracker = new Map();
function trackNukeAction(guildId, userId) {
  if (!nukeTracker.has(guildId)) nukeTracker.set(guildId, new Map());
  const gMap = nukeTracker.get(guildId);
  if (!gMap.has(userId)) gMap.set(userId, { count: 0, reset: Date.now() });
  const u = gMap.get(userId);
  if (Date.now() - u.reset > 10000) { u.count = 0; u.reset = Date.now(); }
  u.count++;
  return u.count;
}

// ── Mistral API ────────────────────────────────────────────────────────────────
async function callMistralRaw(messages, maxTokens = 8000, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: MISTRAL_MODEL, max_tokens: maxTokens, temperature: 0.4, messages }),
        signal:  AbortSignal.timeout(60000), // 60s timeout
      });
      if (res.status === 429) {
        console.warn(`[MISTRAL] Rate limit — aguardando 60s...`);
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      if (!res.ok) throw new Error(`Mistral API error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      let raw = data.choices[0].message.content.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      const arr = raw.trimStart().startsWith('[');
      const s   = raw.indexOf(arr ? '[' : '{');
      const e   = raw.lastIndexOf(arr ? ']' : '}');
      if (s === -1 || e === -1) throw new Error('IA retornou JSON inválido. Tente novamente.');
      return JSON.parse(raw.substring(s, e + 1));
    } catch (e) {
      console.error(`[MISTRAL] Tentativa ${attempt}/${retries} falhou:`, e.message);
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

async function callMistral(messages, maxTokens = 8000, retries = 3) {
  return enqueueMistral(() => callMistralRaw(messages, maxTokens, retries));
}



// ── Generate Structure ─────────────────────────────────────────────────────────
async function generateStructure(prompt, onLog, isPremium = false) {
  prompt = prompt.replace(/"/g, "'").replace(/`/g, "'");
  await onLog('🧠', 'ANÁLISE', `Interpretando prompt${isPremium ? ' (Premium ✨)' : ''}...`);
  await onLog('📡', 'MISTRAL', 'Conectando à API Mistral AI...');

  const roles = await enqueueGeneration(async () => {
    await onLog('⚙️', 'CARGOS', 'Gerando hierarquia de cargos...');
    const systemMsg = isPremium
      ? 'You are an expert Discord server architect. Generate a COMPREHENSIVE and PROFESSIONAL role hierarchy. JSON only, no markdown. Always use proper Portuguese accents. Create 15-25 well-organized roles with proper colors and permissions.'
      : 'You generate Discord server roles. JSON only, no markdown. Always use proper Portuguese accents.';
    const result = await callMistral([
      { role: 'system', content: systemMsg },
      { role: 'user',   content: `Create ALL roles for this server: "${prompt}"\nJSON array:\n[{"name":"Nome","color":"#hex","permissions":["ADMINISTRATOR"]}]` },
    ]);
    await onLog('✅', 'CARGOS', `${Array.isArray(result) ? result.length : 0} cargo(s) definido(s)`);
    return result;
  });

  await new Promise(r => setTimeout(r, 4000));

  const categories = await enqueueGeneration(async () => {
    await onLog('⚙️', 'ESTRUTURA', 'Projetando categorias e canais...');
    const result = await callMistral([
      { role: 'system', content: 'You design Discord servers. JSON only, no markdown. Always use proper Portuguese accents.' },
      { role: 'user',   content: `Design the COMPLETE server structure for: "${prompt}"\n\nCATEGORY FORMAT: EMOJI + SPACE + DIVIDER + SPACE + NAME IN ALL CAPS (ex: 🏛️ ◆ INFORMAÇÕES)\nCHANNEL FORMAT: EMOJI + DIVIDER + name NO SPACES (ex: 🚩・entrada)\nCHANNEL TYPES: text, voice, forum, announcement, stage\nJSON array:\n[{"name":"🏛️ ◆ CATEGORIA","channels":[{"name":"🚩・canal","type":"text","topic":"Tópico","allowedRoles":[]}]}]` },
    ]);
    const totalChannels = Array.isArray(result) ? result.reduce((a, c) => a + (c.channels?.length || 0), 0) : 0;
    await onLog('✅', 'ESTRUTURA', `${Array.isArray(result) ? result.length : 0} categoria(s) · ${totalChannels} canal(is)`);
    return result;
  });

  await new Promise(r => setTimeout(r, 4000));

  const welcomeMessage = await enqueueGeneration(async () => {
    await onLog('✍️', 'BOAS-VINDAS', 'Redigindo mensagem de boas-vindas...');
    const wRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MISTRAL_MODEL, max_tokens: 400, temperature: 0.8, messages: [{ role: 'system', content: 'Write short Discord welcome messages in Portuguese. Plain text only.' }, { role: 'user', content: `Welcome message for: "${prompt}"` }] }),
    });
    const wData = await wRes.json();
    await onLog('✅', 'BOAS-VINDAS', 'Mensagem gerada com sucesso');
    return wData.choices?.[0]?.message?.content?.trim() || '';
  });

  await onLog('🏁', 'CONCLUÍDO', 'Estrutura pronta — aguardando confirmação');
  return { roles: Array.isArray(roles) ? roles : [], categories: Array.isArray(categories) ? categories : [], welcomeMessage };
}

// ── Permission Builder ─────────────────────────────────────────────────────────
function buildPermissions(perms = []) {
  const map = { ADMINISTRATOR: PermissionFlagsBits.Administrator, MANAGE_GUILD: PermissionFlagsBits.ManageGuild, MANAGE_CHANNELS: PermissionFlagsBits.ManageChannels, MANAGE_ROLES: PermissionFlagsBits.ManageRoles, KICK_MEMBERS: PermissionFlagsBits.KickMembers, BAN_MEMBERS: PermissionFlagsBits.BanMembers, SEND_MESSAGES: PermissionFlagsBits.SendMessages, VIEW_CHANNEL: PermissionFlagsBits.ViewChannel };
  return perms.reduce((acc, p) => map[p] ? acc | map[p] : acc, 0n);
}

// ── Capture Backup (COMPLETO) ──────────────────────────────────────────────────
async function captureStructure(guild) {
  // Servidor
  const server = {
    name: guild.name,
    description: guild.description || '',
    verificationLevel: guild.verificationLevel,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    explicitContentFilter: guild.explicitContentFilter,
    systemChannelId: null, // será resolvido após restaurar canais
    afkTimeout: guild.afkTimeout,
    preferredLocale: guild.preferredLocale,
  };

  // Cargos (exceto @everyone e managed)
  const everyoneRole = guild.roles.everyone;
  const everyonePerms = everyoneRole.permissions.toArray();

  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone' && !r.managed)
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      name: r.name,
      color: r.hexColor,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.toArray(),
      position: r.position,
      unicodeEmoji: r.unicodeEmoji || null,
    }));

  // [VERIFICAÇÃO] Membros desativado temporariamente
  const memberRoles = []; // await guild.members.fetch() desativado

  // Canais e categorias
  const channels = await guild.channels.fetch();
  const categories = [];

  // Categorias
  for (const [, cat] of channels) {
    if (cat.type !== ChannelType.GuildCategory) continue;
    const catOverwrites = [];
    for (const [, ow] of cat.permissionOverwrites.cache) {
      const catRoleName = ow.type === 0 ? (guild.roles.cache.get(ow.id)?.name || null) : null; catOverwrites.push({ id: ow.id, type: ow.type, allow: ow.allow.toArray(), deny: ow.deny.toArray(), roleName: catRoleName });
    }

    const children = [];
    for (const [, ch] of channels) {
      if (ch.parentId !== cat.id) continue;
      const chOverwrites = [];
      for (const [, ow] of ch.permissionOverwrites.cache) {
        const chRoleName = ow.type === 0 ? (guild.roles.cache.get(ow.id)?.name || null) : null; chOverwrites.push({ id: ow.id, type: ow.type, allow: ow.allow.toArray(), deny: ow.deny.toArray(), roleName: chRoleName });
      }
      const typeStr = ch.type === ChannelType.GuildVoice ? 'voice'
        : ch.type === ChannelType.GuildAnnouncement ? 'announcement'
        : ch.type === ChannelType.GuildForum ? 'forum'
        : ch.type === ChannelType.GuildStageVoice ? 'stage'
        : 'text';
      children.push({
        name: ch.name,
        type: typeStr,
        topic: ch.topic || '',
        nsfw: ch.nsfw || false,
        rateLimitPerUser: ch.rateLimitPerUser || 0,
        position: ch.position,
        permOverwrites: chOverwrites,
        isSystemChannel: guild.systemChannelId === ch.id,
        isAfkChannel: guild.afkChannelId === ch.id,
      });
    }
    children.sort((a, b) => a.position - b.position);
    categories.push({ name: cat.name, position: cat.position, permOverwrites: catOverwrites, channels: children });
  }

  // Canais sem categoria
  const orphanChannels = [];
  for (const [, ch] of channels) {
    if (ch.parentId || ch.type === ChannelType.GuildCategory) continue;
    const chOverwrites = [];
    for (const [, ow] of ch.permissionOverwrites.cache) {
      const chRoleName = ow.type === 0 ? (guild.roles.cache.get(ow.id)?.name || null) : null; chOverwrites.push({ id: ow.id, type: ow.type, allow: ow.allow.toArray(), deny: ow.deny.toArray(), roleName: chRoleName });
    }
    const typeStr = ch.type === ChannelType.GuildVoice ? 'voice'
      : ch.type === ChannelType.GuildAnnouncement ? 'announcement'
      : ch.type === ChannelType.GuildForum ? 'forum'
      : ch.type === ChannelType.GuildStageVoice ? 'stage'
      : 'text';
    orphanChannels.push({
      name: ch.name, type: typeStr, topic: ch.topic || '',
      nsfw: ch.nsfw || false, rateLimitPerUser: ch.rateLimitPerUser || 0,
      position: ch.position, permOverwrites: chOverwrites,
      isSystemChannel: guild.systemChannelId === ch.id,
      isAfkChannel: guild.afkChannelId === ch.id,
    });
  }
  orphanChannels.sort((a, b) => a.position - b.position);
  categories.sort((a, b) => a.position - b.position);

  return { server, roles, everyonePerms, memberRoles, categories, orphanChannels };
}

// ── Apply Structure (COMPLETO) ─────────────────────────────────────────────────
async function applyStructure(guild, structure, onStep) {
  console.log(`[APPLY] Iniciando applyStructure — roles: ${structure.roles?.length}, categories: ${structure.categories?.length}`);

  // 1. Remover canais
  await onStep('🗑️', 'Removendo canais...');
  const existingChannels = await guild.channels.fetch();
  console.log(`[APPLY] Deletando ${existingChannels.size} canais...`);
  for (const [, ch] of existingChannels) await ch.delete().catch(e => console.error('[APPLY] Erro ao deletar canal:', e.message));
  await new Promise(r => setTimeout(r, 1000));

  // 2. Remover cargos
  await onStep('🗑️', 'Removendo cargos...');
  const existingRoles = await guild.roles.fetch();
  console.log(`[APPLY] Deletando cargos...`);
  for (const [, role] of existingRoles) {
    if (!role.managed && role.name !== '@everyone') await role.delete().catch(e => console.error('[APPLY] Erro ao deletar cargo:', e.message));
  }
  await new Promise(r => setTimeout(r, 500));

  // 3. Restaurar permissões do @everyone
  if (structure.everyonePerms) {
    try {
      await guild.roles.everyone.setPermissions(structure.everyonePerms).catch(() => {});
    } catch (e) { console.error('@everyone perms:', e.message); }
  }

  // 4. Restaurar configurações do servidor
  if (structure.server) {
    try {
      await onStep('⚙️', 'Restaurando configurações do servidor...');
      await guild.edit({
        name: structure.server.name,
        description: structure.server.description || null,
        verificationLevel: structure.server.verificationLevel,
        defaultMessageNotifications: structure.server.defaultMessageNotifications,
        explicitContentFilter: structure.server.explicitContentFilter,
        preferredLocale: structure.server.preferredLocale,
      }).catch(() => {});
    } catch (e) { console.error('Server edit:', e.message); }
  }

  // 5. Criar cargos e mapear nome -> objeto
  await onStep('👥', 'Criando cargos...');
  const createdRoles = new Map(); // nome -> Role
  const rolesToCreate = [...(structure.roles || [])].sort((a, b) => a.position - b.position);
  console.log(`[APPLY] Criando ${rolesToCreate.length} cargos...`);
  for (const r of rolesToCreate) {
    try {
      const safeColor = /^#[0-9A-Fa-f]{6}$/.test(r.color) ? r.color : '#99aab5';
      const roleData = {
        name: r.name,
        color: safeColor,
        hoist: r.hoist || false,
        mentionable: r.mentionable || false,
        permissions: Array.isArray(r.permissions) ? buildPermissions(r.permissions) : (r.permissions || 0n),
      };
      if (r.unicodeEmoji) roleData.unicodeEmoji = r.unicodeEmoji;
      const role = await guild.roles.create(roleData);
      createdRoles.set(r.name, role);
      console.log(`[APPLY] Cargo criado: ${r.name}`);
      await onStep('✅', `Cargo: **${r.name}**`);
      await new Promise(r => setTimeout(r, 200));
    } catch (e) { console.error('Cargo:', e.message); }
  }

  // Helper: converter permOverwrites salvos para overwrites com IDs reais
  function resolveOverwrites(permOverwrites) {
    const resolved = [];
    for (const ow of permOverwrites || []) {
      // type 0 = role, type 1 = member
      if (ow.type === 0) {
        // Tenta encontrar o cargo pelo ID original (pode não existir) ou pelo nome salvo
        const role = createdRoles.get(ow.roleName) || guild.roles.cache.get(ow.id) || guild.roles.everyone;
        if (role) resolved.push({ id: role.id, allow: ow.allow, deny: ow.deny });
      } else if (ow.type === 1) {
        resolved.push({ id: ow.id, allow: ow.allow, deny: ow.deny });
      }
    }
    return resolved;
  }

  // Helper para salvar nome do cargo junto com o overwrite
  function enrichOverwrites(permOverwrites, guildRoles) {
    return (permOverwrites || []).map(ow => {
      if (ow.type === 0) {
        const role = guildRoles.get(ow.id);
        return { ...ow, roleName: role?.name || null };
      }
      return ow;
    });
  }

  // 6. Criar categorias e canais
  const typeMap = {
    voice: ChannelType.GuildVoice,
    announcement: ChannelType.GuildAnnouncement,
    forum: ChannelType.GuildForum,
    stage: ChannelType.GuildStageVoice,
    text: ChannelType.GuildText,
  };

  let systemChannelId = null;
  let afkChannelId = null;

  // Canais sem categoria primeiro
  for (const ch of structure.orphanChannels || []) {
    try {
      const type = typeMap[ch.type] || ChannelType.GuildText;
      const channelData = {
        name: ch.name.substring(0, 100),
        type,
        nsfw: ch.nsfw || false,
        rateLimitPerUser: ch.rateLimitPerUser || 0,
        permissionOverwrites: resolveOverwrites(ch.permOverwrites),
      };
      if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement) channelData.topic = ch.topic?.substring(0, 1024) || '';
      const created = await guild.channels.create(channelData).catch(e => { console.error('Orphan canal create:', e.message); return null; });
      if (!created) continue;
      if (ch.isSystemChannel) systemChannelId = created.id;
      if (ch.isAfkChannel) afkChannelId = created.id;
      await onStep('💬', `Canal: **${ch.name}**`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { console.error('Orphan canal:', e.message); }
  }

  // Categorias e seus canais
  console.log(`[APPLY] Criando ${structure.categories?.length || 0} categorias...`);
  for (const category of structure.categories || []) {
    try {
      await onStep('📁', `Categoria: **${category.name}**`);
      const cat = await guild.channels.create({
        name: category.name.substring(0, 100),
        type: ChannelType.GuildCategory,
        permissionOverwrites: resolveOverwrites(category.permOverwrites),
      }).catch(e => { console.error('[APPLY] Erro ao criar categoria:', e.message); return null; });
      if (!cat) continue;
      console.log(`[APPLY] Categoria criada: ${category.name}`);
      await new Promise(r => setTimeout(r, 400));

      for (const ch of category.channels || []) {
        try {
          const type = typeMap[ch.type] || ChannelType.GuildText;
          const channelData = {
            name: ch.name.substring(0, 100) || 'canal',
            type,
            parent: cat.id,
            nsfw: ch.nsfw || false,
            rateLimitPerUser: ch.rateLimitPerUser || 0,
            permissionOverwrites: resolveOverwrites(ch.permOverwrites),
          };
          if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement) channelData.topic = ch.topic?.substring(0, 1024) || '';
          const created = await guild.channels.create(channelData).catch(e => { console.error('[APPLY] Erro ao criar canal:', ch.name, e.message); return null; });
          if (!created) continue;
          console.log(`[APPLY] Canal criado: ${ch.name}`);
          if (ch.isSystemChannel) systemChannelId = created.id;
          if (ch.isAfkChannel) afkChannelId = created.id;
          await onStep('💬', `Canal: **${ch.name}**`);
          await new Promise(r => setTimeout(r, 300));
        } catch (e) { console.error('[APPLY] Canal exception:', ch.name, e.message); }
      }
    } catch (e) { console.error('[APPLY] Categoria exception:', category.name, e.message); }
  }

  // 7. Atualizar canal de sistema e AFK
  try {
    const editData = {};
    if (systemChannelId) editData.systemChannel = systemChannelId;
    if (afkChannelId) editData.afkChannel = afkChannelId;
    if (Object.keys(editData).length > 0) await guild.edit(editData).catch(() => {});
  } catch (e) { console.error('System/AFK channel:', e.message); }

  // [VERIFICAÇÃO] Restaurar cargos dos membros desativado temporariamente

  // 9. Mensagem de boas-vindas
  if (structure.welcomeMessage) {
    try {
      const freshChannels = await guild.channels.fetch();
      const first = freshChannels.find(c => c?.type === ChannelType.GuildText && c.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel));
      if (first) await first.send(structure.welcomeMessage).catch(() => {});
    } catch (e) { console.error('Welcome message:', e.message); }
  }
}


// ── Pending confirmations ──────────────────────────────────────────────────────
const pendingCreate  = new Map();
const pendingRestore = new Map();

// ── Embeds ─────────────────────────────────────────────────────────────────────
function buildQueueEmbed(position, prompt) {
  return new EmbedBuilder()
    .setTitle('⏳  Na Fila de Geração')
    .setColor(0xf39c12)
    .setDescription([
      '> ◈ O Architect está gerando outro servidor neste momento.',
      `> Sua solicitação está na **posição ${position}** da fila.`,
      '',
      `\`\`\`${prompt.substring(0, 80)}\`\`\``,
    ].join('\n'))
    .setFooter({ text: `Architect ${VERSION} • Aguarde sua vez` })
    .setTimestamp();
}

function buildAnalysisEmbed(prompt, logs) {
  const logLines = logs.slice(-8).map(l => `\`[${l.tag}]\` ${l.icon} ${l.msg}`).join('\n') || '`[INIT]` ◈ Iniciando análise...';
  return new EmbedBuilder()
    .setTitle('◈  Analisando Prompt')
    .setColor(0x9b59b6)
    .addFields(
      { name: '📋 Prompt', value: `\`\`\`${prompt.substring(0, 200)}\`\`\`` },
      { name: '📡 Log em Tempo Real', value: logLines },
    )
    .setFooter({ text: `Architect ${VERSION} • Powered by Mistral AI` })
    .setTimestamp();
}

function buildCountdownBar(seconds, total) {
  const filled = Math.round((seconds / total) * 20);
  return `\`[${'█'.repeat(filled)}${'░'.repeat(20 - filled)}] ${seconds}s\``;
}

function buildConfirmEmbed(prompt, structure, secondsLeft) {
  const totalChannels = structure.categories.reduce((a, c) => a + (c.channels?.length || 0), 0);
  return new EmbedBuilder()
    .setTitle('⚠️  Confirmar Criação')
    .setColor(secondsLeft > 20 ? 0xf39c12 : 0xe74c3c)
    .setDescription('> ⚠️ **Esta ação apagará TUDO e recriará do zero.**\n> Revise antes de confirmar.')
    .addFields(
      { name: '📋 Prompt',      value: `\`\`\`${prompt.substring(0, 200)}\`\`\`` },
      { name: '👥 Cargos',      value: String(structure.roles?.length || 0),      inline: true },
      { name: '📁 Categorias',  value: String(structure.categories?.length || 0), inline: true },
      { name: '💬 Canais',      value: String(totalChannels),                     inline: true },
      { name: `⏱️ Expira em ${secondsLeft}s`, value: buildCountdownBar(secondsLeft, 60) },
    )
    .setFooter({ text: `Architect ${VERSION} • Confirme antes do tempo acabar` })
    .setTimestamp();
}

function buildProgressEmbed(title, info, steps) {
  const last = steps.slice(-8);
  const log  = last.length > 0 ? last.map((s, i) => i === last.length - 1 ? `▶ ${s}` : `✔ ${s}`).join('\n') : '▶ Iniciando...';
  return new EmbedBuilder()
    .setTitle(title).setColor(0x9b59b6)
    .addFields({ name: '📋 Servidor', value: info.substring(0, 150) }, { name: '📊 Progresso', value: `\`\`\`\n${log}\n\`\`\`` })
    .setFooter({ text: `Architect ${VERSION}` }).setTimestamp();
}

function errorEmbed(msg) {
  return new EmbedBuilder().setTitle('❌  Erro').setColor(0xe74c3c)
    .setDescription(`\`\`\`${msg.substring(0, 500)}\`\`\``).setFooter({ text: `Architect ${VERSION}` });
}

function buildConfirmRow(confirmId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`create_confirm_${confirmId}`).setLabel('✅  Confirmar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌  Cancelar').setStyle(ButtonStyle.Danger),
  );
}

function startCountdown(interaction, confirmId, prompt, structure, tipo = null) {
  let secondsLeft = 60;
  const interval = setInterval(async () => {
    secondsLeft--;
    if (secondsLeft <= 0 || !pendingCreate.has(confirmId)) {
      clearInterval(interval);
      if (pendingCreate.has(confirmId)) {
        pendingCreate.delete(confirmId);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⏰  Tempo Esgotado').setColor(0xe74c3c).setDescription('A confirmação expirou. Use o comando novamente.').setFooter({ text: `Architect ${VERSION}` })], components: [] }).catch(() => {});
        await interaction.user.send({ embeds: [new EmbedBuilder().setTitle('⏰  Confirmação Expirada').setColor(0xe74c3c).setDescription(`Sua solicitação${tipo ? ` de template **${tipo}**` : ` em **${interaction.guild?.name}**`} expirou.\n\nUse o comando novamente quando quiser.`).setFooter({ text: `Architect ${VERSION}` })] }).catch(() => {});
      }
      return;
    }
    await interaction.editReply({ embeds: [buildConfirmEmbed(prompt, structure, secondsLeft)], components: [buildConfirmRow(confirmId)] }).catch(() => {});
  }, 1000);
}

// ── Guild Create ───────────────────────────────────────────────────────────────
client.on('guildCreate', async guild => {
  try {
    const owner = await guild.fetchOwner();
    await owner.send({ embeds: [new EmbedBuilder().setTitle('🏗️  Olá! Obrigado por adicionar o Architect!').setColor(0x9b59b6).setThumbnail(client.user.displayAvatarURL()).setDescription(`Opa, **${owner.user.username}**! Vejo que você me adicionou em **${guild.name}**. Seja bem-vindo!\n\nAqui estão os próximos passos:`).addFields({ name: '📋 Comandos', value: 'Use **/help** para ver todos os comandos', inline: false }, { name: '💾 Backup', value: 'Use **/backup** para salvar a estrutura', inline: false }, { name: '🛡️ Proteção', value: 'Use **/proteger ativo:true** para ativar o anti-nuke', inline: false }, { name: '🌐 Idioma', value: 'Use **/idioma** para mudar o idioma do bot', inline: false }).setFooter({ text: `Architect ${VERSION} • Create. Protect. Restore.` }).setTimestamp()] }).catch(() => {});
  } catch (e) { console.error('GuildCreate DM:', e.message); }
});

// ── Ready ──────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Architect ${VERSION} online como ${client.user.tag}`);
  const statuses = [{ text: 'Building your server...', type: 4 }, { text: 'Protecting your community', type: 4 }, { text: 'Restoring after nukes', type: 4 }];
  let si = 0;
  const tick = () => { client.user.setActivity(statuses[si].text, { type: statuses[si].type }); si = (si + 1) % statuses.length; };
  tick(); setInterval(tick, 3000);

  const commands = [
    new SlashCommandBuilder().setName('criar_servidor').setDescription('Cria servidor completo com IA').addStringOption(o => o.setName('prompt').setDescription('Descreva o servidor').setRequired(true)),
    new SlashCommandBuilder().setName('template').setDescription('Aplica template pronto').addStringOption(o => o.setName('tipo').setDescription('Tipo').setRequired(true).addChoices({ name: '🌐 Comunidade', value: 'comunidade' }, { name: '🎮 Gaming', value: 'gaming' }, { name: '🪖 Militar', value: 'militar' }, { name: '🛒 Loja', value: 'loja' }, { name: '🎌 Anime', value: 'anime' }, { name: '📚 Educacional', value: 'educacional' })),
    new SlashCommandBuilder().setName('backup').setDescription('Salva estrutura do servidor'),
    new SlashCommandBuilder().setName('restaurar').setDescription('Restaura servidor do backup'),
    new SlashCommandBuilder().setName('proteger').setDescription('Ativa/desativa anti-nuke').addBooleanOption(o => o.setName('ativo').setDescription('Ativar ou desativar').setRequired(true)),
    new SlashCommandBuilder().setName('deletar').setDescription('Deleta canais, cargos ou tudo').addStringOption(o => o.setName('tipo').setDescription('O que deletar').setRequired(true).addChoices({ name: '🎭 Cargos', value: 'cargos' }, { name: '💬 Canais', value: 'canais' }, { name: '🗑️ Tudo', value: 'tudo' })).addStringOption(o => o.setName('alvo').setDescription('Quais ou "everyone"').setRequired(false)).addBooleanOption(o => o.setName('tudo').setDescription('Deletar tudo?').setRequired(false)),
    new SlashCommandBuilder().setName('status').setDescription('Informações do servidor'),
    new SlashCommandBuilder().setName('cargo_criar').setDescription('Cria um cargo').addStringOption(o => o.setName('nome').setDescription('Nome').setRequired(true)).addStringOption(o => o.setName('cor').setDescription('Cor hex').setRequired(false)).addBooleanOption(o => o.setName('admin').setDescription('Admin?').setRequired(false)),
    new SlashCommandBuilder().setName('canal_criar').setDescription('Cria um canal').addStringOption(o => o.setName('nome').setDescription('Nome').setRequired(true)).addStringOption(o => o.setName('tipo').setDescription('Tipo').setRequired(false).addChoices({ name: '💬 Texto', value: 'text' }, { name: '🔊 Voz', value: 'voice' }, { name: '📋 Fórum', value: 'forum' }, { name: '📢 Announcement', value: 'announcement' }, { name: '🎙️ Palco', value: 'stage' })).addStringOption(o => o.setName('topico').setDescription('Tópico').setRequired(false)),
    new SlashCommandBuilder().setName('ban').setDescription('Bane um membro').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)).addIntegerOption(o => o.setName('dias').setDescription('Dias (0-7)').setMinValue(0).setMaxValue(7).setRequired(false)),
    new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('mute').setDescription('Muta um membro').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addIntegerOption(o => o.setName('duracao').setDescription('Duração em minutos').setRequired(true).setMinValue(1).setMaxValue(10080)).addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('unmute').setDescription('Desmuta um membro').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)),
    new SlashCommandBuilder().setName('warn').setDescription('Adverte um membro').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)),
    new SlashCommandBuilder().setName('lock').setDescription('Tranca um canal').addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(false)).addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('unlock').setDescription('Destranca um canal').addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(false)),
    new SlashCommandBuilder().setName('slowmode').setDescription('Modo lento').addIntegerOption(o => o.setName('segundos').setDescription('Segundos (0 = desativar)').setRequired(true).setMinValue(0).setMaxValue(21600)).addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(false)),
    new SlashCommandBuilder().setName('clear').setDescription('Apaga mensagens').addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (máx: 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('embed').setDescription('Cria embed personalizado').addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true)).addStringOption(o => o.setName('descricao').setDescription('Descrição').setRequired(true)).addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(false)).addStringOption(o => o.setName('cor').setDescription('Cor hex').setRequired(false)).addStringOption(o => o.setName('imagem').setDescription('URL da imagem').setRequired(false)).addStringOption(o => o.setName('rodape').setDescription('Rodapé').setRequired(false)),
    new SlashCommandBuilder().setName('anuncio').setDescription('Envia anúncio').addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true)).addStringOption(o => o.setName('mensagem').setDescription('Mensagem').setRequired(true)).addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(true)).addBooleanOption(o => o.setName('marcar_everyone').setDescription('Marcar @everyone?').setRequired(false)),
    new SlashCommandBuilder().setName('idioma').setDescription('Altera o idioma do bot no servidor').addStringOption(o => o.setName('lang').setDescription('Idioma').setRequired(true).addChoices({ name: '🇧🇷 Português', value: 'pt' }, { name: '🇺🇸 English', value: 'en' }, { name: '🇪🇸 Español', value: 'es' }, { name: '🇫🇷 Français', value: 'fr' }, { name: '🇩🇪 Deutsch', value: 'de' })),
    new SlashCommandBuilder().setName('doar').setDescription('Apoie o desenvolvimento do Architect'),
    new SlashCommandBuilder().setName('dm').setDescription('Enviar mensagem oficial').addStringOption(o => o.setName('mensagem').setDescription('Mensagem').setRequired(true)),
    new SlashCommandBuilder().setName('premium').setDescription('Gerenciar Premium do Architect').addUserOption(o => o.setName('usuario').setDescription('Usuário').setRequired(true)).addStringOption(o => o.setName('plano').setDescription('Plano').setRequired(true).addChoices({ name: '⚡ Semanal (7 dias)', value: 'semanal' }, { name: '💎 Mensal (30 dias)', value: 'mensal' }, { name: '👑 Anual (365 dias)', value: 'anual' }, { name: '❌ Remover', value: 'remover' })),
    new SlashCommandBuilder().setName('info').setDescription('Informações do Architect'),
    new SlashCommandBuilder().setName('help').setDescription('Lista de comandos'),
  ].map(c => c.toJSON());

  try {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log(`✅ ${commands.length} comandos registrados!`);
  } catch (e) { console.error('❌ Erro ao registrar comandos:', e.message); }
});

// ── Interaction Handler ────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split('_confirm_');

    if (action === 'create' && pendingCreate.has(id)) {
      const { prompt, structure } = pendingCreate.get(id); pendingCreate.delete(id);
      const steps = [];
      await interaction.update({ embeds: [buildProgressEmbed('🏗️  Construindo Servidor...', prompt, steps)], components: [] }).catch(() => {});
      const update = async (icon, msg) => { steps.push(`${icon} ${msg}`); await interaction.editReply({ embeds: [buildProgressEmbed('🏗️  Construindo Servidor...', prompt, steps)] }).catch(() => {}); };
      try {
        await applyStructure(interaction.guild, structure, update);
        const successEmbed = new EmbedBuilder().setTitle('✅  Servidor Criado!').setColor(0x2ecc71).setDescription(`O servidor foi recriado com sucesso!`).addFields({ name: '👥 Cargos', value: String(structure.roles?.length || 0), inline: true }, { name: '📁 Categorias', value: String(structure.categories?.length || 0), inline: true }, { name: '💬 Canais', value: String(structure.categories?.reduce((a, c) => a + (c.channels?.length || 0), 0) || 0), inline: true }).setFooter({ text: `Architect ${VERSION} • Create. Protect. Restore.` }).setTimestamp();
        // Tenta editar a reply, se falhar (canal deletado) envia por DM
        await interaction.editReply({ embeds: [successEmbed], components: [] }).catch(async () => {
          await interaction.user.send({ embeds: [successEmbed] }).catch(() => {});
        });
      } catch (e) {
        await interaction.editReply({ embeds: [errorEmbed(e.message)], components: [] }).catch(async () => {
          await interaction.user.send({ embeds: [errorEmbed(e.message)] }).catch(() => {});
        });
      }
      return;
    }

    if (action === 'restore' && pendingRestore.has(id)) {
      const { backup } = pendingRestore.get(id); pendingRestore.delete(id);
      const steps = []; const label = new Date(backup.savedAt).toLocaleString('pt-BR');
      await interaction.update({ embeds: [buildProgressEmbed('🔄  Restaurando Servidor...', `Backup de ${label}`, steps)], components: [] });
      const update = async (icon, msg) => { steps.push(`${icon} ${msg}`); await interaction.editReply({ embeds: [buildProgressEmbed('🔄  Restaurando...', `Backup de ${label}`, steps)] }).catch(() => {}); };
      try { await applyStructure(interaction.guild, backup.structure, update); await update('🎉', 'Servidor restaurado!'); }
      catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)], components: [] }).catch(() => {}); }
      return;
    }

    if (action === 'delete' && pendingCreate.has(`del_${id}`)) {
      const { tipo, alvo, tudo, acao } = pendingCreate.get(`del_${id}`); pendingCreate.delete(`del_${id}`);
      await interaction.update({ embeds: [new EmbedBuilder().setTitle('🗑️  Deletando...').setColor(0xe74c3c).setDescription('Processando...').setFooter({ text: `Architect ${VERSION}` })], components: [] });
      try {
        let deletedCount = 0;
        if (acao === 'delete_all') {
          const chs = await interaction.guild.channels.fetch(); for (const [, ch] of chs) { await ch.delete().catch(() => {}); deletedCount++; }
          const rs = await interaction.guild.roles.fetch(); for (const [, role] of rs) { if (!role.managed && role.name !== '@everyone') { await role.delete().catch(() => {}); deletedCount++; } }
        } else if (acao === 'delete_channels_all') {
          const chs = await interaction.guild.channels.fetch(); for (const [, ch] of chs) { await ch.delete().catch(() => {}); deletedCount++; }
        } else if (acao === 'delete_roles_all') {
          const rs = await interaction.guild.roles.fetch(); for (const [, role] of rs) { if (!role.managed && role.name !== '@everyone') { await role.delete().catch(() => {}); deletedCount++; } }
        } else if (acao === 'delete_channels_specific') {
          const names = alvo.replace(/<#\d+>/g, m => { const ch = interaction.guild.channels.cache.get(m.replace(/\D/g, '')); return ch ? ch.name : ''; }).split(/[\s,]+/).filter(Boolean);
          for (const name of names) { const ch = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === name.toLowerCase()); if (ch) { await ch.delete().catch(() => {}); deletedCount++; } }
        } else if (acao === 'delete_roles_specific') {
          const names = alvo.replace(/<@&\d+>/g, m => { const r = interaction.guild.roles.cache.get(m.replace(/\D/g, '')); return r ? r.name : ''; }).split(/[\s,]+/).filter(Boolean);
          for (const name of names) { const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase()); if (role && !role.managed && role.name !== '@everyone') { await role.delete().catch(() => {}); deletedCount++; } }
        }
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✅  Deleção Concluída').setColor(0x2ecc71).setDescription(`**${deletedCount}** item(s) deletado(s)!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [] });
      } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)], components: [] }); }
      return;
    }

    if (action === 'cancel') {
      pendingCreate.delete(id); pendingRestore.delete(id);
      await interaction.update({ embeds: [new EmbedBuilder().setTitle('❌  Cancelado').setColor(0x95a5a6).setDescription('Operação cancelada.').setFooter({ text: `Architect ${VERSION}` })], components: [] });
      return;
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild, member } = interaction;
  const lang = await getGuildLang(guild.id);
  const publicCmds = ['info', 'help', 'status', 'doar', 'idioma'];
  if (!publicCmds.includes(commandName) && !member.permissions.has(PermissionFlagsBits.Administrator))
    return interaction.reply({ content: lang.noPermission, ephemeral: true });

  // ── /criar_servidor ──────────────────────────────────────────────────────────
  if (commandName === 'criar_servidor') {
    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply();
    if (activeGenerations >= MAX_CONCURRENT || generationQueue.length > 0) {
      await interaction.editReply({ embeds: [buildQueueEmbed(generationQueue.length + 1, prompt)] });
    } else {
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, [])] });
    }
    const isPremium = await isGuildOwnerPremium(guild);
    const logs = [];
    const onLog = async (icon, tag, msg) => { logs.push({ icon, tag, msg }); console.log(`[${tag}] ${msg}`); };
    try {
      const structure = await generateStructure(prompt, onLog, isPremium);
      const confirmId = `${interaction.id}`;
      pendingCreate.set(confirmId, { prompt, structure });
      await interaction.editReply({ embeds: [buildConfirmEmbed(prompt, structure, 60)], components: [buildConfirmRow(confirmId)] });
      startCountdown(interaction, confirmId, prompt, structure);
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }).catch(() => {}); }
  }

  // ── /template ────────────────────────────────────────────────────────────────
  else if (commandName === 'template') {
    const tipo = interaction.options.getString('tipo');
    const templates = { comunidade: 'Crie uma comunidade brasileira com informações, geral, eventos, suporte e voz', gaming: 'Crie um servidor gamer com jogos, torneios, clips, suporte e voz', militar: 'Crie um servidor militar com hierarquia, missões, treinamentos e voz', loja: 'Crie uma loja online com produtos, pedidos, promoções e suporte', anime: 'Crie um servidor de anime com discussões, recomendações e fan arts', educacional: 'Crie um servidor educacional com matérias, dúvidas e eventos' };
    const prompt = templates[tipo];
    await interaction.deferReply();
    if (activeGenerations >= MAX_CONCURRENT || generationQueue.length > 0) {
      await interaction.editReply({ embeds: [buildQueueEmbed(generationQueue.length + 1, prompt)] });
    } else {
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, [])] });
    }
    const isPremium = await isGuildOwnerPremium(guild);
    const logs = [];
    const onLog = async (icon, tag, msg) => { logs.push({ icon, tag, msg }); console.log(`[${tag}] ${msg}`); };
    try {
      const structure = await generateStructure(prompt, onLog, isPremium);
      const confirmId = `${interaction.id}`;
      pendingCreate.set(confirmId, { prompt, structure });
      await interaction.editReply({ embeds: [buildConfirmEmbed(prompt, structure, 60)], components: [buildConfirmRow(confirmId)] });
      startCountdown(interaction, confirmId, prompt, structure, tipo);
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }).catch(() => {}); }
  }

  // ── /backup ──────────────────────────────────────────────────────────────────
  else if (commandName === 'backup') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const structure = await captureStructure(guild);
      saveBackup(guild.id, guild.name, structure);
      const chTotal = structure.categories.reduce((a, c) => a + c.channels.length, 0);
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(lang.backupSaved).setColor(0x2ecc71).setDescription(`Estrutura de **${guild.name}** salva!`).addFields({ name: '👥 Cargos', value: String(structure.roles.length), inline: true }, { name: '📁 Categorias', value: String(structure.categories.length), inline: true }, { name: '💬 Canais', value: String(chTotal), inline: true }, { name: '📅 Salvo em', value: new Date().toLocaleString('pt-BR') }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }); }
  }

  // ── /restaurar ───────────────────────────────────────────────────────────────
  else if (commandName === 'restaurar') {
    const backup = await getBackup(guild.id);
    if (!backup) return interaction.reply({ content: lang.noBackup, ephemeral: true });
    const confirmId = `${interaction.id}`; pendingRestore.set(confirmId, { backup }); setTimeout(() => pendingRestore.delete(confirmId), 60000);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`restore_confirm_${confirmId}`).setLabel('🔄  Restaurar').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌  Cancelar').setStyle(ButtonStyle.Danger));
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️  Restaurar Backup').setColor(0x3498db).setDescription('> ⚠️ **Isso irá apagar TUDO e restaurar o backup.**').addFields({ name: '📅 Backup de', value: new Date(backup.savedAt).toLocaleString('pt-BR') }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [row] });
  }

  // ── /proteger ────────────────────────────────────────────────────────────────
  else if (commandName === 'proteger') {
    const ativo = interaction.options.getBoolean('ativo');
    const backup = await getBackup(guild.id);
    if (ativo && !backup) return interaction.reply({ content: '❌ Faça um **/backup** primeiro!', ephemeral: true });
    if (backup) setProtection(guild.id, ativo);
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(ativo ? '🛡️  Proteção Ativada!' : '🔓  Proteção Desativada').setColor(ativo ? 0x2ecc71 : 0xe74c3c).setDescription(ativo ? '✅ Anti-nuke ativo. Monitorando em tempo real.' : '❌ Proteção desativada.').setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  // ── /deletar ─────────────────────────────────────────────────────────────────
  else if (commandName === 'deletar') {
    const tipo = interaction.options.getString('tipo'); const alvo = interaction.options.getString('alvo') || ''; const tudo = interaction.options.getBoolean('tudo') || false;
    let descricao = '', acao = '';
    if (tipo === 'cargos') { if (tudo || alvo.toLowerCase() === 'everyone') { descricao = '🗑️ Todos os cargos serão deletados.'; acao = 'delete_roles_all'; } else { descricao = `🗑️ Cargos: ${alvo}`; acao = 'delete_roles_specific'; } }
    else if (tipo === 'canais') { if (tudo || alvo.toLowerCase() === 'everyone') { descricao = '🗑️ Todos os canais serão deletados.'; acao = 'delete_channels_all'; } else { descricao = `🗑️ Canais: ${alvo}`; acao = 'delete_channels_specific'; } }
    else { descricao = '🗑️ TUDO será deletado.'; acao = 'delete_all'; }
    const confirmId = `${interaction.id}`; pendingCreate.set(`del_${confirmId}`, { tipo, alvo, tudo, acao }); setTimeout(() => pendingCreate.delete(`del_${confirmId}`), 60000);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`delete_confirm_${confirmId}`).setLabel('🗑️  Deletar').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌  Cancelar').setStyle(ButtonStyle.Secondary));
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️  Confirmar Deleção').setColor(0xe74c3c).setDescription(`> ⚠️ **Esta ação é irreversível!**\n\n${descricao}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [row] });
  }

  // ── /cargo_criar ─────────────────────────────────────────────────────────────
  else if (commandName === 'cargo_criar') {
    const nome = interaction.options.getString('nome'); const cor = interaction.options.getString('cor') || '#99aab5'; const adm = interaction.options.getBoolean('admin') || false;
    try { const role = await guild.roles.create({ name: nome, color: cor, permissions: adm ? [PermissionFlagsBits.Administrator] : [] }); await interaction.reply({ embeds: [new EmbedBuilder().setTitle('✅  Cargo Criado!').setColor(role.color).addFields({ name: '🎭 Nome', value: role.name, inline: true }, { name: '🎨 Cor', value: cor, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
    catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /canal_criar ─────────────────────────────────────────────────────────────
  else if (commandName === 'canal_criar') {
    const nome = interaction.options.getString('nome'); const tipo = interaction.options.getString('tipo') || 'text'; const topico = interaction.options.getString('topico') || '';
    const typeMap = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice };
    try { const channelData = { name: nome, type: typeMap[tipo] || ChannelType.GuildText }; if (topico) channelData.topic = topico; const ch = await guild.channels.create(channelData); await interaction.reply({ embeds: [new EmbedBuilder().setTitle('✅  Canal Criado!').setColor(0x2ecc71).addFields({ name: '💬 Nome', value: ch.name, inline: true }, { name: '📂 Tipo', value: tipo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
    catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /status ──────────────────────────────────────────────────────────────────
  else if (commandName === 'status') {
    const backup = await getBackup(guild.id); const channels = await guild.channels.fetch();
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`📊  Status — ${guild.name}`).setColor(0x3498db).setThumbnail(guild.iconURL()).addFields({ name: '👥 Membros', value: String(guild.memberCount), inline: true }, { name: '🎭 Cargos', value: String(guild.roles.cache.filter(r => r.name !== '@everyone').size), inline: true }, { name: '💬 Texto', value: String(channels.filter(c => c.type === ChannelType.GuildText).size), inline: true }, { name: '🛡️ Proteção', value: backup?.protection ? '✅ Ativa' : '❌ Inativa', inline: true }, { name: '💾 Backup', value: backup ? new Date(backup.savedAt).toLocaleString('pt-BR') : '❌ Nenhum', inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  // ── /ban ─────────────────────────────────────────────────────────────────────
  else if (commandName === 'ban') {
    const target = interaction.options.getMember('membro'); const motivo = interaction.options.getString('motivo') || 'Sem motivo informado'; const dias = interaction.options.getInteger('dias') || 0;
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target || !target.bannable) return interaction.reply({ content: '❌ Não consigo banir este membro!', ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle('🔨  Você foi banido!').setColor(0xe74c3c).setDescription(`Você foi banido de **${guild.name}**\n\n**Motivo:** ${motivo}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      await target.ban({ reason: motivo, deleteMessageDays: dias });
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔨  Membro Banido!').setColor(0xe74c3c).addFields({ name: '👤 Membro', value: target.user.tag, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }, { name: '🗑️ Mensagens', value: `${dias} dia(s)`, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /kick ────────────────────────────────────────────────────────────────────
  else if (commandName === 'kick') {
    const target = interaction.options.getMember('membro'); const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target || !target.kickable) return interaction.reply({ content: '❌ Não consigo expulsar este membro!', ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle('👟  Você foi expulso!').setColor(0xe67e22).setDescription(`Você foi expulso de **${guild.name}**\n\n**Motivo:** ${motivo}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      await target.kick(motivo);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('👟  Membro Expulso!').setColor(0xe67e22).addFields({ name: '👤 Membro', value: target.user.tag, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /mute ────────────────────────────────────────────────────────────────────
  else if (commandName === 'mute') {
    const target = interaction.options.getMember('membro'); const motivo = interaction.options.getString('motivo') || 'Sem motivo informado'; const duracao = interaction.options.getInteger('duracao') || 10;
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target) return interaction.reply({ content: '❌ Membro não encontrado!', ephemeral: true });
    try {
      await target.timeout(duracao * 60 * 1000, motivo);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔇  Membro Mutado!').setColor(0xf39c12).addFields({ name: '👤 Membro', value: target.user.tag, inline: true }, { name: '⏱️ Duração', value: `${duracao} min`, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /unmute ──────────────────────────────────────────────────────────────────
  else if (commandName === 'unmute') {
    const target = interaction.options.getMember('membro');
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target) return interaction.reply({ content: '❌ Membro não encontrado!', ephemeral: true });
    try {
      await target.timeout(null);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔊  Membro Desmutado!').setColor(0x2ecc71).addFields({ name: '👤 Membro', value: target.user.tag, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /warn ────────────────────────────────────────────────────────────────────
  else if (commandName === 'warn') {
    const target = interaction.options.getMember('membro'); const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target) return interaction.reply({ content: '❌ Membro não encontrado!', ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle('⚠️  Advertência Recebida').setColor(0xf39c12).setDescription(`**Servidor:** ${guild.name}\n**Motivo:** ${motivo}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️  Advertência Enviada!').setColor(0xf39c12).addFields({ name: '👤 Membro', value: target.user.tag, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /lock ────────────────────────────────────────────────────────────────────
  else if (commandName === 'lock') {
    const canal = interaction.options.getChannel('canal') || interaction.channel; const motivo = interaction.options.getString('motivo') || 'Canal trancado';
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔒  Canal Trancado!').setColor(0xe74c3c).addFields({ name: '💬 Canal', value: `<#${canal.id}>`, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /unlock ──────────────────────────────────────────────────────────────────
  else if (commandName === 'unlock') {
    const canal = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔓  Canal Destrancado!').setColor(0x2ecc71).addFields({ name: '💬 Canal', value: `<#${canal.id}>`, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /slowmode ────────────────────────────────────────────────────────────────
  else if (commandName === 'slowmode') {
    const segundos = interaction.options.getInteger('segundos'); const canal = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await canal.setRateLimitPerUser(segundos);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⏱️  Slowmode Configurado!').setColor(0x3498db).addFields({ name: '💬 Canal', value: `<#${canal.id}>`, inline: true }, { name: '⏱️ Intervalo', value: segundos === 0 ? 'Desativado' : `${segundos}s`, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /clear ───────────────────────────────────────────────────────────────────
  else if (commandName === 'clear') {
    const quantidade = interaction.options.getInteger('quantidade');
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await interaction.deferReply({ ephemeral: true });
      const msgs = await interaction.channel.bulkDelete(Math.min(quantidade, 100), true);
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🧹  Mensagens Deletadas!').setColor(0x2ecc71).setDescription(`**${msgs.size}** mensagem(s) deletada(s)!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }); }
  }

  // ── /embed ───────────────────────────────────────────────────────────────────
  else if (commandName === 'embed') {
    const titulo = interaction.options.getString('titulo'); const descricao = interaction.options.getString('descricao'); const cor = interaction.options.getString('cor') || '#9b59b6'; const canal = interaction.options.getChannel('canal') || interaction.channel; const imagem = interaction.options.getString('imagem') || null; const rodape = interaction.options.getString('rodape') || null;
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      const embed = new EmbedBuilder().setTitle(titulo).setDescription(descricao).setColor(cor).setTimestamp();
      if (imagem) embed.setImage(imagem);
      if (rodape) embed.setFooter({ text: rodape });
      await canal.send({ embeds: [embed] });
      await interaction.reply({ content: `✅ Embed enviado em <#${canal.id}>!`, ephemeral: true });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /anuncio ─────────────────────────────────────────────────────────────────
  else if (commandName === 'anuncio') {
    const titulo = interaction.options.getString('titulo'); const mensagem = interaction.options.getString('mensagem'); const canal = interaction.options.getChannel('canal'); const marcar = interaction.options.getBoolean('marcar_everyone') || false;
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      const embed = new EmbedBuilder().setTitle(`📢  ${titulo}`).setDescription(mensagem).setColor(0x9b59b6).setFooter({ text: `Anúncio por ${member.user.tag} • Architect ${VERSION}` }).setTimestamp();
      await canal.send({ content: marcar ? '@everyone' : null, embeds: [embed] });
      await interaction.reply({ content: `✅ Anúncio enviado em <#${canal.id}>!`, ephemeral: true });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /idioma ───────────────────────────────────────────────────────────────────
  else if (commandName === 'idioma') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: lang.noPermission, ephemeral: true });
    const langKey = interaction.options.getString('lang');
    const newLang = LANGS[langKey];
    await mongoDB.collection('settings').updateOne({ guildId: guild.id }, { $set: { guildId: guild.id, lang: langKey } }, { upsert: true });
    guildLangCache.set(guild.id, newLang);
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(newLang.langTitle)
      .setColor(0x2ecc71)
      .setDescription(newLang.langChanged(newLang.name))
      .addFields({ name: '🌐 Idioma', value: `${newLang.flag} ${newLang.name}`, inline: true })
      .setFooter({ text: `Architect ${VERSION}` })
      .setTimestamp()] });
  }

  // ── /doar ────────────────────────────────────────────────────────────────────
  else if (commandName === 'doar') {
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(lang.doarTitle)
      .setColor(0x9b59b6)
      .setDescription(lang.doarDesc)
      .addFields(
        { name: '💸 Pix — Copia e Cola', value: '```00020126580014br.gov.bcb.pix0136d1918ea8-a370-4a1b-9a91-6169472609755204000053039865802BR5925Jose Gabriel Nascimento F6009Sao Paulo62290525REC69C84CBCE0A2A7675161826304388D```' },
        { name: '👨‍💻 Dev', value: 'Alzhayds', inline: true },
        { name: '🌐 Servidores', value: String(client.guilds.cache.size), inline: true },
      )
      .setFooter({ text: `Architect ${VERSION} • ${lang.doarThanks}` })
      .setTimestamp()], ephemeral: true });
  }

  // ── /info ────────────────────────────────────────────────────────────────────
  else if (commandName === 'info') {
    const uptime = process.uptime();
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏗️  Architect').setColor(0x9b59b6).setThumbnail(client.user.displayAvatarURL()).setDescription('O bot mais avançado de criação, proteção e restauração de servidores Discord.').addFields({ name: '👨‍💻 Dev', value: 'Alzhayds', inline: true }, { name: '🌐 Servidores', value: String(client.guilds.cache.size), inline: true }, { name: '⏱️ Uptime', value: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`, inline: true }, { name: '⚡ Stack', value: 'Discord.js v14 + Mistral AI', inline: true }, { name: '📦 Versão', value: VERSION, inline: true }, { name: '🔢 Fila', value: `${generationQueue.length} na fila · ${activeGenerations} ativo(s)`, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }


  // ── /dm ──────────────────────────────────────────────────────────────────────
  else if (commandName === 'dm') {
    if (interaction.user.id !== process.env.OWNER_ID)
      return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
    const mensagem = interaction.options.getString('mensagem');
    await interaction.deferReply({ ephemeral: true });
    let enviados = 0, falhas = 0;
    for (const [, g] of client.guilds.cache) {
      try {
        const owner = await g.fetchOwner();
        await owner.send({ embeds: [new EmbedBuilder()
          .setTitle('📢  Mensagem Oficial da Alzhadys')
          .setColor(0x9b59b6)
          .setDescription(mensagem)
          .setThumbnail(client.user.displayAvatarURL())
          .setFooter({ text: `Architect ${VERSION} • Mensagem Oficial` })
          .setTimestamp()] });
        enviados++;
      } catch (e) { falhas++; }
    }
    await interaction.editReply({ content: `✅ Mensagem enviada para **${enviados}** donos. Falhas: **${falhas}**.` });
  }


  // ── /premium ──────────────────────────────────────────────────────────────────
  else if (commandName === 'premium') {
    if (!PREMIUM_OWNERS.includes(interaction.user.id))
      return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });

    const target = interaction.options.getUser('usuario');
    const plano = interaction.options.getString('plano');
    await interaction.deferReply({ ephemeral: true });

    if (plano === 'remover') {
      await mongoDB.collection('premium').deleteOne({ userId: target.id });
      await target.send({ embeds: [new EmbedBuilder()
        .setTitle('❌  Premium Removido')
        .setColor(0xe74c3c)
        .setDescription('Seu acesso Premium ao Architect foi removido pela equipe Alzhadys.')
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] }).catch(() => {});
      return await interaction.editReply({ content: `✅ Premium removido de **${target.tag}**.` });
    }

    const plan = PREMIUM_PLANS[plano];
    const expiresAt = await setPremium(target.id, plano);

    await target.send({ embeds: [new EmbedBuilder()
      .setTitle(`${plan.emoji}  Bem-vindo ao Architect Premium!`)
      .setColor(0x9b59b6)
      .setDescription(`Olá, **${target.username}**! Você recebeu acesso **Premium** ao Architect.`)
      .addFields(
        { name: `${plan.emoji} Plano`, value: plan.label, inline: true },
        { name: '📅 Expira em', value: expiresAt.toLocaleDateString('pt-BR'), inline: true },
        { name: '✨ Benefícios', value: '• Criação de servidores mais detalhada\n• Backup automático a cada 30 min\n• Geração com mais cargos e canais\n• Prioridade na fila de geração', inline: false },
      )
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ text: `Architect ${VERSION} • Create. Protect. Restore.` })
      .setTimestamp()] }).catch(() => {});

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle(`${plan.emoji}  Premium Ativado!`)
      .setColor(0x2ecc71)
      .addFields(
        { name: '👤 Usuário', value: target.tag, inline: true },
        { name: `${plan.emoji} Plano`, value: plan.label, inline: true },
        { name: '📅 Expira', value: expiresAt.toLocaleDateString('pt-BR'), inline: true },
      )
      .setFooter({ text: `Architect ${VERSION}` })
      .setTimestamp()] });
  }

  // ── /help ────────────────────────────────────────────────────────────────────
  else if (commandName === 'help') {
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('📋  Comandos — Architect').setColor(0x9b59b6).setDescription(`**${VERSION}** — Create. Protect. Restore.`).addFields({ name: '🏗️ /criar_servidor', value: 'Cria servidor com IA' }, { name: '🎨 /template', value: 'Templates prontos' }, { name: '💾 /backup', value: 'Salva estrutura' }, { name: '🔄 /restaurar', value: 'Restaura após nuke' }, { name: '🛡️ /proteger', value: 'Anti-nuke toggle' }, { name: '🗑️ /deletar', value: 'Deleta canais/cargos' }, { name: '👥 /cargo_criar', value: 'Cria cargo' }, { name: '💬 /canal_criar', value: 'Cria canal' }, { name: '🌐 /idioma', value: 'Altera o idioma do bot' }, { name: '☕ /doar', value: 'Apoie o Architect' }, { name: '📊 /status', value: 'Info do servidor' }, { name: '🤖 /info', value: 'Info do bot' }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], ephemeral: true });
  }
});

// ── Anti-Nuke Events ───────────────────────────────────────────────────────────
client.on('channelDelete', async channel => {
  try {
    const backup = await getBackup(channel.guild.id); if (!backup?.protection) return;
    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }); const entry = logs.entries.first(); if (!entry) return;
    const count = trackNukeAction(channel.guild.id, entry.executor.id);
    if (count >= 3) { const alertCh = channel.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)); if (alertCh) await alertCh.send({ embeds: [new EmbedBuilder().setTitle('🚨  ALERTA DE NUKE!').setColor(0xe74c3c).setDescription(`⚠️ **${entry.executor.tag}** deletou **${count} canais** em menos de 10s!\n\nUse **/restaurar** imediatamente!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
  } catch (e) { console.error('Anti-nuke:', e.message); }
});

client.on('roleDelete', async role => {
  try {
    const backup = await getBackup(role.guild.id); if (!backup?.protection) return;
    const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }); const entry = logs.entries.first(); if (!entry) return;
    const count = trackNukeAction(role.guild.id, entry.executor.id);
    if (count >= 3) { const alertCh = role.guild.channels.cache.find(c => c.type === ChannelType.GuildText); if (alertCh) await alertCh.send({ embeds: [new EmbedBuilder().setTitle('🚨  ALERTA DE NUKE!').setColor(0xe74c3c).setDescription(`⚠️ **${entry.executor.tag}** deletou **${count} cargos** em menos de 10s!\n\nUse **/restaurar** imediatamente!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
  } catch (e) { console.error('Anti-nuke role:', e.message); }
});

/* [VERIFICAÇÃO] - Reaction Roles desativado temporariamente
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const backup = await getBackup(reaction.message.guild?.id); if (!backup?.reactionRoles) return;
    const rr = backup.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === reaction.emoji.name); if (!rr) return;
    const member = await reaction.message.guild.members.fetch(user.id); await member.roles.add(rr.roleId).catch(() => {});
  } catch (e) { console.error('ReactionRole:', e.message); }
});
*/

/* [VERIFICAÇÃO] - Reaction Roles desativado temporariamente
client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const backup = await getBackup(reaction.message.guild?.id); if (!backup?.reactionRoles) return;
    const rr = backup.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === reaction.emoji.name); if (!rr) return;
    const member = await reaction.message.guild.members.fetch(user.id); await member.roles.remove(rr.roleId).catch(() => {});
  } catch (e) { console.error('ReactionRole:', e.message); }
});
*/


// ── HTTP Server (Render + UptimeRobot) ────────────────────────────────────────
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'online',
    version: VERSION,
    guilds: client.guilds?.cache?.size || 0,
    uptime: Math.floor(process.uptime()),
  }));
});
server.listen(process.env.PORT || 3000, () => {
  console.log(`✅ HTTP ping server na porta ${process.env.PORT || 3000}`);
});

// ── Global Error Handlers ──────────────────────────────────────────────────────
client.on('error', e => console.error('❌ Client error:', e.message));
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection:', reason?.message || reason);
  // NÃO deixa o processo morrer
});
process.on('uncaughtException', (e) => {
  console.error('❌ Uncaught exception:', e?.message || e);
  // NÃO deixa o processo morrer — apenas loga
});

// ── Start ──────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  client.login(process.env.DISCORD_TOKEN)
    .then(() => {
      console.log('✅ Discord login OK');
      // Auto-backup Premium a cada 30 minutos
      setInterval(runAutoBackups, 30 * 60 * 1000);
      // Verificar Premium expirado a cada hora
      setInterval(async () => {
        const docs = await mongoDB.collection('premium').find({}).toArray().catch(() => []);
        for (const doc of docs) {
          if (new Date(doc.expiresAt) < new Date()) await getPremium(doc.userId);
        }
      }, 60 * 60 * 1000);
    })
    .catch(e => { console.error('❌ Discord login FALHOU:', e.message); process.exit(1); });
}).catch(e => { console.error('❌ Erro MongoDB:', e.message); process.exit(1); });
