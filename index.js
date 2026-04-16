/**
 * Architect v2.0.0
 * Developed by Alzhayds
 * Create. Protect. Restore.
 */

'use strict';

const {
  Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ChannelType, AuditLogEvent,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType,
} = require('discord.js');
const fetch      = require('node-fetch');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// ─────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────
const VERSION        = 'v2.0.0';
const MODEL          = 'mistral-small-2503';
const MISTRAL_URL    = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_KEY    = process.env.MISTRAL_KEY;
const OWNER_IDS      = (process.env.OWNER_ID      || '').split(',').map(s => s.trim()).filter(Boolean);
const PREMIUM_ADMINS = (process.env.PREMIUM_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);

// ─────────────────────────────────────────────
//  Custom Emojis
// ─────────────────────────────────────────────
const E = {
  check:      '<a:deucerto:1487554877986050099>',
  aguardando: '<:construcao_aguardando:1493438811965882408>',
  sucesso:    '<:construcao_sucesso:1493438814532927651>',
  cargos:     '<:cargos:1493438816214585354>',
  canais:     '<:canais:1493438818152616196>',
  loading:    '<a:carregando:1493438820077666476>',
  config:     '<:config:1493438822103650525>',
  servidores: '<:servidores:1493438824041156702>',
  erro:       '<:construcao_erro:1493438826163601408>',
  backup:     '<:backup:1493438828206358660>',
  banido:     '<:banido:1493438843574292611>',
  mutado:     '<:mutado:1493438846288003102>',
  lock:       '<a:lock:1493438851648196750>',
  unlock:     '<a:unlock:1493438855448105133>',
  premium:    '<a:premium:1493438858413477938>',
  data:       '<:data:1493438862158991551>',
  membros:    '<:membros:1493438860187926698>',
};

// ─────────────────────────────────────────────
//  Queue System — Normal & Premium
// ─────────────────────────────────────────────
const SECS_PER_GEN = 15;

const queues = {
  premium: { name: 'Premium', busy: false, queue: [] },
  normal:  { name: 'Normal',  busy: false, queue: [] },
};

function getQueue(isPremium) {
  return isPremium ? queues.premium : queues.normal;
}

function getQueueStatus(userId) {
  for (const [, q] of Object.entries(queues)) {
    const idx = q.queue.findIndex(e => e.userId === userId);
    if (idx !== -1) {
      const secs = (q.busy ? SECS_PER_GEN : 0) + idx * SECS_PER_GEN;
      return { label: q.name, position: idx + 1, secs };
    }
  }
  return null;
}

async function broadcastQueueUpdate() {
  for (const q of Object.values(queues)) {
    for (let i = 0; i < q.queue.length; i++) {
      const entry = q.queue[i];
      const secs  = (q.busy ? SECS_PER_GEN : 0) + i * SECS_PER_GEN;
      await entry.interaction?.editReply({
        embeds: [buildQueueEmbed(entry.prompt, q.name, i + 1, secs, entry.isPremium)],
      }).catch(() => {});
    }
  }
}

async function processQueue(key) {
  const q = queues[key];
  if (q.busy || q.queue.length === 0) return;
  q.busy = true;

  const entry = q.queue.shift();
  await broadcastQueueUpdate();

  try   { entry.resolve(await entry.task()); }
  catch (e) { entry.reject(e); }
  finally {
    await sleep(1100);
    q.busy = false;
    processQueue(key);
  }
}

function enqueue(task, interaction, prompt, userId, isPremium) {
  const q = getQueue(isPremium);
  return new Promise((resolve, reject) => {
    q.queue.push({ task, resolve, reject, userId, interaction, prompt, isPremium, addedAt: Date.now() });
    processQueue(isPremium ? 'premium' : 'normal');
  });
}

