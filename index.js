/**
 * Architect v1.8.0
 * Developed by Velroc
 * Create. Protect. Restore.
 */

const {
  Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ChannelType, AuditLogEvent,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType,
} = require('discord.js');
const fetch  = require('node-fetch');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const VERSION        = 'v2.0.0';
const MISTRAL_MODEL  = 'mistral-small-2503';

// ── Mistral Keys ───────────────────────────────────────────────────────────────
// MISTRAL_KEY_A → fila normal | MISTRAL_KEY_B → fila Premium (exclusiva)
const MISTRAL_KEYS = {
  normal:  process.env.MISTRAL_KEY_A,
  premium: process.env.MISTRAL_KEY_B,
};

if (!MISTRAL_KEYS.normal) {
  console.error('❌ MISTRAL_KEY_A não encontrada! Defina no .env.');
  process.exit(1);
}
if (!MISTRAL_KEYS.premium) {
  console.warn('⚠️  MISTRAL_KEY_B não encontrada — Premium usará a fila normal.');
  MISTRAL_KEYS.premium = MISTRAL_KEYS.normal;
}
console.log(`✅ Filas Mistral ativas: Normal (KEY_A) | Premium (KEY_B)`);

// ── Sistema de 2 Filas ────────────────────────────────────────────────────────
const SECS_PER_GENERATION = 12;

const lanes = {
  normal:  { name: 'normal',  busy: false, queue: [], lastRun: 0 },
  premium: { name: 'premium', busy: false, queue: [], lastRun: 0 },
};

function getLane(isPremium) {
  return isPremium ? lanes.premium : lanes.normal;
}

function getLaneName(isPremium) {
  return isPremium ? 'premium' : 'normal';
}

function getQueueStatus(userId, isPremium) {
  const lane = getLane(isPremium);
  const idx  = lane.queue.findIndex(e => e.userId === userId);
  if (idx === -1) return null;
  const secsAhead = (lane.busy ? SECS_PER_GENERATION : 0) + idx * SECS_PER_GENERATION;
  return { lane: lane.name, position: idx + 1, secsAhead };
}

async function broadcastQueueUpdate(laneName) {
  const lane = lanes[laneName];
  for (let i = 0; i < lane.queue.length; i++) {
    const entry     = lane.queue[i];
    const secsAhead = (lane.busy ? SECS_PER_GENERATION : 0) + i * SECS_PER_GENERATION;
    try {
      await entry.interaction.editReply({
        embeds: [buildQueueEmbed(entry.prompt, lane.name, i + 1, secsAhead)],
      }).catch(() => {});
    } catch (_) {}
  }
}

