/**
 * Architect v1.8.0
 * Developed by Alzhayds
 * Create. Protect. Restore.
 */

const {
  Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ChannelType, AuditLogEvent,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const fetch  = require('node-fetch');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const VERSION        = 'v2.0.0';
const MISTRAL_MODEL  = 'mistral-small-2503'; // 200B tokens/mês grátis, 1 req/s por chave

// ── Mistral Keys (5 chaves = 5 filas independentes A-E) ───────────────────────
// No .env: MISTRAL_KEY_A, MISTRAL_KEY_B, MISTRAL_KEY_C, MISTRAL_KEY_D, MISTRAL_KEY_E
const LANE_NAMES = ['A', 'B', 'C', 'D', 'E'];
const MISTRAL_KEYS = {
  A: process.env.MISTRAL_KEY_A,
  B: process.env.MISTRAL_KEY_B,
  C: process.env.MISTRAL_KEY_C,
  D: process.env.MISTRAL_KEY_D,
  E: process.env.MISTRAL_KEY_E,
};

const activeLanes = LANE_NAMES.filter(l => !!MISTRAL_KEYS[l]);
if (activeLanes.length === 0) {
  console.error('❌ Nenhuma MISTRAL_KEY encontrada! Defina ao menos MISTRAL_KEY_A no .env.');
  process.exit(1);
}
console.log(`✅ ${activeLanes.length} fila(s) Mistral ativas: ${activeLanes.join(', ')}`);

// ── Sistema de Filas A-E ───────────────────────────────────────────────────────
// Cada lane é uma fila independente com sua própria chave API (1 req/s garantido)
// Tempo estimado por geração: ~10s (3 chamadas × ~3s cada)
const SECS_PER_GENERATION = 12; // segundos estimados por geração completa

const lanes = {};
for (const name of activeLanes) {
  lanes[name] = {
    name,
    busy:    false,
    queue:   [],      // [{ task, resolve, reject, guildId, userId, interaction, prompt, addedAt }]
    lastRun: 0,       // timestamp da última req (respeita 1 req/s)
  };
}

// Retorna a lane com menos gente OU a que vai terminar mais cedo
function getBestLane() {
  let best = null;
  for (const name of activeLanes) {
    const lane = lanes[name];
    if (!best) { best = lane; continue; }
    // Prioriza a lane mais próxima de terminar (menor fila)
    if (lane.queue.length < best.queue.length) best = lane;
  }
  return best;
}

// Retorna a posição global de um userId e sua lane
function getQueueStatus(userId) {
  for (const name of activeLanes) {
    const lane = lanes[name];
    const idx  = lane.queue.findIndex(e => e.userId === userId);
    if (idx !== -1) {
      const posInLane    = idx + 1; // 1-based
      const secsAhead    = (lane.busy ? SECS_PER_GENERATION : 0) + idx * SECS_PER_GENERATION;
      return { lane: name, position: posInLane, secsAhead };
    }
  }
  return null;
}

// Conta total de pessoas em todas as filas
function totalQueueSize() {
  return activeLanes.reduce((acc, n) => acc + lanes[n].queue.length + (lanes[n].busy ? 1 : 0), 0);
}

// Atualiza o embed de fila de todos os usuários que estão esperando
async function broadcastQueueUpdate() {
  for (const name of activeLanes) {
    const lane = lanes[name];
    for (let i = 0; i < lane.queue.length; i++) {
      const entry      = lane.queue[i];
      const secsAhead  = (lane.busy ? SECS_PER_GENERATION : 0) + i * SECS_PER_GENERATION;
      const position   = i + 1;
      try {
        await entry.interaction.editReply({
          embeds: [buildQueueEmbed(entry.prompt, name, position, secsAhead)],
        }).catch(() => {});
      } catch (_) {}
    }
  }
}

// Processa a fila de uma lane respeitando 1 req/s
async function processLane(laneName) {
  const lane = lanes[laneName];
  if (lane.busy || lane.queue.length === 0) return;
  lane.busy = true;

  const entry = lane.queue.shift();
  await broadcastQueueUpdate(); // atualiza posições de quem ficou na fila

  try { entry.resolve(await entry.task()); }
  catch (e) { entry.reject(e); }
  finally {
    // Respeita 1 req/s do Mistral: espera pelo menos 1100ms desde a última req
    const elapsed = Date.now() - lane.lastRun;
    const wait    = Math.max(0, 1100 - elapsed);
    await new Promise(r => setTimeout(r, wait));
    lane.lastRun = Date.now();
    lane.busy    = false;
    processLane(laneName);
  }
}

// Enfileira uma tarefa na melhor lane disponível, retorna info da fila
function enqueueMistral(task, interaction, prompt, userId) {
  const lane = getBestLane();
  return new Promise((resolve, reject) => {
    lane.queue.push({ task, resolve, reject, userId, interaction, prompt, addedAt: Date.now() });
    processLane(lane.name);
  });
}

// ── Custom Emojis ──────────────────────────────────────────────────────────────
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

// ── Idiomas ────────────────────────────────────────────────────────────────────
const LANGS = {
  pt: {
    flag: '🇧🇷', name: 'Português',
    langChanged:  (n) => `O idioma foi definido para **${n}**.`,
    langTitle:    '🇧🇷  Idioma alterado!',
    noPermission: `${E.erro} Você precisa ser **Administrador**!`,
    backupSaved:  `${E.sucesso}  Backup Salvo!`,
    noBackup:     `${E.erro} Nenhum backup encontrado!`,
    doarTitle:    '☕  Apoie o Architect!',
    doarDesc:     '> Se o Architect te ajudou, considere fazer uma doação!\n> Todo apoio ajuda a manter o bot no ar e a evoluir cada vez mais. 💜',
    doarThanks:   'Obrigado pelo apoio!',
  },
  en: {
    flag: '🇺🇸', name: 'English',
    langChanged:  (n) => `Language has been set to **${n}**.`,
    langTitle:    '🇺🇸  Language changed!',
    noPermission: `${E.erro} You need to be an **Administrator**!`,
    backupSaved:  `${E.sucesso}  Backup Saved!`,
    noBackup:     `${E.erro} No backup found!`,
    doarTitle:    '☕  Support Architect!',
    doarDesc:     '> If Architect helped you, consider making a donation!\n> Every bit of support helps keep the bot running. 💜',
    doarThanks:   'Thank you for your support!',
  },
  es: {
    flag: '🇪🇸', name: 'Español',
    langChanged:  (n) => `El idioma se ha configurado en **${n}**.`,
    langTitle:    '🇪🇸  ¡Idioma cambiado!',
    noPermission: `${E.erro} ¡Necesitas ser **Administrador**!`,
    backupSaved:  `${E.sucesso}  ¡Copia de seguridad guardada!`,
    noBackup:     `${E.erro} ¡No se encontró ninguna copia de seguridad!`,
    doarTitle:    '☕  ¡Apoya a Architect!',
    doarDesc:     '> ¡Si Architect te ayudó, considera hacer una donación!\n> Todo apoyo ayuda a mantener el bot activo. 💜',
    doarThanks:   '¡Gracias por tu apoyo!',
  },
  fr: {
    flag: '🇫🇷', name: 'Français',
    langChanged:  (n) => `La langue a été définie sur **${n}**.`,
    langTitle:    '🇫🇷  Langue modifiée !',
    noPermission: `${E.erro} Vous devez être **Administrateur** !`,
    backupSaved:  `${E.sucesso}  Sauvegarde enregistrée !`,
    noBackup:     `${E.erro} Aucune sauvegarde trouvée !`,
    doarTitle:    '☕  Soutenez Architect !',
    doarDesc:     '> Si Architect vous a aidé, pensez à faire un don !\n> Tout soutien aide à maintenir le bot en ligne. 💜',
    doarThanks:   'Merci pour votre soutien !',
  },
  de: {
    flag: '🇩🇪', name: 'Deutsch',
    langChanged:  (n) => `Die Sprache wurde auf **${n}** gesetzt.`,
    langTitle:    '🇩🇪  Sprache geändert!',
    noPermission: `${E.erro} Du musst **Administrator** sein!`,
    backupSaved:  `${E.sucesso}  Backup gespeichert!`,
    noBackup:     `${E.erro} Kein Backup gefunden!`,
    doarTitle:    '☕  Unterstütze Architect!',
    doarDesc:     '> Wenn Architect dir geholfen hat, erwäge eine Spende!\n> Jede Unterstützung hilft, den Bot am Laufen zu halten. 💜',
    doarThanks:   'Danke für deine Unterstützung!',
  },
};

const guildLangCache = new Map();
async function getGuildLang(guildId) {
  if (guildLangCache.has(guildId)) return guildLangCache.get(guildId);
  if (!mongoDB) return LANGS.pt;
  const setting = await mongoDB.collection('settings').findOne({ guildId });
  const lang    = LANGS[setting?.lang] || LANGS.pt;
  guildLangCache.set(guildId, lang);
  return lang;
}

// ── Premium System ─────────────────────────────────────────────────────────────
const PREMIUM_OWNERS = ['1449734825819897936', '1307428996337897553'];
const PREMIUM_PLANS  = {
  semanal: { label: 'Semanal', days: 7,   emoji: '⚡' },
  mensal:  { label: 'Mensal',  days: 30,  emoji: '💎' },
  anual:   { label: 'Anual',   days: 365, emoji: '👑' },
};

async function getPremium(userId) {
  if (!mongoDB) return null;
  const doc = await mongoDB.collection('premium').findOne({ userId });
  if (!doc) return null;
  if (new Date(doc.expiresAt) < new Date()) {
    try {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        await user.send({ embeds: [new EmbedBuilder()
          .setTitle(`⏰  Seu Premium expirou!`)
          .setColor(0xe74c3c)
          .setDescription(`Seu plano **${doc.plan}** do Architect expirou.\n\nPara renovar, entre em contato com a equipe Alzhadys.`)
          .setFooter({ text: `Architect ${VERSION}` })
          .setTimestamp()] }).catch(() => {});
      }
    } catch (e) { console.error('[PREMIUM] DM expirado:', e.message); }
    await mongoDB.collection('premium').deleteOne({ userId });
    return null;
  }
  return doc;
}