// ─────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function formatETA(secs) {
  if (secs <= 0) return '⚡ Quase na sua vez!';
  if (secs < 60) return `~${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return `~${m}min ${s}s`;
}

// ─────────────────────────────────────────────
//  Mistral API
// ─────────────────────────────────────────────
async function mistral(messages, maxTokens = 8000, asText = false, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(MISTRAL_URL, {
        method:  'POST',
        headers: { Authorization: `Bearer ${MISTRAL_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature: 0.4, messages }),
        signal:  AbortSignal.timeout(90000),
      });

      if (res.status === 429) {
        const wait = parseInt(res.headers.get('retry-after') || '5', 10) * 1000;
        console.warn(`[MISTRAL] 429 — aguardando ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`Mistral HTTP ${res.status}: ${await res.text()}`);

      const content = (await res.json()).choices?.[0]?.message?.content?.trim() || '';
      if (asText) return content;

      let raw = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/gi, '').trim();
      const isArr = raw.trimStart().startsWith('[');
      const s = raw.indexOf(isArr ? '[' : '{');
      const e = raw.lastIndexOf(isArr ? ']' : '}');
      if (s === -1 || e <= s) throw new Error('IA retornou JSON inválido. Tente novamente.');
      return JSON.parse(raw.substring(s, e + 1));

    } catch (err) {
      console.error(`[MISTRAL] Tentativa ${attempt}/${retries}: ${err.message}`);
      if (attempt === retries) throw err;
      await sleep(attempt * 2000);
    }
  }
}

// ─────────────────────────────────────────────
//  MongoDB
// ─────────────────────────────────────────────
let db;

async function connectDB() {
  const mc = new MongoClient(process.env.MONGO_URI);
  await mc.connect();
  db = mc.db('architect');
  console.log('✅ MongoDB conectado!');
}

const col = name => db.collection(name);

async function saveBackup(guildId, guildName, structure) {
  await col('backups').updateOne(
    { guildId },
    { $set: { guildId, guildName, structure, savedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

async function getBackup(guildId) {
  return col('backups').findOne({ guildId });
}

async function setProtection(guildId, val) {
  await col('backups').updateOne({ guildId }, { $set: { protection: val } });
}

// ─────────────────────────────────────────────
//  Premium System
// ─────────────────────────────────────────────
const PREMIUM_PLANS = {
  semanal: { label: 'Semanal', days: 7,   emoji: '⚡' },
  mensal:  { label: 'Mensal',  days: 30,  emoji: '💎' },
  anual:   { label: 'Anual',   days: 365, emoji: '👑' },
};

async function getPremium(userId) {
  const doc = await col('premium').findOne({ userId });
  if (!doc) return null;
  if (new Date(doc.expiresAt) < new Date()) {
    await col('premium').deleteOne({ userId });
    client.users.fetch(userId).then(u => u.send({ embeds: [
      new EmbedBuilder()
        .setTitle('⏰  Seu Premium expirou!')
        .setColor(0xe74c3c)
        .setDescription(`Seu plano **${doc.plan}** do Architect expirou.`)
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp(),
    ] })).catch(() => {});
    return null;
  }
  return doc;
}

async function setPremium(userId, plan) {
  const days      = PREMIUM_PLANS[plan].days;
  const expiresAt = new Date(Date.now() + days * 86400000);
  await col('premium').updateOne(
    { userId },
    { $set: { userId, plan, expiresAt: expiresAt.toISOString(), grantedAt: new Date().toISOString() } },
    { upsert: true }
  );
  return expiresAt;
}

async function isUserPremium(userId)  { return !!(await getPremium(userId)); }
async function isGuildPremium(guild) {
  try { return isUserPremium((await guild.fetchOwner()).id); } catch { return false; }
}

// ─────────────────────────────────────────────
//  Language System
// ─────────────────────────────────────────────
const LANGS = {
  pt: { flag: '🇧🇷', name: 'Português',
    noPermission: `${E.erro} Você precisa ser **Administrador**!`,
    backupSaved:  `${E.sucesso}  Backup Salvo!`,
    noBackup:     `${E.erro} Nenhum backup encontrado!` },
  en: { flag: '🇺🇸', name: 'English',
    noPermission: `${E.erro} You need to be an **Administrator**!`,
    backupSaved:  `${E.sucesso}  Backup Saved!`,
    noBackup:     `${E.erro} No backup found!` },
  es: { flag: '🇪🇸', name: 'Español',
    noPermission: `${E.erro} ¡Necesitas ser **Administrador**!`,
    backupSaved:  `${E.sucesso}  ¡Copia guardada!`,
    noBackup:     `${E.erro} ¡No se encontró copia de seguridad!` },
};

const langCache = new Map();
async function getLang(guildId) {
  if (langCache.has(guildId)) return langCache.get(guildId);
  const doc  = await col('settings').findOne({ guildId }).catch(() => null);
  const lang = LANGS[doc?.lang] || LANGS.pt;
  langCache.set(guildId, lang);
  return lang;
}

// ─────────────────────────────────────────────
//  Auto-Backup Premium (every 30min)
// ─────────────────────────────────────────────
async function runAutoBackups() {
  try {
    const docs = await col('premium').find({}).toArray();
    for (const doc of docs) {
      if (new Date(doc.expiresAt) < new Date()) continue;
      for (const [, guild] of client.guilds.cache) {
        try {
          const owner = await guild.fetchOwner().catch(() => null);
          if (!owner || owner.id !== doc.userId) continue;
          await saveBackup(guild.id, guild.name, await captureStructure(guild));
          console.log(`[AUTO-BACKUP] ${guild.name}`);
        } catch (e) { console.error('[AUTO-BACKUP]', e.message); }
      }
    }
  } catch (e) { console.error('[AUTO-BACKUP]', e.message); }
}

// ─────────────────────────────────────────────
//  Discord Client
// ─────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration],
});

// ─────────────────────────────────────────────
//  Anti-Nuke Tracker
// ─────────────────────────────────────────────
const nukeTracker = new Map();

function trackNuke(guildId, userId) {
  if (!nukeTracker.has(guildId)) nukeTracker.set(guildId, new Map());
  const gMap = nukeTracker.get(guildId);
  if (!gMap.has(userId)) gMap.set(userId, { count: 0, reset: Date.now() });
  const u = gMap.get(userId);
  if (Date.now() - u.reset > 10000) { u.count = 0; u.reset = Date.now(); }
  return ++u.count;
}

// ─────────────────────────────────────────────
//  Generate Structure (AI)
// ─────────────────────────────────────────────
async function generateStructure(prompt, onLog, isPremium) {
  prompt = prompt.replace(/["``]/g, "'");

  await onLog(E.loading, 'ANÁLISE', `Interpretando prompt${isPremium ? ' (Premium ✨)' : ''}...`);

  // Etapa 1 — Cargos
  await onLog(E.cargos, 'CARGOS', 'Gerando hierarquia de cargos...');
  const minRoles = isPremium ? 15 : 8;
  const maxRoles = isPremium ? 25 : 14;

  const roles = await mistral([
    { role: 'system', content: `You are an expert Discord server architect. Return ONLY a valid JSON array of roles. Names in Portuguese. Generate ${minRoles}-${maxRoles} roles with unique hex colors. Include: owner/admin, staff, member levels, bot, muted. Permissions from: ADMINISTRATOR, MANAGE_GUILD, MANAGE_CHANNELS, MANAGE_ROLES, KICK_MEMBERS, BAN_MEMBERS, SEND_MESSAGES, VIEW_CHANNEL, MANAGE_MESSAGES.` },
    { role: 'user',   content: `Server: "${prompt}"\n\nReturn JSON array:\n[{"name":"👑 Dono","color":"#f1c40f","hoist":true,"mentionable":false,"permissions":["ADMINISTRATOR"]}]\nGenerate ALL roles. Return only JSON.` },
  ]);

  if (!Array.isArray(roles) || roles.length === 0)
    throw new Error('A IA não retornou cargos válidos. Tente com um prompt diferente.');

  await onLog(E.sucesso, 'CARGOS', `${roles.length} cargo(s) gerado(s)`);
  const roleNames = roles.map(r => r.name).join(', ');

  // Etapa 2 — Categorias & Canais
  await onLog(E.canais, 'ESTRUTURA', 'Projetando categorias e canais...');
  const minCats     = isPremium ? 7 : 5;
  const minChannels = isPremium ? 5 : 3;

  const categories = await mistral([
    { role: 'system', content: `You are a Discord architect. Return ONLY a valid JSON array of categories. Names in Portuguese. Min ${minCats} categories, each with ${minChannels}+ channels (text/voice/forum/announcement/stage). Channel names: EMOJI・name. Category names: EMOJI ◆ NAME. allowedRoles must reference real role names. Never use empty allowedRoles.` },
    { role: 'user',   content: `Server: "${prompt}"\nRoles: ${roleNames}\n\nReturn JSON:\n[{"name":"🏛️ ◆ INFORMAÇÕES","allowedRoles":["👑 Dono"],"channels":[{"name":"📢・anuncios","type":"announcement","topic":"Novidades","allowedRoles":["👑 Dono"]}]}]\nReturn only JSON.` },
  ]);

  if (!Array.isArray(categories) || categories.length === 0)
    throw new Error('A IA não retornou categorias válidas. Tente com um prompt diferente.');

  const totalChannels = categories.reduce((a, c) => a + (c.channels?.length || 0), 0);
  await onLog(E.sucesso, 'ESTRUTURA', `${categories.length} categoria(s) · ${totalChannels} canal(is)`);

  // Etapa 3 — Boas-vindas (não crítico)
  let welcomeMessage = '';
  try {
    await onLog(E.loading, 'BOAS-VINDAS', 'Redigindo mensagem...');
    welcomeMessage = await mistral([
      { role: 'system', content: 'Write a short friendly Discord welcome in Brazilian Portuguese. Plain text only, 3-4 lines.' },
      { role: 'user',   content: `Server: "${prompt}"` },
    ], 300, true);
    await onLog(E.sucesso, 'BOAS-VINDAS', 'Mensagem gerada!');
  } catch {
    await onLog(E.aguardando, 'BOAS-VINDAS', 'Ignorada (não crítico)');
  }

  await onLog(E.sucesso, 'CONCLUÍDO', 'Estrutura pronta — aguardando confirmação');
  return { roles, categories, welcomeMessage };
}

// ─────────────────────────────────────────────
//  Permission Builder
// ─────────────────────────────────────────────
const PERM_MAP = {
  ADMINISTRATOR:   PermissionFlagsBits.Administrator,
  MANAGE_GUILD:    PermissionFlagsBits.ManageGuild,
  MANAGE_CHANNELS: PermissionFlagsBits.ManageChannels,
  MANAGE_ROLES:    PermissionFlagsBits.ManageRoles,
  KICK_MEMBERS:    PermissionFlagsBits.KickMembers,
  BAN_MEMBERS:     PermissionFlagsBits.BanMembers,
  SEND_MESSAGES:   PermissionFlagsBits.SendMessages,
  VIEW_CHANNEL:    PermissionFlagsBits.ViewChannel,
  MANAGE_MESSAGES: PermissionFlagsBits.ManageMessages,
};

function buildPerms(arr = []) {
  return arr.reduce((acc, p) => PERM_MAP[p] ? acc | PERM_MAP[p] : acc, 0n);
}

// ─────────────────────────────────────────────
//  Capture Structure (Backup)
// ─────────────────────────────────────────────
async function captureStructure(guild) {
  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone' && !r.managed)
    .sort((a, b) => a.position - b.position)
    .map(r => ({ name: r.name, color: r.hexColor, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.toArray(), position: r.position }));

  const channels   = await guild.channels.fetch();
  const categories = [];

  for (const [, cat] of channels) {
    if (cat.type !== ChannelType.GuildCategory) continue;
    const children = [];
    for (const [, ch] of channels) {
      if (ch.parentId !== cat.id) continue;
      const type = ch.type === ChannelType.GuildVoice       ? 'voice'
        : ch.type === ChannelType.GuildAnnouncement         ? 'announcement'
        : ch.type === ChannelType.GuildForum                ? 'forum'
        : ch.type === ChannelType.GuildStageVoice           ? 'stage' : 'text';
      children.push({ name: ch.name, type, topic: ch.topic || '', nsfw: ch.nsfw || false, rateLimitPerUser: ch.rateLimitPerUser || 0, position: ch.position });
    }
    children.sort((a, b) => a.position - b.position);
    categories.push({ name: cat.name, position: cat.position, channels: children });
  }
  categories.sort((a, b) => a.position - b.position);

  return { roles, categories, everyonePerms: guild.roles.everyone.permissions.toArray() };
}

// ─────────────────────────────────────────────
//  Apply Structure
// ─────────────────────────────────────────────
const CH_TYPE_MAP = {
  voice:        ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  forum:        ChannelType.GuildForum,
  stage:        ChannelType.GuildStageVoice,
  text:         ChannelType.GuildText,
};

async function applyStructure(guild, structure, onStep) {
  if (!structure.roles?.length && !structure.categories?.length)
    throw new Error('Estrutura inválida: sem cargos nem categorias.');

  // 1. Remover canais
  await onStep(E.canais, 'Removendo canais...');
  for (const [, ch] of await guild.channels.fetch())
    await ch.delete().catch(() => {});
  await sleep(1000);

  // 2. Remover cargos
  await onStep(E.cargos, 'Removendo cargos...');
  for (const [, r] of await guild.roles.fetch())
    if (!r.managed && r.name !== '@everyone') await r.delete().catch(() => {});
  await sleep(500);

  // 3. Permissões do @everyone
  if (structure.everyonePerms)
    await guild.roles.everyone.setPermissions(structure.everyonePerms).catch(() => {});

  // 4. Criar cargos
  await onStep(E.cargos, 'Criando cargos...');
  const createdRoles = new Map();
  for (const r of [...(structure.roles || [])].sort((a, b) => (a.position || 0) - (b.position || 0))) {
    try {
      const role = await guild.roles.create({
        name:        r.name,
        color:       /^#[0-9A-Fa-f]{6}$/.test(r.color) ? r.color : '#99aab5',
        hoist:       r.hoist       || false,
        mentionable: r.mentionable || false,
        permissions: Array.isArray(r.permissions) ? buildPerms(r.permissions) : (r.permissions || 0n),
      });
      createdRoles.set(r.name, role);
      await onStep(E.sucesso, `Cargo: **${r.name}**`);
      await sleep(250);
    } catch (e) { console.error('[APPLY] Cargo:', r.name, e.message); }
  }

  // Helper: resolve permissionOverwrites por allowedRoles (IA) ou permOverwrites (backup)
  function resolveOverwrites(permOverwrites, allowedRoles) {
    if (allowedRoles?.length) {
      const ows = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
      for (const name of allowedRoles) {
        const role = createdRoles.get(name);
        if (role) ows.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
      }
      return ows;
    }
    return (permOverwrites || []).map(ow => {
      if (ow.type === 0) {
        const role = createdRoles.get(ow.roleName) || guild.roles.cache.get(ow.id) || guild.roles.everyone;
        return role ? { id: role.id, allow: ow.allow, deny: ow.deny } : null;
      }
      return { id: ow.id, allow: ow.allow, deny: ow.deny };
    }).filter(Boolean);
  }

  // 5. Criar categorias e canais
  for (const category of structure.categories || []) {
    try {
      await onStep(E.canais, `Categoria: **${category.name}**`);
      const cat = await guild.channels.create({
        name: category.name.substring(0, 100),
        type: ChannelType.GuildCategory,
        permissionOverwrites: resolveOverwrites(category.permOverwrites, category.allowedRoles),
      }).catch(() => null);
      if (!cat) continue;
      await sleep(400);

      for (const ch of category.channels || []) {
        try {
          const type = CH_TYPE_MAP[ch.type] || ChannelType.GuildText;
          const data = {
            name:                 (ch.name || 'canal').substring(0, 100),
            type, parent: cat.id,
            nsfw:                 ch.nsfw || false,
            rateLimitPerUser:     ch.rateLimitPerUser || 0,
            permissionOverwrites: resolveOverwrites(ch.permOverwrites, ch.allowedRoles),
          };
          if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement)
            data.topic = ch.topic?.substring(0, 1024) || '';
          await guild.channels.create(data).catch(e => console.error('[APPLY] Canal:', ch.name, e.message));
          await onStep(E.canais, `Canal: **${ch.name}**`);
          await sleep(300);
        } catch (e) { console.error('[APPLY] Canal:', ch.name, e.message); }
      }
    } catch (e) { console.error('[APPLY] Categoria:', category.name, e.message); }
  }

  // 6. Mensagem de boas-vindas
  if (structure.welcomeMessage) {
    try {
      const chs   = await guild.channels.fetch();
      const first = chs.find(c => c?.type === ChannelType.GuildText && c.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel));
      if (first) await first.send(structure.welcomeMessage).catch(() => {});
    } catch {}
  }
}

// ─────────────────────────────────────────────
//  Embed Builders
// ─────────────────────────────────────────────
function buildQueueEmbed(prompt, queueName, position, secs, isPremium) {
  const filled = Math.max(0, 10 - Math.min(position - 1, 10));
  const bar    = `\`[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]\``;
  const status = Object.values(queues).map(q => {
    const busy = q.busy ? '⚙️' : '✅';
    const n    = q.queue.filter(e => e.userId !== null).length;
    const mark = q.name === queueName ? ' ◄' : '';
    return `**${q.name}** ${busy} — ${n} aguardando${mark}`;
  }).join('\n');

  return new EmbedBuilder()
    .setTitle(`${E.aguardando}  Na Fila — ${queueName}`)
    .setColor(isPremium ? 0x9b59b6 : 0xf39c12)
    .setDescription(`> ${E.loading} Aguardando sua vez...\n> \`\`\`${prompt.substring(0, 60)}\`\`\``)
    .addFields(
      { name: '🏷️ Fila',              value: isPremium ? `${E.premium} Premium` : '🔵 Normal', inline: true },
      { name: '🔢 Posição',            value: `**#${position}**`,                              inline: true },
      { name: '⏱️ Tempo Estimado',     value: `**${formatETA(secs)}**`,                        inline: true },
      { name: '📊 Progresso',          value: bar,                                             inline: false },
      { name: `${E.servidores} Filas`, value: status,                                          inline: false },
    )
    .setFooter({ text: `Architect ${VERSION} • Atualiza automaticamente` });
}

function buildAnalysisEmbed(prompt, logs) {
  const lines = logs.slice(-8).map((l, i, a) =>
    i === a.length - 1 ? `▶ [${l.tag}] ${l.msg}` : `${E.check} [${l.tag}] ${l.msg}`
  ).join('\n') || `▶ ${E.loading} Iniciando...`;

  const done = logs.at(-1)?.tag === 'CONCLUÍDO';
  return new EmbedBuilder()
    .setTitle(done ? `${E.sucesso}  Análise Concluída` : `${E.loading}  Gerando Servidor...`)
    .setColor(done ? 0x2ecc71 : 0xf39c12)
    .addFields(
      { name: `${E.config} Prompt`,               value: `\`\`\`${prompt.substring(0, 200)}\`\`\`` },
      { name: `${E.servidores} Log em Tempo Real`, value: lines },
    )
    .setFooter({ text: `Architect ${VERSION} • Powered by Mistral AI` })
    .setTimestamp();
}

function buildConfirmEmbed(prompt, structure, secondsLeft) {
  const total  = structure.categories.reduce((a, c) => a + (c.channels?.length || 0), 0);
  const filled = Math.round((secondsLeft / 60) * 20);
  const bar    = `\`[${'█'.repeat(filled)}${'░'.repeat(20 - filled)}] ${secondsLeft}s\``;
  return new EmbedBuilder()
    .setTitle('⚠️  Confirmar Criação')
    .setColor(secondsLeft > 20 ? 0xf39c12 : 0xe74c3c)
    .setDescription('> ⚠️ **Esta ação apagará TUDO e recriará do zero.**')
    .addFields(
      { name: `${E.config} Prompt`,           value: `\`\`\`${prompt.substring(0, 200)}\`\`\`` },
      { name: `${E.cargos} Cargos`,           value: String(structure.roles?.length || 0),      inline: true },
      { name: `${E.canais} Categorias`,       value: String(structure.categories?.length || 0), inline: true },
      { name: `${E.canais} Canais`,           value: String(total),                             inline: true },
      { name: `⏱️ Expira em ${secondsLeft}s`, value: bar },
    )
    .setFooter({ text: `Architect ${VERSION}` })
    .setTimestamp();
}

function buildProgressEmbed(title, info, steps) {
  const log = steps.slice(-8).map((s, i, a) =>
    i === a.length - 1 ? `▶ ${s}` : `${E.check} ${s}`
  ).join('\n') || '▶ Iniciando...';
  return new EmbedBuilder()
    .setTitle(title).setColor(0x9b59b6)
    .addFields(
      { name: `${E.config} Servidor`,      value: info.substring(0, 150) },
      { name: `${E.servidores} Progresso`, value: `\`\`\`\n${log}\n\`\`\`` },
    )
    .setFooter({ text: `Architect ${VERSION}` })
    .setTimestamp();
}

function errorEmbed(msg) {
  return new EmbedBuilder()
    .setTitle(`${E.erro}  Erro`)
    .setColor(0xe74c3c)
    .setDescription(`\`\`\`${String(msg).substring(0, 500)}\`\`\``)
    .setFooter({ text: `Architect ${VERSION}` });
}

function confirmRow(id, label = '✅  Confirmar', style = ButtonStyle.Success) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`create_confirm_${id}`).setLabel(label).setStyle(style),
    new ButtonBuilder().setCustomId(`cancel_confirm_${id}`).setLabel('❌  Cancelar').setStyle(ButtonStyle.Danger),
  );
}

