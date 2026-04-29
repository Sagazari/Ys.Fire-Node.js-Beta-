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
  // ── Novos emojis Velroc ───────────────────────────────────────────────────
  velroc:     '<:velroc:1495983146162852071>',
  bot:        '<:architect_bot:1495983143918768309>',
  no:         '<:no:1495982751281578110>',
  gerando:    '<a:gerandomelhor:1495982749654323340>',
  cats:       '<:categorias:1495982744608444537>',
  info:       '<:info:1495982742884712498>',
  total:      '<a:total:1495982740871581726>',
  dev:        '<a:dev:1495982732981829763>',
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
          .setColor(0xe74c3c)
          .setAuthor({ name: 'Premium expirado' })
          .setDescription(`Seu plano **${doc.plan}** expirou. Para renovar, entre em contato com a equipe Velroc.`)
          .addFields({ name: 'Site', value: '[architect.velroc.workers.dev](https://architect.velroc.workers.dev)', inline: true })
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

// Verifica Premium pelo usuário que executou o comando (ADM Premium pode usar em qualquer servidor)
async function resolveIsPremium(userId, guild) {
  const userPremium = await isUserPremium(userId);
  if (userPremium) return true;
  return await isGuildOwnerPremium(guild);
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
  prompt = prompt.replace(/"/g, "'").replace(/`/g, "'").trim();

  await onLog(E.gerando, 'ANÁLISE',  `Interpretando prompt${isPremium ? ' (Premium ✨)' : ''}...`);
  await onLog(E.loading, 'MISTRAL',  `Conectando via Fila ${isPremium ? 'Premium' : 'Normal'}...`);

  // ─── ETAPA 1: Cargos ───────────────────────────────────────────────────────
  await onLog(E.cargos, 'CARGOS', 'Gerando hierarquia de cargos...');
  const minRoles = isPremium ? 18 : 8;
  const maxRoles = isPremium ? 30 : 14;

  const rolesSystem = isPremium
    ? `You are a world-class Discord community architect with 10+ years of experience managing servers with 50,000–500,000 members for brands, esports organizations, and cultural communities. Your role hierarchies feel handcrafted by a seasoned community director — not auto-generated.

OUTPUT CONTRACT:
- Return ONLY a raw JSON array. No markdown, no backticks, no prose, no explanation.
- All role names in Brazilian Portuguese with correct diacritics and a fitting emoji prefix.
- Generate exactly ${minRoles}–${maxRoles} roles — precision matters.
- Each role MUST have a unique hex color — no duplicates allowed.
- hoist:true for all ownership, staff, and highlighted community tiers.
- mentionable:true only for staff and pinged community roles.
- Permissions strictly scoped per tier — never over-provision.
- Permissions must only use: ADMINISTRATOR, MANAGE_GUILD, MANAGE_CHANNELS, MANAGE_ROLES, KICK_MEMBERS, BAN_MEMBERS, SEND_MESSAGES, VIEW_CHANNEL, MANAGE_MESSAGES.

ROLE ARCHITECTURE (adapt naming and emojis deeply to the server's theme — avoid generic names):
━ OWNERSHIP (1–2): Supreme authority. Color: rich gold (#f1c40f, #d4ac0d). Perms: ADMINISTRATOR.
━ SENIOR STAFF (2–3): Directors, co-owners. Color: deep amber/crimson. Perms: ADMINISTRATOR or MANAGE_GUILD + MANAGE_ROLES.
━ MODERATION (3–4): Head Mod → Moderator → Trial Moderator. Color: gradient from #e74c3c to #e67e22. Graduated perms: Head gets KICK+BAN+MANAGE_MESSAGES, Trial gets only MANAGE_MESSAGES.
━ SUPPORT/HELPERS (2–3): Support agents, helpers, event staff. Color: teal/cyan range. Perms: SEND_MESSAGES + VIEW_CHANNEL.
━ COMMUNITY VIP (3–5): Theme-specific distinguished members — NOT generic "VIP" but names tied to the server's lore/theme. Color: purple/violet range. No extra perms.
━ MEMBER TIERS (2–3): Verified → Regular → Newcomer. Colors descending: #95a5a6 → #7f8c8d → #bdc3c7. No extra perms.
━ SPECIAL (3–5): Booster, Partner, Content Creator, Bot (always include one), Muted (always include one). Unique accent colors per role.
━ THEME-EXCLUSIVE (3–6): Roles that ONLY make sense for this specific server. These should surprise the user with their creativity and specificity.

COLOR HIERARCHY LAW: Colors must visually descend from warm/vibrant (ownership) to cool/muted (newcomers). No two roles share the same hex. The full set should look like a professionally designed color system.`
    : `You are an expert Discord server architect. Generate a realistic, complete role hierarchy.
RULES:
- Return ONLY a valid JSON array. No markdown, no explanation.
- All role names in Brazilian Portuguese with correct accents.
- Generate exactly ${minRoles}–${maxRoles} roles.
- Every role needs a unique hex color.
- Include: 1 owner, 2 staff, 2 mod, 2 member tiers, 1 bot, 1 muted, theme-specific roles.
- Realistic permissions per tier.
- Permissions: ADMINISTRATOR, MANAGE_GUILD, MANAGE_CHANNELS, MANAGE_ROLES, KICK_MEMBERS, BAN_MEMBERS, SEND_MESSAGES, VIEW_CHANNEL, MANAGE_MESSAGES only.`;

  const rolesUser = isPremium
    ? `Server: "${prompt}"

THINK before generating:
• What is the server's world, lore, or culture? What would community members identify with?
• What staff titles fit this theme authentically (e.g. for a military server: "Comandante" not "Admin")?
• What community roles would make members feel recognized and progression feel meaningful?
• What 3–6 theme-exclusive roles exist NOWHERE else?

Generate the complete role hierarchy. Every role must serve a clear purpose and feel like it was designed by a human expert for this specific community.

Return ONLY a raw JSON array (no markdown, no backticks):
[{"name":"👑 Proprietário","color":"#f1c40f","hoist":true,"mentionable":false,"permissions":["ADMINISTRATOR"]},{"name":"🔇 Silenciado","color":"#636e72","hoist":false,"mentionable":false,"permissions":[]}]`
    : `Server: "${prompt}"\n\nReturn JSON array:\n[{"name":"👑 Dono","color":"#f1c40f","hoist":true,"mentionable":false,"permissions":["ADMINISTRATOR"]},{"name":"🔇 Mutado","color":"#7f8c8d","hoist":false,"mentionable":false,"permissions":[]}]\nGenerate all ${minRoles}–${maxRoles} roles. Return only the JSON array.`;

  let roles;
  try {
    roles = await callMistralRaw(laneName, [
      { role: 'system', content: rolesSystem },
      { role: 'user',   content: rolesUser },
    ]);
    if (!Array.isArray(roles) || roles.length === 0)
      throw new Error('Resposta de cargos inválida — array vazio ou malformado.');
    // Sanitize: remove duplicate names, ensure required fields
    const seen = new Set();
    roles = roles.filter(r => {
      if (!r.name || seen.has(r.name)) return false;
      seen.add(r.name);
      r.color       = /^#[0-9A-Fa-f]{6}$/.test(r.color) ? r.color : '#99aab5';
      r.hoist       = !!r.hoist;
      r.mentionable = !!r.mentionable;
      r.permissions = Array.isArray(r.permissions) ? r.permissions : [];
      return true;
    });
    if (roles.length === 0) throw new Error('Nenhum cargo válido após sanitização.');
  } catch (e) {
    console.error('[CARGOS]', e.message);
    throw new Error(`Falha ao gerar cargos: ${e.message}`);
  }

  await onLog(E.sucesso, 'CARGOS', `${roles.length} cargo(s) gerado(s)`);
  const roleNames = roles.map(r => r.name).join(', ');

  // ─── ETAPA 1.5 (Premium): Paleta de Cores ─────────────────────────────────
  if (isPremium) {
    try {
      await onLog(E.loading, 'PALETA', 'Refinando paleta de cores...');
      const paletteSystem = `You are a professional UI designer specializing in Discord server aesthetics. Assign each role a unique, visually perfect hex color.
RULES:
- Return ONLY a raw JSON array. No markdown, no explanation.
- Every role gets a unique hex — absolutely no duplicates.
- Ownership: rich gold/amber. Senior staff: deep red/crimson. Mods: bold blue/indigo gradient. Support: teal/cyan. VIP/community: vibrant purple. Members: soft grey descending. Special: unique accents. Muted: dark grey.
- The complete palette must look like a professionally designed color system — visually harmonious and hierarchically clear.`;
      const paletteUser = `Server: "${prompt}"\nRoles: ${JSON.stringify(roles.map(r => ({ name: r.name })))}\n\nAssign a unique, beautiful hex to every role. Return ONLY: [{"name":"...","color":"#xxxxxx"},...]`;
      const refined = await callMistralRaw(laneName, [
        { role: 'system', content: paletteSystem },
        { role: 'user',   content: paletteUser },
      ], 3000);
      if (Array.isArray(refined)) {
        const map = new Map(refined.map(r => [r.name, r.color]));
        for (const role of roles) {
          const c = map.get(role.name);
          if (c && /^#[0-9A-Fa-f]{6}$/.test(c)) role.color = c;
        }
        await onLog(E.sucesso, 'PALETA', 'Paleta refinada com sucesso');
      }
    } catch (e) {
      console.error('[PALETA]', e.message);
      await onLog(E.aguardando, 'PALETA', 'Paleta padrão mantida');
    }
  }

  // ─── ETAPA 2: Categorias & Canais ─────────────────────────────────────────
  await onLog(E.cats, 'ESTRUTURA', 'Projetando categorias e canais...');
  const minCats     = isPremium ? 8 : 5;
  const minChannels = isPremium ? 3 : 3;

  const catsSystem = isPremium
    ? `You are a world-class Discord server architect. You design server structures that feel built by experienced human community managers — not auto-generated templates.

THE CARDINAL SIN: Uniform channel counts. A real server has categories with 2 channels AND categories with 9 channels. Variation is authenticity. If every category has 5 channels, the output is rejected.

OUTPUT CONTRACT:
- Return ONLY a raw JSON array. No markdown, no backticks, no prose, no explanation.
- ALL names in Brazilian Portuguese with correct diacritics and fitting emojis.
- Generate 8–13 categories total. ONLY what this server genuinely needs — no filler.
- Channel counts PER category must VARY organically: some categories have 2–3 channels, others 6–9. Never uniform.
- Channel types: use text, voice, forum, announcement, stage. Vary them meaningfully — not every category gets one of each.
- Voice channels should reflect real usage: a gaming server might have 6 voice rooms with different purposes; a study server might have 4 focus rooms. Name them creatively.
- NEVER create redundant channels: no "avisos-e-informações", "chat-e-conversa" or any compound name joining two concepts. Each channel has ONE purpose.
- nsfw: false on ALL channels.
- NEVER lock channels by default.
- Role names MUST be distinct from channel names.
- rateLimitPerUser: 0 on announcements/voice/stage/forum, 5 on general social text, 10 on support/media text, 3 on bot channels.

CATEGORY STYLE: Pick ONE style, apply to ALL categories:
  Style A: ╭──── EMOJI ✦ NAME
  Style B: ➢ NAME IN CAPS
  Style C: ╭⎯⎯⎯╴ ✦ EMOJI NAME

CHANNEL STYLE: Pick ONE style, apply to ALL channels:
  Style 1: EMOJI┃channel-name
  Style 2: 「EMOJI」channel-name
  Style 3: EMOJI╺╸channel-name
No spaces around separators. Channel names: lowercase-with-hyphens. NEVER mix styles.

CHANNEL TOPICS (premium quality):
- 1–2 sentences, specific to this server's theme and culture. Never boilerplate.
- Rules channel: write actual numbered rules (5–8) specific to this community.
- Introduction channels: include a fill-in template.
- Support channels: explain what info to provide and expected response time.

ORGANIC STRUCTURE PHILOSOPHY:
Think like a human admin who built this server over time, adding channels as the community grew. Some areas are dense (main chat hub), some sparse (admin-only). The structure should feel lived-in and purposeful, not machine-generated.

CATEGORIES TO INCLUDE (adapt names and contents deeply to the theme):
1. Information/welcome hub — announcements, rules, guide. Usually 3–5 channels.
2. Staff/mod zone — restricted area. Usually 2–4 channels.
3. Main community hub — where members spend most time. Usually 5–8 channels.
4. Voice/activity zone — voice rooms, stage, AFK. Usually 4–7 channels.
5–7. Theme-specific zones — 2–3 areas deeply tied to this server's niche. Vary channel counts.
8. Support/helpdesk — Usually 2–4 channels.
Optional: events, premium lounge, archives — only if they genuinely fit.`
    : `You are an expert Discord server architect. Design a complete server structure.
MANDATORY RULES:
- Return ONLY a raw valid JSON array. No markdown, no backticks, no explanation.
- All names in Brazilian Portuguese with correct accents.
- Generate ${minCats}–8 categories — only what genuinely fits this server.
- Channel counts must VARY per category (some 2–3, some 5–6). Never uniform.
- NEVER create compound channel names joining two concepts (e.g. "avisos-e-informações").
- nsfw: false. NEVER lock channels. Roles ≠ channel names.
- rateLimitPerUser: 0 announcements/voice/forum, 5 social, 10 support/media, 3 bots.
- Pick ONE category style (A/B/C) and ONE channel style (1/2/3). Apply consistently. Never mix.
  Cat A: ╭──── EMOJI ✦ NAME  |  B: ➢ NAME  |  C: ╭⎯⎯⎯╴ ✦ EMOJI NAME
  Ch 1: EMOJI┃name  |  2: 「EMOJI」name  |  3: EMOJI╺╸name
- allowedRoles from actual role list. Never empty.`;

  const catsUser = isPremium
    ? `Server: "${prompt}"
Available roles: ${roleNames}

THINK DEEPLY before generating:
1. What is this server's soul — its culture, inside jokes, hierarchy of values?
2. Which areas will members visit daily vs. occasionally?
3. What makes this community UNIQUE? What channels exist here that exist nowhere else?
4. Which category style (A/B/C) and channel style (1/2/3) best reflects this server's personality?
5. Where does the channel count naturally vary? Which areas are dense, which are sparse?

ANTI-PATTERNS TO AVOID:
✗ Every category having 5 channels
✗ Compound channel names: "avisos-e-informações", "chat-e-conversa"
✗ Generic voice rooms: "Voice 1", "Sala de Voz"
✗ Boilerplate topics copied from template language
✗ Staff zone being empty or having 1 channel
✗ No stage or forum channels anywhere

Design the structure as a human expert who deeply understands this specific community. Apply ONE category style and ONE channel style throughout — never mix.

Return ONLY a raw JSON array:
[{"name":"╭──── 📋 ✦ Informações","allowedRoles":["👑 Proprietário","✅ Membro"],"channels":[{"name":"📢┃avisos","type":"announcement","topic":"Comunicados oficiais da equipe. Apenas a staff publica aqui.","allowedRoles":["👑 Proprietário","✅ Membro"],"rateLimitPerUser":0,"nsfw":false},{"name":"📜┃regras","type":"text","topic":"Leia antes de participar. O descumprimento resulta em punição.","allowedRoles":["👑 Proprietário","✅ Membro"],"rateLimitPerUser":0,"nsfw":false},{"name":"📌┃guia","type":"text","topic":"Como funciona o servidor e por onde começar.","allowedRoles":["👑 Proprietário","✅ Membro"],"rateLimitPerUser":0,"nsfw":false}]}]`
    : `Server: "${prompt}"\nRoles: ${roleNames}\n\nChoose ONE category style (A/B/C) and ONE channel style (1/2/3). Apply to EVERY item — never mix. Vary channel counts per category.\n\nReturn JSON array:\n[{"name":"╭──── 📋 ✦ Informações","allowedRoles":["👑 Dono","✅ Membro"],"channels":[{"name":"📢┃avisos","type":"announcement","topic":"Comunicados oficiais.","allowedRoles":["👑 Dono","✅ Membro"],"rateLimitPerUser":0,"nsfw":false},{"name":"📜┃regras","type":"text","topic":"Regras do servidor.","allowedRoles":["👑 Dono","✅ Membro"],"rateLimitPerUser":0,"nsfw":false}]}]\nVary channel counts. Return only the JSON array.`;

  let categories;
  try {
    categories = await callMistralRaw(laneName, [
      { role: 'system', content: catsSystem },
      { role: 'user',   content: catsUser },
    ], isPremium ? 16000 : 8000);
    if (!Array.isArray(categories) || categories.length === 0)
      throw new Error('Resposta de categorias inválida — array vazio ou malformado.');
    // Sanitize categories and channels
    categories = categories
      .filter(cat => cat.name && Array.isArray(cat.channels) && cat.channels.length > 0)
      .map(cat => ({
        ...cat,
        name: String(cat.name).substring(0, 100),
        allowedRoles: Array.isArray(cat.allowedRoles) && cat.allowedRoles.length ? cat.allowedRoles : roles.slice(0, 2).map(r => r.name),
        channels: cat.channels
          .filter(ch => ch.name)
          .map(ch => ({
            name:             String(ch.name).substring(0, 100),
            type:             ['text','voice','forum','announcement','stage'].includes(ch.type) ? ch.type : 'text',
            topic:            String(ch.topic || '').substring(0, 1024),
            nsfw:             false,
            rateLimitPerUser: Number.isInteger(ch.rateLimitPerUser) ? Math.max(0, Math.min(21600, ch.rateLimitPerUser)) : 0,
            allowedRoles:     Array.isArray(ch.allowedRoles) && ch.allowedRoles.length ? ch.allowedRoles : (Array.isArray(cat.allowedRoles) ? cat.allowedRoles : roles.slice(0,2).map(r=>r.name)),
          })),
      }))
      .filter(cat => cat.channels.length > 0);
    if (categories.length === 0) throw new Error('Nenhuma categoria válida após sanitização.');
  } catch (e) {
    console.error('[CATEGORIAS]', e.message);
    throw new Error(`Falha ao gerar categorias: ${e.message}`);
  }

  const totalChannels = categories.reduce((a, c) => a + c.channels.length, 0);
  await onLog(E.sucesso, 'ESTRUTURA', `${categories.length} categoria(s) · ${totalChannels} canal(is)`);

  // ─── ETAPA 3 (Premium): Regras ────────────────────────────────────────────
  let serverRules = '';
  if (isPremium) {
    try {
      await onLog(E.loading, 'REGRAS', 'Redigindo regras do servidor...');
      const rulesSys  = `You are a professional Discord community manager. Write a complete server ruleset in Brazilian Portuguese. Plain text only, no JSON, no markdown headers.`;
      const rulesUser = `Rules for: "${prompt}". Numbered 1–10. Each rule: short bold title + 1–2 sentence explanation. Cover: respect, content policy, spam, staff authority, theme-specific rules, consequences. Tone: firm but welcoming.`;
      serverRules = await callMistralText(laneName, [
        { role: 'system', content: rulesSys },
        { role: 'user',   content: rulesUser },
      ], 700);
      // Inject into rules channel
      for (const cat of categories) {
        for (const ch of cat.channels) {
          if (/regra|rule/i.test(ch.name)) ch.topic = serverRules.substring(0, 1024);
        }
      }
      await onLog(E.sucesso, 'REGRAS', 'Regras aplicadas com sucesso');
    } catch (e) {
      console.error('[REGRAS]', e.message);
      await onLog(E.aguardando, 'REGRAS', 'Ignoradas (não crítico)');
    }
  }

  // ─── ETAPA 4 (Premium): Descrição ─────────────────────────────────────────
  let serverDescription = '';
  if (isPremium) {
    try {
      await onLog(E.loading, 'DESCRIÇÃO', 'Criando tagline do servidor...');
      const descSys  = `Write a short, punchy server description in Brazilian Portuguese. Max 100 characters. No hashtags, no emojis at start. Premium, specific, like a brand tagline.`;
      const descUser = `Tagline for: "${prompt}"`;
      serverDescription = await callMistralText(laneName, [
        { role: 'system', content: descSys },
        { role: 'user',   content: descUser },
      ], 120);
      await onLog(E.sucesso, 'DESCRIÇÃO', 'Tagline criada');
    } catch (e) {
      console.error('[DESCRIÇÃO]', e.message);
    }
  }

  // ─── ETAPA 5: Boas-vindas ──────────────────────────────────────────────────
  let welcomeMessage = '';
  try {
    await onLog(E.loading, 'BOAS-VINDAS', 'Redigindo mensagem de boas-vindas...');
    const wSys  = isPremium
      ? `You are a professional community manager. Write a stunning welcome message in Brazilian Portuguese using Discord markdown (bold, italic). Warm, specific to the server, genuinely human. Plain text, no JSON.`
      : `Write a short, friendly Discord welcome message in Brazilian Portuguese. Plain text only.`;
    const wUser = isPremium
      ? `Welcome message for "${prompt}". 5–7 lines. Warm greeting + server purpose + 2–3 first steps (read rules, introduce yourself, get roles) + call-to-action. Human, not robotic.`
      : `Welcome message for "${prompt}". 3–4 lines, warm and inviting.`;
    welcomeMessage = await callMistralText(laneName, [
      { role: 'system', content: wSys },
      { role: 'user',   content: wUser },
    ], isPremium ? 500 : 300);
    await onLog(E.sucesso, 'BOAS-VINDAS', 'Mensagem gerada');
  } catch (e) {
    console.error('[BOAS-VINDAS]', e.message);
    await onLog(E.aguardando, 'BOAS-VINDAS', 'Ignorada (não crítico)');
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
    .setColor(isPrem ? 0xf26c1e : 0x5865f2)
    .setAuthor({ name: `Fila ${laneLabel} — Posição #${position}` })
    .setDescription(`**${prompt.substring(0, 80)}${prompt.length > 80 ? '…' : ''}**\n\nAguardando na fila. O embed atualiza automaticamente.`)
    .addFields(
      { name: 'Posição',         value: `#${position}`,             inline: true },
      { name: 'Tempo estimado',  value: formatETA(secsAhead),       inline: true },
      { name: 'Tipo',            value: isPrem ? 'Premium' : 'Normal', inline: true },
      { name: 'Progresso',       value: bar,                        inline: false },
      { name: 'Filas',           value: laneStatus,                 inline: false },
    )
    .setFooter({ text: `Architect ${VERSION} · https://architect.velroc.workers.dev` })
    .setTimestamp();
}

function buildAnalysisEmbed(prompt, logs) {
  const logLines = logs.slice(-8)
    .map((l, i, arr) => i === arr.length - 1
      ? `${E.gerando} \`${l.tag}\` ${l.msg}`
      : `${E.check} \`${l.tag}\` ${l.msg}`
    ).join('\n')
    || `${E.gerando} \`INIT\` Iniciando análise...`;

  const lastTag = logs.length > 0 ? logs[logs.length - 1].tag : '';
  const done = lastTag === 'CONCLUÍDO';
  return new EmbedBuilder()
    .setColor(done ? 0x2ecc71 : 0xf26c1e)
    .setAuthor({ name: done ? 'Geração concluída' : 'Gerando estrutura…' })
    .setDescription(`> ${prompt.substring(0, 150)}${prompt.length > 150 ? '…' : ''}`)
    .addFields({ name: 'Log', value: logLines })
    .setFooter({ text: `Architect ${VERSION} · Powered by Mistral AI` })
    .setTimestamp();
}

function buildCountdownBar(seconds, total) {
  const filled = Math.round((seconds / total) * 20);
  return `\`[${'█'.repeat(filled)}${'░'.repeat(20 - filled)}] ${seconds}s\``;
}

function buildConfirmEmbed(prompt, structure, secondsLeft) {
  const totalChannels = structure.categories.reduce((a, c) => a + (c.channels?.length || 0), 0);
  return new EmbedBuilder()
    .setColor(secondsLeft > 20 ? 0xf26c1e : 0xe74c3c)
    .setAuthor({ name: 'Confirmar criação do servidor' })
    .setDescription(`> Essa ação vai **apagar toda a estrutura atual** e recriar do zero. Revise antes de confirmar.`)
    .addFields(
      { name: 'Prompt',      value: prompt.substring(0, 200),                  inline: false },
      { name: 'Cargos',      value: String(structure.roles?.length || 0),      inline: true  },
      { name: 'Categorias',  value: String(structure.categories?.length || 0), inline: true  },
      { name: 'Canais',      value: String(totalChannels),                     inline: true  },
      { name: `Expira em ${secondsLeft}s`, value: buildCountdownBar(secondsLeft, 60) },
    )
    .setFooter({ text: `Architect ${VERSION} · Confirme antes do tempo acabar` })
    .setTimestamp();
}

function buildProgressEmbed(title, info, steps) {
  const last = steps.slice(-8);
  const log  = last.length > 0
    ? last.map((s, i) => i === last.length - 1 ? `${E.gerando} ${s}` : `${E.check} ${s}`).join('\n')
    : `${E.gerando} Iniciando...`;
  return new EmbedBuilder()
    .setColor(0xf26c1e)
    .setAuthor({ name: title })
    .setDescription(info.substring(0, 150))
    .addFields({ name: 'Progresso', value: log })
    .setFooter({ text: `Architect ${VERSION}` })
    .setTimestamp();
}

function errorEmbed(msg) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setAuthor({ name: 'Ocorreu um erro' })
    .setDescription(msg.substring(0, 500))
    .setFooter({ text: `Architect ${VERSION}` });
}

function buildConfirmRow(confirmId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`create_confirm_${confirmId}`).setLabel('Confirmar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger),
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
          .setColor(0xe74c3c)
          .setAuthor({ name: 'Tempo esgotado' })
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
      .setColor(0xf26c1e)
      .setAuthor({ name: 'Architect foi adicionado ao seu servidor' })
      .setThumbnail(client.user.displayAvatarURL())
      .setDescription(`Olá, **${owner.user.username}**. O Architect está pronto para uso em **${guild.name}**.`)
      .addFields(
        { name: 'Primeiros passos', value: '`/criar_servidor` — Cria servidor completo com IA\n`/backup` — Salva a estrutura atual\n`/proteger ativo:true` — Ativa o Anti-Nuke\n`/help` — Lista todos os comandos', inline: false },
        { name: 'Site', value: '[architect.velroc.workers.dev](https://architect.velroc.workers.dev)', inline: true },
        { name: 'Versão', value: `${VERSION}`, inline: true },
      )
      .setFooter({ text: `Architect ${VERSION}` })
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
  // ── Global error boundary ─────────────────────────────────────────────────
  try {

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
          .setColor(0x2ecc71)
          .setAuthor({ name: 'Servidor criado com sucesso' })
          .addFields(
            { name: 'Cargos',     value: String(structure.roles?.length || 0),      inline: true },
            { name: 'Categorias', value: String(structure.categories?.length || 0), inline: true },
            { name: 'Canais',     value: String(totalChannels),                     inline: true },
          )
          .setFooter({ text: `Architect ${VERSION} · https://architect.velroc.workers.dev` })
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
    const isPremium = await resolveIsPremium(userId, guild);

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
    const isPremium = await resolveIsPremium(userId, guild);

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
        .setAuthor({ name: lang.backupSaved })
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
        .setColor(0xf26c1e)
        .setAuthor({ name: titulo })
        .setDescription(mensagem)
        .setFooter({ text: `Anúncio por ${member.user.tag} · Architect ${VERSION}` })
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
      .setColor(0xf26c1e)
      .setAuthor({ name: lang.doarTitle })
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
      .setColor(0xf26c1e)
      .setAuthor({ name: 'Architect', iconURL: client.user.displayAvatarURL() })
      .setDescription('Create. Protect. Restore.')
      .addFields(
        { name: 'Desenvolvedor',  value: `${E.velroc} Velroc`,                                                            inline: true },
        { name: 'Servidores',     value: String(client.guilds.cache.size),                                                   inline: true },
        { name: 'Uptime',         value: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,          inline: true },
        { name: 'Versão',         value: VERSION,                                                                            inline: true },
        { name: 'Stack',          value: 'Discord.js v14 · Mistral AI',                                                     inline: true },
        { name: 'Fila Normal',    value: String(lanes.normal.queue.filter(e=>e.userId).length) + ' aguardando',             inline: true },
        { name: 'Fila Premium',   value: String(lanes.premium.queue.filter(e=>e.userId).length) + ' aguardando',           inline: true },
        { name: 'Site',           value: '[architect.velroc.workers.dev](https://architect.velroc.workers.dev)',                                          inline: true },
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
    const contatados = new Set(); // evita mensagens duplicadas para o mesmo dono
    for (const [, g] of client.guilds.cache) {
      try {
        const owner = await g.fetchOwner();
        if (contatados.has(owner.id)) continue; // já enviou para esse dono
        contatados.add(owner.id);
        await owner.send({ embeds: [new EmbedBuilder()
          .setColor(0xf26c1e)
          .setAuthor({ name: `${E.velroc} Mensagem Oficial · Velroc` })
          .setDescription(mensagem)
          .setThumbnail(client.user.displayAvatarURL())
          .setFooter({ text: `Architect ${VERSION} • Mensagem Oficial` })
          .setTimestamp()] });
        enviados++;
      } catch (e) { falhas++; }
    }
    await interaction.editReply({ content: `${E.sucesso} Mensagem enviada para **${enviados}** dono(s) único(s). Falhas: **${falhas}**.` });
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
        .setColor(0xe74c3c)
        .setAuthor({ name: 'Premium removido' })
        .setDescription('Seu acesso Premium ao Architect foi removido pela equipe Velroc.')
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] }).catch(() => {});
      return await interaction.editReply({ content: `${E.sucesso} Premium removido de **${target.tag}**.` });
    }

    const plan      = PREMIUM_PLANS[plano];
    const expiresAt = await setPremium(target.id, plano);

    await target.send({ embeds: [new EmbedBuilder()
      .setColor(0xf26c1e)
      .setAuthor({ name: `${E.velroc} Architect Premium ativado` })
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
      .setColor(0x2ecc71)
      .setAuthor({ name: 'Premium ativado' })
      .addFields(
        { name: 'Usuário', value: target.tag,                           inline: true },
        { name: 'Plano',   value: `${plan.emoji} ${plan.label}`,       inline: true },
        { name: 'Expira',  value: expiresAt.toLocaleDateString('pt-BR'), inline: true },
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
        .setColor(0xf26c1e)
        .setAuthor({ name: `Estatísticas — ${dateFormatted}` })
        .setDescription(`Atividade registrada pelo Architect nesta data.`)
        .addFields(
          { name: `${E.total} Usuários únicos`,    value: String(totalUsers.size),        inline: true },
          { name: `${E.premium} Usuários Premium`,   value: String(usersPremium.size),      inline: true },
          { name: `${E.membros} Usuários Normais`,   value: String(usersNormal.size),       inline: true },
          { name: `${E.cats} Comandos usados`,       value: String(totalCmds),              inline: true },
          { name: `${E.gerando} Criações (IA)`,      value: String(criacoes),               inline: true },
          { name: `${E.velroc} Premium ativos`,      value: String(activePremium.length),   inline: true },
          { name: `${E.info} Top Comandos`,          value: topCmdsText,                    inline: false },
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
      .setColor(0xf26c1e)
      .setAuthor({ name: 'Comandos — Architect' })
      .addFields(
        { name: 'Criação',     value: '`/criar_servidor` `/template`',              inline: false },
        { name: 'Backup',      value: '`/backup` `/restaurar` `/proteger`',         inline: false },
        { name: 'Moderação',   value: '`/ban` `/kick` `/mute` `/unmute` `/warn` `/lock` `/unlock` `/slowmode` `/clear`', inline: false },
        { name: 'Servidor',    value: '`/cargo_criar` `/canal_criar` `/deletar` `/embed` `/anuncio`', inline: false },
        { name: 'Geral',       value: '`/status` `/info` `/idioma` `/usuarios` `/doar`', inline: false },
        { name: 'Site',        value: '[architect.velroc.workers.dev](https://architect.velroc.workers.dev)',     inline: false },
      )
      .setFooter({ text: `Architect ${VERSION} · https://architect.velroc.workers.dev` })
      .setTimestamp()], ephemeral: true });
  }

  } catch (err) {
    console.error('[INTERACTION] Uncaught error:', err?.message || err);
    const errMsg = { embeds: [errorEmbed('Ocorreu um erro inesperado. Por favor, tente novamente.')], ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(errMsg).catch(() => {});
      else await interaction.reply(errMsg).catch(() => {});
    } catch (_) {}
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
        .setColor(0xe74c3c)
        .setAuthor({ name: 'Alerta Anti-Nuke' })
        .setDescription(`**${entry.executor.tag}** deletou **${count} canais** em menos de 10 segundos.\n\nUse **/restaurar** imediatamente para reverter.`)
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
        .setColor(0xe74c3c)
        .setAuthor({ name: 'Alerta Anti-Nuke' })
        .setDescription(`**${entry.executor.tag}** deletou **${count} cargos** em menos de 10 segundos.\n\nUse **/restaurar** imediatamente para reverter.`)
        .setFooter({ text: `Architect ${VERSION}` })
        .setTimestamp()] });
    }
  } catch (e) { console.error('[ANTI-NUKE] roleDelete:', e.message); }
});