async function setPremium(userId, plan) {
  const days      = PREMIUM_PLANS[plan].days;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await mongoDB.collection('premium').updateOne(
    { userId },
    { $set: { userId, plan, expiresAt: expiresAt.toISOString(), grantedAt: new Date().toISOString() } },
    { upsert: true }
  );
  return expiresAt;
}

async function isUserPremium(userId) {
  return !!(await getPremium(userId));
}

async function isGuildOwnerPremium(guild) {
  try {
    const owner = await guild.fetchOwner();
    return await isUserPremium(owner.id);
  } catch { return false; }
}

// ── Auto-Backup Premium (a cada 30 min) ───────────────────────────────────────
async function runAutoBackups() {
  try {
    const premiumDocs = await mongoDB.collection('premium').find({}).toArray();
    for (const doc of premiumDocs) {
      if (new Date(doc.expiresAt) < new Date()) continue;
      for (const [, guild] of client.guilds.cache) {
        try {
          const owner = await guild.fetchOwner().catch(() => null);
          if (!owner || owner.id !== doc.userId) continue;
          const structure = await captureStructure(guild);
          await saveBackup(guild.id, guild.name, structure);
          console.log(`[AUTO-BACKUP] ${guild.name} (${doc.userId})`);
        } catch (e) { console.error('[AUTO-BACKUP] Guild:', e.message); }
      }
    }
  } catch (e) { console.error('[AUTO-BACKUP]:', e.message); }
}

// ── Mistral API ────────────────────────────────────────────────────────────────
// 1 req/s por chave — cada lane tem sua própria chave e respeita o limite
async function callMistralRaw(laneName, messages, maxTokens = 8000, retries = 4) {
  const key = MISTRAL_KEYS[laneName];
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MISTRAL_MODEL, max_tokens: maxTokens, temperature: 0.4, messages }),
        signal: AbortSignal.timeout(90000),
      });

      if (res.status === 429) {
        const wait = parseInt(res.headers.get('retry-after') || '5', 10) * 1000;
        console.warn(`[MISTRAL/${laneName}] 429 — aguardando ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`Mistral HTTP ${res.status}: ${await res.text()}`);

      const data = await res.json();
      let raw = (data.choices?.[0]?.message?.content || '').trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      const isArr = raw.trimStart().startsWith('[');
      const s = raw.indexOf(isArr ? '[' : '{');
      const e = raw.lastIndexOf(isArr ? ']' : '}');
      if (s === -1 || e === -1) throw new Error('IA retornou JSON inválido. Tente novamente.');
      return JSON.parse(raw.substring(s, e + 1));

    } catch (err) {
      console.error(`[MISTRAL/${laneName}] Tentativa ${attempt}/${retries}:`, err.message);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

// Enfileira chamada Mistral na lane especificada — tarefa simples sem rastreamento de fila
function callMistral(laneName, messages, maxTokens = 8000) {
  return new Promise((resolve, reject) => {
    lanes[laneName].queue.push({
      task:        () => callMistralRaw(laneName, messages, maxTokens),
      resolve, reject,
      userId:      null, interaction: null, prompt: null, addedAt: Date.now(),
    });
    processLane(laneName);
  });
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
    GatewayIntentBits.GuildModeration,
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

// ── Generate Structure ─────────────────────────────────────────────────────────
async function generateStructure(prompt, onLog, isPremium = false, laneName = 'A') {
  prompt = prompt.replace(/"/g, "'").replace(/`/g, "'");

  await onLog(E.loading, 'ANÁLISE',  `Interpretando prompt${isPremium ? ' (Premium ✨)' : ''}...`);
  await onLog(E.loading, 'MISTRAL',  `Conectando via Fila ${laneName}...`);

  // ── ETAPA 1: Cargos ─────────────────────────────────────────────────────────
  await onLog(E.cargos, 'CARGOS', 'Gerando hierarquia de cargos...');
  const minRoles  = isPremium ? 15 : 8;
  const maxRoles  = isPremium ? 25 : 14;
  const rolesMsg  = `You are an expert Discord server architect. Your task is to generate a COMPLETE and REALISTIC role hierarchy for a Discord server.
RULES:
- Return ONLY a valid JSON array, no markdown, no explanation.
- Always write role names in Portuguese with correct accents.
- Generate between ${minRoles} and ${maxRoles} roles.
- Every role MUST have a unique, fitting hex color.
- Include at minimum: 1 owner/admin role, 2-3 staff roles, 2-3 member/level roles, 1 bot role, 1 muted role, specific theme roles.
- Use realistic permissions per role type (admin gets ADMINISTRATOR, mod gets KICK_MEMBERS+BAN_MEMBERS, etc).
- Permissions array must only contain values from: ADMINISTRATOR, MANAGE_GUILD, MANAGE_CHANNELS, MANAGE_ROLES, KICK_MEMBERS, BAN_MEMBERS, SEND_MESSAGES, VIEW_CHANNEL, MANAGE_MESSAGES.`;

  const roles = await callMistral(laneName, [
    { role: 'system', content: rolesMsg },
    { role: 'user', content: `Server description: "${prompt}"\n\nReturn a JSON array:\n[{"name":"👑 Dono","color":"#f1c40f","hoist":true,"mentionable":false,"permissions":["ADMINISTRATOR"]},{"name":"🔇 Mutado","color":"#7f8c8d","hoist":false,"mentionable":false,"permissions":[]}]\nGenerate ALL roles. Return only the JSON array.` },
  ]);

  if (!Array.isArray(roles) || roles.length === 0)
    throw new Error('A IA não retornou cargos válidos. Tente novamente com um prompt diferente.');

  const count = roles.length;
  await onLog(E.sucesso, 'CARGOS', `${count} cargo(s) gerado(s)`);
  const roleNames = roles.map(r => r.name).join(', ');

  // ── ETAPA 2: Categorias & Canais ─────────────────────────────────────────────
  await onLog(E.canais, 'ESTRUTURA', 'Projetando categorias e canais...');
  const minCats     = isPremium ? 7  : 5;
  const minChannels = isPremium ? 5  : 3;
  const catsMsg     = `You are an expert Discord server architect. Your task is to design a COMPLETE, DETAILED Discord server structure.
RULES:
- Return ONLY a valid JSON array, no markdown, no explanation.
- Always write names in Portuguese with correct accents.
- Generate at minimum ${minCats} categories.
- Each category MUST have at least ${minChannels} channels — never leave a category empty or with only 1 channel.
- Include a variety of channel types: text, voice, forum, announcement, stage.
- Channel names: EMOJI・name-with-hyphens (ex: 📢・anuncios).
- Category names: EMOJI ◆ NAME IN CAPS (ex: 🏛️ ◆ INFORMAÇÕES).
- allowedRoles must reference role names from the server's actual role list.
- Every category and channel MUST have allowedRoles populated (never empty []).`;

  const categories = await callMistral(laneName, [
    { role: 'system', content: catsMsg },
    { role: 'user', content: `Server: "${prompt}"\nRoles: ${roleNames}\n\nReturn JSON array:\n[{"name":"🏛️ ◆ INFORMAÇÕES","allowedRoles":["👑 Dono","✅ Membro"],"channels":[{"name":"📢・anuncios","type":"announcement","topic":"Novidades","allowedRoles":["👑 Dono","✅ Membro"]},{"name":"📋・regras","type":"text","topic":"Regras","allowedRoles":["👑 Dono","✅ Membro"]}]}]\nEach category needs at least ${minChannels} channels. Return only the JSON array.` },
  ]);

  if (!Array.isArray(categories) || categories.length === 0)
    throw new Error('A IA não retornou categorias válidas. Tente novamente com um prompt diferente.');

  const totalChannels = categories.reduce((a, c) => a + (c.channels?.length || 0), 0);
  await onLog(E.sucesso, 'ESTRUTURA', `${categories.length} categoria(s) · ${totalChannels} canal(is)`);

  // ── ETAPA 3: Boas-vindas ─────────────────────────────────────────────────────
  let welcomeMessage = '';
  try {
    await onLog(E.loading, 'BOAS-VINDAS', 'Redigindo mensagem de boas-vindas...');
    const wResult = await callMistral(laneName, [
      { role: 'system', content: 'Write a short, friendly Discord welcome message in Brazilian Portuguese. Plain text only, no JSON, no markdown.' },
      { role: 'user',   content: `Welcome message for: "${prompt}". 3-4 lines, warm and inviting.` },
    ], 300);
    welcomeMessage = typeof wResult === 'string' ? wResult : (wResult?.content || wResult?.message || '');
    await onLog(E.sucesso, 'BOAS-VINDAS', 'Mensagem gerada com sucesso');
  } catch (e) {
    console.error('[BOAS-VINDAS] Falhou:', e.message);
    await onLog(E.aguardando, 'BOAS-VINDAS', 'Ignorada (erro não crítico)');
  }

  await onLog(E.sucesso, 'CONCLUÍDO', 'Estrutura pronta — aguardando confirmação');
  return { roles, categories, welcomeMessage: welcomeMessage || '' };
}