// ─────────────────────────────────────────────
//  Pending State
// ─────────────────────────────────────────────
const pendingCreate  = new Map();
const pendingRestore = new Map();

function startCountdown(interaction, confirmId, prompt, structure) {
  let secs = 60;
  const iv = setInterval(async () => {
    secs--;
    if (secs <= 0 || !pendingCreate.has(confirmId)) {
      clearInterval(iv);
      if (pendingCreate.has(confirmId)) {
        pendingCreate.delete(confirmId);
        const expired = new EmbedBuilder()
          .setTitle('⏰  Tempo Esgotado')
          .setColor(0xe74c3c)
          .setDescription('A confirmação expirou. Use o comando novamente.')
          .setFooter({ text: `Architect ${VERSION}` });
        await interaction.editReply({ embeds: [expired], components: [] }).catch(async () => {
          await interaction.user.send({ embeds: [expired] }).catch(() => {});
        });
      }
      return;
    }
    await interaction.editReply({
      embeds:     [buildConfirmEmbed(prompt, structure, secs)],
      components: [confirmRow(confirmId)],
    }).catch(() => {});
  }, 1000);
}

// Helper unificado para /criar_servidor e /template
async function handleGenerate(interaction, prompt, isPremium) {
  await interaction.deferReply();

  const q          = getQueue(isPremium);
  const posInQueue = q.queue.length + (q.busy ? 1 : 0);
  const secsAhead  = (q.busy ? SECS_PER_GEN : 0) + posInQueue * SECS_PER_GEN;
  const userId     = interaction.user.id;

  await interaction.editReply({
    embeds: [posInQueue > 0
      ? buildQueueEmbed(prompt, q.name, posInQueue + 1, secsAhead, isPremium)
      : buildAnalysisEmbed(prompt, [])],
  });

  const logs  = [];
  let started = false;

  const onLog = async (icon, tag, msg) => {
    logs.push({ icon, tag, msg });
    console.log(`[${tag}] ${msg}`);
    if (started)
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, logs)] }).catch(() => {});
  };

  // ETA ticker enquanto espera
  let ticker = null;
  if (posInQueue > 0) {
    let elapsed = 0;
    ticker = setInterval(async () => {
      if (started) { clearInterval(ticker); ticker = null; return; }
      elapsed++;
      const status = getQueueStatus(userId);
      if (!status) { clearInterval(ticker); ticker = null; return; }
      await interaction.editReply({
        embeds: [buildQueueEmbed(prompt, status.label, status.position, Math.max(0, status.secs - elapsed), isPremium)],
      }).catch(() => {});
    }, 1000);
  }

  try {
    const structure = await enqueue(
      async () => {
        started = true;
        if (ticker) { clearInterval(ticker); ticker = null; }
        await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, logs)] }).catch(() => {});
        return generateStructure(prompt, onLog, isPremium);
      },
      interaction, prompt, userId, isPremium
    );

    if (ticker) { clearInterval(ticker); ticker = null; }

    const confirmId = interaction.id;
    pendingCreate.set(confirmId, { prompt, structure });
    await interaction.editReply({
      embeds:     [buildConfirmEmbed(prompt, structure, 60)],
      components: [confirmRow(confirmId)],
    });
    startCountdown(interaction, confirmId, prompt, structure);

  } catch (e) {
    if (ticker) { clearInterval(ticker); ticker = null; }
    await interaction.editReply({ embeds: [errorEmbed(e.message)] }).catch(() => {});
  }
}