async function processLane(laneName) {
  const lane = lanes[laneName];
  if (lane.busy || lane.queue.length === 0) return;
  lane.busy = true;

  const entry = lane.queue.shift();
  await broadcastQueueUpdate(laneName);

  // Timeout de segurança — se a task travar por mais de 120s, desbloqueamos a lane
  let taskDone = false;
  const safetyTimeout = setTimeout(() => {
    if (!taskDone) {
      console.error(`[LANE/${laneName}] ⚠️ Timeout de segurança acionado — lane desbloqueada forçadamente.`);
      entry.reject(new Error('Timeout de segurança da lane.'));
      lane.busy = false;
      processLane(laneName);
    }
  }, 120_000);

  try { entry.resolve(await entry.task()); }
  catch (e) { entry.reject(e); }
  finally {
    taskDone = true;
    clearTimeout(safetyTimeout);
    const elapsed = Date.now() - lane.lastRun;
    const wait    = Math.max(0, 1100 - elapsed);
    await new Promise(r => setTimeout(r, wait));
    lane.lastRun = Date.now();
    lane.busy    = false;
    processLane(laneName);
  }
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
          .setDescription(`Seu plano **${doc.plan}** do Architect expirou.\n\nPara renovar, entre em contato com a equipe Velroc.`)
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

// ── Daily Creation Limit (usuários normais) ────────────────────────────────────
const DAILY_LIMIT_NORMAL = 3;

function getTodayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function getDailyUsage(userId) {
  if (!mongoDB) return 0;
  const today = getTodayKey();
  const doc = await mongoDB.collection('daily_usage').findOne({ userId, date: today });
  return doc?.count || 0;
}

async function incrementDailyUsage(userId) {
  if (!mongoDB) return;
  const today = getTodayKey();
  await mongoDB.collection('daily_usage').updateOne(
    { userId, date: today },
    { $inc: { count: 1 } },
    { upsert: true }
  );
}

async function trackCommandUsage(userId, commandName, isPremium) {
  if (!mongoDB) return;
  const today = getTodayKey();
  await mongoDB.collection('command_usage').updateOne(
    { date: today },
    {
      $addToSet: { [`users_${isPremium ? 'premium' : 'normal'}`]: userId },
      $inc:      { [`cmd_${commandName}`]: 1, total_commands: 1 },
      $set:      { date: today },
    },
    { upsert: true }
  );
}

async function checkDailyLimit(userId, isPremium) {
  if (isPremium) return { allowed: true };
  const used = await getDailyUsage(userId);
  if (used >= DAILY_LIMIT_NORMAL) {
    return { allowed: false, used, limit: DAILY_LIMIT_NORMAL };
  }
  return { allowed: true, used, limit: DAILY_LIMIT_NORMAL };
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
async function _mistralFetch(laneName, messages, maxTokens, retries, parseJson) {
  const key = MISTRAL_KEYS[laneName] || MISTRAL_KEYS.normal;
  if (!key) { console.error(`[MISTRAL/${laneName}] Chave não definida!`); throw new Error('Chave Mistral não configurada.'); }
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[MISTRAL/${laneName}] Tentativa ${attempt}/${retries}...`);
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MISTRAL_MODEL, max_tokens: maxTokens, temperature: 0.4, messages }),
        signal: AbortSignal.timeout(90000),
      });
      console.log(`[MISTRAL/${laneName}] HTTP ${res.status}`);

      if (res.status === 429) {
        const wait = parseInt(res.headers.get('retry-after') || '5', 10) * 1000;
        console.warn(`[MISTRAL/${laneName}] 429 — aguardando ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`Mistral HTTP ${res.status}: ${await res.text()}`);

      const data = await res.json();
      const content = (data.choices?.[0]?.message?.content || '').trim();

      if (!parseJson) return content; // texto puro

      // Remove markdown code fences
      let raw = content
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/gi, '').trim();

      // Detecta se é array ou objeto
      const isArr = raw.trimStart().startsWith('[');
      const open  = isArr ? '[' : '{';
      const close = isArr ? ']' : '}';
      const s = raw.indexOf(open);
      const e = raw.lastIndexOf(close);

      if (s === -1 || e === -1 || e <= s) {
        console.error(`[MISTRAL/${laneName}] JSON não encontrado. Raw: ${raw.substring(0, 200)}`);
        throw new Error('IA retornou JSON inválido. Tente novamente.');
      }

      try {
        return JSON.parse(raw.substring(s, e + 1));
      } catch (parseErr) {
        console.error(`[MISTRAL/${laneName}] JSON parse falhou:`, parseErr.message, '| Raw:', raw.substring(s, Math.min(s + 300, e + 1)));
        throw new Error('IA retornou JSON inválido. Tente novamente.');
      }

    } catch (err) {
      console.error(`[MISTRAL/${laneName}] Tentativa ${attempt}/${retries}:`, err.message);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

async function callMistralRaw(laneName, messages, maxTokens = 8000, retries = 4) {
  return _mistralFetch(laneName, messages, maxTokens, retries, true);
}

async function callMistralText(laneName, messages, maxTokens = 300, retries = 3) {
  return _mistralFetch(laneName, messages, maxTokens, retries, false);
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
async function generateStructure(prompt, onLog, isPremium = false) {
  const laneName = getLaneName(isPremium);
  prompt = prompt.replace(/"/g, "'").replace(/`/g, "'");

  await onLog(E.loading, 'ANÁLISE',  `Interpretando prompt${isPremium ? ' (Premium ✨)' : ''}...`);
  await onLog(E.loading, 'MISTRAL',  `Conectando via Fila ${isPremium ? 'Premium' : 'Normal'}...`);

  // ── ETAPA 1: Cargos ─────────────────────────────────────────────────────────
  await onLog(E.cargos, 'CARGOS', 'Gerando hierarquia de cargos...');
  const minRoles = isPremium ? 18 : 8;
  const maxRoles = isPremium ? 30 : 14;

  const rolesMsg = isPremium
    ? `You are a senior Discord community architect with 10+ years of experience designing large-scale, professional Discord servers for brands, esports organizations, and communities with 100k+ members. Your role hierarchies are indistinguishable from those built by expert human admins.

MANDATORY RULES — violating any rule makes the output invalid:
- Return ONLY a raw valid JSON array. No markdown, no backticks, no explanation, no extra text.
- Write ALL role names in Brazilian Portuguese with correct accents and appropriate emojis.
- Generate between ${minRoles} and ${maxRoles} roles — never fewer.
- Every role MUST have a unique, thematically coherent hex color (no two roles the same color).
- hoist:true for all staff, ownership, and highlighted community tiers.
- mentionable:true only for staff and important community roles.
- Permissions MUST be realistic and granular per role tier.
- Permissions array must only contain values from: ADMINISTRATOR, MANAGE_GUILD, MANAGE_CHANNELS, MANAGE_ROLES, KICK_MEMBERS, BAN_MEMBERS, SEND_MESSAGES, VIEW_CHANNEL, MANAGE_MESSAGES.

REQUIRED ROLE STRUCTURE (adapt names/emojis to the server theme):
1. OWNERSHIP TIER (1-2 roles): Full admin. Color: gold/premium tones.
2. SENIOR STAFF TIER (2-3 roles): Co-owners, directors. ADMINISTRATOR or MANAGE_GUILD.
3. MODERATION TIER (3-4 roles): Head Mod, Moderator, Trial Mod. Graduated permissions.
4. SUPPORT/STAFF TIER (2-3 roles): Support, Helper, Event Staff.
5. COMMUNITY HIGHLIGHT ROLES (3-5 roles): VIP, Booster, Veteran, Active Member. Thematic and unique.
6. MEMBER TIER (2-3 roles): Verified member, Newcomer/Pending.
7. SPECIAL ROLES (2-4 roles): Partner, Content Creator, Bot, Muted. Always include bot and muted.
8. THEMED ROLES (2-5 roles): Deeply specific to the server theme — creative, unique, realistic.

QUALITY STANDARDS:
- Role names must feel authentic, not generic. Use theme-appropriate terminology.
- Colors: ownership = warm gold/yellow, staff = red/orange, mods = blue/teal, community = purple/green, members = grey/white, special = unique accent.
- No two roles share the same color. Create a beautiful, visually distinct hierarchy.
- Permissions must be correctly scoped — never give ADMINISTRATOR to non-ownership roles.`
    : `You are an expert Discord server architect. Generate a complete, realistic role hierarchy for a Discord server.
RULES:
- Return ONLY a valid JSON array, no markdown, no explanation.
- Write role names in Brazilian Portuguese with correct accents.
- Generate between ${minRoles} and ${maxRoles} roles.
- Every role MUST have a unique hex color.
- Include: 1 owner role, 2 staff roles, 2 member tiers, 1 bot role, 1 muted role, theme-specific roles.
- Permissions must be realistic per role type.
- Permissions array must only contain: ADMINISTRATOR, MANAGE_GUILD, MANAGE_CHANNELS, MANAGE_ROLES, KICK_MEMBERS, BAN_MEMBERS, SEND_MESSAGES, VIEW_CHANNEL, MANAGE_MESSAGES.`;

  const rolesUserPrompt = isPremium
    ? `Server description: "${prompt}"

Before generating, think step by step:
1. What is this server's purpose and culture?
2. What staff hierarchy does it need?
3. What community roles would make members feel valued?
4. What themed roles are unique to this specific server?

Now generate a world-class, professional role hierarchy. Every role must serve a clear function and feel crafted by a real, experienced Discord admin.

Return ONLY a JSON array (no markdown, no backticks):
[{"name":"👑 Proprietário","color":"#f1c40f","hoist":true,"mentionable":false,"permissions":["ADMINISTRATOR"]},{"name":"🔇 Silenciado","color":"#636e72","hoist":false,"mentionable":false,"permissions":[]}]

Generate ALL ${minRoles}-${maxRoles} roles. Return only the raw JSON array.`
    : `Server description: "${prompt}"\n\nReturn a JSON array:\n[{"name":"👑 Dono","color":"#f1c40f","hoist":true,"mentionable":false,"permissions":["ADMINISTRATOR"]},{"name":"🔇 Mutado","color":"#7f8c8d","hoist":false,"mentionable":false,"permissions":[]}]\nGenerate ALL roles. Return only the JSON array.`;

  const roles = await callMistralRaw(laneName, [
    { role: 'system', content: rolesMsg },
    { role: 'user',   content: rolesUserPrompt },
  ]);

  if (!Array.isArray(roles) || roles.length === 0)
    throw new Error('A IA não retornou cargos válidos. Tente novamente com um prompt diferente.');

  const count = roles.length;
  await onLog(E.sucesso, 'CARGOS', `${count} cargo(s) gerado(s)`);
  const roleNames = roles.map(r => r.name).join(', ');

  // ── ETAPA 1.5 (Premium): Refinamento de Paleta de Cores ─────────────────────
  if (isPremium) {
    try {
      await onLog(E.loading, 'PALETA', 'Refinando paleta de cores dos cargos...');
      const paletteMsg = `You are a professional UI/UX designer specializing in Discord server aesthetics. You will receive a list of Discord roles and must assign each role a visually perfect, unique hex color.

RULES:
- Return ONLY a raw valid JSON array. No markdown, no backticks, no explanation.
- Every role MUST get a unique hex color — absolutely no duplicates.
- Colors must form a beautiful visual hierarchy from top (ownership) to bottom (muted).
- Ownership roles: rich gold/amber tones (#f1c40f, #e67e22, #d4ac0d range).
- Senior staff: deep red/crimson (#e74c3c, #c0392b range).
- Moderation: bold blue/indigo (#3498db, #2980b9, #5865f2 range).
- Support/helpers: teal/cyan (#1abc9c, #16a085 range).
- Community highlights: vibrant purple/violet (#9b59b6, #8e44ad range).
- Regular members: soft grey/silver (#95a5a6, #bdc3c7 range).
- Special/bot roles: unique accent (varies per role).
- Muted: dark grey (#636e72, #7f8c8d range).
- Themed roles: pick colors deeply fitting to the server's theme.
- The final palette must look stunning as a whole — like it was designed by a professional.`;

      const paletteUser = `Server: "${prompt}"
Current roles: ${JSON.stringify(roles.map(r => ({ name: r.name })))}

Assign a unique, beautiful, thematically appropriate hex color to every single role. Return ONLY a JSON array in this format:
[{"name":"👑 Proprietário","color":"#f1c40f"},{"name":"🔇 Silenciado","color":"#636e72"}]

Return ALL ${roles.length} roles with their refined colors. Raw JSON array only.`;

      const refinedColors = await callMistralRaw(laneName, [
        { role: 'system', content: paletteMsg },
        { role: 'user',   content: paletteUser },
      ], 4000);

      if (Array.isArray(refinedColors)) {
        const colorMap = new Map(refinedColors.map(r => [r.name, r.color]));
        for (const role of roles) {
          const refined = colorMap.get(role.name);
          if (refined && /^#[0-9A-Fa-f]{6}$/.test(refined)) role.color = refined;
        }
        await onLog(E.sucesso, 'PALETA', 'Paleta de cores refinada com sucesso');
      }
    } catch (e) {
      console.error('[PALETA] Falhou (não crítico):', e.message);
      await onLog(E.aguardando, 'PALETA', 'Paleta padrão mantida');
    }
  }

  // ── ETAPA 2: Categorias & Canais ─────────────────────────────────────────────
  await onLog(E.canais, 'ESTRUTURA', 'Projetando categorias e canais...');
  const minCats     = isPremium ? 8 : 5;
  const minChannels = isPremium ? 5  : 3;

  const catsMsg = isPremium
    ? `You are a senior Discord community architect with 10+ years of experience building large-scale professional servers. You design server structures that are intuitive, beautiful, and functionally perfect — indistinguishable from those built by the world's best Discord admins.

MANDATORY RULES — violating any rule makes the output invalid:
- Return ONLY a raw valid JSON array. No markdown, no backticks, no explanation, no comments.
- Write ALL names in Brazilian Portuguese with correct accents and fitting emojis.
- Generate between ${minCats} and 14 categories — never fewer than ${minCats}.
- Each category MUST have at least ${minChannels} channels — never fewer. Aim for 5-8 channels per category.
- STRICTLY generate ONLY the categories that the server actually needs. NEVER invent extra categories.
- Use a rich variety of channel types: text, voice, forum, announcement, stage.
- NEVER lock or add permission restrictions to channels by default. All channels open to members.
- Role names MUST be clearly role-like. NEVER name a role after a channel or category.
- nsfw must always be false unless the server is explicitly adult-themed.
- Channel topics must be concise (1-2 sentences max per channel). Do NOT write long paragraphs — short and descriptive only.
- Every text channel must have a slowmode (rateLimitPerUser) appropriate to its purpose:
  - General/social channels: 5 seconds
  - Support/ticket channels: 10 seconds
  - Announcement channels: 0 seconds (no slowmode)
  - Meme/media channels: 10 seconds
  - Bot command channels: 3 seconds
  - Voice channels: always 0

CATEGORY NAME STYLE — pick exactly ONE and use on EVERY category:
- Style A: ╭──── EMOJI ✦ NAME  (ex: ╭──── ⛺ ✦ Importante)
- Style B: ➢ NAME IN CAPS  (ex: ➢ CONFIGURAÇÕES)
- Style C: ╭⎯⎯⎯╴ ✦ EMOJI NAME  (ex: ╭⎯⎯⎯╴ ✦ 🍫 Inicio)
Choose based on server theme. NEVER mix styles.

CHANNEL NAME STYLE — pick exactly ONE and use on EVERY channel:
- Style 1: EMOJI┃channel-name  (ex: 💬┃chat-geral)
- Style 2: 「EMOJI」channel-name  (ex: 「💬」chat-geral)
- Style 3: EMOJI╺╸channel-name  (ex: 💬╺╸chat-geral)
No spaces around separators. Channel names: lowercase-with-hyphens only. NEVER mix styles.

CHANNEL TOPIC STANDARDS (critical for Premium quality):
- Announcement channels: explain what gets posted here, who can post, how often.
- Rules channel: write 5-7 actual numbered rules appropriate to the server's theme and culture.
- General chat: explain the vibe, what's welcome, what's not.
- Support channels: explain how to get help, response time expectations, what info to provide.
- Introduction channels: give a template (Name, Age, Interests, How you found the server).
- Voice channels: explain the purpose, etiquette, who can join.
- Every topic must be 2-4 sentences. Never generic. Always specific to this server.

REQUIRED CATEGORY STRUCTURE:
1. INFORMATION HUB: announcements, rules, FAQ, server-guide, partnerships.
2. WELCOME/ONBOARDING: welcome, introductions, role-selection.
3. STAFF/MANAGEMENT ZONE: staff-only, mod-log, ban-appeals, suggestions-review.
4. MAIN COMMUNITY AREA: general chat, off-topic, media, memes, bot commands.
5. VOICE & ACTIVITY: multiple themed voice rooms, AFK, music, study.
6-8. THEME-SPECIFIC AREAS: 3 deeply specific areas to the server niche.
9. SUPPORT/HELPDESK: tickets, support, FAQ, known issues.
10. EVENTS & SPECIALS: giveaways, tournaments, event announcements.`
    : `You are an expert Discord server architect. Design a complete, detailed Discord server structure.
MANDATORY RULES:
- Return ONLY a valid JSON array, no markdown, no explanation.
- Write names in Brazilian Portuguese with correct accents.
- Generate at minimum ${minCats} categories. Only create categories that make sense for this server.
- Each category MUST have at least ${minChannels} channels.
- Include variety: text, voice, forum, announcement, stage channels.
- NEVER lock or restrict channels by default.
- Role names must NEVER match channel or category names.
- nsfw: false on all channels.
- rateLimitPerUser: 5 on general channels, 10 on support/media, 0 on announcements and voice.
- Pick ONE category style (A, B, or C) and ONE channel style (1, 2, or 3). Never mix.
  Category A: ╭──── EMOJI ✦ NAME  |  B: ➢ NAME  |  C: ╭⎯⎯⎯╴ ✦ EMOJI NAME
  Channel 1: EMOJI┃name  |  2: 「EMOJI」name  |  3: EMOJI╺╸name
- allowedRoles must reference role names from the actual role list. Never empty.`;

  const catsUserPrompt = isPremium
    ? `Server description: "${prompt}"
Available roles: ${roleNames}

Before generating, think step by step:
1. What is the server's core purpose and who is its audience?
2. What categories does this community genuinely need?
3. What channel names and topics would feel authentic to this community?
4. Which category style (A/B/C) and channel style (1/2/3) fits this server's vibe best?

Now design a complete, professional Discord server structure. Generate ONLY the categories this server needs. Every channel topic must be specific, detailed, and authentic — not generic boilerplate.

Apply ONE category style and ONE channel style consistently throughout. Never mix.
NEVER lock channels. NEVER name roles after channels. nsfw: false on all channels.
Apply appropriate rateLimitPerUser to every channel (0 for announcements/voice, 3-10 for text channels).

Return ONLY a raw JSON array (no markdown, no backticks):
[{"name":"╭──── ⛺ ✦ Informações","allowedRoles":["👑 Proprietário","✅ Membro Verificado"],"channels":[{"name":"📢┃anuncios-oficiais","type":"announcement","topic":"Canal reservado para comunicados oficiais da equipe administrativa. Somente a staff possui permissão para publicar aqui. Fique atento a este canal para não perder atualizações importantes sobre o servidor.","allowedRoles":["👑 Proprietário","✅ Membro Verificado"],"rateLimitPerUser":0,"nsfw":false},{"name":"📋┃regras-e-conduta","type":"text","topic":"Leia e respeite as regras antes de participar. O descumprimento resultará em punições.","allowedRoles":["👑 Proprietário","✅ Membro Verificado"],"rateLimitPerUser":0,"nsfw":false}]}]

Generate ALL ${minCats}-14 categories, each with ${minChannels}+ channels. Return only the raw JSON array.`
    : `Server: "${prompt}"\nRoles: ${roleNames}\n\nReturn JSON array:\n[{"name":"╭──── ⛺ ✦ Informações","allowedRoles":["👑 Dono","✅ Membro"],"channels":[{"name":"📢┃anuncios","type":"announcement","topic":"Anúncios oficiais do servidor.","allowedRoles":["👑 Dono","✅ Membro"],"rateLimitPerUser":0,"nsfw":false},{"name":"📋┃regras","type":"text","topic":"Regras do servidor.","allowedRoles":["👑 Dono","✅ Membro"],"rateLimitPerUser":0,"nsfw":false}]}]\nEach category needs at least ${minChannels} channels. Return only the JSON array.`;

  const categories = await callMistralRaw(laneName, [
    { role: 'system', content: catsMsg },
    { role: 'user',   content: catsUserPrompt },
  ], isPremium ? 16000 : 8000);

  if (!Array.isArray(categories) || categories.length === 0)
    throw new Error('A IA não retornou categorias válidas. Tente novamente com um prompt diferente.');

  const totalChannels = categories.reduce((a, c) => a + (c.channels?.length || 0), 0);
  await onLog(E.sucesso, 'ESTRUTURA', `${categories.length} categoria(s) · ${totalChannels} canal(is)`);

  // ── ETAPA 3 (Premium): Regras do Servidor ───────────────────────────────────
  let serverRules = '';
  if (isPremium) {
    try {
      await onLog(E.loading, 'REGRAS', 'Redigindo regras do servidor...');
      const rulesMsg = `You are a professional Discord community manager. Write a complete, professional server ruleset in Brazilian Portuguese. The rules must feel authentic, specific to the server's theme, and cover all important aspects of community conduct. Plain text only, no JSON, no markdown headers.`;
      const rulesUser = `Write a complete ruleset for this Discord server: "${prompt}"

The rules must:
- Be numbered from 1 to 10
- Start with the most fundamental rules (respect, no harassment)
- Include rules specific to this server's theme and community
- Cover: conduct, content, spam, staff authority, consequences
- Each rule should have a short title in bold and a 1-2 sentence explanation
- End with a note about consequences and appeals
- Tone: firm but welcoming, like a well-run professional community`;
      serverRules = await callMistralText(laneName, [
        { role: 'system', content: rulesMsg },
        { role: 'user',   content: rulesUser },
      ], 800);
      await onLog(E.sucesso, 'REGRAS', 'Regras geradas com sucesso');

      // Inject rules into the rules channel topic if it exists
      for (const cat of categories) {
        for (const ch of cat.channels || []) {
          const nm = ch.name.toLowerCase();
          if (nm.includes('regra') || nm.includes('rule')) {
            ch.topic = serverRules.substring(0, 1024);
          }
        }
      }
    } catch (e) {
      console.error('[REGRAS] Falhou (não crítico):', e.message);
      await onLog(E.aguardando, 'REGRAS', 'Ignoradas (erro não crítico)');
    }
  }

  // ── ETAPA 4 (Premium): Descrição/Banner do Servidor ─────────────────────────
  let serverDescription = '';
  if (isPremium) {
    try {
      await onLog(E.loading, 'DESCRIÇÃO', 'Criando descrição do servidor...');
      const descMsg = `You are a professional copywriter specializing in Discord communities. Write a short, punchy, and memorable server description in Brazilian Portuguese. Maximum 100 characters. No hashtags. No emojis at the start. It must feel premium, specific, and compelling — like a tagline.`;
      const descUser = `Write a compelling server description (max 100 chars) for: "${prompt}"`;
      serverDescription = await callMistralText(laneName, [
        { role: 'system', content: descMsg },
        { role: 'user',   content: descUser },
      ], 120);
      await onLog(E.sucesso, 'DESCRIÇÃO', 'Descrição do servidor criada');
    } catch (e) {
      console.error('[DESCRIÇÃO] Falhou (não crítico):', e.message);
    }
  }

  // ── ETAPA 5: Boas-vindas ─────────────────────────────────────────────────────
  let welcomeMessage = '';
  try {
    await onLog(E.loading, 'BOAS-VINDAS', 'Redigindo mensagem de boas-vindas...');
    const wSystem = isPremium
      ? `You are a professional community manager and copywriter specializing in Discord communities. Write a stunning, engaging welcome message in Brazilian Portuguese. The message must feel warm, professional, and genuinely exciting — like it was written by a real, passionate community manager. Use Discord markdown formatting (bold, italic) tastefully. Plain text only, no JSON.`
      : `Write a short, friendly Discord welcome message in Brazilian Portuguese. Plain text only, no JSON, no markdown.`;
    const wUser = isPremium
      ? `Write a captivating welcome message for: "${prompt}". 5-7 lines. Include: warm greeting, what the server is about, 2-3 first steps for new members (read rules, introduce yourself, get roles), enthusiastic call-to-action. Human, genuine, exciting — not robotic.`
      : `Welcome message for: "${prompt}". 3-4 lines, warm and inviting.`;
    welcomeMessage = await callMistralText(laneName, [
      { role: 'system', content: wSystem },
      { role: 'user',   content: wUser },
    ], isPremium ? 500 : 300);
    await onLog(E.sucesso, 'BOAS-VINDAS', 'Mensagem gerada com sucesso');
  } catch (e) {
    console.error('[BOAS-VINDAS] Falhou:', e.message);
    await onLog(E.aguardando, 'BOAS-VINDAS', 'Ignorada (erro não crítico)');
  }

  await onLog(E.sucesso, 'CONCLUÍDO', 'Estrutura pronta — aguardando confirmação');
  return { roles, categories, welcomeMessage: welcomeMessage || '', serverDescription: serverDescription || '' };
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
        description:                structure.server.description || structure.serverDescription || null,
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
    const validRoles = allowedRoles.map(n => createdRoles.get(n)).filter(Boolean);
    // Se nenhuma role válida encontrada, não aplica overwrites — canal fica aberto
    if (validRoles.length === 0) return [];
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ];
    for (const role of validRoles) {
      overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
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
            nsfw:                 false,
            rateLimitPerUser:     (type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice) ? 0 : (ch.rateLimitPerUser || 0),
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
  const isPrem    = laneName === 'premium';
  const laneEmoji = isPrem ? '👑' : '🟦';
  const laneLabel = isPrem ? 'Premium' : 'Normal';
  const bar = (() => {
    const maxDisplay = 10;
    const filled = Math.max(0, maxDisplay - Math.min(position - 1, maxDisplay));
    return `\`[${'█'.repeat(filled)}${'░'.repeat(maxDisplay - filled)}]\``;
  })();

  const normalQ  = lanes.normal.queue.filter(e => e.userId !== null).length;
  const premiumQ = lanes.premium.queue.filter(e => e.userId !== null).length;
  const laneStatus =
    `🟦 **Fila Normal** ${lanes.normal.busy ? '⚙️' : '✅'} — ${normalQ} aguardando\n` +
    `👑 **Fila Premium** ${lanes.premium.busy ? '⚙️' : '✅'} — ${premiumQ} aguardando`;

  return new EmbedBuilder()
    .setTitle(`${E.aguardando}  Na Fila — Fila ${laneLabel}`)
    .setColor(isPrem ? 0x9b59b6 : 0xf39c12)
    .setDescription(`> ${E.loading} Sua geração está enfileirada. Aguarde sua vez!\n> \`\`\`${prompt.substring(0, 60)}\`\`\``)
    .addFields(
      { name: `${laneEmoji} Sua Fila`,            value: `**Fila ${laneLabel}**`,        inline: true },
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
    .map((l, i, arr) => i === arr.length - 1
      ? `\`[${l.tag}]\` ${E.loading} **${l.msg}**`
      : `\`[${l.tag}]\` ${E.check} ${l.msg}`
    ).join('\n')
    || `\`[INIT]\` ${E.loading} Iniciando análise...`;

  const lastTag = logs.length > 0 ? logs[logs.length - 1].tag : '';
  const done = lastTag === 'CONCLUÍDO';
  return new EmbedBuilder()
    .setTitle(done ? `${E.sucesso}  Análise Concluída` : `${E.loading}  Gerando Servidor...`)
    .setColor(done ? 0x2ecc71 : 0xf39c12)
    .addFields(
      { name: `${E.config} Prompt`,               value: `\`\`\`${prompt.substring(0, 200)}\`\`\`` },
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
    { text: 'Building your server...', type: ActivityType.Watching },
    { text: 'Protecting your community', type: ActivityType.Watching },
    { text: 'Restoring after nukes', type: ActivityType.Watching },
  ];
  let si = 0;
  const tick = () => {
    client.user.setPresence({
      status: 'online',
      activities: [{ name: statuses[si].text, type: statuses[si].type }],
    });
    si = (si + 1) % statuses.length;
  };
  tick(); setInterval(tick, 10000);

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
    new SlashCommandBuilder().setName('usuarios').setDescription('Estatísticas de uso do Architect hoje').addStringOption(o => o.setName('data').setDescription('Data no formato YYYY-MM-DD (padrão: hoje)').setRequired(false)),
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

  // Rastreia uso do comando
  const _isPremiumUser = await isUserPremium(interaction.user.id);
  trackCommandUsage(interaction.user.id, commandName, _isPremiumUser).catch(() => {});

  // ── /criar_servidor ──────────────────────────────────────────────────────────
  if (commandName === 'criar_servidor') {
    const prompt    = interaction.options.getString('prompt');
    const userId    = interaction.user.id;
    const isPremium = await isGuildOwnerPremium(guild);

    // ── Limite diário para usuários normais ──────────────────────────────────
    const limitCheck = await checkDailyLimit(userId, isPremium);
    if (!limitCheck.allowed) {
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.erro}  Limite Diário Atingido`)
        .setColor(0xe74c3c)
        .setDescription(`Você já usou suas **${limitCheck.limit} criações gratuitas** de hoje.\n\n> Volte amanhã ou adquira o ${E.premium} **Premium** para criações ilimitadas!`)
        .addFields({ name: '📊 Uso hoje', value: `${limitCheck.used}/${limitCheck.limit} criações`, inline: true })
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()], ephemeral: true });
    }

    await interaction.deferReply();

    // Escolhe a lane correta conforme Premium ou Normal
    const chosenLane = getLane(isPremium);
    const posInLane  = chosenLane.queue.length + (chosenLane.busy ? 1 : 0);
    const secsAhead  = (chosenLane.busy ? SECS_PER_GENERATION : 0) + posInLane * SECS_PER_GENERATION;

    if (posInLane > 0) {
      await interaction.editReply({ embeds: [buildQueueEmbed(prompt, chosenLane.name, posInLane + 1, secsAhead)] });
    } else {
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, [])] });
    }

    const logs  = [];
    let generationStarted = false;

    const onLog = async (icon, tag, msg) => {
      logs.push({ icon, tag, msg });
      console.log(`[${tag}] ${msg}`);
      // Atualiza o embed de análise em tempo real durante a geração
      if (generationStarted) {
        await interaction.editReply({
          embeds: [buildAnalysisEmbed(prompt, logs)],
        }).catch(() => {});
      }
    };

    // Inicia atualização de ETA em tempo real enquanto está na fila (antes de começar a gerar)
    let etaInterval = null;
    if (posInLane > 0) {
      let elapsed = 0;
      etaInterval = setInterval(async () => {
        // Para assim que a geração começar
        if (generationStarted) { clearInterval(etaInterval); etaInterval = null; return; }
        elapsed++;
        const status = getQueueStatus(userId, isPremium);
        if (!status) { clearInterval(etaInterval); etaInterval = null; return; }
        const remaining = Math.max(0, status.secsAhead - elapsed);
        await interaction.editReply({
          embeds: [buildQueueEmbed(prompt, status.lane, status.position, remaining)],
        }).catch(() => {});
      }, 1000);
    }

    try {
      const structure = await new Promise((resolve, reject) => {
        chosenLane.queue.push({
          task: async () => {
            // Marca que saiu da fila e começou a gerar — para o etaInterval
            generationStarted = true;
            if (etaInterval) { clearInterval(etaInterval); etaInterval = null; }
            await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, logs)] }).catch(() => {});
            // Registra uso diário (apenas para não-premium)
            if (!isPremium) await incrementDailyUsage(userId);
            return generateStructure(prompt, onLog, isPremium);
          },
          resolve, reject,
          userId, interaction, prompt,
          addedAt: Date.now(),
        });
        processLane(chosenLane.name);
      });

      if (etaInterval) { clearInterval(etaInterval); etaInterval = null; }
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

    // ── Limite diário para usuários normais ──────────────────────────────────
    const limitCheck = await checkDailyLimit(userId, isPremium);
    if (!limitCheck.allowed) {
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.erro}  Limite Diário Atingido`)
        .setColor(0xe74c3c)
        .setDescription(`Você já usou suas **${limitCheck.limit} criações gratuitas** de hoje.\n\n> Volte amanhã ou adquira o ${E.premium} **Premium** para criações ilimitadas!`)
        .addFields({ name: '📊 Uso hoje', value: `${limitCheck.used}/${limitCheck.limit} criações`, inline: true })
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()], ephemeral: true });
    }

    await interaction.deferReply();

    const chosenLane = getLane(isPremium);
    const posInLane  = chosenLane.queue.length + (chosenLane.busy ? 1 : 0);
    const secsAhead  = (chosenLane.busy ? SECS_PER_GENERATION : 0) + posInLane * SECS_PER_GENERATION;

    if (posInLane > 0) {
      await interaction.editReply({ embeds: [buildQueueEmbed(prompt, chosenLane.name, posInLane + 1, secsAhead)] });
    } else {
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, [])] });
    }

    const logs  = [];
    let generationStartedT = false;

    const onLog = async (icon, tag, msg) => {
      logs.push({ icon, tag, msg });
      console.log(`[${tag}] ${msg}`);
      if (generationStartedT) {
        await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, logs)] }).catch(() => {});
      }
    };

    let etaInterval = null;
    if (posInLane > 0) {
      let elapsed = 0;
      etaInterval = setInterval(async () => {
        if (generationStartedT) { clearInterval(etaInterval); etaInterval = null; return; }
        elapsed++;
        const status = getQueueStatus(userId, isPremium);
        if (!status) { clearInterval(etaInterval); etaInterval = null; return; }
        const remaining = Math.max(0, status.secsAhead - elapsed);
        await interaction.editReply({
          embeds: [buildQueueEmbed(prompt, status.lane, status.position, remaining)],
        }).catch(() => {});
      }, 1000);
    }

    try {
      const structure = await new Promise((resolve, reject) => {
        chosenLane.queue.push({
          task: async () => {
            generationStartedT = true;
            if (etaInterval) { clearInterval(etaInterval); etaInterval = null; }
            await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, logs)] }).catch(() => {});
            // Registra uso diário (apenas para não-premium)
            if (!isPremium) await incrementDailyUsage(userId);
            return generateStructure(prompt, onLog, isPremium);
          },
          resolve, reject,
          userId, interaction, prompt,
          addedAt: Date.now(),
        });
        processLane(chosenLane.name);
      });

      if (etaInterval) { clearInterval(etaInterval); etaInterval = null; }
      await interaction.editReply({ embeds: [buildAnalysisEmbed(prompt, logs)] });

      const confirmId = `${interaction.id}`;
      pendingCreate.set(confirmId, { prompt, structure });
      await interaction.editReply({
        embeds:     [buildConfirmEmbed(prompt, structure, 60)],
        components: [buildConfirmRow(confirmId)],
      });
      startCountdown(interaction, confirmId, prompt, structure, tipo);
    } catch (e) {
      if (etaInterval) { clearInterval(etaInterval); etaInterval = null; }
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
        { name: '👨‍💻 Dev',                value: 'Velroc',                         inline: true },
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
        { name: '👨‍💻 Dev',                    value: 'Velroc',                                                           inline: true },
        { name: `${E.servidores} Servidores`, value: String(client.guilds.cache.size),                                      inline: true },
        { name: '⏱️ Uptime',                  value: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`, inline: true },
        { name: '⚡ Stack',                   value: 'Discord.js v14 + Groq AI',                                          inline: true },
        { name: '📦 Versão',                  value: VERSION,                                                               inline: true },
        { name: `${E.loading} Filas`,          value: `Normal: ${lanes.normal.queue.filter(e=>e.userId).length} | Premium: ${lanes.premium.queue.filter(e=>e.userId).length} aguardando`, inline: true },
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
          .setTitle('📢  Mensagem Oficial da Velroc')
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
        .setDescription('Seu acesso Premium ao Architect foi removido pela equipe Velroc.')
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

  // ── /usuarios ────────────────────────────────────────────────────────────────
  else if (commandName === 'usuarios') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const dataParam = interaction.options.getString('data');
      const today     = dataParam || getTodayKey();

      const usageDoc  = await mongoDB.collection('command_usage').findOne({ date: today });
      const dailyDocs = await mongoDB.collection('daily_usage').find({ date: today }).toArray();
      const premDocs  = await mongoDB.collection('premium').find({}).toArray();
      const activePremium = premDocs.filter(d => new Date(d.expiresAt) > new Date());

      const usersNormal  = new Set(usageDoc?.users_normal  || []);
      const usersPremium = new Set(usageDoc?.users_premium || []);
      const totalUsers   = new Set([...usersNormal, ...usersPremium]);

      const totalCmds    = usageDoc?.total_commands || 0;
      const criacoes     = dailyDocs.reduce((a, d) => a + (d.count || 0), 0);

      // Top 5 comandos mais usados
      const cmdEntries = Object.entries(usageDoc || {})
        .filter(([k]) => k.startsWith('cmd_'))
        .map(([k, v]) => ({ name: k.replace('cmd_', '/'), count: v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const topCmdsText = cmdEntries.length
        ? cmdEntries.map((c, i) => `\`${i + 1}.\` **${c.name}** — ${c.count}x`).join('\n')
        : 'Nenhum comando registrado';

      const [year, month, day] = today.split('-');
      const dateFormatted = `${day}/${month}/${year}`;

      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setTitle(`${E.membros}  Estatísticas de Uso — ${dateFormatted}`)
        .setColor(0x9b59b6)
        .setDescription(`Resumo completo de atividade do **Architect** nesta data.`)
        .addFields(
          { name: `${E.membros} Usuários únicos`,    value: String(totalUsers.size),        inline: true },
          { name: `${E.premium} Usuários Premium`,   value: String(usersPremium.size),      inline: true },
          { name: `${E.check}  Usuários Normais`,    value: String(usersNormal.size),       inline: true },
          { name: `${E.servidores} Comandos usados`, value: String(totalCmds),              inline: true },
          { name: `${E.canais} Criações (IA)`,       value: String(criacoes),               inline: true },
          { name: `${E.premium} Premium ativos`,     value: String(activePremium.length),   inline: true },
          { name: `${E.config} Top Comandos`,        value: topCmdsText,                    inline: false },
        )
        .setFooter({ text: `Architect ${VERSION} • Dados de ${dateFormatted}` })
        .setTimestamp()] });
    } catch (e) {
      console.error('[/usuarios]', e.message);
      await interaction.editReply({ content: `${E.erro} Erro ao buscar estatísticas: ${e.message}` });
    }
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
async function startup() {
  const missing = ['DISCORD_TOKEN', 'CLIENT_ID', 'MONGO_URI'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`❌ Variáveis de ambiente faltando: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`[STARTUP] TOKEN: ${process.env.DISCORD_TOKEN?.slice(0,10)}... CLIENT_ID: ${process.env.CLIENT_ID}`);

  try { await connectDB(); }
  catch (e) { console.error('❌ Erro MongoDB:', e.message); process.exit(1); }

  console.log('[STARTUP] Fazendo login no Discord...');
  const loginTimeout = setTimeout(() => {
    console.error('❌ Discord login TIMEOUT (30s) — verifique o DISCORD_TOKEN no Render.');
    process.exit(1);
  }, 30000);

  try {
    await client.login(process.env.DISCORD_TOKEN);
    clearTimeout(loginTimeout);
    console.log('✅ Discord login OK');
  } catch (e) {
    clearTimeout(loginTimeout);
    console.error('❌ Discord login FALHOU:', e.message);
    process.exit(1);
  }

  setInterval(runAutoBackups, 30 * 60 * 1000);
  setInterval(async () => {
    const docs = await mongoDB.collection('premium').find({}).toArray().catch(() => []);
    for (const doc of docs) {
      if (new Date(doc.expiresAt) < new Date()) await getPremium(doc.userId);
    }
  }, 60 * 60 * 1000);
}

startup();