// ── Permission Builder ─────────────────────────────────────────────────────────
function buildPermissions(perms = []) {
  const map = {
    ADMINISTRATOR:   PermissionFlagsBits.Administrator,
    MANAGE_GUILD:    PermissionFlagsBits.ManageGuild,
    MANAGE_CHANNELS: PermissionFlagsBits.ManageChannels,
    MANAGE_ROLES:    PermissionFlagsBits.ManageRoles,
    KICK_MEMBERS:    PermissionFlagsBits.KickMembers,
    BAN_MEMBERS:     PermissionFlagsBits.BanMembers,
    SEND_MESSAGES:   PermissionFlagsBits.SendMessages,
    VIEW_CHANNEL:    PermissionFlagsBits.ViewChannel,
  };
  return perms.reduce((acc, p) => (map[p] ? acc | map[p] : acc), 0n);
}

// ── Capture Structure (Backup) ─────────────────────────────────────────────────
async function captureStructure(guild) {
  const server = {
    name:                       guild.name,
    description:                guild.description || '',
    verificationLevel:          guild.verificationLevel,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    explicitContentFilter:      guild.explicitContentFilter,
    systemChannelId:            null,
    afkTimeout:                 guild.afkTimeout,
    preferredLocale:            guild.preferredLocale,
  };

  const everyoneRole  = guild.roles.everyone;
  const everyonePerms = everyoneRole.permissions.toArray();

  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone' && !r.managed)
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      name:         r.name,
      color:        r.hexColor,
      hoist:        r.hoist,
      mentionable:  r.mentionable,
      permissions:  r.permissions.toArray(),
      position:     r.position,
      unicodeEmoji: r.unicodeEmoji || null,
    }));

  const memberRoles = [];
  const channels    = await guild.channels.fetch();
  const categories  = [];

  for (const [, cat] of channels) {
    if (cat.type !== ChannelType.GuildCategory) continue;
    const catOverwrites = [];
    for (const [, ow] of cat.permissionOverwrites.cache) {
      const name = ow.type === 0 ? (guild.roles.cache.get(ow.id)?.name || null) : null;
      catOverwrites.push({ id: ow.id, type: ow.type, allow: ow.allow.toArray(), deny: ow.deny.toArray(), roleName: name });
    }
    const children = [];
    for (const [, ch] of channels) {
      if (ch.parentId !== cat.id) continue;
      const chOverwrites = [];
      for (const [, ow] of ch.permissionOverwrites.cache) {
        const name = ow.type === 0 ? (guild.roles.cache.get(ow.id)?.name || null) : null;
        chOverwrites.push({ id: ow.id, type: ow.type, allow: ow.allow.toArray(), deny: ow.deny.toArray(), roleName: name });
      }
      const typeStr = ch.type === ChannelType.GuildVoice       ? 'voice'
        : ch.type === ChannelType.GuildAnnouncement             ? 'announcement'
        : ch.type === ChannelType.GuildForum                    ? 'forum'
        : ch.type === ChannelType.GuildStageVoice               ? 'stage'
        : 'text';
      children.push({
        name: ch.name, type: typeStr, topic: ch.topic || '',
        nsfw: ch.nsfw || false, rateLimitPerUser: ch.rateLimitPerUser || 0,
        position: ch.position, permOverwrites: chOverwrites,
        isSystemChannel: guild.systemChannelId === ch.id,
        isAfkChannel:    guild.afkChannelId    === ch.id,
      });
    }
    children.sort((a, b) => a.position - b.position);
    categories.push({ name: cat.name, position: cat.position, permOverwrites: catOverwrites, channels: children });
  }

  const orphanChannels = [];
  for (const [, ch] of channels) {
    if (ch.parentId || ch.type === ChannelType.GuildCategory) continue;
    const chOverwrites = [];
    for (const [, ow] of ch.permissionOverwrites.cache) {
      const name = ow.type === 0 ? (guild.roles.cache.get(ow.id)?.name || null) : null;
      chOverwrites.push({ id: ow.id, type: ow.type, allow: ow.allow.toArray(), deny: ow.deny.toArray(), roleName: name });
    }
    const typeStr = ch.type === ChannelType.GuildVoice       ? 'voice'
      : ch.type === ChannelType.GuildAnnouncement             ? 'announcement'
      : ch.type === ChannelType.GuildForum                    ? 'forum'
      : ch.type === ChannelType.GuildStageVoice               ? 'stage'
      : 'text';
    orphanChannels.push({
      name: ch.name, type: typeStr, topic: ch.topic || '',
      nsfw: ch.nsfw || false, rateLimitPerUser: ch.rateLimitPerUser || 0,
      position: ch.position, permOverwrites: chOverwrites,
      isSystemChannel: guild.systemChannelId === ch.id,
      isAfkChannel:    guild.afkChannelId    === ch.id,
    });
  }
  orphanChannels.sort((a, b) => a.position - b.position);
  categories.sort((a, b) => a.position - b.position);

  return { server, roles, everyonePerms, memberRoles, categories, orphanChannels };
}