// ─────────────────────────────────────────────
//  Ready Event
// ─────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`✅ Architect ${VERSION} online como ${client.user.tag}`);

  const statuses = [
    { name: 'Building your server...',   type: ActivityType.Watching },
    { name: 'Protecting your community', type: ActivityType.Watching },
    { name: 'Restoring after nukes',     type: ActivityType.Watching },
  ];
  let si = 0;
  const tick = () => {
    client.user.setPresence({ status: 'online', activities: [statuses[si]] });
    si = (si + 1) % statuses.length;
  };
  tick();
  setInterval(tick, 10000);

  const commands = [
    new SlashCommandBuilder().setName('criar_servidor').setDescription('Cria servidor completo com IA')
      .addStringOption(o => o.setName('prompt').setDescription('Descreva o servidor').setRequired(true)),
    new SlashCommandBuilder().setName('template').setDescription('Aplica template pronto')
      .addStringOption(o => o.setName('tipo').setDescription('Tipo').setRequired(true)
        .addChoices(
          { name: '🌐 Comunidade', value: 'comunidade' }, { name: '🎮 Gaming',      value: 'gaming'      },
          { name: '🪖 Militar',    value: 'militar'    }, { name: '🛒 Loja',        value: 'loja'        },
          { name: '🎌 Anime',      value: 'anime'      }, { name: '📚 Educacional', value: 'educacional' },
        )),
    new SlashCommandBuilder().setName('backup').setDescription('Salva estrutura do servidor'),
    new SlashCommandBuilder().setName('restaurar').setDescription('Restaura servidor do backup'),
    new SlashCommandBuilder().setName('proteger').setDescription('Ativa/desativa anti-nuke')
      .addBooleanOption(o => o.setName('ativo').setDescription('Ativar ou desativar').setRequired(true)),
    new SlashCommandBuilder().setName('deletar').setDescription('Deleta canais, cargos ou tudo')
      .addStringOption(o => o.setName('tipo').setDescription('O que deletar').setRequired(true)
        .addChoices({ name: '🎭 Cargos', value: 'cargos' }, { name: '💬 Canais', value: 'canais' }, { name: '🗑️ Tudo', value: 'tudo' }))
      .addStringOption(o => o.setName('alvo').setDescription('Quais ou "everyone"').setRequired(false))
      .addBooleanOption(o => o.setName('tudo').setDescription('Deletar tudo?').setRequired(false)),
    new SlashCommandBuilder().setName('status').setDescription('Informações do servidor'),
    new SlashCommandBuilder().setName('cargo_criar').setDescription('Cria um cargo')
      .addStringOption(o => o.setName('nome').setDescription('Nome').setRequired(true))
      .addStringOption(o => o.setName('cor').setDescription('Cor hex').setRequired(false))
      .addBooleanOption(o => o.setName('admin').setDescription('Admin?').setRequired(false)),
    new SlashCommandBuilder().setName('canal_criar').setDescription('Cria um canal')
      .addStringOption(o => o.setName('nome').setDescription('Nome').setRequired(true))
      .addStringOption(o => o.setName('tipo').setDescription('Tipo').setRequired(false)
        .addChoices({ name: '💬 Texto', value: 'text' }, { name: '🔊 Voz', value: 'voice' }, { name: '📋 Fórum', value: 'forum' }, { name: '📢 Announcement', value: 'announcement' }, { name: '🎙️ Palco', value: 'stage' }))
      .addStringOption(o => o.setName('topico').setDescription('Tópico').setRequired(false)),
    new SlashCommandBuilder().setName('ban').setDescription('Bane um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false))
      .addIntegerOption(o => o.setName('dias').setDescription('Dias (0-7)').setMinValue(0).setMaxValue(7).setRequired(false)),
    new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('mute').setDescription('Muta um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
      .addIntegerOption(o => o.setName('duracao').setDescription('Duração em minutos').setRequired(true).setMinValue(1).setMaxValue(10080))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('unmute').setDescription('Desmuta um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)),
    new SlashCommandBuilder().setName('warn').setDescription('Adverte um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)),
    new SlashCommandBuilder().setName('lock').setDescription('Tranca um canal')
      .addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(false))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('unlock').setDescription('Destranca um canal')
      .addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(false)),
    new SlashCommandBuilder().setName('slowmode').setDescription('Modo lento')
      .addIntegerOption(o => o.setName('segundos').setDescription('Segundos (0 = desativar)').setRequired(true).setMinValue(0).setMaxValue(21600))
      .addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(false)),
    new SlashCommandBuilder().setName('clear').setDescription('Apaga mensagens')
      .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (máx: 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('embed').setDescription('Cria embed personalizado')
      .addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true))
      .addStringOption(o => o.setName('descricao').setDescription('Descrição').setRequired(true))
      .addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(false))
      .addStringOption(o => o.setName('cor').setDescription('Cor hex').setRequired(false))
      .addStringOption(o => o.setName('imagem').setDescription('URL da imagem').setRequired(false))
      .addStringOption(o => o.setName('rodape').setDescription('Rodapé').setRequired(false)),
    new SlashCommandBuilder().setName('anuncio').setDescription('Envia anúncio')
      .addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true))
      .addStringOption(o => o.setName('mensagem').setDescription('Mensagem').setRequired(true))
      .addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(true))
      .addBooleanOption(o => o.setName('marcar_everyone').setDescription('Marcar @everyone?').setRequired(false)),
    new SlashCommandBuilder().setName('idioma').setDescription('Altera o idioma do bot')
      .addStringOption(o => o.setName('lang').setDescription('Idioma').setRequired(true)
        .addChoices({ name: '🇧🇷 Português', value: 'pt' }, { name: '🇺🇸 English', value: 'en' }, { name: '🇪🇸 Español', value: 'es' })),
    new SlashCommandBuilder().setName('doar').setDescription('Apoie o desenvolvimento do Architect'),
    new SlashCommandBuilder().setName('dm').setDescription('Mensagem oficial para todos os donos')
      .addStringOption(o => o.setName('mensagem').setDescription('Mensagem').setRequired(true)),
    new SlashCommandBuilder().setName('premium').setDescription('Gerenciar Premium')
      .addUserOption(o => o.setName('usuario').setDescription('Usuário').setRequired(true))
      .addStringOption(o => o.setName('plano').setDescription('Plano').setRequired(true)
        .addChoices(
          { name: '⚡ Semanal (7 dias)', value: 'semanal' }, { name: '💎 Mensal (30 dias)', value: 'mensal' },
          { name: '👑 Anual (365 dias)', value: 'anual'   }, { name: '❌ Remover',           value: 'remover' },
        )),
    new SlashCommandBuilder().setName('info').setDescription('Informações do bot'),
    new SlashCommandBuilder().setName('help').setDescription('Lista de comandos'),
  ].map(c => c.toJSON());

  try {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log(`✅ ${commands.length} comandos registrados!`);
  } catch (e) { console.error('❌ Erro ao registrar comandos:', e.message); }
});