// ── Dashboard Server (Express + OAuth2) ──────────────────────────────────────
const express      = require('express');
const session      = require('express-session');
const cookieParser = require('cookie-parser');
const path         = require('path');
const crypto       = require('crypto');
const app          = express();

const DASHBOARD_CLIENT_ID     = process.env.CLIENT_ID;
const DASHBOARD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DASHBOARD_REDIRECT      = process.env.DASHBOARD_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const DASHBOARD_SECRET        = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret:            DASHBOARD_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── OAuth2 Routes ─────────────────────────────────────────────────────────────
app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id:     DASHBOARD_CLIENT_ID,
    redirect_uri:  DASHBOARD_REDIRECT,
    response_type: 'code',
    scope:         'identify guilds',
    state,
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || state !== req.session.oauthState) return res.redirect('/?error=invalid_state');
  try {
    // Exchange code for token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     DASHBOARD_CLIENT_ID,
        client_secret: DASHBOARD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  DASHBOARD_REDIRECT,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token');

    // Fetch user
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    // Fetch user guilds
    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userGuilds = await guildsRes.json();

    req.session.user         = user;
    req.session.accessToken  = tokenData.access_token;
    req.session.userGuilds   = userGuilds;
    req.session.oauthState   = null;
    res.redirect('/dashboard');
  } catch (e) {
    console.error('[OAuth2]', e.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ── API Routes ────────────────────────────────────────────────────────────────

// GET /api/me — current user + their guilds where bot is present
app.get('/api/me', requireAuth, (req, res) => {
  const user       = req.session.user;
  const userGuilds = req.session.userGuilds || [];
  // Only guilds where user is admin AND bot is present
  const botGuildIds = new Set(client.guilds.cache.keys());
  const managed = userGuilds.filter(g =>
    (parseInt(g.permissions) & 0x8) === 0x8 && botGuildIds.has(g.id)
  );
  res.json({ user, guilds: managed });
});

// GET /api/guild/:id — guild info + config
app.get('/api/guild/:id', requireAuth, async (req, res) => {
  try {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    // Check user is admin in this guild
    const userGuilds = req.session.userGuilds || [];
    const userGuild  = userGuilds.find(g => g.id === req.params.id);
    if (!userGuild || (parseInt(userGuild.permissions) & 0x8) !== 0x8)
      return res.status(403).json({ error: 'Forbidden' });

    const config = await mongoDB?.collection('guild_configs').findOne({ guildId: req.params.id }) || {};
    const premiumDoc = await mongoDB?.collection('premium').findOne({ userId: guild.ownerId });
    const isPremium  = premiumDoc && new Date(premiumDoc.expiresAt) > new Date();
    const backupDoc  = await mongoDB?.collection('backups').findOne({ guildId: req.params.id });

    res.json({
      id:          guild.id,
      name:        guild.name,
      icon:        guild.iconURL({ dynamic: true }) || null,
      memberCount: guild.memberCount,
      isPremium,
      config: {
        antiNuke:     config.antiNuke || false,
        welcomeMsg:   config.welcomeMsg || '',
        welcomeCh:    config.welcomeCh || '',
        ticketCh:     config.ticketCh || '',
        ticketRole:   config.ticketRole || '',
        logCh:        config.logCh || '',
        lang:         config.lang || 'pt',
      },
      hasBackup: !!backupDoc,
      backupDate: backupDoc?.savedAt || null,
      roles:      guild.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
      channels:   guild.channels.cache.filter(c => c.type === 0 || c.type === 2).map(c => ({ id: c.id, name: c.name, type: c.type })),
    });
  } catch (e) {
    console.error('[API /guild]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/guild/:id/config — save guild config
app.post('/api/guild/:id/config', requireAuth, async (req, res) => {
  try {
    const userGuilds = req.session.userGuilds || [];
    const userGuild  = userGuilds.find(g => g.id === req.params.id);
    if (!userGuild || (parseInt(userGuild.permissions) & 0x8) !== 0x8)
      return res.status(403).json({ error: 'Forbidden' });

    const allowed = ['antiNuke','welcomeMsg','welcomeCh','ticketCh','ticketRole','logCh','lang'];
    const update  = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    await mongoDB?.collection('guild_configs').updateOne(
      { guildId: req.params.id },
      { $set: { ...update, guildId: req.params.id, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/guild/:id/generate — trigger AI server generation
app.post('/api/guild/:id/generate', requireAuth, async (req, res) => {
  try {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const userGuilds = req.session.userGuilds || [];
    const userGuild  = userGuilds.find(g => g.id === req.params.id);
    if (!userGuild || (parseInt(userGuild.permissions) & 0x8) !== 0x8)
      return res.status(403).json({ error: 'Forbidden' });

    const { prompt, confirm } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt required' });

    const userId    = req.session.user.id;
    const isPremium = await resolveIsPremium(userId, guild);

    // Check daily limit
    const limitCheck = await checkDailyLimit(userId, isPremium);
    if (!limitCheck.allowed)
      return res.status(429).json({ error: `Limite diário atingido (${limitCheck.limit}/dia). Adquira o Premium para criações ilimitadas.` });

    // If not confirmed, just generate preview
    if (!confirm) {
      const structure = await generateStructure(prompt, () => {}, isPremium);
      if (!isPremium) await incrementDailyUsage(userId);
      return res.json({ ok: true, preview: {
        roles:      structure.roles.length,
        categories: structure.categories.length,
        channels:   structure.categories.reduce((a, c) => a + c.channels.length, 0),
        structure,
      }});
    }

    // Confirmed — apply structure
    const structure = JSON.parse(req.body.structure || '{}');
    if (!structure.roles) return res.status(400).json({ error: 'No structure to apply' });
    await applyStructure(guild, structure);
    res.json({ ok: true, message: 'Servidor criado com sucesso!' });
  } catch (e) {
    console.error('[API /generate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/guild/:id/backup — create backup
app.post('/api/guild/:id/backup', requireAuth, async (req, res) => {
  try {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const userGuilds = req.session.userGuilds || [];
    const userGuild  = userGuilds.find(g => g.id === req.params.id);
    if (!userGuild || (parseInt(userGuild.permissions) & 0x8) !== 0x8)
      return res.status(403).json({ error: 'Forbidden' });

    await saveBackup(guild);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ai-config — returns Mistral key for AI chat (auth required)
app.get('/api/ai-config', requireAuth, (req, res) => {
  res.json({ key: process.env.MISTRAL_KEY_CHAT || process.env.MISTRAL_KEY_A || '' });
});

// GET /ai — serve AI chat page
app.get('/ai', (req, res) => {
  if (!req.session?.user) return res.redirect('/auth/login');
  res.sendFile(path.join(__dirname, 'public', 'ai.html'));
});

// GET /dashboard — serve dashboard app
app.get('/dashboard', (req, res) => {
  if (!req.session?.user) return res.redirect('/auth/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// GET /health — UptimeRobot keepalive
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    version: VERSION,
    guilds:  client.guilds?.cache?.size || 0,
    uptime:  Math.floor(process.uptime()),
    latency: client.ws?.ping || 0,
  });
});

// GET / — redirect to dashboard or login
app.get('/', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

// Fallback
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(process.env.PORT || 3000, () => {
  console.log(`✅ Dashboard server na porta ${process.env.PORT || 3000}`);
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