// ── Apply Structure ────────────────────────────────────────────────────────────
// FIX: valida estrutura antes de deletar qualquer coisa
async function applyStructure(guild, structure, onStep) {
  // Garante que temos dados válidos antes de qualquer deleção
  if (!structure.roles?.length && !structure.categories?.length) {
    throw new Error('Estrutura inválida: sem cargos nem categorias para criar. Operação cancelada.');
  }

  console.log(`[APPLY] Iniciando — roles: ${structure.roles?.length}, categories: ${structure.categories?.length}`);

  // 1. Remover canais
  await onStep(E.canais, 'Removendo canais existentes...');
  const existingChannels = await guild.channels.fetch();
  for (const [, ch] of existingChannels) {
    await ch.delete().catch(e => console.error('[APPLY] Erro ao deletar canal:', e.message));
  }
  await new Promise(r => setTimeout(r, 1000));

  // 2. Remover cargos
  await onStep(E.cargos, 'Removendo cargos existentes...');
  const existingRoles = await guild.roles.fetch();
  for (const [, role] of existingRoles) {
    if (!role.managed && role.name !== '@everyone') {
      await role.delete().catch(e => console.error('[APPLY] Erro ao deletar cargo:', e.message));
    }
  }
  await new Promise(r => setTimeout(r, 500));

  // 3. Restaurar permissões do @everyone
  if (structure.everyonePerms) {
    await guild.roles.everyone.setPermissions(structure.everyonePerms).catch(e => console.error('[APPLY] @everyone perms:', e.message));
  }

  // 4. Restaurar configurações do servidor
  if (structure.server) {
    try {
      await onStep(E.config, 'Restaurando configurações do servidor...');
      await guild.edit({
        name:                       structure.server.name,
        description:                structure.server.description || null,
        verificationLevel:          structure.server.verificationLevel,
        defaultMessageNotifications: structure.server.defaultMessageNotifications,
        explicitContentFilter:      structure.server.explicitContentFilter,
        preferredLocale:            structure.server.preferredLocale,
      }).catch(e => console.error('[APPLY] Guild edit:', e.message));
    } catch (e) { console.error('[APPLY] Guild config:', e.message); }
  }

  // 5. Criar cargos
  await onStep(E.cargos, 'Criando cargos...');
  const createdRoles  = new Map();
  const rolesToCreate = [...(structure.roles || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
  console.log(`[APPLY] Criando ${rolesToCreate.length} cargos...`);

  for (const r of rolesToCreate) {
    try {
      const safeColor = /^#[0-9A-Fa-f]{6}$/.test(r.color) ? r.color : '#99aab5';
      const roleData  = {
        name:        r.name,
        color:       safeColor,
        hoist:       r.hoist       || false,
        mentionable: r.mentionable || false,
        permissions: Array.isArray(r.permissions) ? buildPermissions(r.permissions) : (r.permissions || 0n),
      };
      if (r.unicodeEmoji) roleData.unicodeEmoji = r.unicodeEmoji;
      const role = await guild.roles.create(roleData);
      createdRoles.set(r.name, role);
      console.log(`[APPLY] Cargo criado: ${r.name}`);
      await onStep(E.sucesso, `Cargo: **${r.name}**`);
      await new Promise(r => setTimeout(r, 250));
    } catch (e) { console.error(`[APPLY] Cargo "${r.name}":`, e.message); }
  }

  // Helper: converte allowedRoles (IA) em permissionOverwrites do Discord
  function buildOverwritesFromAllowedRoles(allowedRoles) {
    if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return [];
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ];
    for (const roleName of allowedRoles) {
      const role = createdRoles.get(roleName);
      if (role) overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }
    return overwrites;
  }

  // Helper: resolve permOverwrites (backup) OU allowedRoles (IA)
  function resolveOverwrites(permOverwrites, allowedRoles) {
    if (allowedRoles?.length) return buildOverwritesFromAllowedRoles(allowedRoles);
    const resolved = [];
    for (const ow of permOverwrites || []) {
      if (ow.type === 0) {
        const role = createdRoles.get(ow.roleName) || guild.roles.cache.get(ow.id) || guild.roles.everyone;
        if (role) resolved.push({ id: role.id, allow: ow.allow, deny: ow.deny });
      } else if (ow.type === 1) {
        resolved.push({ id: ow.id, allow: ow.allow, deny: ow.deny });
      }
    }
    return resolved;
  }

  const typeMap = {
    voice:        ChannelType.GuildVoice,
    announcement: ChannelType.GuildAnnouncement,
    forum:        ChannelType.GuildForum,
    stage:        ChannelType.GuildStageVoice,
    text:         ChannelType.GuildText,
  };

  let systemChannelId = null;
  let afkChannelId    = null;

  // 6a. Canais sem categoria (backups)
  for (const ch of structure.orphanChannels || []) {
    try {
      const type        = typeMap[ch.type] || ChannelType.GuildText;
      const channelData = {
        name:                 ch.name.substring(0, 100),
        type,
        nsfw:                 ch.nsfw || false,
        rateLimitPerUser:     ch.rateLimitPerUser || 0,
        permissionOverwrites: resolveOverwrites(ch.permOverwrites, ch.allowedRoles),
      };
      if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement)
        channelData.topic = ch.topic?.substring(0, 1024) || '';
      const created = await guild.channels.create(channelData).catch(e => { console.error('[APPLY] Orphan canal:', e.message); return null; });
      if (!created) continue;
      if (ch.isSystemChannel) systemChannelId = created.id;
      if (ch.isAfkChannel)    afkChannelId    = created.id;
      await onStep(E.canais, `Canal: **${ch.name}**`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { console.error('[APPLY] Orphan canal exception:', ch.name, e.message); }
  }

  // 6b. Categorias e seus canais
  console.log(`[APPLY] Criando ${structure.categories?.length || 0} categorias...`);
  for (const category of structure.categories || []) {
    try {
      await onStep(E.canais, `Categoria: **${category.name}**`);
      const cat = await guild.channels.create({
        name:                 category.name.substring(0, 100),
        type:                 ChannelType.GuildCategory,
        permissionOverwrites: resolveOverwrites(category.permOverwrites, category.allowedRoles),
      }).catch(e => { console.error('[APPLY] Categoria:', e.message); return null; });
      if (!cat) continue;
      console.log(`[APPLY] Categoria criada: ${category.name} (${category.channels?.length || 0} canais)`);
      await new Promise(r => setTimeout(r, 400));

      for (const ch of category.channels || []) {
        try {
          const type        = typeMap[ch.type] || ChannelType.GuildText;
          const channelData = {
            name:                 (ch.name || 'canal').substring(0, 100),
            type,
            parent:               cat.id,
            nsfw:                 ch.nsfw || false,
            rateLimitPerUser:     ch.rateLimitPerUser || 0,
            permissionOverwrites: resolveOverwrites(ch.permOverwrites, ch.allowedRoles),
          };
          if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement)
            channelData.topic = ch.topic?.substring(0, 1024) || '';
          const created = await guild.channels.create(channelData).catch(e => { console.error('[APPLY] Canal:', ch.name, e.message); return null; });
          if (!created) continue;
          console.log(`[APPLY] Canal criado: ${ch.name}`);
          if (ch.isSystemChannel) systemChannelId = created.id;
          if (ch.isAfkChannel)    afkChannelId    = created.id;
          await onStep(E.canais, `Canal: **${ch.name}**`);
          await new Promise(r => setTimeout(r, 300));
        } catch (e) { console.error('[APPLY] Canal exception:', ch.name, e.message); }
      }
    } catch (e) { console.error('[APPLY] Categoria exception:', category.name, e.message); }
  }

  // 7. Canal de sistema e AFK
  try {
    const editData = {};
    if (systemChannelId) editData.systemChannel = systemChannelId;
    if (afkChannelId)    editData.afkChannel    = afkChannelId;
    if (Object.keys(editData).length > 0) await guild.edit(editData).catch(() => {});
  } catch (e) { console.error('[APPLY] System/AFK channel:', e.message); }

  // 8. Mensagem de boas-vindas
  if (structure.welcomeMessage) {
    try {
      const freshChannels = await guild.channels.fetch();
      const first = freshChannels.find(c =>
        c?.type === ChannelType.GuildText &&
        c.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
      );
      if (first) await first.send(structure.welcomeMessage).catch(() => {});
    } catch (e) { console.error('[APPLY] Boas-vindas:', e.message); }
  }
}

// ── Pending Maps ───────────────────────────────────────────────────────────────
const pendingCreate  = new Map();
const pendingRestore = new Map();

// ── Embed Builders ─────────────────────────────────────────────────────────────
// ── Queue Embed (rico: lane, posição, ETA) ─────────────────────────────────────
function formatETA(secs) {
  if (secs <= 0)   return '⚡ Quase na sua vez!';
  if (secs < 60)   return `~${secs}s`;
  if (secs < 3600) return `~${Math.floor(secs / 60)}min ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `~${h}h ${m}min`;
}

function buildQueueEmbed(prompt, laneName, position, secsAhead) {
  const laneEmoji = { A: '🟦', B: '🟩', C: '🟨', D: '🟧', E: '🟥' };
  const bar = (() => {
    const maxDisplay = 10;
    const filled = Math.max(0, maxDisplay - Math.min(position - 1, maxDisplay));
    return `\`[${'█'.repeat(filled)}${'░'.repeat(maxDisplay - filled)}]\``;
  })();

  // Status de todas as lanes
  const laneStatus = activeLanes.map(n => {
    const l    = lanes[n];
    const busy = l.busy ? '⚙️' : '✅';
    const q    = l.queue.filter(e => e.userId !== null).length;
    const mark = n === laneName ? ' ◄' : '';
    return `${laneEmoji[n]} **Fila ${n}** ${busy} — ${q} aguardando${mark}`;
  }).join('\n');

  return new EmbedBuilder()
    .setTitle(`${E.aguardando}  Na Fila — Fila ${laneName}`)
    .setColor(0xf39c12)
    .setDescription(`> ${E.loading} Sua geração está enfileirada. Aguarde sua vez!\n> \`\`\`${prompt.substring(0, 60)}\`\`\``)
    .addFields(
      { name: `${laneEmoji[laneName]} Sua Fila`,  value: `**Fila ${laneName}**`,         inline: true },
      { name: '🔢 Posição',                        value: `**#${position}**`,             inline: true },
      { name: `${E.data} Tempo Estimado`,          value: `**${formatETA(secsAhead)}**`, inline: true },
      { name: '📊 Progresso na Fila',              value: bar,                            inline: false },
      { name: `${E.servidores} Status das Filas`,  value: laneStatus,                    inline: false },
    )
    .setFooter({ text: `Architect ${VERSION} • Este embed atualiza automaticamente` })
    .setTimestamp();
}

function buildAnalysisEmbed(prompt, logs) {
  const logLines = logs.slice(-8)
    .map(l => `\`[${l.tag}]\` ${l.icon} ${l.msg}`).join('\n')
    || `\`[INIT]\` ${E.loading} Iniciando análise...`;
  return new EmbedBuilder()
    .setTitle(`${E.loading}  Analisando Prompt`)
    .setColor(0x9b59b6)
    .addFields(
      { name: `${E.config} Prompt`,            value: `\`\`\`${prompt.substring(0, 200)}\`\`\`` },
      { name: `${E.servidores} Log em Tempo Real`, value: logLines },
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
    .setTitle(`⚠️  Confirmar Criação`)
    .setColor(secondsLeft > 20 ? 0xf39c12 : 0xe74c3c)
    .setDescription(`> ⚠️ **Esta ação apagará TUDO e recriará do zero.**\n> Revise antes de confirmar.`)
    .addFields(
      { name: `${E.config} Prompt`,         value: `\`\`\`${prompt.substring(0, 200)}\`\`\`` },
      { name: `${E.cargos} Cargos`,         value: String(structure.roles?.length || 0),      inline: true },
      { name: `${E.canais} Categorias`,     value: String(structure.categories?.length || 0), inline: true },
      { name: `${E.canais} Canais`,         value: String(totalChannels),                     inline: true },
      { name: `⏱️ Expira em ${secondsLeft}s`, value: buildCountdownBar(secondsLeft, 60) },
    )
    .setFooter({ text: `Architect ${VERSION} • Confirme antes do tempo acabar` })
    .setTimestamp();
}

function buildProgressEmbed(title, info, steps) {
  const last = steps.slice(-8);
  const log  = last.length > 0
    ? last.map((s, i) => i === last.length - 1 ? `▶ ${s}` : `${E.check} ${s}`).join('\n')
    : `▶ Iniciando...`;
  return new EmbedBuilder()
    .setTitle(title).setColor(0x9b59b6)
    .addFields(
      { name: `${E.config} Servidor`, value: info.substring(0, 150) },
      { name: `${E.servidores} Progresso`, value: `\`\`\`\n${log}\n\`\`\`` },
    )
    .setFooter({ text: `Architect ${VERSION}` })
    .setTimestamp();
}

function errorEmbed(msg) {
  return new EmbedBuilder()
    .setTitle(`${E.erro}  Erro`)
    .setColor(0xe74c3c)
    .setDescription(`\`\`\`${msg.substring(0, 500)}\`\`\``)
    .setFooter({ text: `Architect ${VERSION}` });
}

function buildConfirmRow(confirmId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`create_confirm_${confirmId}`).setLabel('✅  Confirmar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌  Cancelar').setStyle(ButtonStyle.Danger),
  );
}