// ─────────────────────────────────────────────
//  Guild Welcome
// ─────────────────────────────────────────────
client.on('guildCreate', async guild => {
  try {
    const owner = await guild.fetchOwner();
    await owner.send({ embeds: [new EmbedBuilder()
      .setTitle(`${E.servidores}  Olá! Obrigado por adicionar o Architect!`)
      .setColor(0x9b59b6)
      .setThumbnail(client.user.displayAvatarURL())
      .setDescription(`Opa, **${owner.user.username}**! Seja bem-vindo ao Architect!`)
      .addFields(
        { name: `${E.config} Comandos`, value: 'Use **/help** para ver todos os comandos' },
        { name: `${E.backup} Backup`,   value: 'Use **/backup** para salvar a estrutura'  },
        { name: `${E.lock} Proteção`,   value: 'Use **/proteger ativo:true** para ativar o anti-nuke' },
      )
      .setFooter({ text: `Architect ${VERSION} • Create. Protect. Restore.` })
      .setTimestamp()] }).catch(() => {});
  } catch (e) { console.error('[GUILD CREATE]', e.message); }
});

// ─────────────────────────────────────────────
//  Interaction Handler
// ─────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

  // ── Botões ────────────────────────────────────
  if (interaction.isButton()) {
    const parts  = interaction.customId.split('_confirm_');
    const action = parts[0];
    const id     = parts[1];

    // Confirmar criação
    if (action === 'create' && pendingCreate.has(id)) {
      const { prompt, structure } = pendingCreate.get(id);
      pendingCreate.delete(id);
      const steps = [];
      await interaction.update({
        embeds: [buildProgressEmbed(`${E.servidores}  Construindo Servidor...`, prompt, steps)],
        components: [],
      }).catch(() => {});
      const onStep = async (icon, msg) => {
        steps.push(`${icon} ${msg}`);
        await interaction.editReply({ embeds: [buildProgressEmbed(`${E.servidores}  Construindo Servidor...`, prompt, steps)] }).catch(() => {});
      };
      try {
        await applyStructure(interaction.guild, structure, onStep);
        const total = structure.categories?.reduce((a, c) => a + (c.channels?.length || 0), 0) || 0;
        const done  = new EmbedBuilder()
          .setTitle(`${E.sucesso}  Servidor Criado!`).setColor(0x2ecc71)
          .setDescription('Servidor recriado com sucesso!')
          .addFields(
            { name: `${E.cargos} Cargos`,     value: String(structure.roles?.length || 0),      inline: true },
            { name: `${E.canais} Categorias`, value: String(structure.categories?.length || 0), inline: true },
            { name: `${E.canais} Canais`,     value: String(total),                             inline: true },
          )
          .setFooter({ text: `Architect ${VERSION}` }).setTimestamp();
        await interaction.editReply({ embeds: [done], components: [] }).catch(async () => {
          await interaction.user.send({ embeds: [done] }).catch(() => {});
        });
      } catch (e) {
        const err = errorEmbed(e.message);
        await interaction.editReply({ embeds: [err], components: [] }).catch(async () => {
          await interaction.user.send({ embeds: [err] }).catch(() => {});
        });
      }
      return;
    }

    // Confirmar restauração
    if (action === 'restore' && pendingRestore.has(id)) {
      const { backup } = pendingRestore.get(id);
      pendingRestore.delete(id);
      const steps = [];
      const label = new Date(backup.savedAt).toLocaleString('pt-BR');
      await interaction.update({
        embeds: [buildProgressEmbed(`${E.backup}  Restaurando Servidor...`, `Backup de ${label}`, steps)],
        components: [],
      }).catch(() => {});
      const onStep = async (icon, msg) => {
        steps.push(`${icon} ${msg}`);
        await interaction.editReply({ embeds: [buildProgressEmbed(`${E.backup}  Restaurando...`, `Backup de ${label}`, steps)] }).catch(() => {});
      };
      try {
        await applyStructure(interaction.guild, backup.structure, onStep);
        await onStep(E.sucesso, 'Servidor restaurado com sucesso!');
      } catch (e) {
        await interaction.editReply({ embeds: [errorEmbed(e.message)], components: [] }).catch(() => {});
      }
      return;
    }

    // Confirmar deleção
    if (action === 'delete' && pendingCreate.has(`del_${id}`)) {
      const { acao, alvo } = pendingCreate.get(`del_${id}`);
      pendingCreate.delete(`del_${id}`);
      await interaction.update({
        embeds: [new EmbedBuilder().setTitle(`${E.loading}  Deletando...`).setColor(0xe74c3c).setDescription('Processando...').setFooter({ text: `Architect ${VERSION}` })],
        components: [],
      });
      try {
        let count = 0;
        if (acao === 'delete_all') {
          for (const [, ch] of await interaction.guild.channels.fetch()) { await ch.delete().catch(() => {}); count++; }
          for (const [, r]  of await interaction.guild.roles.fetch())    { if (!r.managed && r.name !== '@everyone') { await r.delete().catch(() => {}); count++; } }
        } else if (acao === 'delete_channels_all') {
          for (const [, ch] of await interaction.guild.channels.fetch()) { await ch.delete().catch(() => {}); count++; }
        } else if (acao === 'delete_roles_all') {
          for (const [, r] of await interaction.guild.roles.fetch()) { if (!r.managed && r.name !== '@everyone') { await r.delete().catch(() => {}); count++; } }
        } else if (acao === 'delete_channels_specific') {
          for (const name of alvo.split(/[\s,]+/).filter(Boolean)) {
            const ch = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === name.toLowerCase());
            if (ch) { await ch.delete().catch(() => {}); count++; }
          }
        } else if (acao === 'delete_roles_specific') {
          for (const name of alvo.split(/[\s,]+/).filter(Boolean)) {
            const r = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
            if (r && !r.managed && r.name !== '@everyone') { await r.delete().catch(() => {}); count++; }
          }
        }
        await interaction.editReply({ embeds: [new EmbedBuilder()
          .setTitle(`${E.sucesso}  Deleção Concluída`).setColor(0x2ecc71)
          .setDescription(`**${count}** item(s) deletado(s)!`)
          .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [] });
      } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)], components: [] }); }
      return;
    }

    // Cancelar
    if (action === 'cancel') {
      pendingCreate.delete(id);
      pendingRestore.delete(id);
      await interaction.update({ embeds: [new EmbedBuilder()
        .setTitle('❌  Cancelado').setColor(0x95a5a6)
        .setDescription('Operação cancelada.')
        .setFooter({ text: `Architect ${VERSION}` })], components: [] });
      return;
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, member } = interaction;
  const lang       = await getLang(guild.id);
  const publicCmds = ['info', 'help', 'status', 'doar', 'idioma'];
  const isAdmin    = member.permissions.has(PermissionFlagsBits.Administrator);

  if (!publicCmds.includes(commandName) && !isAdmin)
    return interaction.reply({ content: lang.noPermission, ephemeral: true });

  // ── /criar_servidor ──────────────────────────
  if (commandName === 'criar_servidor') {
    return handleGenerate(interaction, interaction.options.getString('prompt'), await isGuildPremium(guild));
  }

  // ── /template ────────────────────────────────
  else if (commandName === 'template') {
    const TEMPLATES = {
      comunidade:  'Comunidade brasileira com informações, geral, eventos, suporte e voz',
      gaming:      'Servidor gamer com jogos, torneios, clips, suporte e voz',
      militar:     'Servidor militar com hierarquia, missões, treinamentos e voz',
      loja:        'Loja online com produtos, pedidos, promoções e suporte',
      anime:       'Servidor de anime com discussões, recomendações e fan arts',
      educacional: 'Servidor educacional com matérias, dúvidas e eventos',
    };
    return handleGenerate(interaction, TEMPLATES[interaction.options.getString('tipo')], await isGuildPremium(guild));
  }

  // ── /backup ──────────────────────────────────
  else if (commandName === 'backup') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const structure = await captureStructure(guild);
      await saveBackup(guild.id, guild.name, structure);
      const total = structure.categories.reduce((a, c) => a + c.channels.length, 0);
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setTitle(lang.backupSaved).setColor(0x2ecc71)
        .setDescription(`Estrutura de **${guild.name}** salva!`)
        .addFields(
          { name: `${E.cargos} Cargos`,     value: String(structure.roles.length),      inline: true },
          { name: `${E.canais} Categorias`, value: String(structure.categories.length), inline: true },
          { name: `${E.canais} Canais`,     value: String(total),                       inline: true },
          { name: `${E.data} Salvo em`,     value: new Date().toLocaleString('pt-BR'),  inline: false },
        )
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }); }
  }

  // ── /restaurar ───────────────────────────────
  else if (commandName === 'restaurar') {
    const backup = await getBackup(guild.id);
    if (!backup) return interaction.reply({ content: lang.noBackup, ephemeral: true });
    const id = interaction.id;
    pendingRestore.set(id, { backup });
    setTimeout(() => pendingRestore.delete(id), 60000);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`restore_confirm_${id}`).setLabel('🔄  Restaurar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`cancel_confirm_${id}`).setLabel('❌  Cancelar').setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.backup}  Restaurar Backup`).setColor(0x3498db)
      .setDescription('> ⚠️ **Isso irá apagar TUDO e restaurar o backup.**')
      .addFields({ name: `${E.data} Backup de`, value: new Date(backup.savedAt).toLocaleString('pt-BR') })
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [row] });
  }

  // ── /proteger ────────────────────────────────
  else if (commandName === 'proteger') {
    const ativo  = interaction.options.getBoolean('ativo');
    const backup = await getBackup(guild.id);
    if (ativo && !backup) return interaction.reply({ content: `${E.erro} Faça um **/backup** primeiro!`, ephemeral: true });
    if (backup) await setProtection(guild.id, ativo);
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(ativo ? `${E.lock}  Proteção Ativada!` : `${E.unlock}  Proteção Desativada`)
      .setColor(ativo ? 0x2ecc71 : 0xe74c3c)
      .setDescription(ativo ? `${E.sucesso} Anti-nuke ativo.` : `${E.erro} Proteção desativada.`)
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  // ── /deletar ─────────────────────────────────
  else if (commandName === 'deletar') {
    const tipo = interaction.options.getString('tipo');
    const alvo = interaction.options.getString('alvo') || '';
    const tudo = interaction.options.getBoolean('tudo') || false;
    let descricao = '', acao = '';

    if (tipo === 'cargos') {
      acao = (tudo || alvo.toLowerCase() === 'everyone') ? 'delete_roles_all'    : 'delete_roles_specific';
      descricao = acao === 'delete_roles_all' ? '🗑️ Todos os cargos serão deletados.' : `🗑️ Cargos: ${alvo}`;
    } else if (tipo === 'canais') {
      acao = (tudo || alvo.toLowerCase() === 'everyone') ? 'delete_channels_all' : 'delete_channels_specific';
      descricao = acao === 'delete_channels_all' ? '🗑️ Todos os canais serão deletados.' : `🗑️ Canais: ${alvo}`;
    } else {
      acao = 'delete_all'; descricao = '🗑️ TUDO será deletado.';
    }

    const id = interaction.id;
    pendingCreate.set(`del_${id}`, { tipo, alvo, tudo, acao });
    setTimeout(() => pendingCreate.delete(`del_${id}`), 60000);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`delete_confirm_${id}`).setLabel('🗑️  Deletar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cancel_confirm_${id}`).setLabel('❌  Cancelar').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('⚠️  Confirmar Deleção').setColor(0xe74c3c)
      .setDescription(`> ⚠️ **Esta ação é irreversível!**\n\n${descricao}`)
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [row] });
  }

  // ── /cargo_criar ─────────────────────────────
  else if (commandName === 'cargo_criar') {
    const nome = interaction.options.getString('nome');
    const cor  = interaction.options.getString('cor') || '#99aab5';
    const adm  = interaction.options.getBoolean('admin') || false;
    try {
      const role = await guild.roles.create({ name: nome, color: cor, permissions: adm ? [PermissionFlagsBits.Administrator] : [] });
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.sucesso}  Cargo Criado!`).setColor(role.color)
        .addFields({ name: `${E.cargos} Nome`, value: role.name, inline: true }, { name: '🎨 Cor', value: cor, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /canal_criar ─────────────────────────────
  else if (commandName === 'canal_criar') {
    const nome   = interaction.options.getString('nome');
    const tipo   = interaction.options.getString('tipo') || 'text';
    const topico = interaction.options.getString('topico') || '';
    const tmap   = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice };
    try {
      const data = { name: nome, type: tmap[tipo] || ChannelType.GuildText };
      if (topico) data.topic = topico;
      const ch = await guild.channels.create(data);
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.sucesso}  Canal Criado!`).setColor(0x2ecc71)
        .addFields({ name: `${E.canais} Nome`, value: ch.name, inline: true }, { name: '📂 Tipo', value: tipo, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /status ──────────────────────────────────
  else if (commandName === 'status') {
    const backup   = await getBackup(guild.id);
    const channels = await guild.channels.fetch();
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.servidores}  Status — ${guild.name}`).setColor(0x3498db).setThumbnail(guild.iconURL())
      .addFields(
        { name: `${E.membros} Membros`, value: String(guild.memberCount),                                                       inline: true },
        { name: `${E.cargos} Cargos`,  value: String(guild.roles.cache.filter(r => r.name !== '@everyone').size),              inline: true },
        { name: `${E.canais} Texto`,   value: String(channels.filter(c => c.type === ChannelType.GuildText).size),             inline: true },
        { name: `${E.lock} Proteção`,  value: backup?.protection ? `${E.sucesso} Ativa` : `${E.erro} Inativa`,                inline: true },
        { name: `${E.backup} Backup`,  value: backup ? new Date(backup.savedAt).toLocaleString('pt-BR') : `${E.erro} Nenhum`, inline: true },
      )
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  // ── /ban ─────────────────────────────────────
  else if (commandName === 'ban') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    const dias   = interaction.options.getInteger('dias') || 0;
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target?.bannable) return interaction.reply({ content: `${E.erro} Não consigo banir este membro!`, ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle(`${E.banido}  Você foi banido!`).setColor(0xe74c3c)
        .setDescription(`Você foi banido de **${guild.name}**\n**Motivo:** ${motivo}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      await target.ban({ reason: motivo, deleteMessageDays: dias });
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${E.banido}  Membro Banido!`).setColor(0xe74c3c)
        .addFields({ name: `${E.membros} Membro`, value: target.user.tag, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }, { name: '🗑️ Msgs', value: `${dias}d`, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /kick ────────────────────────────────────
  else if (commandName === 'kick') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target?.kickable) return interaction.reply({ content: `${E.erro} Não consigo expulsar este membro!`, ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle(`${E.membros}  Você foi expulso!`).setColor(0xe67e22)
        .setDescription(`Você foi expulso de **${guild.name}**\n**Motivo:** ${motivo}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      await target.kick(motivo);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${E.membros}  Membro Expulso!`).setColor(0xe67e22)
        .addFields({ name: `${E.membros} Membro`, value: target.user.tag, inline: true }, { name: '📋 Motivo', value: motivo, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /mute ────────────────────────────────────
  else if (commandName === 'mute') {
    const target  = interaction.options.getMember('membro');
    const duracao = interaction.options.getInteger('duracao');
    const motivo  = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, ephemeral: true });
    try {
      await target.timeout(duracao * 60000, motivo);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${E.mutado}  Membro Mutado!`).setColor(0xf39c12)
        .addFields({ name: `${E.membros} Membro`, value: target.user.tag, inline: true }, { name: '⏱️ Duração', value: `${duracao}min`, inline: true }, { name: '📋 Motivo', value: motivo, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /unmute ──────────────────────────────────
  else if (commandName === 'unmute') {
    const target = interaction.options.getMember('membro');
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, ephemeral: true });
    try {
      await target.timeout(null);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${E.unlock}  Membro Desmutado!`).setColor(0x2ecc71)
        .addFields({ name: `${E.membros} Membro`, value: target.user.tag, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /warn ────────────────────────────────────
  else if (commandName === 'warn') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo');
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle('⚠️  Advertência Recebida').setColor(0xf39c12)
        .setDescription(`**Servidor:** ${guild.name}\n**Motivo:** ${motivo}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️  Advertência Enviada!').setColor(0xf39c12)
        .addFields({ name: `${E.membros} Membro`, value: target.user.tag, inline: true }, { name: '📋 Motivo', value: motivo, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /lock ────────────────────────────────────
  else if (commandName === 'lock') {
    const canal  = interaction.options.getChannel('canal') || interaction.channel;
    const motivo = interaction.options.getString('motivo') || 'Canal trancado';
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${E.lock}  Canal Trancado!`).setColor(0xe74c3c)
        .addFields({ name: `${E.canais} Canal`, value: `<#${canal.id}>`, inline: true }, { name: '📋 Motivo', value: motivo, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /unlock ──────────────────────────────────
  else if (commandName === 'unlock') {
    const canal = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${E.unlock}  Canal Destrancado!`).setColor(0x2ecc71)
        .addFields({ name: `${E.canais} Canal`, value: `<#${canal.id}>`, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /slowmode ────────────────────────────────
  else if (commandName === 'slowmode') {
    const secs  = interaction.options.getInteger('segundos');
    const canal = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await canal.setRateLimitPerUser(secs);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${E.config}  Slowmode Configurado!`).setColor(0x3498db)
        .addFields({ name: `${E.canais} Canal`, value: `<#${canal.id}>`, inline: true }, { name: '⏱️ Intervalo', value: secs === 0 ? 'Desativado' : `${secs}s`, inline: true })
        .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /clear ───────────────────────────────────
  else if (commandName === 'clear') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await interaction.deferReply({ ephemeral: true });
      const msgs = await interaction.channel.bulkDelete(Math.min(interaction.options.getInteger('quantidade'), 100), true);
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`${E.sucesso}  Mensagens Deletadas!`).setColor(0x2ecc71)
        .setDescription(`**${msgs.size}** mensagem(s) deletada(s)!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }); }
  }

  // ── /embed ───────────────────────────────────
  else if (commandName === 'embed') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    const titulo = interaction.options.getString('titulo');
    const desc   = interaction.options.getString('descricao');
    const cor    = interaction.options.getString('cor') || '#9b59b6';
    const canal  = interaction.options.getChannel('canal') || interaction.channel;
    const imagem = interaction.options.getString('imagem') || null;
    const rodape = interaction.options.getString('rodape') || null;
    try {
      const emb = new EmbedBuilder().setTitle(titulo).setDescription(desc).setColor(cor).setTimestamp();
      if (imagem) emb.setImage(imagem);
      if (rodape) emb.setFooter({ text: rodape });
      await canal.send({ embeds: [emb] });
      await interaction.reply({ content: `${E.sucesso} Embed enviado em <#${canal.id}>!`, ephemeral: true });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /anuncio ─────────────────────────────────
  else if (commandName === 'anuncio') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    const canal  = interaction.options.getChannel('canal');
    const marcar = interaction.options.getBoolean('marcar_everyone') || false;
    try {
      await canal.send({ content: marcar ? '@everyone' : null, embeds: [new EmbedBuilder()
        .setTitle(`📢  ${interaction.options.getString('titulo')}`)
        .setDescription(interaction.options.getString('mensagem'))
        .setColor(0x9b59b6)
        .setFooter({ text: `Anúncio por ${member.user.tag} • Architect ${VERSION}` }).setTimestamp()] });
      await interaction.reply({ content: `${E.sucesso} Anúncio enviado em <#${canal.id}>!`, ephemeral: true });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /idioma ──────────────────────────────────
  else if (commandName === 'idioma') {
    const code  = interaction.options.getString('lang');
    const lang2 = LANGS[code];
    if (!lang2) return interaction.reply({ content: `${E.erro} Idioma inválido.`, ephemeral: true });
    await col('settings').updateOne({ guildId: guild.id }, { $set: { lang: code } }, { upsert: true });
    langCache.set(guild.id, lang2);
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${lang2.flag}  Idioma alterado!`).setColor(0x9b59b6)
      .setDescription(`O idioma foi definido para **${lang2.name}**.`)
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  // ── /doar ────────────────────────────────────
  else if (commandName === 'doar') {
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('☕  Apoie o Architect!').setColor(0x9b59b6)
      .setDescription('> Se o Architect te ajudou, considere fazer uma doação!\n> Todo apoio ajuda a manter o bot no ar. 💜')
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], ephemeral: true });
  }

  // ── /dm ──────────────────────────────────────
  else if (commandName === 'dm') {
    if (!OWNER_IDS.includes(interaction.user.id)) return interaction.reply({ content: `${E.erro} Sem permissão.`, ephemeral: true });
    const msg = interaction.options.getString('mensagem');
    await interaction.deferReply({ ephemeral: true });
    let sent = 0, failed = 0;
    for (const [, g] of client.guilds.cache) {
      try {
        const owner = await g.fetchOwner();
        await owner.send({ embeds: [new EmbedBuilder().setTitle('📢  Mensagem Oficial do Architect')
          .setColor(0x9b59b6).setDescription(msg).setThumbnail(client.user.displayAvatarURL())
          .setFooter({ text: `Architect ${VERSION} • Mensagem Oficial` }).setTimestamp()] });
        sent++;
      } catch { failed++; }
    }
    await interaction.editReply({ content: `${E.sucesso} Enviada para **${sent}** donos. Falhas: **${failed}**.` });
  }

  // ── /premium ─────────────────────────────────
  else if (commandName === 'premium') {
    if (!PREMIUM_ADMINS.includes(interaction.user.id)) return interaction.reply({ content: `${E.erro} Sem permissão.`, ephemeral: true });
    const target = interaction.options.getUser('usuario');
    const plano  = interaction.options.getString('plano');
    await interaction.deferReply({ ephemeral: true });

    if (plano === 'remover') {
      await col('premium').deleteOne({ userId: target.id });
      await target.send({ embeds: [new EmbedBuilder().setTitle(`${E.erro}  Premium Removido`).setColor(0xe74c3c)
        .setDescription('Seu acesso Premium ao Architect foi removido.').setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      return interaction.editReply({ content: `${E.sucesso} Premium removido de **${target.tag}**.` });
    }

    const plan      = PREMIUM_PLANS[plano];
    const expiresAt = await setPremium(target.id, plano);
    await target.send({ embeds: [new EmbedBuilder()
      .setTitle(`${E.premium}  Bem-vindo ao Architect Premium!`).setColor(0x9b59b6)
      .setDescription(`Olá, **${target.username}**! Você recebeu acesso **Premium** ao Architect.`)
      .addFields(
        { name: `${plan.emoji} Plano`,  value: plan.label,                           inline: true },
        { name: `${E.data} Expira em`, value: expiresAt.toLocaleDateString('pt-BR'), inline: true },
        { name: '✨ Benefícios', value: '• Geração mais detalhada\n• Backup automático a cada 30min\n• Fila exclusiva (sem espera)', inline: false },
      )
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.premium}  Premium Ativado!`).setColor(0x2ecc71)
      .addFields(
        { name: `${E.membros} Usuário`, value: target.tag,                           inline: true },
        { name: `${plan.emoji} Plano`,  value: plan.label,                           inline: true },
        { name: `${E.data} Expira`,     value: expiresAt.toLocaleDateString('pt-BR'), inline: true },
      )
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  // ── /info ────────────────────────────────────
  else if (commandName === 'info') {
    const pQ = queues.premium.queue.length + (queues.premium.busy ? 1 : 0);
    const nQ = queues.normal.queue.length  + (queues.normal.busy  ? 1 : 0);
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.config}  Architect`).setColor(0x9b59b6).setThumbnail(client.user.displayAvatarURL())
      .setDescription('> O bot mais avançado de criação, proteção e restauração de servidores Discord.')
      .addFields(
        { name: '👨‍💻 Dev',                   value: 'Alzhayds',                             inline: true },
        { name: `${E.servidores} Servidores`, value: String(client.guilds.cache.size),      inline: true },
        { name: '⏱️ Uptime',                  value: `${Math.floor(process.uptime() / 60)}min`, inline: true },
        { name: '⚡ Stack',                   value: 'Discord.js v14 + Mistral AI',          inline: true },
        { name: '📦 Versão',                  value: VERSION,                                inline: true },
        { name: `${E.premium} Filas`,         value: `Premium: ${pQ} • Normal: ${nQ}`,      inline: true },
      )
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  // ── /help ────────────────────────────────────
  else if (commandName === 'help') {
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.config}  Comandos — Architect`).setColor(0x9b59b6)
      .setDescription(`**${VERSION}** — Create. Protect. Restore.`)
      .addFields(
        { name: `${E.servidores} /criar_servidor`, value: 'Cria servidor com IA'  },
        { name: '🎨 /template',                    value: 'Templates prontos'     },
        { name: `${E.backup} /backup`,             value: 'Salva estrutura'       },
        { name: `${E.backup} /restaurar`,          value: 'Restaura após nuke'    },
        { name: `${E.lock} /proteger`,             value: 'Anti-nuke toggle'      },
        { name: '🗑️ /deletar',                    value: 'Deleta canais/cargos'  },
        { name: `${E.cargos} /cargo_criar`,        value: 'Cria cargo'            },
        { name: `${E.canais} /canal_criar`,        value: 'Cria canal'            },
        { name: '🌐 /idioma',                      value: 'Altera o idioma'       },
        { name: '☕ /doar',                        value: 'Apoie o Architect'     },
        { name: `${E.servidores} /status`,         value: 'Info do servidor'      },
        { name: `${E.config} /info`,               value: 'Info do bot'           },
      )
      .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], ephemeral: true });
  }
});

// ─────────────────────────────────────────────
//  Anti-Nuke Events
// ─────────────────────────────────────────────
async function antiNukeAlert(guild, tag, type, count) {
  const ch = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildText &&
    c.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
  );
  if (!ch) return;
  await ch.send({ embeds: [new EmbedBuilder()
    .setTitle(`${E.erro}  ALERTA DE NUKE!`).setColor(0xe74c3c)
    .setDescription(`⚠️ **${tag}** deletou **${count} ${type}** em menos de 10s!\n\nUse **/restaurar** imediatamente!`)
    .setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
}

client.on('channelDelete', async channel => {
  try {
    const backup = await getBackup(channel.guild.id);
    if (!backup?.protection) return;
    const logs  = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return;
    const count = trackNuke(channel.guild.id, entry.executor.id);
    if (count >= 3) await antiNukeAlert(channel.guild, entry.executor.tag, 'canais', count);
  } catch (e) { console.error('[ANTI-NUKE] channelDelete:', e.message); }
});

client.on('roleDelete', async role => {
  try {
    const backup = await getBackup(role.guild.id);
    if (!backup?.protection) return;
    const logs  = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return;
    const count = trackNuke(role.guild.id, entry.executor.id);
    if (count >= 3) await antiNukeAlert(role.guild, entry.executor.tag, 'cargos', count);
  } catch (e) { console.error('[ANTI-NUKE] roleDelete:', e.message); }
});

// ─────────────────────────────────────────────
//  HTTP Server (health check)
// ─────────────────────────────────────────────
require('http').createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'online', version: VERSION, guilds: client.guilds?.cache?.size || 0, uptime: Math.floor(process.uptime()) }));
}).listen(process.env.PORT || 3000, () => console.log(`✅ HTTP server na porta ${process.env.PORT || 3000}`));