// FIX: interaction.editReply pode falhar se o canal foi deletado — envolvido em try/catch com fallback para DM
function startCountdown(interaction, confirmId, prompt, structure, tipo = null) {
  let secondsLeft = 60;
  const interval  = setInterval(async () => {
    secondsLeft--;
    if (secondsLeft <= 0 || !pendingCreate.has(confirmId)) {
      clearInterval(interval);
      if (pendingCreate.has(confirmId)) {
        pendingCreate.delete(confirmId);
        const expiredEmbed = new EmbedBuilder()
          .setTitle('⏰  Tempo Esgotado')
          .setColor(0xe74c3c)
          .setDescription('A confirmação expirou. Use o comando novamente.')
          .setFooter({ text: `Architect ${VERSION}` });
        await interaction.editReply({ embeds: [expiredEmbed], components: [] }).catch(async () => {
          await interaction.user.send({ embeds: [expiredEmbed] }).catch(() => {});
        });
      }
      return;
    }
    await interaction.editReply({
      embeds:     [buildConfirmEmbed(prompt, structure, secondsLeft)],
      components: [buildConfirmRow(confirmId)],
    }).catch(() => {});
  }, 1000);
}

// ── Guild Create Welcome ───────────────────────────────────────────────────────
client.on('guildCreate', async guild => {
  try {
    const owner = await guild.fetchOwner();
    await owner.send({ embeds: [new EmbedBuilder()
      .setTitle(`${E.servidores}  Olá! Obrigado por adicionar o Architect!`)
      .setColor(0x9b59b6)
      .setThumbnail(client.user.displayAvatarURL())
      .setDescription(`Opa, **${owner.user.username}**! Seja bem-vindo ao Architect!\n\nAqui estão os próximos passos:`)
      .addFields(
        { name: `${E.config} Comandos`,   value: 'Use **/help** para ver todos os comandos', inline: false },
        { name: `${E.backup} Backup`,     value: 'Use **/backup** para salvar a estrutura', inline: false },
        { name: `${E.lock} Proteção`,     value: 'Use **/proteger ativo:true** para ativar o anti-nuke', inline: false },
        { name: '🌐 Idioma',              value: 'Use **/idioma** para mudar o idioma do bot', inline: false },
      )
      .setFooter({ text: `Architect ${VERSION} • Create. Protect. Restore.` })
      .setTimestamp()] }).catch(() => {});
  } catch (e) { console.error('[GUILD CREATE] DM:', e.message); }
});

// ── Ready ──────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Architect ${VERSION} online como ${client.user.tag}`);

  const statuses = [
    { text: 'Building your server...', type: 4 },
    { text: 'Protecting your community', type: 4 },
    { text: 'Restoring after nukes', type: 4 },
  ];
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

  // ── Botões ─────────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split('_confirm_');

    // Confirmar criação
    if (action === 'create' && pendingCreate.has(id)) {
      const { prompt, structure } = pendingCreate.get(id);
      pendingCreate.delete(id);
      const steps = [];
      await interaction.update({
        embeds:     [buildProgressEmbed(`${E.servidores}  Construindo Servidor...`, prompt, steps)],
        components: [],
      }).catch(() => {});

      const update = async (icon, msg) => {
        steps.push(`${icon} ${msg}`);
        await interaction.editReply({
          embeds: [buildProgressEmbed(`${E.servidores}  Construindo Servidor...`, prompt, steps)],
        }).catch(() => {});
      };

      try {
        await applyStructure(interaction.guild, structure, update);
        const totalChannels = structure.categories?.reduce((a, c) => a + (c.channels?.length || 0), 0) || 0;
        const successEmbed  = new EmbedBuilder()
          .setTitle(`${E.sucesso}  Servidor Criado!`)
          .setColor(0x2ecc71)
          .setDescription('O servidor foi recriado com sucesso!')
          .addFields(
            { name: `${E.cargos} Cargos`,     value: String(structure.roles?.length || 0),      inline: true },
            { name: `${E.canais} Categorias`, value: String(structure.categories?.length || 0), inline: true },
            { name: `${E.canais} Canais`,     value: String(totalChannels),                     inline: true },
          )
          .setFooter({ text: `Architect ${VERSION} • Create. Protect. Restore.` })
          .setTimestamp();
        // FIX: se o canal foi deletado durante a criação, envia por DM
        await interaction.editReply({ embeds: [successEmbed], components: [] }).catch(async () => {
          await interaction.user.send({ embeds: [successEmbed] }).catch(() => {});
        });
      } catch (e) {
        const errEmbed = errorEmbed(e.message);
        await interaction.editReply({ embeds: [errEmbed], components: [] }).catch(async () => {
          await interaction.user.send({ embeds: [errEmbed] }).catch(() => {});
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
        embeds:     [buildProgressEmbed(`${E.backup}  Restaurando Servidor...`, `Backup de ${label}`, steps)],
        components: [],
      }).catch(() => {});
      const update = async (icon, msg) => {
        steps.push(`${icon} ${msg}`);
        await interaction.editReply({
          embeds: [buildProgressEmbed(`${E.backup}  Restaurando...`, `Backup de ${label}`, steps)],
        }).catch(() => {});
      };
      try {
        await applyStructure(interaction.guild, backup.structure, update);
        await update(E.sucesso, 'Servidor restaurado com sucesso!');
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
        embeds: [new EmbedBuilder()
          .setTitle(`${E.loading}  Deletando...`)
          .setColor(0xe74c3c)
          .setDescription('Processando...')
          .setFooter({ text: `Architect ${VERSION}` })],
        components: [],
      });
      try {
        let deletedCount = 0;
        if (acao === 'delete_all') {
          const chs = await interaction.guild.channels.fetch();
          for (const [, ch] of chs) { await ch.delete().catch(() => {}); deletedCount++; }
          const rs = await interaction.guild.roles.fetch();
          for (const [, role] of rs) { if (!role.managed && role.name !== '@everyone') { await role.delete().catch(() => {}); deletedCount++; } }
        } else if (acao === 'delete_channels_all') {
          const chs = await interaction.guild.channels.fetch();
          for (const [, ch] of chs) { await ch.delete().catch(() => {}); deletedCount++; }
        } else if (acao === 'delete_roles_all') {
          const rs = await interaction.guild.roles.fetch();
          for (const [, role] of rs) { if (!role.managed && role.name !== '@everyone') { await role.delete().catch(() => {}); deletedCount++; } }
        } else if (acao === 'delete_channels_specific') {
          const names = alvo.replace(/<#\d+>/g, m => { const ch = interaction.guild.channels.cache.get(m.replace(/\D/g, '')); return ch ? ch.name : ''; }).split(/[\s,]+/).filter(Boolean);
          for (const name of names) { const ch = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === name.toLowerCase()); if (ch) { await ch.delete().catch(() => {}); deletedCount++; } }
        } else if (acao === 'delete_roles_specific') {
          const names = alvo.replace(/<@&\d+>/g, m => { const r = interaction.guild.roles.cache.get(m.replace(/\D/g, '')); return r ? r.name : ''; }).split(/[\s,]+/).filter(Boolean);
          for (const name of names) { const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase()); if (role && !role.managed && role.name !== '@everyone') { await role.delete().catch(() => {}); deletedCount++; } }
        }
        await interaction.editReply({ embeds: [new EmbedBuilder()
          .setTitle(`${E.sucesso}  Deleção Concluída`)
          .setColor(0x2ecc71)
          .setDescription(`**${deletedCount}** item(s) deletado(s)!`)
          .setFooter({ text: `Architect ${VERSION}` })
          .setTimestamp()], components: [] });
      } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)], components: [] }); }
      return;
    }

    // Cancelar
    if (action === 'cancel') {
      pendingCreate.delete(id);
      pendingRestore.delete(id);
      await interaction.update({ embeds: [new EmbedBuilder()
        .setTitle('❌  Cancelado')
        .setColor(0x95a5a6)
        .setDescription('Operação cancelada.')
        .setFooter({ text: `Architect ${VERSION}` })], components: [] });
      return;
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, member } = interaction;
  const lang       = await getGuildLang(guild.id);
  const publicCmds = ['info', 'help', 'status', 'doar', 'idioma'];

  if (!publicCmds.includes(commandName) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: lang.noPermission, ephemeral: true });
  }

  // ── /criar_servidor ──────────────────────────────────────────────────────────
  if (commandName === 'criar_servidor') {
    const prompt    = interaction.options.getString('prompt');
    const userId    = interaction.user.id;
    const isPremium = await isGuildOwnerPremium(guild);
    await interaction.deferReply();

    // Escolhe a melhor lane e mostra o embed de fila imediatamente
    const chosenLane = getBestLane();
    const posInLane  = chosenLane.queue.length + (chosenLane.busy ? 1 : 0);
    const secsAhead  = (chosenLane.busy ? SECS_PER_GENERATION : 0) + posInLane * SECS_PER_GENERATION;

    if (posInLane > 0) {
      await interaction.editReply({ embeds: [buildQueueEmbed(prompt, chosenLane.name, posInLane + 1, secsAhead)] });
    } else {
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, [])] });
    }

    const logs  = [];
    const onLog = async (icon, tag, msg) => { logs.push({ icon, tag, msg }); console.log(`[${tag}] ${msg}`); };

    // Inicia atualização de ETA em tempo real enquanto está na fila
    let etaInterval = null;
    if (posInLane > 0) {
      let elapsed = 0;
      etaInterval = setInterval(async () => {
        elapsed++;
        const status = getQueueStatus(userId);
        if (!status) { clearInterval(etaInterval); return; }
        const remaining = Math.max(0, status.secsAhead - elapsed);
        await interaction.editReply({
          embeds: [buildQueueEmbed(prompt, status.lane, status.position, remaining)],
        }).catch(() => {});
      }, 1000);
    }

    try {
      const structure = await new Promise((resolve, reject) => {
        chosenLane.queue.push({
          task:        () => generateStructure(prompt, onLog, isPremium, chosenLane.name),
          resolve, reject,
          userId, interaction, prompt,
          addedAt: Date.now(),
        });
        processLane(chosenLane.name);
      });

      if (etaInterval) clearInterval(etaInterval);
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, logs)] });

      const confirmId = `${interaction.id}`;
      pendingCreate.set(confirmId, { prompt, structure });
      await interaction.editReply({
        embeds:     [buildConfirmEmbed(prompt, structure, 60)],
        components: [buildConfirmRow(confirmId)],
      });
      startCountdown(interaction, confirmId, prompt, structure);
    } catch (e) {
      if (etaInterval) clearInterval(etaInterval);
      await interaction.editReply({ embeds: [errorEmbed(e.message)] }).catch(() => {});
    }
  }

  // ── /template ────────────────────────────────────────────────────────────────
  else if (commandName === 'template') {
    const tipo = interaction.options.getString('tipo');
    const templates = {
      comunidade:  'Crie uma comunidade brasileira com informações, geral, eventos, suporte e voz',
      gaming:      'Crie um servidor gamer com jogos, torneios, clips, suporte e voz',
      militar:     'Crie um servidor militar com hierarquia, missões, treinamentos e voz',
      loja:        'Crie uma loja online com produtos, pedidos, promoções e suporte',
      anime:       'Crie um servidor de anime com discussões, recomendações e fan arts',
      educacional: 'Crie um servidor educacional com matérias, dúvidas e eventos',
    };
    const prompt    = templates[tipo];
    const userId    = interaction.user.id;
    const isPremium = await isGuildOwnerPremium(guild);
    await interaction.deferReply();

    const chosenLane = getBestLane();
    const posInLane  = chosenLane.queue.length + (chosenLane.busy ? 1 : 0);
    const secsAhead  = (chosenLane.busy ? SECS_PER_GENERATION : 0) + posInLane * SECS_PER_GENERATION;

    if (posInLane > 0) {
      await interaction.editReply({ embeds: [buildQueueEmbed(prompt, chosenLane.name, posInLane + 1, secsAhead)] });
    } else {
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, [])] });
    }

    const logs  = [];
    const onLog = async (icon, tag, msg) => { logs.push({ icon, tag, msg }); console.log(`[${tag}] ${msg}`); };

    let etaInterval = null;
    if (posInLane > 0) {
      let elapsed = 0;
      etaInterval = setInterval(async () => {
        elapsed++;
        const status = getQueueStatus(userId);
        if (!status) { clearInterval(etaInterval); return; }
        const remaining = Math.max(0, status.secsAhead - elapsed);
        await interaction.editReply({
          embeds: [buildQueueEmbed(prompt, status.lane, status.position, remaining)],
        }).catch(() => {});
      }, 1000);
    }

    try {
      const structure = await new Promise((resolve, reject) => {
        chosenLane.queue.push({
          task:        () => generateStructure(prompt, onLog, isPremium, chosenLane.name),
          resolve, reject,
          userId, interaction, prompt,
          addedAt: Date.now(),
        });
        processLane(chosenLane.name);
      });

      if (etaInterval) clearInterval(etaInterval);
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, logs)] });

      const confirmId = `${interaction.id}`;
      pendingCreate.set(confirmId, { prompt, structure });
      await interaction.editReply({
        embeds:     [buildConfirmEmbed(prompt, structure, 60)],
        components: [buildConfirmRow(confirmId)],
      });
      startCountdown(interaction, confirmId, prompt, structure, tipo);
    } catch (e) {
      if (etaInterval) clearInterval(etaInterval);
      await interaction.editReply({ embeds: [errorEmbed(e.message)] }).catch(() => {});
    }
  }

  // ── /backup ──────────────────────────────────────────────────────────────────
  else if (commandName === 'backup') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const structure = await captureStructure(guild);
      await saveBackup(guild.id, guild.name, structure);
      const chTotal = structure.categories.reduce((a, c) => a + c.channels.length, 0);
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setTitle(lang.backupSaved)
        .setColor(0x2ecc71)
        .setDescription(`Estrutura de **${guild.name}** salva com sucesso!`)
        .addFields(
          { name: `${E.cargos} Cargos`,     value: String(structure.roles.length),      inline: true },
          { name: `${E.canais} Categorias`, value: String(structure.categories.length), inline: true },
          { name: `${E.canais} Canais`,     value: String(chTotal),                     inline: true },
          { name: `${E.data} Salvo em`,     value: new Date().toLocaleString('pt-BR'),  inline: false },
        )
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }); }
  }

  // ── /restaurar ───────────────────────────────────────────────────────────────
  else if (commandName === 'restaurar') {
    const backup = await getBackup(guild.id);
    if (!backup) return interaction.reply({ content: lang.noBackup, ephemeral: true });
    const confirmId = `${interaction.id}`;
    pendingRestore.set(confirmId, { backup });
    setTimeout(() => pendingRestore.delete(confirmId), 60000);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`restore_confirm_${confirmId}`).setLabel('🔄  Restaurar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌  Cancelar').setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.backup}  Restaurar Backup`)
      .setColor(0x3498db)
      .setDescription('> ⚠️ **Isso irá apagar TUDO e restaurar o backup.**')
      .addFields({ name: `${E.data} Backup de`, value: new Date(backup.savedAt).toLocaleString('pt-BR') })
      .setFooter({ text: `Architect ${VERSION}` })
      .setTimestamp()], components: [row] });
  }

  // ── /proteger ────────────────────────────────────────────────────────────────
  else if (commandName === 'proteger') {
    const ativo  = interaction.options.getBoolean('ativo');
    const backup = await getBackup(guild.id);
    if (ativo && !backup) return interaction.reply({ content: `${E.erro} Faça um **/backup** primeiro!`, ephemeral: true });
    if (backup) await setProtection(guild.id, ativo);
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(ativo ? `${E.lock}  Proteção Ativada!` : `${E.unlock}  Proteção Desativada`)
      .setColor(ativo ? 0x2ecc71 : 0xe74c3c)
      .setDescription(ativo ? `${E.sucesso} Anti-nuke ativo. Monitorando em tempo real.` : `${E.erro} Proteção desativada.`)
      .setFooter({ text: `Architect ${VERSION}` })
      .setTimestamp()] });
  }

  // ── /deletar ─────────────────────────────────────────────────────────────────
  else if (commandName === 'deletar') {
    const tipo = interaction.options.getString('tipo');
    const alvo = interaction.options.getString('alvo') || '';
    const tudo = interaction.options.getBoolean('tudo') || false;
    let descricao = '', acao = '';

    if (tipo === 'cargos') {
      if (tudo || alvo.toLowerCase() === 'everyone') { descricao = '🗑️ Todos os cargos serão deletados.'; acao = 'delete_roles_all'; }
      else { descricao = `🗑️ Cargos: ${alvo}`; acao = 'delete_roles_specific'; }
    } else if (tipo === 'canais') {
      if (tudo || alvo.toLowerCase() === 'everyone') { descricao = '🗑️ Todos os canais serão deletados.'; acao = 'delete_channels_all'; }
      else { descricao = `🗑️ Canais: ${alvo}`; acao = 'delete_channels_specific'; }
    } else {
      descricao = '🗑️ TUDO será deletado.'; acao = 'delete_all';
    }

    const confirmId = `${interaction.id}`;
    pendingCreate.set(`del_${confirmId}`, { tipo, alvo, tudo, acao });
    setTimeout(() => pendingCreate.delete(`del_${confirmId}`), 60000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`delete_confirm_${confirmId}`).setLabel('🗑️  Deletar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌  Cancelar').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('⚠️  Confirmar Deleção')
      .setColor(0xe74c3c)
      .setDescription(`> ⚠️ **Esta ação é irreversível!**\n\n${descricao}`)
      .setFooter({ text: `Architect ${VERSION}` })
      .setTimestamp()], components: [row] });
  }

  // ── /cargo_criar ─────────────────────────────────────────────────────────────
  else if (commandName === 'cargo_criar') {
    const nome = interaction.options.getString('nome');
    const cor  = interaction.options.getString('cor') || '#99aab5';
    const adm  = interaction.options.getBoolean('admin') || false;
    try {
      const role = await guild.roles.create({ name: nome, color: cor, permissions: adm ? [PermissionFlagsBits.Administrator] : [] });
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.sucesso}  Cargo Criado!`)
        .setColor(role.color)
        .addFields(
          { name: `${E.cargos} Nome`, value: role.name, inline: true },
          { name: '🎨 Cor',          value: cor,        inline: true },
        )
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /canal_criar ─────────────────────────────────────────────────────────────
  else if (commandName === 'canal_criar') {
    const nome   = interaction.options.getString('nome');
    const tipo   = interaction.options.getString('tipo') || 'text';
    const topico = interaction.options.getString('topico') || '';
    const typeMap = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice };
    try {
      const channelData = { name: nome, type: typeMap[tipo] || ChannelType.GuildText };
      if (topico) channelData.topic = topico;
      const ch = await guild.channels.create(channelData);
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.sucesso}  Canal Criado!`)
        .setColor(0x2ecc71)
        .addFields(
          { name: `${E.canais} Nome`, value: ch.name, inline: true },
          { name: '📂 Tipo',          value: tipo,    inline: true },
        )
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /status ──────────────────────────────────────────────────────────────────
  else if (commandName === 'status') {
    const backup   = await getBackup(guild.id);
    const channels = await guild.channels.fetch();
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.servidores}  Status — ${guild.name}`)
      .setColor(0x3498db)
      .setThumbnail(guild.iconURL())
      .addFields(
        { name: `${E.membros} Membros`, value: String(guild.memberCount),                                                                         inline: true },
        { name: `${E.cargos} Cargos`,  value: String(guild.roles.cache.filter(r => r.name !== '@everyone').size),                                 inline: true },
        { name: `${E.canais} Texto`,   value: String(channels.filter(c => c.type === ChannelType.GuildText).size),                                inline: true },
        { name: `${E.lock} Proteção`,  value: backup?.protection ? `${E.sucesso} Ativa` : `${E.erro} Inativa`,                                    inline: true },
        { name: `${E.backup} Backup`,  value: backup ? new Date(backup.savedAt).toLocaleString('pt-BR') : `${E.erro} Nenhum`,                    inline: true },
      )
      .setFooter({ text: `Architect ${VERSION}` })
      .setTimestamp()] });
  }

  // ── /ban ─────────────────────────────────────────────────────────────────────
  else if (commandName === 'ban') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    const dias   = interaction.options.getInteger('dias') || 0;
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target || !target.bannable) return interaction.reply({ content: `${E.erro} Não consigo banir este membro!`, ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder()
        .setTitle(`${E.banido}  Você foi banido!`)
        .setColor(0xe74c3c)
        .setDescription(`Você foi banido de **${guild.name}**\n\n**Motivo:** ${motivo}`)
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] }).catch(() => {});
      await target.ban({ reason: motivo, deleteMessageDays: dias });
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.banido}  Membro Banido!`)
        .setColor(0xe74c3c)
        .addFields(
          { name: `${E.membros} Membro`,    value: target.user.tag, inline: true },
          { name: '📋 Motivo',               value: motivo,          inline: true },
          { name: '🗑️ Mensagens deletadas', value: `${dias} dia(s)`, inline: true },
        )
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /kick ────────────────────────────────────────────────────────────────────
  else if (commandName === 'kick') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target || !target.kickable) return interaction.reply({ content: `${E.erro} Não consigo expulsar este membro!`, ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder()
        .setTitle(`${E.membros}  Você foi expulso!`)
        .setColor(0xe67e22)
        .setDescription(`Você foi expulso de **${guild.name}**\n\n**Motivo:** ${motivo}`)
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] }).catch(() => {});
      await target.kick(motivo);
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.membros}  Membro Expulso!`)
        .setColor(0xe67e22)
        .addFields(
          { name: `${E.membros} Membro`, value: target.user.tag, inline: true },
          { name: '📋 Motivo',            value: motivo,          inline: true },
        )
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /mute ────────────────────────────────────────────────────────────────────
  else if (commandName === 'mute') {
    const target  = interaction.options.getMember('membro');
    const motivo  = interaction.options.getString('motivo') || 'Sem motivo informado';
    const duracao = interaction.options.getInteger('duracao') || 10;
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, ephemeral: true });
    try {
      await target.timeout(duracao * 60 * 1000, motivo);
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.mutado}  Membro Mutado!`)
        .setColor(0xf39c12)
        .addFields(
          { name: `${E.membros} Membro`, value: target.user.tag,  inline: true },
          { name: '⏱️ Duração',          value: `${duracao} min`, inline: true },
          { name: '📋 Motivo',            value: motivo,           inline: true },
        )
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /unmute ──────────────────────────────────────────────────────────────────
  else if (commandName === 'unmute') {
    const target = interaction.options.getMember('membro');
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, ephemeral: true });
    try {
      await target.timeout(null);
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.unlock}  Membro Desmutado!`)
        .setColor(0x2ecc71)
        .addFields({ name: `${E.membros} Membro`, value: target.user.tag, inline: true })
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /warn ────────────────────────────────────────────────────────────────────
  else if (commandName === 'warn') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder()
        .setTitle('⚠️  Advertência Recebida')
        .setColor(0xf39c12)
        .setDescription(`**Servidor:** ${guild.name}\n**Motivo:** ${motivo}`)
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] }).catch(() => {});
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle('⚠️  Advertência Enviada!')
        .setColor(0xf39c12)
        .addFields(
          { name: `${E.membros} Membro`, value: target.user.tag, inline: true },
          { name: '📋 Motivo',            value: motivo,          inline: true },
        )
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /lock ────────────────────────────────────────────────────────────────────
  else if (commandName === 'lock') {
    const canal  = interaction.options.getChannel('canal') || interaction.channel;
    const motivo = interaction.options.getString('motivo') || 'Canal trancado';
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.lock}  Canal Trancado!`)
        .setColor(0xe74c3c)
        .addFields(
          { name: `${E.canais} Canal`, value: `<#${canal.id}>`, inline: true },
          { name: '📋 Motivo',          value: motivo,           inline: true },
        )
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /unlock ──────────────────────────────────────────────────────────────────
  else if (commandName === 'unlock') {
    const canal = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.unlock}  Canal Destrancado!`)
        .setColor(0x2ecc71)
        .addFields({ name: `${E.canais} Canal`, value: `<#${canal.id}>`, inline: true })
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /slowmode ────────────────────────────────────────────────────────────────
  else if (commandName === 'slowmode') {
    const segundos = interaction.options.getInteger('segundos');
    const canal    = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await canal.setRateLimitPerUser(segundos);
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.config}  Slowmode Configurado!`)
        .setColor(0x3498db)
        .addFields(
          { name: `${E.canais} Canal`, value: `<#${canal.id}>`,                                  inline: true },
          { name: '⏱️ Intervalo',      value: segundos === 0 ? 'Desativado' : `${segundos}s`,    inline: true },
        )
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /clear ───────────────────────────────────────────────────────────────────
  else if (commandName === 'clear') {
    const quantidade = interaction.options.getInteger('quantidade');
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      await interaction.deferReply({ ephemeral: true });
      const msgs = await interaction.channel.bulkDelete(Math.min(quantidade, 100), true);
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.sucesso}  Mensagens Deletadas!`)
        .setColor(0x2ecc71)
        .setDescription(`**${msgs.size}** mensagem(s) deletada(s)!`)
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }); }
  }

  // ── /embed ───────────────────────────────────────────────────────────────────
  else if (commandName === 'embed') {
    const titulo    = interaction.options.getString('titulo');
    const descricao = interaction.options.getString('descricao');
    const cor       = interaction.options.getString('cor') || '#9b59b6';
    const canal     = interaction.options.getChannel('canal') || interaction.channel;
    const imagem    = interaction.options.getString('imagem') || null;
    const rodape    = interaction.options.getString('rodape') || null;
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      const embed = new EmbedBuilder().setTitle(titulo).setDescription(descricao).setColor(cor).setTimestamp();
      if (imagem) embed.setImage(imagem);
      if (rodape) embed.setFooter({ text: rodape });
      await canal.send({ embeds: [embed] });
      await interaction.reply({ content: `${E.sucesso} Embed enviado em <#${canal.id}>!`, ephemeral: true });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /anuncio ─────────────────────────────────────────────────────────────────
  else if (commandName === 'anuncio') {
    const titulo   = interaction.options.getString('titulo');
    const mensagem = interaction.options.getString('mensagem');
    const canal    = interaction.options.getChannel('canal');
    const marcar   = interaction.options.getBoolean('marcar_everyone') || false;
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, ephemeral: true });
    try {
      const embed = new EmbedBuilder()
        .setTitle(`📢  ${titulo}`)
        .setDescription(mensagem)
        .setColor(0x9b59b6)
        .setFooter({ text: `Anúncio por ${member.user.tag} • Architect ${VERSION}` })
        .setTimestamp();
      await canal.send({ content: marcar ? '@everyone' : null, embeds: [embed] });
      await interaction.reply({ content: `${E.sucesso} Anúncio enviado em <#${canal.id}>!`, ephemeral: true });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // ── /idioma ───────────────────────────────────────────────────────────────────
  else if (commandName === 'idioma') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: lang.noPermission, ephemeral: true });
    const langKey = interaction.options.getString('lang');
    const newLang = LANGS[langKey];
    await mongoDB.collection('settings').updateOne(
      { guildId: guild.id },
      { $set: { guildId: guild.id, lang: langKey } },
      { upsert: true }
    );
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
        { name: '👨‍💻 Dev',                value: 'Alzhayds',                         inline: true },
        { name: `${E.servidores} Servidores`, value: String(client.guilds.cache.size), inline: true },
      )
      .setFooter({ text: `Architect ${VERSION} • ${lang.doarThanks}` })
      .setTimestamp()], ephemeral: true });
  }

  // ── /info ────────────────────────────────────────────────────────────────────
  else if (commandName === 'info') {
    const uptime = process.uptime();
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.servidores}  Architect`)
      .setColor(0x9b59b6)
      .setThumbnail(client.user.displayAvatarURL())
      .setDescription('O bot mais avançado de criação, proteção e restauração de servidores Discord.')
      .addFields(
        { name: '👨‍💻 Dev',                    value: 'Alzhayds',                                                           inline: true },
        { name: `${E.servidores} Servidores`, value: String(client.guilds.cache.size),                                      inline: true },
        { name: '⏱️ Uptime',                  value: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`, inline: true },
        { name: '⚡ Stack',                   value: 'Discord.js v14 + Groq AI',                                          inline: true },
        { name: '📦 Versão',                  value: VERSION,                                                               inline: true },
        { name: `${E.loading} Filas`,          value: activeLanes.map(n => `${n}: ${lanes[n].queue.filter(e=>e.userId).length} aguardando`).join(' · '), inline: true },
      )
      .setFooter({ text: `Architect ${VERSION}` })
      .setTimestamp()] });
  }

  // ── /dm ──────────────────────────────────────────────────────────────────────
  else if (commandName === 'dm') {
    if (interaction.user.id !== process.env.OWNER_ID)
      return interaction.reply({ content: `${E.erro} Sem permissão.`, ephemeral: true });
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
    await interaction.editReply({ content: `${E.sucesso} Mensagem enviada para **${enviados}** donos. Falhas: **${falhas}**.` });
  }

  // ── /premium ──────────────────────────────────────────────────────────────────
  else if (commandName === 'premium') {
    if (!PREMIUM_OWNERS.includes(interaction.user.id))
      return interaction.reply({ content: `${E.erro} Sem permissão.`, ephemeral: true });
    const target = interaction.options.getUser('usuario');
    const plano  = interaction.options.getString('plano');
    await interaction.deferReply({ ephemeral: true });

    if (plano === 'remover') {
      await mongoDB.collection('premium').deleteOne({ userId: target.id });
      await target.send({ embeds: [new EmbedBuilder()
        .setTitle(`${E.erro}  Premium Removido`)
        .setColor(0xe74c3c)
        .setDescription('Seu acesso Premium ao Architect foi removido pela equipe Alzhadys.')
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] }).catch(() => {});
      return await interaction.editReply({ content: `${E.sucesso} Premium removido de **${target.tag}**.` });
    }

    const plan      = PREMIUM_PLANS[plano];
    const expiresAt = await setPremium(target.id, plano);

    await target.send({ embeds: [new EmbedBuilder()
      .setTitle(`${E.premium}  Bem-vindo ao Architect Premium!`)
      .setColor(0x9b59b6)
      .setDescription(`Olá, **${target.username}**! Você recebeu acesso **Premium** ao Architect.`)
      .addFields(
        { name: `${plan.emoji} Plano`,  value: plan.label,                              inline: true },
        { name: `${E.data} Expira em`, value: expiresAt.toLocaleDateString('pt-BR'),    inline: true },
        { name: '✨ Benefícios',        value: '• Criação de servidores mais detalhada\n• Backup automático a cada 30 min\n• Geração com mais cargos e canais\n• Prioridade na fila de geração', inline: false },
      )
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ text: `Architect ${VERSION} • Create. Protect. Restore.` })
      .setTimestamp()] }).catch(() => {});

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.premium}  Premium Ativado!`)
      .setColor(0x2ecc71)
      .addFields(
        { name: `${E.membros} Usuário`, value: target.tag,                           inline: true },
        { name: `${plan.emoji} Plano`,  value: plan.label,                           inline: true },
        { name: `${E.data} Expira`,     value: expiresAt.toLocaleDateString('pt-BR'), inline: true },
      )
      .setFooter({ text: `Architect ${VERSION}` })
      .setTimestamp()] });
  }

  // ── /help ────────────────────────────────────────────────────────────────────
  else if (commandName === 'help') {
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${E.config}  Comandos — Architect`)
      .setColor(0x9b59b6)
      .setDescription(`**${VERSION}** — Create. Protect. Restore.`)
      .addFields(
        { name: `${E.servidores} /criar_servidor`, value: 'Cria servidor com IA' },
        { name: '🎨 /template',                    value: 'Templates prontos' },
        { name: `${E.backup} /backup`,             value: 'Salva estrutura' },
        { name: `${E.backup} /restaurar`,          value: 'Restaura após nuke' },
        { name: `${E.lock} /proteger`,             value: 'Anti-nuke toggle' },
        { name: '🗑️ /deletar',                    value: 'Deleta canais/cargos' },
        { name: `${E.cargos} /cargo_criar`,        value: 'Cria cargo' },
        { name: `${E.canais} /canal_criar`,        value: 'Cria canal' },
        { name: '🌐 /idioma',                      value: 'Altera o idioma do bot' },
        { name: '☕ /doar',                        value: 'Apoie o Architect' },
        { name: `${E.servidores} /status`,         value: 'Info do servidor' },
        { name: `${E.config} /info`,               value: 'Info do bot' },
      )
      .setFooter({ text: `Architect ${VERSION}` })
      .setTimestamp()], ephemeral: true });
  }
});