// ─────────────────────────────────────────────
//  Error Handlers
// ─────────────────────────────────────────────
client.on('error', e => console.error('❌ Client error:', e.message));
process.on('unhandledRejection', r => console.error('❌ Unhandled rejection:', r?.message || r));
process.on('uncaughtException',  e => console.error('❌ Uncaught exception:',  e?.message || e));

// ─────────────────────────────────────────────
//  Startup
// ─────────────────────────────────────────────
async function startup() {
  const missing = ['DISCORD_TOKEN', 'CLIENT_ID', 'MONGO_URI', 'MISTRAL_KEY'].filter(k => !process.env[k]);
  if (missing.length) { console.error(`❌ Variáveis faltando: ${missing.join(', ')}`); process.exit(1); }

  console.log(`[STARTUP] TOKEN: ${process.env.DISCORD_TOKEN?.slice(0, 10)}... CLIENT_ID: ${process.env.CLIENT_ID}`);

  await connectDB();

  console.log('[STARTUP] Fazendo login no Discord...');
  const timeout = setTimeout(() => {
    console.error('❌ Discord login TIMEOUT (30s) — verifique o DISCORD_TOKEN.');
    process.exit(1);
  }, 30000);

  try {
    await client.login(process.env.DISCORD_TOKEN);
    clearTimeout(timeout);
    console.log('✅ Discord login OK');
  } catch (e) {
    clearTimeout(timeout);
    console.error('❌ Discord login FALHOU:', e.message);
    process.exit(1);
  }

  setInterval(runAutoBackups, 30 * 60 * 1000);
  setInterval(async () => {
    const docs = await col('premium').find({}).toArray().catch(() => []);
    for (const doc of docs)
      if (new Date(doc.expiresAt) < new Date()) await getPremium(doc.userId);
  }, 60 * 60 * 1000);
}

startup();

// Iniciar bot
console.log("TOKEN:", process.env.DISCORD_TOKEN ? "OK" : "NÃO DETECTADO");

client.login(process.env.DISCORD_TOKEN);