// ── Anti-Nuke Events ───────────────────────────────────────────────────────────
client.on('channelDelete', async channel => {
  try {
    const backup = await getBackup(channel.guild.id);
    if (!backup?.protection) return;
    const logs  = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return;
    const count = trackNukeAction(channel.guild.id, entry.executor.id);
    if (count >= 3) {
      const alertCh = channel.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildText &&
        c.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
      );
      if (alertCh) await alertCh.send({ embeds: [new EmbedBuilder()
        .setTitle(`${E.erro}  ALERTA DE NUKE!`)
        .setColor(0xe74c3c)
        .setDescription(`⚠️ **${entry.executor.tag}** deletou **${count} canais** em menos de 10s!\n\nUse **/restaurar** imediatamente!`)
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    }
  } catch (e) { console.error('[ANTI-NUKE] channelDelete:', e.message); }
});

client.on('roleDelete', async role => {
  try {
    const backup = await getBackup(role.guild.id);
    if (!backup?.protection) return;
    const logs  = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return;
    const count = trackNukeAction(role.guild.id, entry.executor.id);
    if (count >= 3) {
      const alertCh = role.guild.channels.cache.find(c => c.type === ChannelType.GuildText);
      if (alertCh) await alertCh.send({ embeds: [new EmbedBuilder()
        .setTitle(`${E.erro}  ALERTA DE NUKE!`)
        .setColor(0xe74c3c)
        .setDescription(`⚠️ **${entry.executor.tag}** deletou **${count} cargos** em menos de 10s!\n\nUse **/restaurar** imediatamente!`)
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    }
  } catch (e) { console.error('[ANTI-NUKE] roleDelete:', e.message); }
});

// ── HTTP Server (Render + UptimeRobot) ────────────────────────────────────────
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status:  'online',
    version: VERSION,
    guilds:  client.guilds?.cache?.size || 0,
    uptime:  Math.floor(process.uptime()),
  }));
}).listen(process.env.PORT || 3000, () => {
  console.log(`✅ HTTP server na porta ${process.env.PORT || 3000}`);
});

// ── Global Error Handlers ──────────────────────────────────────────────────────
client.on('error', e => console.error('❌ Client error:', e.message));
process.on('unhandledRejection', reason => console.error('❌ Unhandled rejection:', reason?.message || reason));
process.on('uncaughtException',  e      => console.error('❌ Uncaught exception:',  e?.message    || e));

// ── Startup ────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  client.login(process.env.DISCORD_TOKEN)
    .then(() => {
      console.log('✅ Discord login OK');
      setInterval(runAutoBackups, 30 * 60 * 1000);
      setInterval(async () => {
        const docs = await mongoDB.collection('premium').find({}).toArray().catch(() => []);
        for (const doc of docs) {
          if (new Date(doc.expiresAt) < new Date()) await getPremium(doc.userId);
        }
      }, 60 * 60 * 1000);
    })
    .catch(e => { console.error('❌ Discord login FALHOU:', e.message); process.exit(1); });
}).catch(e => { console.error('❌ Erro MongoDB:', e.message); process.exit(1); });
