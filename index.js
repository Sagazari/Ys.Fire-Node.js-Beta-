/**
 * Architect v1.8.0
 * Developed by Velroc
 * Create. Protect. Restore.
 */

const {
  Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ChannelType, AuditLogEvent,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType,
  MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SectionBuilder, ThumbnailBuilder,
} = require('discord.js');

// ── Canvas (geração de imagem PNG nativa, sem sharp/librsvg) ─────────────────
// Importa node-fetch para baixar o ícone do servidor
const fetch = require('node-fetch');

let createCanvas, loadImage;
try {
  ({ createCanvas, loadImage } = require('@napi-rs/canvas'));
  console.log('[CANVAS] @napi-rs/canvas carregado com sucesso.');
} catch (_) {
  try {
    ({ createCanvas, loadImage } = require('canvas'));
    console.log('[CANVAS] node-canvas carregado com sucesso.');
  } catch (__) {
    console.warn('[CANVAS] Nenhuma lib de canvas disponível. Imagens desativadas. Instale: npm install @napi-rs/canvas');
  }
}

/**
 * Gera um card PNG celebrando a criação do servidor.
 * Usa node-canvas — sem sharp, sem librsvg, funciona em qualquer hosting.
 * Retorna null se canvas não estiver disponível.
 */
async function generateServerCard({ guildName, guildIcon, roles, categories, channels, isPremium, prompt }) {
  if (!createCanvas) return null;
  try {
    const W = 900, H = 500;
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');

    // ── Fundo gradiente ──────────────────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0,    '#0d1117');
    bg.addColorStop(0.5,  '#1a1f2e');
    bg.addColorStop(1,    '#0d1117');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Glow laranja no canto superior esquerdo
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 320);
    glow.addColorStop(0,   'rgba(242,108,30,0.18)');
    glow.addColorStop(1,   'rgba(242,108,30,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // ── Borda superior laranja ───────────────────────────────────────────────
    const topBar = ctx.createLinearGradient(0, 0, W, 0);
    topBar.addColorStop(0,    'rgba(242,108,30,0)');
    topBar.addColorStop(0.3,  '#f26c1e');
    topBar.addColorStop(0.7,  '#f26c1e');
    topBar.addColorStop(1,    'rgba(242,108,30,0)');
    ctx.fillStyle = topBar;
    ctx.fillRect(0, 0, W, 3);

    // ── Avatar ───────────────────────────────────────────────────────────────
    let avatarX = 60;
    if (guildIcon) {
      try {
        const res = await fetch(guildIcon);
        const buf = Buffer.from(await res.arrayBuffer());
        const img = await loadImage(buf);
        const cx = 105, cy = 105, r = 45;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
        // Borda circular laranja
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#f26c1e';
        ctx.lineWidth = 3;
        ctx.stroke();
        avatarX = 174;
      } catch (_) {}
    }

    // ── Nome do servidor ─────────────────────────────────────────────────────
    const safeName = (guildName || 'Servidor').substring(0, 28);
    ctx.font      = 'bold 34px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(safeName, avatarX, 112);

    // Badge premium
    if (isPremium) {
      ctx.font      = 'bold 13px Arial';
      ctx.fillStyle = '#f26c1e';
      ctx.fillText('✦ PREMIUM', avatarX, 140);
    }

    // ── Subtítulo ─────────────────────────────────────────────────────────────
    ctx.font      = '17px Arial';
    ctx.fillStyle = '#8b949e';
    ctx.fillText('Servidor criado com sucesso pelo Architect', 60, 210);

    // ── Linha separadora ──────────────────────────────────────────────────────
    const sep = ctx.createLinearGradient(60, 0, W - 60, 0);
    sep.addColorStop(0,    'rgba(242,108,30,0)');
    sep.addColorStop(0.1,  'rgba(242,108,30,0.6)');
    sep.addColorStop(0.9,  'rgba(242,108,30,0.6)');
    sep.addColorStop(1,    'rgba(242,108,30,0)');
    ctx.fillStyle = sep;
    ctx.fillRect(60, 228, W - 120, 1);

    // ── Cards de estatísticas ─────────────────────────────────────────────────
    const stats = [
      { label: 'Cargos',     value: String(roles),      icon: '◉' },
      { label: 'Categorias', value: String(categories), icon: '▦' },
      { label: 'Canais',     value: String(channels),   icon: '#' },
      { label: 'Tipo',       value: isPremium ? 'Premium' : 'Normal', icon: isPremium ? '⚡' : '◆' },
    ];
    const cardW = 180, cardH = 110, cardY = 250;
    const gapX  = (W - 120 - stats.length * cardW) / (stats.length - 1);

    stats.forEach((s, i) => {
      const cx = 60 + i * (cardW + gapX);
      // Fundo do card
      ctx.fillStyle   = 'rgba(255,255,255,0.04)';
      roundRect(ctx, cx, cardY, cardW, cardH, 14);
      ctx.fill();
      // Borda do card
      ctx.strokeStyle = 'rgba(242,108,30,0.3)';
      ctx.lineWidth   = 1;
      roundRect(ctx, cx, cardY, cardW, cardH, 14);
      ctx.stroke();
      // Ícone
      ctx.font      = '22px Arial';
      ctx.fillStyle = '#f26c1e';
      ctx.fillText(s.icon, cx + 16, cardY + 36);
      // Valor
      ctx.font      = 'bold 30px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s.value, cx + 16, cardY + 72);
      // Label
      ctx.font      = '13px Arial';
      ctx.fillStyle = '#8b949e';
      ctx.fillText(s.label, cx + 16, cardY + 95);
    });

    // ── Prompt ────────────────────────────────────────────────────────────────
    const safePrompt = `"${(prompt || '').substring(0, 72)}"`;
    ctx.font      = 'italic 14px Arial';
    ctx.fillStyle = '#6e7681';
    ctx.fillText(safePrompt, 60, cardY + cardH + 32);

    // ── Rodapé ────────────────────────────────────────────────────────────────
    const dateStr = new Date().toLocaleDateString('pt-BR');
    ctx.font      = '12px Arial';
    ctx.fillStyle = '#484f58';
    ctx.fillText(`Architect ${VERSION}  ·  architectalz.netlify.app  ·  ${dateStr}`, 60, H - 20);
    // Bolinha laranja
    ctx.beginPath();
    ctx.arc(W - 50, H - 26, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f26c1e';
    ctx.fill();

    return await canvas.toBuffer('image/png');
  } catch (e) {
    console.error('[CANVAS] Erro ao gerar imagem:', e.message);
    return null;
  }
}

/** Helper: desenha um retângulo com bordas arredondadas no ctx */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

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
  console.error('<:negar:1500524485231509785> MISTRAL_KEY_A não encontrada! Defina no .env.');
  process.exit(1);
}
if (!MISTRAL_KEYS.premium) {
  console.warn('<:atencao:1500524473827459263>  MISTRAL_KEY_B não encontrada — Premium usará a fila normal.');
  MISTRAL_KEYS.premium = MISTRAL_KEYS.normal;
}
console.log(`<:aceitar:1500524505746116800> Filas Mistral ativas: Normal (KEY_A) | Premium (KEY_B)`);

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
        ...buildQueueEmbed(entry.prompt, lane.name, i + 1, secsAhead),
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
      console.error(`[LANE/${laneName}] <:atencao:1500524473827459263> Timeout de segurança acionado — lane desbloqueada forçadamente.`);
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
  check:      '<:aceitar:1500524505746116800>',
  aguardando: '<:construcao_aguardando:1493438811965882408>',
  sucesso:    '<:aceitar:1500524505746116800>',
  cargos:     '<:roles:1500524514470133853>',
  canais:     '<:canal:1500524470270562304>',
  loading:    '<:recarregando:1500524465249845368>',
  config:     '<:configuração:1500524495562215455>',
  servidores: '<:system:1500524458467918027>',
  erro:       '<:erro:1500524467648991252>',
  backup:     '<:download:1500524477078044672>',
  banido:     '<:ban:1500524478805971006>',
  mutado:     '<:mutad9:1500524453992333484>',
  lock:       '<:lockcanal:1500524516324147470>',
  unlock:     '<:unlockcanal:1500524519612485853>',
  premium:    '<:vip:1500524460221005854>',
  data:       '<:time:1500524456840400999>',
  membros:    '<:members:1500524517775245445>',
  // ── Novos emojis Velroc ───────────────────────────────────────────────────
  velroc:     '<:desenvolvedor:1500524499508920572>',
  bot:        '<:system:1500524458467918027>',
  no:         '<:no:1495982751281578110>',
  gerando:    '<:recarregando:1500524465249845368>',
  cats:       '<:categoria:1500524490214473758>',
  info:       '<:informacao:1500524487177801788>',
  total:      '<:lista:1500524503778988072>',
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
  semanal: { label: 'Semanal', days: 7,   emoji: '<:system:1500524458467918027>' },
  mensal:  { label: 'Mensal',  days: 30,  emoji: '<:nitro:1500524497688723566>' },
  anual:   { label: 'Anual',   days: 365, emoji: '<:vip:1500524460221005854>' },
};

async function getPremium(userId) {
  if (!mongoDB) return null;
  const doc = await mongoDB.collection('premium').findOne({ userId });
  if (!doc) return null;
  if (new Date(doc.expiresAt) < new Date()) {
    try {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        await user.send({
          ...v2Simple(C_RED,
            `${E.erro} Premium expirado`,
            `Seu plano **${doc.plan}** expirou. Para renovar, entre em contato com a equipe Velroc.\n\n**Site:** [architect.velroc.workers.dev](https://architect.velroc.workers.dev)`,
            `Architect ${VERSION}`
          )
        }).catch(() => {});
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
  console.log('<:aceitar:1500524505746116800> MongoDB conectado!');
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

// ── Ticket Handler ────────────────────────────────────────────────────────────
async function handleTicketOpen(interaction, categoryName) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const guild  = interaction.guild;
    const member = interaction.member;
    const config = await mongoDB?.collection('guild_configs').findOne({ guildId: guild.id });

    // Check if user already has open ticket
    const existingCh = guild.channels.cache.find(c =>
      c.name === `ticket-${member.user.username.toLowerCase().replace(/\s+/g,'-')}` ||
      (c.topic && c.topic.includes(member.id))
    );
    if (existingCh) {
      return interaction.editReply(v2Simple(C_YELLOW, '<:ticket:1500524512607862884> Ticket já aberto', `Você já tem um ticket aberto: <#${existingCh.id}>`, `Architect ${VERSION}`));
    }

    // Find or use configured category
    const catChannel = config?.ticketCategoryCh
      ? guild.channels.cache.get(config.ticketCategoryCh)
      : null;

    // Permission overwrites
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ];
    if (config?.ticketRole) {
      const role = guild.roles.cache.get(config.ticketRole);
      if (role) overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
    }

    const chName = `ticket-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g,'-').substring(0,20)}`;
    const ticketCh = await guild.channels.create({
      name:                chName,
      type:                ChannelType.GuildText,
      parent:              catChannel || null,
      topic:               `Ticket de ${member.user.tag} (${member.id}) · ${categoryName || 'Suporte'} · Aberto em ${new Date().toLocaleString('pt-BR')}`,
      permissionOverwrites: overwrites,
    });

    // Send ticket embed in new channel
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    // ── Painel do ticket com 3 botões (Fechar, Chamar Staff, Reivindicar) ────────
    const ticketRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_close_${ticketCh.id}`)
        .setLabel('Fechar Ticket')
        .setEmoji({ id: '1500524516324147470', name: 'lockcanal' })
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ticket_call_staff_${ticketCh.id}`)
        .setLabel('Chamar Staff')
        .setEmoji({ id: '1500524483801251890', name: 'notificacao' })
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_claim_${ticketCh.id}`)
        .setLabel('Reivindicar')
        .setEmoji({ id: '1500524517775245445', name: 'members' })
        .setStyle(ButtonStyle.Primary),
    );

    const staffMentionText = config?.ticketRole ? `<@&${config.ticketRole}> — novo ticket aberto!\n\n` : '';

    const ticketV2 = v2Simple(C_ORANGE,
      `<:ticket:1500524512607862884> Ticket — ${categoryName || 'Suporte'}`,
      `${staffMentionText}Olá, <@${member.id}>! Descreva seu problema e a equipe responderá em breve.\n\n**Usuário:** ${member.user.tag}\n**Categoria:** ${categoryName || 'Suporte'}\n**Aberto em:** ${new Date().toLocaleString('pt-BR')}`,
      `Architect ${VERSION}`
    );

    await ticketCh.send({
      flags: ticketV2.flags,
      components: [...ticketV2.components, ticketRow],
    });

    await interaction.editReply(v2Simple(C_GREEN, '<:ticket:1500524512607862884> Ticket Aberto!', `Seu ticket foi criado em <#${ticketCh.id}>`, `Architect ${VERSION}`));
  } catch (e) {
    console.error('[TICKET]', e.message);
    await interaction.editReply(errorEmbed(`Erro ao criar ticket: ${e.message}`));
  }
}

// ── Generate Structure ─────────────────────────────────────────────────────────
async function generateStructure(prompt, onLog, isPremium = false, userCustomPrompt = null) {
  const laneName = getLaneName(isPremium);
  prompt = prompt.replace(/"/g, "'").replace(/`/g, "'").trim();

  await onLog(E.gerando, 'ANÁLISE',  `Interpretando prompt${isPremium ? ' (Premium <:nitro:1500524497688723566>)' : ''}...`);
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
- CRITICAL: Use ONLY standard unicode emojis. NEVER use custom Discord emojis like <:name:id> — they will break the roles.
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

  // Injeta prompt customizado do usuário (ia_config premium)
  const customInstruction = userCustomPrompt
    ? `\n\n[INSTRUÇÃO PERSONALIZADA DO USUÁRIO]:\n${userCustomPrompt}`
    : '';

  let roles;
  try {
    roles = await callMistralRaw(laneName, [
      { role: 'system', content: rolesSystem },
      { role: 'user',   content: rolesUser },
    ]);
    if (!Array.isArray(roles) || roles.length === 0)
      throw new Error('Resposta de cargos inválida — array vazio ou malformado.');
    const stripCustomEmojiRole = str => String(str).replace(/<a?:\w+:\d+>/g, '').replace(/\s{2,}/g, ' ').trim();
    // Sanitize: remove duplicate names, ensure required fields
    const seen = new Set();
    roles = roles.filter(r => {
      if (!r || !r.name) return false;
      r.name = stripCustomEmojiRole(r.name).substring(0, 100);
      if (seen.has(r.name)) return false;
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

  // ── Sorteia estilos UMA VEZ aqui no código — a IA recebe apenas o escolhido ──
  // Isso garante que TODOS os canais e categorias usem exatamente 1 estilo cada.
  const CAT_STYLES = [
    { id: 'A', pattern: 'EMOJI ✦ NAME',  example: '╭──── 📋 ✦ Informações' },
    { id: 'B', pattern: '➢ NAME',        example: '➢ INFORMAÇÕES' },
    { id: 'C', pattern: '╭⎯⎯⎯╴ ✦ EMOJI NAME', example: '╭⎯⎯⎯╴ ✦ 📋 Informações' },
  ];
  const CH_STYLES = [
    { id: '1', sep: '┃',  example: '📢┃avisos' },
    { id: '2', sep: '」', example: '「📢」avisos' },
    { id: '3', sep: '╺╸', example: '📢╺╸avisos' },
  ];
  const chosenCatStyle = CAT_STYLES[Math.floor(Math.random() * CAT_STYLES.length)];
  const chosenChStyle  = CH_STYLES[Math.floor(Math.random() * CH_STYLES.length)];

  // Prefixos corretos para cada estilo de categoria
  const catPrefix = chosenCatStyle.id === 'A' ? '╭──── '
                  : chosenCatStyle.id === 'B' ? '➢ '
                  : '╭⎯⎯⎯╴ ✦ ';
  const chSep = chosenChStyle.sep;

  console.log(`[ESTILOS] Categoria: ${chosenCatStyle.id} (${chosenCatStyle.example}) | Canal: ${chosenChStyle.id} (${chosenChStyle.example})`);

  const catsSystem = isPremium
    ? `You are a world-class Discord server architect. You design server structures that feel built by experienced human community managers — not auto-generated templates.

⚠️ CRITICAL RULE — PROMPT COMPLIANCE:
If the user's prompt specifies an EXACT number of categories or channels (e.g. "4 categories with 5 channels each", "3 categories", "6 canais por categoria"), you MUST follow it EXACTLY. Non-compliance is a critical failure.
- If prompt says N categories → create exactly N categories.
- If prompt says N channels per category → create exactly N channels per category.
- Only when the prompt does NOT specify counts should you use creative judgment.

THE CARDINAL SIN: Uniform channel counts WHEN THE PROMPT DOESN'T SPECIFY. A real server has categories with 2 channels AND categories with 9 channels. Variation is authenticity. If every category has 5 channels and the user didn't ask for that, the output is rejected.

OUTPUT CONTRACT:
- Return ONLY a raw JSON array. No markdown, no backticks, no prose, no explanation.
- ALL names in Brazilian Portuguese with correct diacritics and fitting emojis.
- CRITICAL: Use ONLY standard unicode emojis (e.g. 📢 🎮 🔊). NEVER use custom Discord emojis like <:name:id> or <a:name:id> — they will break the server.
- Generate 8–13 categories total (or EXACTLY as requested). ONLY what this server genuinely needs — no filler.
- Channel counts PER category must VARY organically unless user specified: some categories have 2–3 channels, others 6–9.
- Channel types: use text, voice, forum, announcement, stage. Vary them meaningfully — not every category gets one of each.
- Voice channels should reflect real usage: a gaming server might have 6 voice rooms with different purposes; a study server might have 4 focus rooms. Name them creatively.
- NEVER create redundant channels: no "avisos-e-informações", "chat-e-conversa" or any compound name joining two concepts. Each channel has ONE purpose.
- nsfw: false on ALL channels.
- NEVER lock channels by default.
- Role names MUST be distinct from channel names.
- rateLimitPerUser: 0 on announcements/voice/stage/forum, 5 on general social text, 10 on support/media text, 3 on bot channels.

STYLE — STRICTLY ENFORCED (do NOT deviate):
CATEGORY style: ${chosenCatStyle.id} → format: ${chosenCatStyle.pattern}
  Every single category name MUST start with: "${catPrefix}"
  Example: "${chosenCatStyle.example}"
  DO NOT use any other category prefix or format.

CHANNEL style: ${chosenChStyle.id} → separator: "${chSep}"
  Every single channel name MUST follow: EMOJI${chSep}channel-name
  Example: "${chosenChStyle.example}"
  DO NOT use any other channel separator or format.

STYLE ENFORCEMENT IS ABSOLUTE — mixing styles is a critical failure. Every category and every channel must match the assigned style exactly.
No spaces around separators. Channel names: lowercase-with-hyphens only.

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
- allowedRoles from actual role list. Never empty.

STYLE — STRICTLY ENFORCED:
Category style ${chosenCatStyle.id}: every category name MUST start with "${catPrefix}" → Example: "${chosenCatStyle.example}"
Channel style ${chosenChStyle.id}: every channel name MUST use separator "${chSep}" → Example: "${chosenChStyle.example}"
DO NOT mix. DO NOT use any other format. This is non-negotiable.`;

  const catsUser = isPremium
    ? `Server: "${prompt}"
Available roles: ${roleNames}

THINK DEEPLY before generating:
1. What is this server's soul — its culture, inside jokes, hierarchy of values?
2. Which areas will members visit daily vs. occasionally?
3. What makes this community UNIQUE? What channels exist here that exist nowhere else?
4. Where does the channel count naturally vary? Which areas are dense, which are sparse?

ANTI-PATTERNS TO AVOID:
✗ Every category having 5 channels
✗ Compound channel names: "avisos-e-informações", "chat-e-conversa"
✗ Generic voice rooms: "Voice 1", "Sala de Voz"
✗ Boilerplate topics copied from template language
✗ Staff zone being empty or having 1 channel
✗ No stage or forum channels anywhere
✗ Category names that don't start with "${catPrefix}"
✗ Channel names that don't use separator "${chSep}"

REMINDER: Category style is ${chosenCatStyle.id}, channel style is ${chosenChStyle.id}. Apply to 100% of items.

Return ONLY a raw JSON array:
[{"name":"${chosenCatStyle.example.replace('Informações','Informações')}","allowedRoles":["👑 Proprietário","✅ Membro"],"channels":[{"name":"📢${chSep}avisos","type":"announcement","topic":"Comunicados oficiais da equipe. Apenas a staff publica aqui.","allowedRoles":["👑 Proprietário","✅ Membro"],"rateLimitPerUser":0,"nsfw":false},{"name":"📜${chSep}regras","type":"text","topic":"Leia antes de participar. O descumprimento resulta em punição.","allowedRoles":["👑 Proprietário","✅ Membro"],"rateLimitPerUser":0,"nsfw":false}]}]`
    : `Server: "${prompt}"\nRoles: ${roleNames}\n\nSTYLE (non-negotiable): Category prefix "${catPrefix}", channel separator "${chSep}". Apply to EVERY item.\n\nReturn JSON array:\n[{"name":"${chosenCatStyle.example}","allowedRoles":["👑 Dono","✅ Membro"],"channels":[{"name":"📢${chSep}avisos","type":"announcement","topic":"Comunicados oficiais.","allowedRoles":["👑 Dono","✅ Membro"],"rateLimitPerUser":0,"nsfw":false},{"name":"📜${chSep}regras","type":"text","topic":"Regras do servidor.","allowedRoles":["👑 Dono","✅ Membro"],"rateLimitPerUser":0,"nsfw":false}]}]\nVary channel counts. Return only the JSON array.`;

  let categories;
  try {
    categories = await callMistralRaw(laneName, [
      { role: 'system', content: catsSystem },
      { role: 'user',   content: catsUser },
    ], isPremium ? 16000 : 8000);
    if (!Array.isArray(categories) || categories.length === 0)
      throw new Error('Resposta de categorias inválida — array vazio ou malformado.');
    // Sanitize custom emojis from all names (last line of defense)
    const stripCustomEmoji = str => String(str).replace(/<a?:\w+:\d+>/g, '').replace(/\s{2,}/g, ' ').trim();
    // Sanitize categories and channels
    categories = categories
      .filter(cat => cat && cat.name && Array.isArray(cat.channels) && cat.channels.length > 0)
      .map(cat => {
        // ── Força o estilo de categoria sorteado ──────────────────────────────
        let catName = stripCustomEmoji(String(cat.name)).substring(0, 100).trim();
        // Remove qualquer prefixo de estilo existente e aplica o correto
        catName = catName
          .replace(/^╭────\s*/,  '')
          .replace(/^╭⎯⎯⎯╴\s*✦\s*/, '')
          .replace(/^➢\s*/,       '')
          .trim();
        if (chosenCatStyle.id === 'A') catName = `╭──── ${catName}`;
        else if (chosenCatStyle.id === 'B') catName = `➢ ${catName.toUpperCase()}`;
        else catName = `╭⎯⎯⎯╴ ✦ ${catName}`;

        const channels = (Array.isArray(cat.channels) ? cat.channels : [])
          .filter(ch => ch && ch.name)
          .map(ch => {
            // ── Força o estilo de canal sorteado ───────────────────────────────
            let chName = String(ch.name).substring(0, 100).trim().toLowerCase();
            // Remove qualquer separador existente e aplica o correto
            // Extrai emoji (se houver) e o nome do canal
            const separators = ['┃', '」', '╺╸', '|', '「'];
            let emoji = '';
            let bare  = chName;
            for (const sep of separators) {
              const idx = chName.indexOf(sep);
              if (idx !== -1) {
                // Tudo antes do separador é o emoji, depois é o nome
                const before = chName.slice(0, idx).trim();
                const after  = chName.slice(idx + sep.length).trim();
                // Verifica se o "before" parece ser emoji (curto)
                if (before.length <= 6 && after.length > 0) {
                  emoji = before;
                  bare  = after;
                  break;
                }
              }
            }
            // Remove 「 」 soltos
            bare = stripCustomEmoji(bare).replace(/^「/, '').replace(/」$/, '').trim();
            // Remove custom emoji from emoji part too
            if (emoji) emoji = stripCustomEmoji(emoji);
            // Reconstrói com o separador correto
            if (chosenChStyle.id === '1') chName = emoji ? `${emoji}┃${bare}` : `📌┃${bare}`;
            else if (chosenChStyle.id === '2') chName = emoji ? `「${emoji}」${bare}` : `「📌」${bare}`;
            else chName = emoji ? `${emoji}╺╸${bare}` : `📌╺╸${bare}`;

            return {
              name:             chName.substring(0, 100),
              type:             ['text','voice','forum','announcement','stage'].includes(ch.type) ? ch.type : 'text',
              topic:            String(ch.topic || '').substring(0, 1024),
              nsfw:             false,
              rateLimitPerUser: Number.isInteger(ch.rateLimitPerUser) ? Math.max(0, Math.min(21600, ch.rateLimitPerUser)) : 0,
              allowedRoles:     Array.isArray(ch.allowedRoles) && ch.allowedRoles.length ? ch.allowedRoles : (Array.isArray(cat.allowedRoles) ? cat.allowedRoles : roles.slice(0,2).map(r=>r.name)),
            };
          });

        return {
          ...cat,
          name: catName.substring(0, 100),
          allowedRoles: Array.isArray(cat.allowedRoles) && cat.allowedRoles.length ? cat.allowedRoles : roles.slice(0, 2).map(r => r.name),
          channels,
        };
      })
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
  const step = typeof onStep === 'function' ? onStep : async () => {};
  // Garante que temos dados válidos antes de qualquer deleção
  if (!structure.roles?.length && !structure.categories?.length) {
    throw new Error('Estrutura inválida: sem cargos nem categorias para criar. Operação cancelada.');
  }

  console.log(`[APPLY] Iniciando — roles: ${structure.roles?.length}, categories: ${structure.categories?.length}`);

  // 1. Se servidor Comunidade, desativa temporariamente para poder deletar canais obrigatórios
  const isCommunity = guild.features?.includes('COMMUNITY');
  if (isCommunity) {
    try {
      await step(E.config, 'Desativando modo Comunidade temporariamente...');
      await guild.edit({
        features: guild.features.filter(f => f !== 'COMMUNITY'),
        rulesChannel: null,
        publicUpdatesChannel: null,
      }).catch(e => console.warn('[APPLY] Não foi possível desativar Comunidade:', e.message));
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) { console.warn('[APPLY] Community disable:', e.message); }
  }

  // 2. Remover canais — com delay entre cada um para evitar rate limit
  await step(E.canais, 'Removendo canais existentes...');
  const existingChannels = await guild.channels.fetch();
  // Deleta canais filhos primeiro, categorias depois
  const sortedChs = [...existingChannels.values()].filter(Boolean).sort((a, b) => {
    const aIsCat = a.type === 4; // GuildCategory
    const bIsCat = b.type === 4;
    return aIsCat === bIsCat ? 0 : aIsCat ? 1 : -1;
  });
  for (const ch of sortedChs) {
    if (!ch) continue;
    await ch.delete().catch(e => console.warn(`[APPLY] Não deletou canal "${ch.name}": ${e.message}`));
    await new Promise(r => setTimeout(r, 300));
  }
  await new Promise(r => setTimeout(r, 1000));

  // 3. Remover cargos
  await step(E.cargos, 'Removendo cargos existentes...');
  const existingRoles = await guild.roles.fetch();
  const botMember  = await guild.members.fetchMe().catch(() => null);
  const botTopRole = botMember?.roles?.highest;
  const botPosition = botTopRole?.position ?? 0;
  console.log(`[APPLY] Cargo mais alto do bot: ${botTopRole?.name} (posição ${botPosition})`);
  for (const [, role] of existingRoles) {
    if (!role || role.managed || role.name === '@everyone') continue;
    if (role.position >= botPosition) {
      console.warn(`[APPLY] Cargo ${role.name} (pos ${role.position}) está acima do bot — ignorado`);
      continue;
    }
    await role.delete().catch(e => console.warn(`[APPLY] Não deletou cargo ${role.name}: ${e.message}`));
    await new Promise(r => setTimeout(r, 200));
  }
  await new Promise(r => setTimeout(r, 500));

  // 4. Restaurar permissões do @everyone
  if (structure.everyonePerms) {
    await guild.roles.everyone.setPermissions(structure.everyonePerms).catch(e => console.error('[APPLY] @everyone perms:', e.message));
  }

  // 5. Restaurar configurações do servidor
  if (structure.server) {
    try {
      await step(E.config, 'Restaurando configurações do servidor...');
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
  await step(E.cargos, 'Criando cargos...');
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
      await step(E.sucesso, `Cargo: **${r.name}**`);
      await new Promise(r => setTimeout(r, 250));
    } catch (e) { console.error(`[APPLY] Cargo "${r.name}":`, e.message); }
  }

  // Palavras-chave que identificam canais/categorias PÚBLICOS (sem restrição)
  const PUBLIC_KEYWORDS = [
    'chat', 'geral', 'conversa', 'mídia', 'media', 'meme', 'memes', 'interação',
    'interacao', 'boas-vindas', 'bem-vindo', 'bem-vinda', 'welcome', 'apresentação',
    'apresentacao', 'off-topic', 'offtopic', 'humor', 'funny', 'lazer', 'entretenimento',
    'random', 'geral', 'lounge', 'social', 'publico', 'público',
  ];
  // Palavras-chave de canais PRIVADOS (devem manter restrição)
  const PRIVATE_KEYWORDS = [
    'staff', 'admin', 'moderação', 'moderacao', 'mod-', '-mod', 'interno', 'interna',
    'backstage', 'diretoria', 'gestão', 'gestao', 'logs', 'log-', 'registro',
    'avisos', 'entrada', 'regras', 'rules', 'anuncio', 'anúncio', 'announcements',
    'privado', 'privada', 'restrito', 'restrita', 'secreto', 'secreta',
  ];

  function isPublicChannel(name, categoryName) {
    const n = (name + ' ' + (categoryName || '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (PRIVATE_KEYWORDS.some(k => n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) return false;
    if (PUBLIC_KEYWORDS.some(k => n.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) return true;
    return false;
  }

  // Helper: converte allowedRoles (IA) em permissionOverwrites do Discord
  function buildOverwritesFromAllowedRoles(allowedRoles, channelName, categoryName) {
    if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return [];
    // Canais públicos NÃO recebem deny — ficam abertos para @everyone
    if (isPublicChannel(channelName || '', categoryName || '')) return [];
    const validRoles = allowedRoles.map(n => createdRoles.get(n)).filter(Boolean);
    // Se nenhuma role válida encontrada, não aplica overwrites — canal fica aberto
    if (validRoles.length === 0) return [];
    // Verifica se inclui roles de membro/verificado (indicativo de canal público)
    const hasMemberRole = validRoles.some(r => {
      const rn = r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return rn.includes('membro') || rn.includes('verificado') || rn.includes('member') || rn.includes('everyone');
    });
    if (hasMemberRole && validRoles.length >= 2) return []; // canal acessível a membros = público
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ];
    for (const role of validRoles) {
      overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }
    return overwrites;
  }

  // Helper: resolve permOverwrites (backup) OU allowedRoles (IA)
  function resolveOverwrites(permOverwrites, allowedRoles, channelName, categoryName) {
    if (allowedRoles?.length) return buildOverwritesFromAllowedRoles(allowedRoles, channelName, categoryName);
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

  // Tipos que exigem boost ou permissão especial — fallback para text/voice se falhar
  const FALLBACK = {
    [ChannelType.GuildAnnouncement]: ChannelType.GuildText,
    [ChannelType.GuildForum]:        ChannelType.GuildText,
    [ChannelType.GuildStageVoice]:   ChannelType.GuildVoice,
  };

  /** Cria canal com fallback automático e retry em caso de rate limit */
  async function safeCreateChannel(data, attempt = 1) {
    try {
      return await guild.channels.create(data);
    } catch (e) {
      // Rate limit — aguarda e tenta de novo (até 3x)
      if ((e.status === 429 || e.code === 429 || e.message?.includes('rate limit')) && attempt <= 3) {
        const wait = (e.retryAfter || attempt * 3) * 1000;
        console.warn(`[APPLY] Rate limit em "${data.name}" — aguardando ${wait}ms (tentativa ${attempt}/3)`);
        await new Promise(r => setTimeout(r, wait));
        return safeCreateChannel(data, attempt + 1);
      }
      const fallbackType = FALLBACK[data.type];
      if (fallbackType !== undefined) {
        console.warn(`[APPLY] Tipo ${data.type} não suportado, fallback → ${fallbackType} para "${data.name}"`);
        try {
          return await guild.channels.create({ ...data, type: fallbackType });
        } catch (e2) {
          console.error('[APPLY] Fallback também falhou:', data.name, e2.message);
          return null;
        }
      }
      console.error('[APPLY] Canal falhou:', data.name, e.message);
      return null;
    }
  }

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
        permissionOverwrites: resolveOverwrites(ch.permOverwrites, ch.allowedRoles, ch.name, ''),
      };
      if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement)
        channelData.topic = ch.topic?.substring(0, 1024) || '';
      if (type === ChannelType.GuildForum)
        channelData.topic = ch.topic?.substring(0, 4096) || '';
      const created = await safeCreateChannel(channelData);
      if (!created) continue;
      if (ch.isSystemChannel) systemChannelId = created.id;
      if (ch.isAfkChannel)    afkChannelId    = created.id;
      await step(E.canais, `Canal: **${ch.name}**`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { console.error('[APPLY] Orphan canal exception:', ch.name, e.message); }
  }

  // 6b. Categorias e seus canais
  console.log(`[APPLY] Criando ${structure.categories?.length || 0} categorias...`);
  for (const category of structure.categories || []) {
    if (!category || !category.name) { console.warn('[APPLY] Categoria inválida ignorada'); continue; }
    try {
      await step(E.canais, `Categoria: **${category.name}**`);
      const cat = await guild.channels.create({
        name:                 category.name.substring(0, 100),
        type:                 ChannelType.GuildCategory,
        permissionOverwrites: resolveOverwrites(category.permOverwrites, category.allowedRoles, category.name, ''),
      }).catch(e => { console.error('[APPLY] Categoria:', e.message); return null; });
      if (!cat) continue;
      console.log(`[APPLY] Categoria criada: ${category.name} (${category.channels?.length || 0} canais)`);
      await new Promise(r => setTimeout(r, 500));

      for (const ch of category.channels || []) {
        if (!ch || !ch.name) { console.warn('[APPLY] Canal inválido ignorado'); continue; }
        try {
          const type        = typeMap[ch.type] || ChannelType.GuildText;
          const channelData = {
            name:                 (ch.name || 'canal').substring(0, 100),
            type,
            parent:               cat.id,
            nsfw:                 false,
            rateLimitPerUser:     (type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice) ? 0 : (ch.rateLimitPerUser || 0),
            permissionOverwrites: resolveOverwrites(ch.permOverwrites, ch.allowedRoles, ch.name, category.name),
          };
          if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement)
            channelData.topic = ch.topic?.substring(0, 1024) || '';
          if (type === ChannelType.GuildForum)
            channelData.topic = ch.topic?.substring(0, 4096) || '';
          const created = await safeCreateChannel(channelData);
          if (!created) continue;
          console.log(`[APPLY] Canal criado: ${ch.name}`);
          if (ch.isSystemChannel) systemChannelId = created.id;
          if (ch.isAfkChannel)    afkChannelId    = created.id;
          await step(E.canais, `Canal: **${ch.name}**`);
          await new Promise(r => setTimeout(r, 400));
        } catch (e) { console.error('[APPLY] Canal exception:', ch?.name, e.message); }
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { console.error('[APPLY] Categoria exception:', category?.name, e.message); }
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
// ── Ticket tracking ────────────────────────────────────────────────────────────
// staffCallCooldown: Map<channelId, Map<userId, timestamp>>  (30min anti-spam)
// ticketClaimed:     Map<channelId, { staffId, staffTag, claimedAt }>
// ticketStats:       Map<staffId, count>  (persistido no mongo também)
const staffCallCooldown = new Map();
const ticketClaimed     = new Map();
const ticketStats       = new Map();

// ── Components V2 Helpers ───────────────────────────────────────────────────────
// Retorna { flags, components } prontos para passar em reply/editReply
// Todos os "embeds" do bot agora usam Components V2 (IsComponentsV2 flag)

/** Cor hex → int para accentColor do ContainerBuilder */
function hex(h) { return parseInt(String(h).replace('#',''), 16); }

const C_ORANGE = hex('f26c1e');
const C_GREEN  = hex('2ecc71');
const C_RED    = hex('e74c3c');
const C_BLUE   = hex('3498db');
const C_YELLOW = hex('f39c12');
const C_GREY   = hex('95a5a6');
const C_PURPLE = hex('5865f2');
const C_DARK   = hex('e74c3c');

/** Monta um componente V2 simples: título + corpo + rodapé */
function v2Simple(accentColor, title, body, footer) {
  const lines = [];
  if (title) lines.push(`## ${title}`);
  if (body)  lines.push(body);
  if (footer) lines.push(`-# ${footer}`);
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [{
      type: 17, // Container
      accent_color: accentColor,
      components: [{ type: 10, content: lines.join('\n') }], // TextDisplay
    }],
  };
}

/** Monta V2 com múltiplos campos inline simulados */
function v2Fields(accentColor, title, body, fields, footer) {
  const lines = [];
  if (title) lines.push(`## ${title}`);
  if (body)  lines.push(body);
  if (fields && fields.length) {
    lines.push('');
    for (const f of fields) {
      lines.push(`**${f.name}**\n${f.value}`);
    }
  }
  if (footer) lines.push(`\n-# ${footer}`);
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [{
      type: 17,
      accent_color: accentColor,
      components: [{ type: 10, content: lines.join('\n') }],
    }],
  };
}

/** Extrai só o array de components V2 (para usos que precisam mesclar com botões) */
function v2Container(accentColor, content) {
  return { type: 17, accent_color: accentColor, components: [{ type: 10, content }] };
}

// ── Queue ───────────────────────────────────────────────────────────────────────
function formatETA(secs) {
  if (secs <= 0)   return '<:system:1500524458467918027> Quase na sua vez!';
  if (secs < 60)   return `~${secs}s`;
  if (secs < 3600) return `~${Math.floor(secs / 60)}min ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `~${h}h ${m}min`;
}

function buildQueueEmbed(prompt, laneName, position, secsAhead) {
  const isPrem    = laneName === 'premium';
  const laneLabel = isPrem ? '✦ Premium' : 'Normal';
  const maxDisplay = 12;
  const filled = Math.max(0, maxDisplay - Math.min(position - 1, maxDisplay));
  const bar = `\`[${'█'.repeat(filled)}${'░'.repeat(maxDisplay - filled)}]\``;

  const normalQ  = lanes.normal.queue.filter(e => e.userId !== null).length;
  const premiumQ = lanes.premium.queue.filter(e => e.userId !== null).length;

  // Ícone dinâmico por posição
  const posIcon = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `#${position}`;

  const content = [
    `## ${isPrem ? E.premium : '🟦'} Fila ${laneLabel} — Posição ${posIcon}`,
    `> *${prompt.substring(0, 80)}${prompt.length > 80 ? '…' : ''}*`,
    ``,
    `**⏳ Tempo estimado:** ${formatETA(secsAhead)}`,
    `**Tipo de fila:** ${isPrem ? `${E.premium} Premium` : '🟦 Normal'}`,
    `**Progresso:** ${bar}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🟦 **Fila Normal** ${lanes.normal.busy ? E.loading : E.sucesso} — ${normalQ} na fila`,
    `${E.premium} **Fila Premium** ${lanes.premium.busy ? E.loading : E.sucesso} — ${premiumQ} na fila`,
    ``,
    `-# Architect ${VERSION} · Este painel atualiza automaticamente`,
  ].join('\n');

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [v2Container(isPrem ? C_ORANGE : C_PURPLE, content)],
  };
}

function buildAnalysisEmbed(prompt, logs) {
  const logLines = logs.slice(-8)
    .map((l, i, arr) => i === arr.length - 1
      ? `${E.gerando} \`${l.tag}\` ${l.msg}`
      : `${E.check} \`${l.tag}\` ${l.msg}`
    ).join('\n') || `${E.gerando} \`INIT\` Iniciando análise...`;

  const lastTag  = logs.length > 0 ? logs[logs.length - 1].tag : '';
  const done     = lastTag === 'CONCLUÍDO';
  const total    = 5; // etapas: ANÁLISE, MISTRAL, CARGOS, CATEGORIAS, BOAS-VINDAS/REGRAS
  const progress = done ? total : Math.min(logs.length, total);
  const barFilled = Math.round((progress / total) * 16);
  const bar = `\`[${'█'.repeat(barFilled)}${'░'.repeat(16 - barFilled)}] ${Math.round((progress / total) * 100)}%\``;

  const content = [
    `## ${done ? `${E.sucesso} Geração concluída!` : `${E.gerando} Gerando estrutura…`}`,
    `> *${prompt.substring(0, 150)}${prompt.length > 150 ? '…' : ''}*`,
    ``,
    `**Progresso:** ${bar}`,
    ``,
    `**Log em tempo real:**`,
    logLines,
    ``,
    `-# Architect ${VERSION} · Velroc Systems`,
  ].join('\n');

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [v2Container(done ? C_GREEN : C_ORANGE, content)],
  };
}

function buildCountdownBar(seconds, total) {
  const filled = Math.round((seconds / total) * 20);
  return `\`[${'█'.repeat(filled)}${'░'.repeat(20 - filled)}] ${seconds}s\``;
}

function buildConfirmEmbed(prompt, structure, secondsLeft) {
  const totalChannels = structure.categories.reduce((a, c) => a + (c.channels?.length || 0), 0);
  const urgent  = secondsLeft <= 20;
  const warning = secondsLeft <= 40 && secondsLeft > 20;

  // Barra de progresso colorida por urgência
  const barIcon = urgent ? '🔴' : warning ? '🟡' : '🟢';

  // Preview de categorias (máx 4)
  const catPreview = (structure.categories || []).slice(0, 4)
    .map(c => `> ${E.cats} **${c.name}** — ${c.channels?.length || 0} canais`)
    .join('\n');
  const moreCount = Math.max(0, (structure.categories?.length || 0) - 4);

  const content = [
    `## <:atencao:1500524473827459263> Confirmação de Criação`,
    `> ⚠️ Esta ação **apagará toda a estrutura atual** e recriará do zero.`,
    ``,
    `**<:lista:1500524503778988072> Prompt:**`,
    `> *${prompt.substring(0, 180)}${prompt.length > 180 ? '…' : ''}*`,
    ``,
    `**${E.servidores} Resumo da estrutura:**`,
    `> ${E.cargos} **${structure.roles?.length || 0}** cargos  ·  ${E.cats} **${structure.categories?.length || 0}** categorias  ·  ${E.canais} **${totalChannels}** canais`,
    ``,
    ...(catPreview ? [`**Categorias:**`, catPreview, ...(moreCount > 0 ? [`> *… e mais ${moreCount} categoria(s)*`] : []), ``] : []),
    `**${barIcon} Expira em ${secondsLeft}s:** ${buildCountdownBar(secondsLeft, 60)}`,
    ``,
    `-# Architect ${VERSION} · Confirme ou cancele antes do tempo acabar`,
  ].join('\n');

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [v2Container(urgent ? C_RED : warning ? C_YELLOW : C_ORANGE, content)],
  };
}

function buildProgressEmbed(title, info, steps) {
  const last = steps.slice(-10);
  const log  = last.length > 0
    ? last.map((s, i) => i === last.length - 1 ? `${E.gerando} ${s}` : `${E.check} ${s}`).join('\n')
    : `${E.gerando} Iniciando...`;

  // Estima progresso pelo número de steps
  const estimatedTotal = 40;
  const pct  = Math.min(100, Math.round((steps.length / estimatedTotal) * 100));
  const barF = Math.round(pct / 6.25); // 16 blocos
  const bar  = `\`[${'█'.repeat(barF)}${'░'.repeat(16 - barF)}] ${pct}%\``;

  const content = [
    `## ${title}`,
    `> *${info.substring(0, 150)}*`,
    ``,
    `**Construção:** ${bar}`,
    ``,
    `**Log:**`,
    log,
    ``,
    `-# Architect ${VERSION} · Não feche o Discord durante a construção`,
  ].join('\n');

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [v2Container(C_ORANGE, content)],
  };
}

function errorEmbed(msg) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [v2Container(C_RED, `## ${E.erro} Ocorreu um erro\n${msg.substring(0, 500)}\n\n-# Architect ${VERSION}`)],
  };
}

/** Versão de errorEmbed que retorna só o payload (para usos inline) */
function errPayload(msg) { return errorEmbed(msg); }

function buildConfirmRow(confirmId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`create_confirm_${confirmId}`)
      .setLabel('Confirmar')
      .setEmoji({ id: '1500524505746116800', name: 'aceitar' })
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancel_confirm_${confirmId}`)
      .setLabel('Cancelar')
      .setEmoji({ id: '1500524485231509785', name: 'negar' })
      .setStyle(ButtonStyle.Danger),
  );
}

/** Merge V2 payload with an ActionRow (buttons must sit alongside containers) */
function v2WithRow(v2Payload, row) {
  return {
    flags: v2Payload.flags,
    components: [...v2Payload.components, row],
  };
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
        const expiredPayload = v2Simple(C_RED, '<:time:1500524456840400999> Tempo esgotado', 'A confirmação expirou. Use o comando novamente.', `Architect ${VERSION}`);
        await interaction.editReply(expiredPayload).catch(async () => {
          await interaction.user.send(expiredPayload).catch(() => {});
        });
      }
      return;
    }
    await interaction.editReply(
      v2WithRow(buildConfirmEmbed(prompt, structure, secondsLeft), buildConfirmRow(confirmId)),
    ).catch(() => {});
  }, 1000);
}

// ── Guild Create Welcome ───────────────────────────────────────────────────────
client.on('guildCreate', async guild => {
  try {
    const owner = await guild.fetchOwner();
    await owner.send(v2Simple(C_ORANGE,
      `${E.bot} Architect foi adicionado ao seu servidor!`,
      `Olá, **${owner.user.username}**! O Architect está pronto para uso em **${guild.name}**.\n\n` +
      `**Primeiros passos:**\n\`/criar_servidor\` — Cria servidor completo com IA\n\`/backup\` — Salva a estrutura atual\n\`/proteger ativo:true\` — Ativa o Anti-Nuke\n\`/help\` — Lista todos os comandos\n\n` +
      `**Site:** [architect.velroc.workers.dev](https://architect.velroc.workers.dev)   **Versão:** ${VERSION}`,
      `Architect ${VERSION}`
    )).catch(() => {});
  } catch (e) { console.error('[GUILD CREATE] DM:', e.message); }
});

// ── Ready ──────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`<:aceitar:1500524505746116800> Architect ${VERSION} online como ${client.user.tag}`);

  // ── Status dinâmico com contagem real de servidores (cross-shard) ──────────
  const shardId     = client.shard?.ids?.[0] ?? 0;
  const totalShards = client.shard?.count ?? 1;
  const shardLabel  = totalShards > 1 ? `${totalShards} Shards` : `1 Shard`;

  // Busca contagem real de guilds (suporta sharding)
  const getTotalGuilds = async () => {
    if (client.shard) {
      try {
        const counts = await client.shard.fetchClientValues('guilds.cache.size');
        return counts.reduce((a, b) => a + b, 0);
      } catch (_) {}
    }
    return client.guilds.cache.size;
  };

  let _statusIndex = 0;
  const rotatePresence = async () => {
    if (!client.user) return;
    const totalGuilds = await getTotalGuilds(); // servidores que o bot está
    // Soma todas as criações históricas da collection daily_usage
    let totalCreations = 0;
    try {
      const allDocs = await mongoDB.collection('daily_usage').find({}).toArray();
      totalCreations = allDocs.reduce((a, d) => a + (d.count || 0), 0);
    } catch (_) {}
    const statuses = [
      { name: `🏗️ ${totalCreations} servidores criados`,        type: ActivityType.Custom },
      { name: `⚡ Architect ${VERSION} · Premium disponível`, type: ActivityType.Custom },
      { name: `🛡️ Protegendo ${totalGuilds} comunidades`,    type: ActivityType.Custom },
      { name: `🤖 Velroc Systems`,                     type: ActivityType.Custom },
    ];
    const s = statuses[_statusIndex % statuses.length];
    client.user.setPresence({ status: 'online', activities: [{ name: s.name, type: s.type, state: s.name }] });
    _statusIndex++;
  };

  rotatePresence();
  if (!client._presenceInterval) {
    client._presenceInterval = setInterval(rotatePresence, 10000); // troca status a cada 10s com contagem atualizada
  }

  // Atualiza imediatamente quando o bot entra/sai de um servidor
  client.on('guildCreate', () => rotatePresence());
  client.on('guildDelete', () => rotatePresence());

  const commands = [
    new SlashCommandBuilder().setName('criar_servidor').setDescription('Cria servidor completo com IA').addStringOption(o => o.setName('prompt').setDescription('Descreva o servidor').setRequired(true)),
    new SlashCommandBuilder().setName('template').setDescription('Aplica template pronto').addStringOption(o => o.setName('tipo').setDescription('Tipo').setRequired(true).addChoices({ name: '🌐 Comunidade', value: 'comunidade' }, { name: '🎮 Gaming', value: 'gaming' }, { name: '🪖 Militar', value: 'militar' }, { name: '🛒 Loja', value: 'loja' }, { name: '🎌 Anime', value: 'anime' }, { name: '📚 Educacional', value: 'educacional' })),
    new SlashCommandBuilder().setName('backup').setDescription('Salva estrutura do servidor'),
    new SlashCommandBuilder().setName('restaurar').setDescription('Restaura servidor do backup'),
    new SlashCommandBuilder().setName('proteger').setDescription('Ativa/desativa anti-nuke').addBooleanOption(o => o.setName('ativo').setDescription('Ativar ou desativar').setRequired(true)),
    new SlashCommandBuilder().setName('deletar').setDescription('Deleta canais, cargos ou tudo').addStringOption(o => o.setName('tipo').setDescription('O que deletar').setRequired(true).addChoices({ name: '🎭 Cargos', value: 'cargos' }, { name: '💬 Canais', value: 'canais' }, { name: '🗑️ Tudo', value: 'tudo' })).addStringOption(o => o.setName('alvo').setDescription('Quais ou "everyone"').setRequired(false)).addBooleanOption(o => o.setName('tudo').setDescription('Deletar tudo?').setRequired(false)),
    new SlashCommandBuilder().setName('status').setDescription('Informações do servidor'),
    new SlashCommandBuilder().setName('cargo_criar').setDescription('Cria um cargo').addStringOption(o => o.setName('nome').setDescription('Nome').setRequired(true)).addStringOption(o => o.setName('cor').setDescription('Cor do cargo').setRequired(false).addChoices(
      { name: '🔴 Vermelho',      value: '#e74c3c' },
      { name: '🟠 Laranja',       value: '#e67e22' },
      { name: '🟡 Amarelo',       value: '#f1c40f' },
      { name: '🟢 Verde',         value: '#2ecc71' },
      { name: '🔵 Azul',          value: '#3498db' },
      { name: '🟣 Roxo',          value: '#9b59b6' },
      { name: '🩷 Rosa',          value: '#e91e8c' },
      { name: '⚪ Branco',        value: '#ffffff' },
      { name: '⚫ Preto',         value: '#23272a' },
      { name: '🩶 Cinza',         value: '#95a5a6' },
      { name: '🟤 Marrom',        value: '#795548' },
      { name: '🔷 Azul Escuro',   value: '#1a237e' },
      { name: '🌊 Ciano',         value: '#00bcd4' },
      { name: '🟩 Verde Lima',    value: '#8bc34a' },
      { name: '🧡 Âmbar',         value: '#ff6f00' },
      { name: '💜 Violeta',       value: '#5865f2' },
    )).addBooleanOption(o => o.setName('admin').setDescription('Admin?').setRequired(false)),
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
    new SlashCommandBuilder().setName('embed').setDescription('Cria embed personalizado').addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true)).addStringOption(o => o.setName('descrição').setDescription('Descrição').setRequired(true)).addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(false)).addStringOption(o => o.setName('cor').setDescription('Cor hex').setRequired(false)).addStringOption(o => o.setName('imagem').setDescription('URL da imagem').setRequired(false)).addStringOption(o => o.setName('rodape').setDescription('Rodapé').setRequired(false)),
    new SlashCommandBuilder().setName('anuncio').setDescription('Envia anúncio').addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true)).addStringOption(o => o.setName('mensagem').setDescription('Mensagem').setRequired(true)).addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(true)).addBooleanOption(o => o.setName('marcar_everyone').setDescription('Marcar @everyone?').setRequired(false)),
    new SlashCommandBuilder().setName('idioma').setDescription('Altera o idioma do bot no servidor').addStringOption(o => o.setName('lang').setDescription('Idioma').setRequired(true).addChoices({ name: '🇧🇷 Português', value: 'pt' }, { name: '🇺🇸 English', value: 'en' }, { name: '🇪🇸 Español', value: 'es' }, { name: '🇫🇷 Français', value: 'fr' }, { name: '🇩🇪 Deutsch', value: 'de' })),
    new SlashCommandBuilder().setName('doar').setDescription('Apoie o desenvolvimento do Architect'),
    new SlashCommandBuilder().setName('dm').setDescription('Enviar mensagem oficial').addStringOption(o => o.setName('mensagem').setDescription('Mensagem').setRequired(true)),
    new SlashCommandBuilder().setName('premium').setDescription('Gerenciar Premium do Architect').addUserOption(o => o.setName('usuário').setDescription('Usuário').setRequired(true)).addStringOption(o => o.setName('plano').setDescription('Plano').setRequired(true).addChoices({ name: '⚡ Semanal (7 dias)', value: 'semanal' }, { name: '💎 Mensal (30 dias)', value: 'mensal' }, { name: '👑 Anual (365 dias)', value: 'anual' }, { name: '❌ Remover', value: 'remover' })),
    new SlashCommandBuilder().setName('info').setDescription('Informações do Architect'),
    new SlashCommandBuilder().setName('help').setDescription('Lista de comandos'),
    new SlashCommandBuilder().setName('usuários').setDescription('Estatísticas de uso do Architect hoje').addStringOption(o => o.setName('data').setDescription('Data no formato YYYY-MM-DD (padrão: hoje)').setRequired(false)),
    new SlashCommandBuilder().setName('tickets').setDescription('Mostra o ranking de atendimentos da staff neste servidor'),

    // ── Novos comandos ────────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('bansoft').setDescription('Bane um membro e deleta todas as mensagens dele')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),

    new SlashCommandBuilder().setName('logs_config').setDescription('Configura o canal de logs de cada sistema')
      .addStringOption(o => o.setName('tipo').setDescription('Tipo de log').setRequired(true).addChoices(
        { name: '🔨 Bans / Kicks', value: 'ban' },
        { name: '🔇 Mutes',        value: 'mute' },
        { name: '🎫 Tickets',      value: 'ticket' },
        { name: '⚠️ Warns',        value: 'warn' },
        { name: '🤖 IA Detect',    value: 'detect' },
        { name: '🤝 Parcerias',    value: 'parceria' },
        { name: '📋 Todos',        value: 'all' },
      ))
      .addChannelOption(o => o.setName('canal').setDescription('Canal de logs').setRequired(true)),

    new SlashCommandBuilder().setName('ia_config').setDescription('(Premium) Personaliza o prompt da IA para você')
      .addStringOption(o => o.setName('prompt').setDescription('Descreva como a IA deve se comportar / quantidade de cargos etc').setRequired(true)),

    new SlashCommandBuilder().setName('set_parceria').setDescription('Define o canal e cargo de parceria do servidor')
      .addChannelOption(o => o.setName('canal').setDescription('Canal onde as parcerias serão enviadas').setRequired(true))
      .addRoleOption(o => o.setName('cargo').setDescription('Cargo necessário para usar /parceria').setRequired(false))
      .addStringOption(o => o.setName('mensagem').setDescription('Mensagem personalizada (opcional)').setRequired(false)),

    new SlashCommandBuilder().setName('ia_detect').setDescription('Ativa a detecção inteligente de conteúdo suspeito')
      .addBooleanOption(o => o.setName('ativo').setDescription('Ativar ou desativar').setRequired(true)),

    new SlashCommandBuilder().setName('detect_config').setDescription('Configura as ações do sistema de detecção IA')
      .addStringOption(o => o.setName('nivel').setDescription('Nível de severidade').setRequired(true).addChoices(
        { name: '🟡 Baixo — apenas avisar no log',        value: 'low' },
        { name: '🟠 Médio — mutar automaticamente',       value: 'medium' },
        { name: '🔴 Alto — banir automaticamente',        value: 'high' },
      ))
      .addBooleanOption(o => o.setName('links').setDescription('Detectar links suspeitos?').setRequired(false))
      .addBooleanOption(o => o.setName('divulgacao').setDescription('Detectar divulgações indiretas?').setRequired(false))
      .addBooleanOption(o => o.setName('spam').setDescription('Detectar spam?').setRequired(false)),

    // ── Parceria manual ───────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('parceria').setDescription('Registra uma nova parceria no servidor')
      .addStringOption(o => o.setName('descrição').setDescription('Descrição da parceria / servidor parceiro').setRequired(true))
      .addStringOption(o => o.setName('invite').setDescription('Link de convite do servidor parceiro').setRequired(false)),

    // ── set_parceria atualizado ────────────────────────────────────────────────
    // (já registrado acima, mas atualizando as opções)

    // ── Moderação extra ───────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('warns').setDescription('Ver advertências de um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)),
    new SlashCommandBuilder().setName('clearwarns').setDescription('Limpar advertências de um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)),
    new SlashCommandBuilder().setName('move').setDescription('Move um membro para outro canal de voz')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
      .addChannelOption(o => o.setName('canal').setDescription('Canal de destino').setRequired(true)),
    new SlashCommandBuilder().setName('nick').setDescription('Altera o apelido de um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true))
      .addStringOption(o => o.setName('apelido').setDescription('Novo apelido (vazio para remover)').setRequired(false)),

    // ── Informações ───────────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('userinfo').setDescription('Informações detalhadas de um usuário')
      .addUserOption(o => o.setName('usuário').setDescription('Usuário (padrão: você)').setRequired(false)),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Informações detalhadas do servidor'),
    new SlashCommandBuilder().setName('avatar').setDescription('Exibe o avatar de um usuário')
      .addUserOption(o => o.setName('usuário').setDescription('Usuário (padrão: você)').setRequired(false)),
    new SlashCommandBuilder().setName('roleinfo').setDescription('Informações de um cargo')
      .addRoleOption(o => o.setName('cargo').setDescription('Cargo').setRequired(true)),

    // ── Engajamento ───────────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('sorteio').setDescription('Cria um sorteio no canal')
      .addStringOption(o => o.setName('premio').setDescription('Prêmio').setRequired(true))
      .addIntegerOption(o => o.setName('duracao').setDescription('Duração em minutos').setRequired(true).setMinValue(1).setMaxValue(10080))
      .addIntegerOption(o => o.setName('vencedores').setDescription('Quantidade de vencedores').setRequired(false).setMinValue(1).setMaxValue(10))
      .addRoleOption(o => o.setName('cargo_req').setDescription('Cargo necessário para participar').setRequired(false)),
    new SlashCommandBuilder().setName('enquete').setDescription('Cria uma enquete')
      .addStringOption(o => o.setName('pergunta').setDescription('Pergunta da enquete').setRequired(true))
      .addStringOption(o => o.setName('opcao1').setDescription('Opção 1').setRequired(true))
      .addStringOption(o => o.setName('opcao2').setDescription('Opção 2').setRequired(true))
      .addStringOption(o => o.setName('opcao3').setDescription('Opção 3').setRequired(false))
      .addStringOption(o => o.setName('opcao4').setDescription('Opção 4').setRequired(false)),
    new SlashCommandBuilder().setName('contador').setDescription('Define canal de contador de membros')
      .addChannelOption(o => o.setName('canal').setDescription('Canal de voz para o contador').setRequired(true)),

    // ── Autorole ──────────────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('autorole').setDescription('Define cargo automático para novos membros')
      .addRoleOption(o => o.setName('cargo').setDescription('Cargo (vazio para desativar)').setRequired(false)),

    new SlashCommandBuilder().setName('reaction_role').setDescription('Configura cargo por reacao em uma mensagem')
      .addStringOption(o => o.setName('mensagem_id').setDescription('ID da mensagem').setRequired(true))
      .addRoleOption(o => o.setName('cargo').setDescription('Cargo a dar/remover').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji da reacao').setRequired(true))
      .addChannelOption(o => o.setName('canal').setDescription('Canal da mensagem (padrão: atual)').setRequired(false)),

    new SlashCommandBuilder().setName('button_role').setDescription('Cria painel com botao para dar/remover cargo')
      .addRoleOption(o => o.setName('cargo').setDescription('Cargo a dar/remover').setRequired(true))
      .addStringOption(o => o.setName('titulo').setDescription('Titulo do painel').setRequired(false))
      .addStringOption(o => o.setName('descrição').setDescription('Descrição do painel').setRequired(false))
      .addChannelOption(o => o.setName('canal').setDescription('Canal para enviar (padrão: atual)').setRequired(false)),

    // ── Ticket Setup ──────────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('ticket_criar').setDescription('Configura o sistema de tickets do servidor')
      .addChannelOption(o => o.setName('canal').setDescription('Canal onde o painel de tickets será enviado').setRequired(true))
      .addStringOption(o => o.setName('titulo').setDescription('Título do painel').setRequired(false))
      .addStringOption(o => o.setName('descrição').setDescription('Descrição do painel').setRequired(false))
      .addStringOption(o => o.setName('categorias').setDescription('Categorias separadas por vírgula (ex: Suporte,Dúvidas,Parceria)').setRequired(false))
      .addRoleOption(o => o.setName('cargo_staff').setDescription('Cargo que pode ver e gerenciar tickets').setRequired(false)),

    // ── Moderação extra ───────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('role_all').setDescription('Adiciona ou remove um cargo de todos os membros')
      .addRoleOption(o => o.setName('cargo').setDescription('Cargo a aplicar').setRequired(true))
      .addStringOption(o => o.setName('acao').setDescription('Ação').setRequired(true)
        .addChoices({ name: '➕ Adicionar', value: 'add' }, { name: '➖ Remover', value: 'remove' })),

    new SlashCommandBuilder().setName('mention_role').setDescription('Menciona um cargo com uma mensagem (mesmo que não seja mencionável)')
      .addRoleOption(o => o.setName('cargo').setDescription('Cargo a mencionar').setRequired(true))
      .addStringOption(o => o.setName('mensagem').setDescription('Mensagem a enviar').setRequired(true))
      .addChannelOption(o => o.setName('canal').setDescription('Canal (padrão: atual)').setRequired(false)),

    new SlashCommandBuilder().setName('automod').setDescription('Configura o AutoMod do servidor')
      .addStringOption(o => o.setName('acao').setDescription('O que configurar').setRequired(true)
        .addChoices(
          { name: '🚫 Anti-Link', value: 'anti_link' },
          { name: '📢 Anti-Spam', value: 'anti_spam' },
          { name: '🤬 Anti-Palavrão', value: 'anti_palavrao' },
          { name: '📋 Ver Config', value: 'ver' },
          { name: '🗑️ Desativar Tudo', value: 'desativar' },
        ))
      .addRoleOption(o => o.setName('cargo_ignorado').setDescription('Cargo isento das regras').setRequired(false)),

    new SlashCommandBuilder().setName('reset').setDescription('Recria o canal atual deletando todo o histórico')
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),

    // ── /chat ─────────────────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('chat').setDescription('Converse com o Architect por texto usando IA')
      .addStringOption(o => o.setName('pergunta').setDescription('O que você quer perguntar?').setRequired(true)),

    new SlashCommandBuilder().setName('google_voice').setDescription('Resposta de voz do Architect usando Google TTS')
      .addStringOption(o => o.setName('pergunta').setDescription('O que você quer perguntar?').setRequired(true)),

  ].map(c => c.toJSON());

  // Registra comandos apenas no shard 0 (ou sem sharding) para evitar conflito
  const shardIdNow = client.shard?.ids?.[0] ?? 0;
  if (shardIdNow === 0) {
    try {
      const rest = new REST().setToken(process.env.DISCORD_TOKEN);
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log(`<:aceitar:1500524505746116800> ${commands.length} comandos registrados!`);
    } catch (e) { console.error('<:negar:1500524485231509785> Erro ao registrar comandos:', e.message); }
  }
});

// ── Interaction Handler ────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  // ── Global error boundary ─────────────────────────────────────────────────
  try {

  // ── Guard: ignora interações fora de servidor (DMs, etc.) ────────────────
  if (!interaction.guild || !interaction.guildId) return;
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split('_confirm_');

    // Confirmar criação
    if (action === 'create' && pendingCreate.has(id)) {
      const { prompt, structure, isPremium } = pendingCreate.get(id);
      pendingCreate.delete(id);
      const steps = [];

      // deferUpdate responde ao Discord imediatamente (<3s), depois editReply atualiza
      await interaction.deferUpdate();

      const update = async (icon, msg) => {
        steps.push(`${icon} ${msg}`);
        await interaction.editReply({
          ...buildProgressEmbed(`${E.servidores}  Construindo Servidor...`, prompt, steps),
        }).catch(() => {});
      };

      // Mostra o embed de progresso inicial
      await interaction.editReply(
        buildProgressEmbed(`${E.servidores}  Construindo Servidor...`, prompt, steps)
      ).catch(() => {});

      try {
        await applyStructure(interaction.guild, structure, update);
        const totalChannels = structure.categories?.reduce((a, c) => a + (c.channels?.length || 0), 0) || 0;

        // Resumo de tipos de canais
        const allChannels = (structure.categories || []).flatMap(c => c.channels || []);
        const countByType = allChannels.reduce((acc, ch) => { acc[ch.type || 'text'] = (acc[ch.type || 'text'] || 0) + 1; return acc; }, {});
        const typeLines = Object.entries(countByType)
          .map(([t, n]) => {
            const icons = { text: '<:canal:1500524470270562304>', voice: '🔊', forum: '<:lista:1500524503778988072>', announcement: '<:avisos:1500524507171918006>', stage: '🎙️' };
            return `${icons[t] || '📌'} **${n}** ${t}`;
          }).join('  ·  ');

        const successContent = [
          `## ${E.sucesso} Servidor criado com sucesso!`,
          ``,
          `> Toda a estrutura foi aplicada com sucesso no servidor.`,
          ``,
          `**${E.cargos} Cargos:** ${structure.roles?.length || 0}  ·  **${E.cats} Categorias:** ${structure.categories?.length || 0}  ·  **${E.canais} Canais:** ${totalChannels}`,
          ...(typeLines ? [`**Distribuição:** ${typeLines}`] : []),
          ``,
          `-# Architect ${VERSION} · architect.velroc.workers.dev`,
        ].join('\n');

        const successEmbed = {
          flags: MessageFlags.IsComponentsV2,
          components: [v2Container(C_GREEN, successContent)],
        };

        // Gera o card de imagem
        const guild = interaction.guild;
        const imageBuffer = await generateServerCard({
          guildName:  guild.name,
          guildIcon:  guild.iconURL({ extension: 'png', size: 256 }),
          roles:      structure.roles?.length || 0,
          categories: structure.categories?.length || 0,
          channels:   totalChannels,
          isPremium:  !!isPremium,
          prompt,
        });

        const { AttachmentBuilder } = require('discord.js');
        const containerComponents = [
          { type: 10, content: successContent }, // TextDisplay
        ];

        // imageBuffer é sempre um Buffer PNG (ou null se canvas não disponível)
        if (imageBuffer) {
          containerComponents.push({
            type: 11, // MediaGallery
            items: [{ media: { url: 'attachment://architect-resultado.png' } }],
          });
        }

        const replyPayload = {
          flags: MessageFlags.IsComponentsV2,
          components: [
            {
              type: 17, // Container
              accent_color: C_GREEN,
              components: containerComponents,
            },
          ],
          ...(imageBuffer ? { files: [new AttachmentBuilder(imageBuffer, { name: 'architect-resultado.png' })] } : {}),
        };

        await interaction.editReply(replyPayload).catch(async () => {
          await interaction.user.send({ ...replyPayload }).catch(() => {});
        });

        // DM de voto no top.gg após criação bem-sucedida
        interaction.user.send(
          `Se você gostou do Architect, vote aqui para ajudar: https://top.gg/bot/1353210073832357992?s=03ad7aa496c89\nObrigado! 🙏`
        ).catch(() => {});
      } catch (e) {
        const errEmbed = errorEmbed(e.message);
        await interaction.editReply(errEmbed).catch(async () => {
          await interaction.user.send(errEmbed).catch(() => {});
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

      await interaction.deferUpdate();

      const update = async (icon, msg) => {
        steps.push(`${icon} ${msg}`);
        await interaction.editReply({
          ...buildProgressEmbed(`${E.backup}  Restaurando...`, `Backup de ${label}`, steps),
        }).catch(() => {});
      };

      await interaction.editReply(
        buildProgressEmbed(`${E.backup}  Restaurando Servidor...`, `Backup de ${label}`, steps)
      ).catch(() => {});

      try {
        await applyStructure(interaction.guild, backup.structure, update);
        await update(E.sucesso, 'Servidor restaurado com sucesso!');
      } catch (e) {
        await interaction.editReply(errorEmbed(e.message)).catch(() => {});
      }
      return;
    }

    // Confirmar deleção
    if (action === 'delete' && pendingCreate.has(`del_${id}`)) {
      const { acao, alvo } = pendingCreate.get(`del_${id}`);
      pendingCreate.delete(`del_${id}`);
      await interaction.deferUpdate();
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
        await interaction.editReply(v2Simple(C_GREEN, `${E.sucesso} Deleção Concluída`, `**${deletedCount}** item(s) deletado(s)!`, `Architect ${VERSION}`));
      } catch (e) { await interaction.editReply(errorEmbed(e.message)); }
      return;
    }

    // Cancelar
    if (action === 'cancel') {
      pendingCreate.delete(id);
      pendingRestore.delete(id);
      await interaction.deferUpdate();
      await interaction.editReply(v2Simple(C_GREY, '<:negar:1500524485231509785> Cancelado', 'Operação cancelada pelo usuário.', `Architect ${VERSION}`)).catch(() => {});
      return;
    }

    // ── Ticket — verificação de cargo helper ────────────────────────────────────
    async function assertTicketStaffPermission(intr) {
      const config = await mongoDB?.collection('guild_configs').findOne({ guildId: intr.guild.id });
      const ticketRoleId = config?.ticketRole;
      if (!ticketRoleId) return true; // sem cargo configurado = qualquer um pode
      const member = intr.guild.members.cache.get(intr.user.id) || await intr.guild.members.fetch(intr.user.id).catch(() => null);
      if (!member) return false;
      const hasRole = member.roles.cache.has(ticketRoleId);
      if (!hasRole) {
        await intr.reply({ content: `${E.erro} Somente <@&${ticketRoleId}> pode usar este botão.`, flags: MessageFlags.Ephemeral });
        return false;
      }
      return true;
    }

    // ── Ticket — <:lockcanal:1500524516324147470> Fechar ──────────────────────────────────────────────────────
    if (interaction.customId.startsWith('ticket_close_')) {
      if (!await assertTicketStaffPermission(interaction)) return;
      const chId = interaction.customId.replace('ticket_close_', '');
      const ch   = interaction.guild.channels.cache.get(chId);
      if (!ch) return interaction.reply({ content: 'Canal não encontrado.', flags: MessageFlags.Ephemeral });

      // Se estava reivindicado, incrementa stats do staff
      const claim = ticketClaimed.get(chId);
      if (claim) {
        const prev = ticketStats.get(claim.staffId) || 0;
        ticketStats.set(claim.staffId, prev + 1);
        ticketClaimed.delete(chId);
        // Persiste no mongo
        await mongoDB?.collection('ticket_stats').updateOne(
          { staffId: claim.staffId, guildId: interaction.guild.id },
          { $inc: { count: 1 }, $set: { staffTag: claim.staffTag } },
          { upsert: true }
        ).catch(() => {});
      }
      staffCallCooldown.delete(chId);

      await interaction.reply({
        ...v2Simple(C_RED, '<:lockcanal:1500524516324147470> Ticket Fechado', `Ticket encerrado por <@${interaction.user.id}>. O canal será deletado em 5 segundos.`, `Architect ${VERSION}`),
      });
      setTimeout(async () => { await ch.delete().catch(() => {}); }, 5000);
      return;
    }

    // ── Ticket — <:notificacao:1500524483801251890> Chamar Staff (cooldown 30min) ───────────────────────────────
    if (interaction.customId.startsWith('ticket_call_staff_')) {
      const chId  = interaction.customId.replace('ticket_call_staff_', '');
      const uid   = interaction.user.id;
      const now   = Date.now();
      const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos

      if (!staffCallCooldown.has(chId)) staffCallCooldown.set(chId, new Map());
      const chCooldown = staffCallCooldown.get(chId);
      const lastCall   = chCooldown.get(uid) || 0;
      const remaining  = COOLDOWN_MS - (now - lastCall);

      if (remaining > 0) {
        const mins = Math.ceil(remaining / 60000);
        // ephemeral puro sem V2 — sem conflito
        return interaction.reply({ content: `${E.erro} Aguarde **${mins} minuto(s)** para chamar a staff novamente.`, flags: MessageFlags.Ephemeral });
      }

      chCooldown.set(uid, now);

      const config       = await mongoDB?.collection('guild_configs').findOne({ guildId: interaction.guild.id });
      const staffMention = config?.ticketRole ? `<@&${config.ticketRole}>` : '';

      // Primeiro: ping real em mensagem separada (sem V2, para o Discord processar a menção)
      if (staffMention) {
        await interaction.channel?.send({ content: staffMention, allowedMentions: { roles: [config.ticketRole] } }).catch(() => {});
      }

      // Depois: resposta V2 confirmando
      await interaction.reply({
        ...v2Simple(C_YELLOW, '<:notificacao:1500524483801251890> Staff Chamada!', `<@${uid}> está precisando de ajuda neste ticket.\n\nA equipe foi notificada e responderá em breve.`, `Architect ${VERSION}`),
      });
      return;
    }

    // ── Ticket — Reivindicar ──────────────────────────────────────────────────
    if (interaction.customId.startsWith('ticket_claim_')) {
      if (!await assertTicketStaffPermission(interaction)) return;
      const chId = interaction.customId.replace('ticket_claim_', '');

      const already = ticketClaimed.get(chId);
      if (already) {
        // ephemeral puro — sem V2
        return interaction.reply({ content: `${E.erro} Este ticket já foi reivindicado por <@${already.staffId}>.`, flags: MessageFlags.Ephemeral });
      }

      ticketClaimed.set(chId, {
        staffId:   interaction.user.id,
        staffTag:  interaction.user.tag,
        claimedAt: new Date().toISOString(),
      });

      await interaction.reply({
        ...v2Simple(C_GREEN,
          '<:aceitar:1500524505746116800> Ticket Reivindicado',
          `<@${interaction.user.id}> está atendendo este ticket.\nApenas este membro da staff é responsável agora.`,
          `Architect ${VERSION}`
        ),
      });
      return;
    }

    // Ticket — abrir ticket via botão
    if (interaction.customId === 'ticket_open') {
      await handleTicketOpen(interaction, null);
      return;
    }
    return;
  }

  // ── Select Menu (ticket categories) ────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'ticket_select') {
      const selected = interaction.values[0];
      const config   = await mongoDB?.collection('guild_configs').findOne({ guildId: interaction.guild.id });
      const cat      = (config?.ticketCategories || []).find(c => c.name.toLowerCase().replace(/\s+/g,'_') === selected);
      await handleTicketOpen(interaction, cat?.name || selected);
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, member } = interaction;
  const lang       = await getGuildLang(guild.id);
  const publicCmds = ['info', 'help', 'status', 'doar', 'idioma', 'chat', 'google_voice'];

  if (!publicCmds.includes(commandName) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
  }

  // Rastreia uso do comando
  isUserPremium(interaction.user.id)
    .then(p => trackCommandUsage(interaction.user.id, commandName, p))
    .catch(() => {});

  // ── /criar_servidor ──────────────────────────────────────────────────────────
  if (commandName === 'criar_servidor') {
    const prompt = interaction.options.getString('prompt');
    const userId = interaction.user.id;

    // Defer imediatamente — ANTES de qualquer await, para garantir resposta em <3s ao Discord
    await interaction.deferReply();

    const isPremium = await resolveIsPremium(userId, guild);

    // ── Limite diário para usuários normais ──────────────────────────────────
    const limitCheck = await checkDailyLimit(userId, isPremium);
    if (!limitCheck.allowed) {
      return interaction.editReply({ ...v2Simple(C_RED,
        `${E.erro} Limite Diário Atingido`,
        `Você já usou suas **${limitCheck.limit} criações gratuitas** de hoje.\n\n> Volte amanhã ou adquira o ${E.premium} **Premium** para criações ilimitadas!\n\n**Uso hoje:** ${limitCheck.used}/${limitCheck.limit} criações`,
        `Architect ${VERSION}`
      ) });
    }

    // Escolhe a lane correta conforme Premium ou Normal
    const chosenLane = getLane(isPremium);
    const posInLane  = chosenLane.queue.length + (chosenLane.busy ? 1 : 0);
    const secsAhead  = (chosenLane.busy ? SECS_PER_GENERATION : 0) + posInLane * SECS_PER_GENERATION;

    if (posInLane > 0) {
      await interaction.editReply({ ...buildQueueEmbed(prompt, chosenLane.name, posInLane + 1, secsAhead) });
    } else {
      await interaction.editReply({ ...buildAnalysisEmbed(prompt, []) });
    }

    const logs  = [];
    let generationStarted = false;

    const onLog = async (icon, tag, msg) => {
      logs.push({ icon, tag, msg });
      console.log(`[${tag}] ${msg}`);
      // Atualiza o embed de análise em tempo real durante a geração
      if (generationStarted) {
        await interaction.editReply({
          ...buildAnalysisEmbed(prompt, logs),
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
          ...buildQueueEmbed(prompt, status.lane, status.position, remaining),
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
            await interaction.editReply({ ...buildAnalysisEmbed(prompt, logs) }).catch(() => {});
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
      await interaction.editReply({ ...buildAnalysisEmbed(prompt, logs) });

      const confirmId = `${interaction.id}`;
      pendingCreate.set(confirmId, { prompt, structure, isPremium });
      await interaction.editReply(
        v2WithRow(buildConfirmEmbed(prompt, structure, 60), buildConfirmRow(confirmId))
      );
      startCountdown(interaction, confirmId, prompt, structure);
    } catch (e) {
      if (etaInterval) clearInterval(etaInterval);
      await interaction.editReply(errorEmbed(e.message)).catch(() => {});
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
      return interaction.reply({ ...v2Simple(C_RED,
        `${E.erro} Limite Diário Atingido`,
        `Você já usou suas **${limitCheck.limit} criações gratuitas** de hoje.\n\n> Volte amanhã ou adquira o ${E.premium} **Premium** para criações ilimitadas!\n\n**Uso hoje:** ${limitCheck.used}/${limitCheck.limit} criações`,
        `Architect ${VERSION}`
      ), flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const chosenLane = getLane(isPremium);
    const posInLane  = chosenLane.queue.length + (chosenLane.busy ? 1 : 0);
    const secsAhead  = (chosenLane.busy ? SECS_PER_GENERATION : 0) + posInLane * SECS_PER_GENERATION;

    if (posInLane > 0) {
      await interaction.editReply({ ...buildQueueEmbed(prompt, chosenLane.name, posInLane + 1, secsAhead) });
    } else {
      await interaction.editReply({ ...buildAnalysisEmbed(prompt, []) });
    }

    const logs  = [];
    let generationStartedT = false;

    const onLog = async (icon, tag, msg) => {
      logs.push({ icon, tag, msg });
      console.log(`[${tag}] ${msg}`);
      if (generationStartedT) {
        await interaction.editReply({ ...buildAnalysisEmbed(prompt, logs) }).catch(() => {});
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
          ...buildQueueEmbed(prompt, status.lane, status.position, remaining),
        }).catch(() => {});
      }, 1000);
    }

    try {
      const structure = await new Promise((resolve, reject) => {
        chosenLane.queue.push({
          task: async () => {
            generationStartedT = true;
            if (etaInterval) { clearInterval(etaInterval); etaInterval = null; }
            await interaction.editReply({ ...buildAnalysisEmbed(prompt, logs) }).catch(() => {});
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
      await interaction.editReply({ ...buildAnalysisEmbed(prompt, logs) });

      const confirmId = `${interaction.id}`;
      pendingCreate.set(confirmId, { prompt, structure, isPremium });
      await interaction.editReply(
        v2WithRow(buildConfirmEmbed(prompt, structure, 60), buildConfirmRow(confirmId))
      );
      startCountdown(interaction, confirmId, prompt, structure, tipo);
    } catch (e) {
      if (etaInterval) { clearInterval(etaInterval); etaInterval = null; }
      await interaction.editReply(errorEmbed(e.message)).catch(() => {});
    }
  }

  // ── /backup ──────────────────────────────────────────────────────────────────
  else if (commandName === 'backup') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const structure = await captureStructure(guild);
      await saveBackup(guild.id, guild.name, structure);
      const chTotal = structure.categories.reduce((a, c) => a + c.channels.length, 0);
      await interaction.editReply(v2Simple(C_GREEN,
        lang.backupSaved,
        `Estrutura de **${guild.name}** salva com sucesso!\n\n` +
        `**${E.cargos} Cargos:** ${structure.roles.length}   **${E.canais} Categorias:** ${structure.categories.length}   **${E.canais} Canais:** ${chTotal}\n` +
        `**${E.data} Salvo em:** ${new Date().toLocaleString('pt-BR')}`,
        `Architect ${VERSION}`
      ));
    } catch (e) { await interaction.editReply(errorEmbed(e.message)); }
  }

  // ── /restaurar ───────────────────────────────────────────────────────────────
  else if (commandName === 'restaurar') {
    const backup = await getBackup(guild.id);
    if (!backup) return interaction.reply({ content: lang.noBackup, flags: MessageFlags.Ephemeral });
    const confirmId = `${interaction.id}`;
    pendingRestore.set(confirmId, { backup });
    setTimeout(() => pendingRestore.delete(confirmId), 60000);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`restore_confirm_${confirmId}`)
        .setLabel('Restaurar')
        .setEmoji({ id: '1500524465249845368', name: 'recarregando' })
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`cancel_confirm_${confirmId}`)
        .setLabel('Cancelar')
        .setEmoji({ id: '1500524485231509785', name: 'negar' })
        .setStyle(ButtonStyle.Danger),
    );
    await interaction.reply(v2WithRow(v2Simple(C_BLUE,
      `${E.backup} Restaurar Backup`,
      `> <:atencao:1500524473827459263> **Isso irá apagar TUDO e restaurar o backup.**\n\n**${E.data} Backup de:** ${new Date(backup.savedAt).toLocaleString('pt-BR')}`,
      `Architect ${VERSION}`
    ), row));
  }

  // ── /proteger ────────────────────────────────────────────────────────────────
  else if (commandName === 'proteger') {
    const ativo  = interaction.options.getBoolean('ativo');
    const backup = await getBackup(guild.id);
    if (ativo && !backup) return interaction.reply({ content: `${E.erro} Faça um **/backup** primeiro!`, flags: MessageFlags.Ephemeral });
    if (backup) await setProtection(guild.id, ativo);
    await interaction.reply(v2Simple(
      ativo ? C_GREEN : C_RED,
      ativo ? `${E.lock} Proteção Ativada!` : `${E.unlock} Proteção Desativada`,
      ativo ? `${E.sucesso} Anti-nuke ativo. Monitorando em tempo real.` : `${E.erro} Proteção desativada.`,
      `Architect ${VERSION}`
    ));
  }

  // ── /deletar ─────────────────────────────────────────────────────────────────
  else if (commandName === 'deletar') {
    const tipo = interaction.options.getString('tipo');
    const alvo = interaction.options.getString('alvo') || '';
    const tudo = interaction.options.getBoolean('tudo') || false;
    let descrição = '', acao = '';

    if (tipo === 'cargos') {
      if (tudo || alvo.toLowerCase() === 'everyone') { descrição = '<:deletar:1500524511081140384> Todos os cargos serão deletados.'; acao = 'delete_roles_all'; }
      else { descrição = `<:deletar:1500524511081140384> Cargos: ${alvo}`; acao = 'delete_roles_specific'; }
    } else if (tipo === 'canais') {
      if (tudo || alvo.toLowerCase() === 'everyone') { descrição = '<:deletar:1500524511081140384> Todos os canais serão deletados.'; acao = 'delete_channels_all'; }
      else { descrição = `<:deletar:1500524511081140384> Canais: ${alvo}`; acao = 'delete_channels_specific'; }
    } else {
      descrição = '<:deletar:1500524511081140384> TUDO será deletado.'; acao = 'delete_all';
    }

    const confirmId = `${interaction.id}`;
    pendingCreate.set(`del_${confirmId}`, { tipo, alvo, tudo, acao });
    setTimeout(() => pendingCreate.delete(`del_${confirmId}`), 60000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`delete_confirm_${confirmId}`)
        .setLabel('Deletar')
        .setEmoji({ id: '1500524511081140384', name: 'deletar' })
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cancel_confirm_${confirmId}`)
        .setLabel('Cancelar')
        .setEmoji({ id: '1500524485231509785', name: 'negar' })
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply(v2WithRow(v2Simple(C_RED, '<:atencao:1500524473827459263> Confirmar Deleção', `> <:atencao:1500524473827459263> **Esta ação é irreversível!**\n\n${descrição}`, `Architect ${VERSION}`), row));
  }

  // ── /cargo_criar ─────────────────────────────────────────────────────────────
  else if (commandName === 'cargo_criar') {
    const nome = interaction.options.getString('nome');
    const cor  = interaction.options.getString('cor') || '#99aab5';
    const adm  = interaction.options.getBoolean('admin') || false;
    try {
      const role = await guild.roles.create({ name: nome, color: cor, permissions: adm ? [PermissionFlagsBits.Administrator] : [] });
      await interaction.reply(v2Simple(role.color, `${E.sucesso} Cargo Criado!`, `**${E.cargos} Nome:** ${role.name}   **🎨 Cor:** ${cor}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
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
      await interaction.reply(v2Simple(C_GREEN, `${E.sucesso} Canal Criado!`, `**${E.canais} Nome:** ${ch.name}   **<:categoria:1500524490214473758> Tipo:** ${tipo}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /status ──────────────────────────────────────────────────────────────────
  else if (commandName === 'status') {
    const backup   = await getBackup(guild.id);
    const channels = await guild.channels.fetch();
    await interaction.reply(v2Simple(C_BLUE,
      `${E.servidores} Status — ${guild.name}`,
      `**${E.membros} Membros:** ${guild.memberCount}   **${E.cargos} Cargos:** ${guild.roles.cache.filter(r => r.name !== '@everyone').size}   **${E.canais} Canais:** ${channels.filter(c => c.type === ChannelType.GuildText).size}\n` +
      `**${E.lock} Proteção:** ${backup?.protection ? `${E.sucesso} Ativa` : `${E.erro} Inativa`}   **${E.backup} Backup:** ${backup ? new Date(backup.savedAt).toLocaleString('pt-BR') : `${E.erro} Nenhum`}`,
      `Architect ${VERSION}`
    ));
  }

  // ── /ban ─────────────────────────────────────────────────────────────────────
  else if (commandName === 'ban') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    const dias   = interaction.options.getInteger('dias') || 0;
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    if (!target || !target.bannable) return interaction.reply({ content: `${E.erro} Não consigo banir este membro!`, flags: MessageFlags.Ephemeral });
    try {
      await target.send(v2Simple(C_RED, `${E.banido} Você foi banido!`, `Você foi banido de **${guild.name}**\n\n**Motivo:** ${motivo}`, `Architect ${VERSION}`)).catch(() => {});
      await target.ban({ reason: motivo, deleteMessageDays: dias });
      await interaction.reply(v2Simple(C_RED, `${E.banido} Membro Banido!`, `**${E.membros} Membro:** ${target.user.tag}   **<:lista:1500524503778988072> Motivo:** ${motivo}\n**<:deletar:1500524511081140384> Mensagens deletadas:** ${dias} dia(s)`, `Architect ${VERSION}`));
      await sendLog(guild.id, 'ban', v2Simple(C_RED, `🔨 Log — Ban`, `**Membro:** ${target.user.tag} (${target.id})\n**Moderador:** ${member.user.tag}\n**Motivo:** ${motivo}\n**Mensagens deletadas:** ${dias} dia(s)`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /kick ────────────────────────────────────────────────────────────────────
  else if (commandName === 'kick') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    if (!target || !target.kickable) return interaction.reply({ content: `${E.erro} Não consigo expulsar este membro!`, flags: MessageFlags.Ephemeral });
    try {
      await target.send(v2Simple(C_YELLOW, `${E.membros} Você foi expulso!`, `Você foi expulso de **${guild.name}**\n\n**Motivo:** ${motivo}`, `Architect ${VERSION}`)).catch(() => {});
      await target.kick(motivo);
      await interaction.reply(v2Simple(C_YELLOW, `${E.membros} Membro Expulso!`, `**${E.membros} Membro:** ${target.user.tag}   **<:lista:1500524503778988072> Motivo:** ${motivo}`, `Architect ${VERSION}`));
      await sendLog(guild.id, 'ban', v2Simple(C_YELLOW, `👢 Log — Kick`, `**Membro:** ${target.user.tag} (${target.id})\n**Moderador:** ${member.user.tag}\n**Motivo:** ${motivo}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /mute ────────────────────────────────────────────────────────────────────
  else if (commandName === 'mute') {
    const target  = interaction.options.getMember('membro');
    const motivo  = interaction.options.getString('motivo') || 'Sem motivo informado';
    const duracao = interaction.options.getInteger('duracao') || 10;
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, flags: MessageFlags.Ephemeral });
    try {
      await target.timeout(duracao * 60 * 1000, motivo);
      await interaction.reply(v2Simple(C_YELLOW, `${E.mutado} Membro Mutado!`, `**${E.membros} Membro:** ${target.user.tag}   **<:time:1500524456840400999> Duração:** ${duracao} min   **<:lista:1500524503778988072> Motivo:** ${motivo}`, `Architect ${VERSION}`));
      await sendLog(guild.id, 'mute', v2Simple(C_YELLOW, `🔇 Log — Mute`, `**Membro:** ${target.user.tag} (${target.id})\n**Moderador:** ${member.user.tag}\n**Duração:** ${duracao} min\n**Motivo:** ${motivo}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /unmute ──────────────────────────────────────────────────────────────────
  else if (commandName === 'unmute') {
    const target = interaction.options.getMember('membro');
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, flags: MessageFlags.Ephemeral });
    try {
      await target.timeout(null);
      await interaction.reply(v2Simple(C_GREEN, `${E.unlock} Membro Desmutado!`, `**${E.membros} Membro:** ${target.user.tag}`, `Architect ${VERSION}`));
      await sendLog(guild.id, 'mute', v2Simple(C_GREEN, `🔊 Log — Unmute`, `**Membro:** ${target.user.tag} (${target.id})\n**Moderador:** ${member.user.tag}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /warn ────────────────────────────────────────────────────────────────────
  else if (commandName === 'warn') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, flags: MessageFlags.Ephemeral });
    try {
      await target.send(v2Simple(C_YELLOW, '<:atencao:1500524473827459263> Advertência Recebida', `**Servidor:** ${guild.name}\n**Motivo:** ${motivo}`, `Architect ${VERSION}`)).catch(() => {});
      // Salva warn no MongoDB
      await mongoDB.collection('warns').insertOne({ guildId: guild.id, userId: target.id, moderatorId: member.id, motivo, createdAt: new Date() });
      const totalWarns = await mongoDB.collection('warns').countDocuments({ guildId: guild.id, userId: target.id });
      await interaction.reply(v2Simple(C_YELLOW, '<:atencao:1500524473827459263> Advertência Enviada!', `**${E.membros} Membro:** ${target.user.tag}   **<:lista:1500524503778988072> Motivo:** ${motivo}\n**Total de warns:** ${totalWarns}`, `Architect ${VERSION}`));
      await sendLog(guild.id, 'warn', v2Simple(C_YELLOW, `⚠️ Log — Warn`, `**Membro:** ${target.user.tag} (${target.id})\n**Moderador:** ${member.user.tag}\n**Motivo:** ${motivo}\n**Total de warns:** ${totalWarns}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /lock ────────────────────────────────────────────────────────────────────
  else if (commandName === 'lock') {
    const canal  = interaction.options.getChannel('canal') || interaction.channel;
    const motivo = interaction.options.getString('motivo') || 'Canal trancado';
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      await interaction.reply(v2Simple(C_RED, `${E.lock} Canal Trancado!`, `**${E.canais} Canal:** <#${canal.id}>   **<:lista:1500524503778988072> Motivo:** ${motivo}`, `Architect ${VERSION}`));
      await sendLog(guild.id, 'ban', v2Simple(C_RED, `🔒 Log — Canal Trancado`, `**Canal:** <#${canal.id}>\n**Moderador:** ${member.user.tag}\n**Motivo:** ${motivo}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /unlock ──────────────────────────────────────────────────────────────────
  else if (commandName === 'unlock') {
    const canal = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      await interaction.reply(v2Simple(C_GREEN, `${E.unlock} Canal Destrancado!`, `**${E.canais} Canal:** <#${canal.id}>`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /slowmode ────────────────────────────────────────────────────────────────
  else if (commandName === 'slowmode') {
    const segundos = interaction.options.getInteger('segundos');
    const canal    = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    try {
      await canal.setRateLimitPerUser(segundos);
      await interaction.reply(v2Simple(C_BLUE, `${E.config} Slowmode Configurado!`, `**${E.canais} Canal:** <#${canal.id}>   **<:time:1500524456840400999> Intervalo:** ${segundos === 0 ? 'Desativado' : `${segundos}s`}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /clear ───────────────────────────────────────────────────────────────────
  else if (commandName === 'clear') {
    const quantidade = interaction.options.getInteger('quantidade');
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const msgs = await interaction.channel.bulkDelete(Math.min(quantidade, 100), true);
      await interaction.editReply(v2Simple(C_GREEN, `${E.sucesso} Mensagens Deletadas!`, `**${msgs.size}** mensagem(s) deletada(s)!`, `Architect ${VERSION}`));
      await sendLog(guild.id, 'ban', v2Simple(C_BLUE, `🗑️ Log — Clear`, `**Canal:** <#${interaction.channel.id}>\n**Moderador:** ${member.user.tag}\n**Mensagens:** ${msgs.size} deletadas`, `Architect ${VERSION}`));
    } catch (e) { await interaction.editReply(errorEmbed(e.message)); }
  }

  // ── /embed ───────────────────────────────────────────────────────────────────
  else if (commandName === 'embed') {
    const titulo    = interaction.options.getString('titulo');
    const descrição = interaction.options.getString('descrição');
    const cor       = interaction.options.getString('cor') || '#9b59b6';
    const canal     = interaction.options.getChannel('canal') || interaction.channel;
    const imagem    = interaction.options.getString('imagem') || null;
    const rodape    = interaction.options.getString('rodape') || null;
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    try {
      const customV2 = v2Simple(hex(cor.replace('#','').length === 6 ? cor : '#9b59b6'), titulo, descrição + (imagem ? `\n${imagem}` : ''), rodape || null);
      await canal.send(customV2);
      await interaction.reply({ content: `${E.sucesso} Embed enviado em <#${canal.id}>!`, flags: MessageFlags.Ephemeral });
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /anuncio ─────────────────────────────────────────────────────────────────
  else if (commandName === 'anuncio') {
    const titulo   = interaction.options.getString('titulo');
    const mensagem = interaction.options.getString('mensagem');
    const canal    = interaction.options.getChannel('canal');
    const marcar   = interaction.options.getBoolean('marcar_everyone') || false;
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    try {
      const anuncioV2 = v2Simple(C_ORANGE, `<:avisos:1500524507171918006> ${titulo}`, mensagem, `Anúncio por ${member.user.tag} · Architect ${VERSION}`);
      if (marcar) await canal.send({ content: '@everyone', allowedMentions: { parse: ['everyone'] } }).catch(() => {});
      await canal.send(anuncioV2);
      await interaction.reply({ content: `${E.sucesso} Anúncio enviado em <#${canal.id}>!`, flags: MessageFlags.Ephemeral });
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /idioma ───────────────────────────────────────────────────────────────────
  else if (commandName === 'idioma') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const langKey = interaction.options.getString('lang');
    const newLang = LANGS[langKey];
    await mongoDB.collection('settings').updateOne(
      { guildId: guild.id },
      { $set: { guildId: guild.id, lang: langKey } },
      { upsert: true }
    );
    guildLangCache.set(guild.id, newLang);
    await interaction.reply(v2Simple(C_GREEN, newLang.langTitle, `${newLang.langChanged(newLang.name)}\n\n**<:linked:1500524472229433404> Idioma:** ${newLang.flag} ${newLang.name}`, `Architect ${VERSION}`));
  }

  // ── /chat ────────────────────────────────────────────────────────────────────
  else if (commandName === 'chat') {
    const pergunta = interaction.options.getString('pergunta');
    await interaction.deferReply();
    try {
      const resposta = await mistralChat(pergunta);
      await interaction.editReply({
        ...v2Simple(C_ORANGE, '🤖 Architect Chat',
          '**Você:** ' + pergunta + '\n\n**Architect:** ' + resposta,
          'Architect ' + VERSION + ' • Velroc Systems'),
      });
    } catch (e) {
      console.error('[/chat]', e.message);
      await interaction.editReply({
        ...v2Simple(C_RED, E.erro + ' Erro no Chat',
          'Não consegui processar sua pergunta: ' + e.message,
          'Architect ' + VERSION),
      }).catch(() => {});
    }
  }

  // ── /google_voice ─────────────────────────────────────────────────────────────
  else if (commandName === 'google_voice') {
    const pergunta = interaction.options.getString('pergunta');
    await interaction.deferReply();
    try {
      const respostaTexto = await mistralChat(pergunta);

      // Remove tudo que o TTS não deve ler: markdown, emojis, mencoes, etc.
      const limparParaTTS = (texto) => texto
        .replace(/<a?:[a-zA-Z0-9_]+:[0-9]+>/g, '')   // emojis customizados <:nome:id>
        .replace(/<@!?[0-9]+>/g, '')                   // mencoes de usuário
        .replace(/<@&[0-9]+>/g, '')                    // mencoes de cargo
        .replace(/<#[0-9]+>/g, '')                     // mencoes de canal
        .replace(/\*\*(.+?)\*\*/g, '$1')            // **negrito**
        .replace(/\*(.+?)\*/g, '$1')                  // *italico*
        .replace(/__(.+?)__/g, '$1')                   // __sublinhado__
        .replace(/~~(.+?)~~/g, '$1')                   // ~~tachado~~
        .replace(/`{1,3}[^`]*`{1,3}/g, '')            // `codigo`
        .replace(/#{1,6}\s/g, '')                     // # headers
        .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')      // emojis unicode
        .replace(/\s+/g, ' ')
        .trim();

      const textoLimpo = limparParaTTS(respostaTexto);

      const os   = require('os');
      const path = require('path');
      const fs   = require('fs');
      const tmp  = path.join(os.tmpdir(), 'gvoice_' + interaction.id + '.mp3');

      try {
        await gerarAudioEdgeTTS(textoLimpo, tmp);
        await interaction.editReply({
          content: '🎙️ **Você:** ' + pergunta,
          files:   [{ attachment: tmp, name: 'resposta.mp3' }],
        });
      } catch (audioErr) {
        console.error('[/google_voice]', audioErr.message);
        await interaction.editReply({
          ...v2Simple(C_RED, E.erro + ' Erro no Audio',
            'Não consegui gerar o audio: ' + audioErr.message,
            'Architect ' + VERSION),
        }).catch(() => {});
      } finally {
        setTimeout(() => require('fs').unlink(tmp, () => {}), 8000);
      }
    } catch (e) {
      console.error('[/google_voice]', e.message);
      await interaction.editReply({
        ...v2Simple(C_RED, E.erro + ' Erro',
          'Não consegui processar sua pergunta: ' + e.message,
          'Architect ' + VERSION),
      }).catch(() => {});
    }
  }

  // ── /doar ────────────────────────────────────────────────────────────────────
  else if (commandName === 'doar') {
    await interaction.reply({ ...v2Simple(C_ORANGE,
      lang.doarTitle,
      `${lang.doarDesc}\n\n**💸 Pix — Copia e Cola**\n\`\`\`00020126580014br.gov.bcb.pix0136d1918ea8-a370-4a1b-9a91-6169472609755204000053039865802BR5925Jose Gabriel Nascimento F6009Sao Paulo62290525REC69C84CBCE0A2A7675161826304388D\`\`\`\n**👨‍<:cmd:1500524508384071783> Dev:** Velroc   **${E.servidores} Servidores:** ${client.guilds.cache.size}`,
      `Architect ${VERSION} • ${lang.doarThanks}`
    ), flags: MessageFlags.Ephemeral });
  }

  // ── /info ────────────────────────────────────────────────────────────────────
  else if (commandName === 'info') {
    const uptime   = process.uptime();
    const mem      = process.memoryUsage();
    const ramUsed  = (mem.heapUsed  / 1024 / 1024).toFixed(1);
    const ramTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);
    const rss      = (mem.rss       / 1024 / 1024).toFixed(1);
    const ping     = client.ws.ping;
    const days     = Math.floor(uptime / 86400);
    const hours    = Math.floor((uptime % 86400) / 3600);
    const mins     = Math.floor((uptime % 3600) / 60);
    const uptimeStr = `${days}d ${hours}h ${mins}m`;

    await interaction.reply(v2Simple(C_ORANGE,
      `${E.bot} Architect — Create. Protect. Restore.`,
      `**👨‍💻 Devs:** Sagaz, Luan Kovalsy e Mulari   **🌐 Servidores:** ${client.guilds.cache.size}   **⏱️ Uptime:** ${uptimeStr}\n` +
      `**📦 Versão:** ${VERSION}   **🏗️ Stack:** Discord.js v14   **🏓 Ping:** ${ping}ms\n` +
      `**🏢 Desenvolvido por:** Velroc Systems | Sagaz, Luan Kovalsy e Mulari\n` +
      `**🧠 RAM Heap:** ${ramUsed}MB / ${ramTotal}MB   **💾 RAM RSS:** ${rss}MB\n` +
      `**🖥️ Node.js:** ${process.version}   **🔧 Plataforma:** ${process.platform}\n` +
      `**📋 Fila Normal:** ${lanes.normal.queue.filter(e=>e.userId).length} aguardando   **⭐ Fila Premium:** ${lanes.premium.queue.filter(e=>e.userId).length} aguardando\n` +
      `**🔗 Site:** [architect.velroc.workers.dev](https://architect.velroc.workers.dev)`,
      `Architect ${VERSION}`
    ));
  }

  // ── /dm ──────────────────────────────────────────────────────────────────────
  else if (commandName === 'dm') {
    if (interaction.user.id !== process.env.OWNER_ID)
      return interaction.reply({ content: `${E.erro} Sem permissão.`, flags: MessageFlags.Ephemeral });
    const mensagem = interaction.options.getString('mensagem');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let enviados = 0, falhas = 0;
    const contatados = new Set(); // evita mensagens duplicadas para o mesmo dono
    for (const [, g] of client.guilds.cache) {
      try {
        const owner = await g.fetchOwner();
        if (contatados.has(owner.id)) continue; // já enviou para esse dono
        contatados.add(owner.id);
        await owner.send(v2Simple(C_ORANGE, `${E.velroc} Mensagem Oficial · Velroc`, mensagem, `Architect ${VERSION} • Mensagem Oficial`));
        enviados++;
      } catch (e) { falhas++; }
    }
    await interaction.editReply({ content: `${E.sucesso} Mensagem enviada para **${enviados}** dono(s) único(s). Falhas: **${falhas}**.` });
  }

  // ── /premium ──────────────────────────────────────────────────────────────────
  else if (commandName === 'premium') {
    if (!PREMIUM_OWNERS.includes(interaction.user.id))
      return interaction.reply({ content: `${E.erro} Sem permissão.`, flags: MessageFlags.Ephemeral });
    const target = interaction.options.getUser('usuário');
    const plano  = interaction.options.getString('plano');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (plano === 'remover') {
      await mongoDB.collection('premium').deleteOne({ userId: target.id });
      await target.send(v2Simple(C_RED, `${E.premium} Premium removido`, 'Seu acesso Premium ao Architect foi removido pela equipe Velroc.', `Architect ${VERSION}`)).catch(() => {});
      return await interaction.editReply({ content: `${E.sucesso} Premium removido de **${target.tag}**.` });
    }

    const plan      = PREMIUM_PLANS[plano];
    const expiresAt = await setPremium(target.id, plano);

    await target.send(v2Simple(C_ORANGE,
      `${E.velroc} Architect Premium ativado!`,
      `Olá, **${target.username}**! Você recebeu acesso **Premium** ao Architect.\n\n` +
      `**${plan.emoji} Plano:** ${plan.label}   **${E.data} Expira em:** ${expiresAt.toLocaleDateString('pt-BR')}\n\n` +
      `**<:nitro:1500524497688723566> Benefícios:**\n• Criação de servidores mais detalhada\n• Backup automático a cada 30 min\n• Geração com mais cargos e canais\n• Prioridade na fila de geração`,
      `Architect ${VERSION} • Create. Protect. Restore.`
    )).catch(() => {});

    await interaction.editReply(v2Simple(C_GREEN,
      `${E.premium} Premium ativado`,
      `**Usuário:** ${target.tag}   **Plano:** ${plan.emoji} ${plan.label}   **Expira:** ${expiresAt.toLocaleDateString('pt-BR')}`,
      `Architect ${VERSION}`
    ));
  }

  // ── /bansoft ─────────────────────────────────────────────────────────────────
  else if (commandName === 'bansoft') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.BanMembers))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado.`, flags: MessageFlags.Ephemeral });
    try {
      await interaction.deferReply();
      // Bane e deleta TODAS as mensagens (7 dias = max do Discord)
      await guild.members.ban(target.id, { deleteMessageSeconds: 7 * 24 * 60 * 60, reason: motivo });
      await interaction.editReply(v2Simple(C_RED,
        `${E.ban} Soft-Ban aplicado!`,
        `**${E.membros} Membro:** ${target.user.tag}
**${E.config} Motivo:** ${motivo}
**🗑️ Mensagens:** Todas deletadas (7 dias)`,
        `Architect ${VERSION}`
      ));
      // Log
      await sendLog(guild.id, 'ban', v2Simple(C_RED,
        `🔨 Soft-Ban — ${target.user.tag}`,
        `**Moderador:** ${interaction.user.tag}
**Motivo:** ${motivo}
**Mensagens deletadas:** 7 dias`,
        `Architect ${VERSION}`
      ));
    } catch (e) { await interaction.editReply(errorEmbed(e.message)); }
  }

  // ── /logs_config ─────────────────────────────────────────────────────────────
  else if (commandName === 'logs_config') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const tipo  = interaction.options.getString('tipo');
    const canal = interaction.options.getChannel('canal');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const tipos = tipo === 'all' ? ['ban','mute','ticket','warn','detect','parceria'] : [tipo];
    const set   = {};
    tipos.forEach(t => { set[`logs.${t}`] = canal.id; });
    await mongoDB.collection('settings').updateOne(
      { guildId: guild.id },
      { $set: set },
      { upsert: true }
    );
    const nomes = { ban:'🔨 Bans/Kicks', mute:'🔇 Mutes', ticket:'🎫 Tickets', warn:'⚠️ Warns', detect:'🤖 IA Detect', parceria:'🤝 Parcerias' };
    const lista = tipos.map(t => nomes[t]).join(', ');
    await interaction.editReply(v2Simple(C_GREEN,
      `${E.config} Logs Configurados!`,
      `**Canal:** <#${canal.id}>
**Tipos:** ${lista}`,
      `Architect ${VERSION}`
    ));
  }

  // ── /ia_config ────────────────────────────────────────────────────────────────
  else if (commandName === 'ia_config') {
    const isPremiumUser = await isUserPremium(interaction.user.id);
    if (!isPremiumUser)
      return interaction.reply({ content: `${E.premium} Este comando é exclusivo para usuários **Premium**!`, flags: MessageFlags.Ephemeral });
    const promptCustom = interaction.options.getString('prompt');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await mongoDB.collection('ia_config').updateOne(
      { userId: interaction.user.id },
      { $set: { userId: interaction.user.id, prompt: promptCustom, updatedAt: new Date() } },
      { upsert: true }
    );
    await interaction.editReply(v2Simple(C_ORANGE,
      `${E.premium} IA Personalizada!`,
      `Seu prompt foi salvo. A IA usará essas instruções nas próximas criações de servidor.

**📝 Prompt:**
${promptCustom.substring(0, 300)}${promptCustom.length > 300 ? '...' : ''}`,
      `Architect ${VERSION}`
    ));
  }

  // ── /set_parceria ─────────────────────────────────────────────────────────────
  else if (commandName === 'set_parceria') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const canal          = interaction.options.getChannel('canal');
    const cargoPermitido = interaction.options.getRole('cargo');
    const mensagem       = interaction.options.getString('mensagem') || null;
    if (!canal)
      return interaction.reply({ content: `${E.erro} Canal inválido!`, flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await mongoDB.collection('settings').updateOne(
      { guildId: guild.id },
      { $set: {
        'parceria.channelId': canal.id,
        'parceria.roleId':    cargoPermitido?.id || null,
        partnershipChannelId: canal.id,
        'parceria.canalId':   canal.id,
        'parceria.mensagem':  mensagem,
      }},
      { upsert: true }
    );
    await interaction.editReply(v2Simple(C_GREEN,
      `🤝 Sistema de Parceria Configurado!`,
      `**Cargo com permissão:** <@&${cargoPermitido.id}>
` +
      `**Canal de parcerias:** <#${canal.id}>
` +
      `${mensagem ? `**Mensagem personalizada:** ${mensagem}` : '*Mensagem padrão será usada.*'}

` +
      `Membros com o cargo <@&${cargoPermitido.id}> podem usar **/parceria** para registrar uma nova parceria.`,
      `Architect ${VERSION}`
    ));
  }

  // ── /ia_detect ────────────────────────────────────────────────────────────────
  else if (commandName === 'ia_detect') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const ativo = interaction.options.getBoolean('ativo');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await mongoDB.collection('settings').updateOne(
      { guildId: guild.id },
      { $set: { 'detect.ativo': ativo } },
      { upsert: true }
    );
    await interaction.editReply(v2Simple(ativo ? C_GREEN : C_RED,
      `🤖 IA Detect ${ativo ? 'Ativada' : 'Desativada'}!`,
      ativo
        ? 'O sistema de detecção inteligente está ativo. Use **/detect_config** para configurar as ações.'
        : 'A detecção inteligente foi desativada neste servidor.',
      `Architect ${VERSION}`
    ));
  }

  // ── /detect_config ────────────────────────────────────────────────────────────
  else if (commandName === 'detect_config') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const nivel     = interaction.options.getString('nivel');
    const links     = interaction.options.getBoolean('links')      ?? true;
    const divulg    = interaction.options.getBoolean('divulgacao')  ?? true;
    const spam      = interaction.options.getBoolean('spam')        ?? true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await mongoDB.collection('settings').updateOne(
      { guildId: guild.id },
      { $set: { 'detect.nivel': nivel, 'detect.links': links, 'detect.divulgacao': divulg, 'detect.spam': spam } },
      { upsert: true }
    );
    const nivelLabel = { low: '🟡 Baixo (log apenas)', medium: '🟠 Médio (mutar)', high: '🔴 Alto (banir)' }[nivel];
    await interaction.editReply(v2Simple(C_ORANGE,
      `🤖 Detect Config Salvo!`,
      `**Nível:** ${nivelLabel}
**Links:** ${links ? 'Sim' : 'Não'}   **Divulgação:** ${divulg ? 'Sim' : 'Não'}   **Spam:** ${spam ? 'Sim' : 'Não'}`,
      `Architect ${VERSION}`
    ));
  }

  // ── /usuários ────────────────────────────────────────────────────────────────
  else if (commandName === 'usuários') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

      await interaction.editReply(v2Simple(C_ORANGE,
        `${E.info} Estatísticas — ${dateFormatted}`,
        `Atividade registrada pelo Architect nesta data.\n\n` +
        `**${E.total} Únicos:** ${totalUsers.size}   **${E.premium} Premium:** ${usersPremium.size}   **${E.membros} Normais:** ${usersNormal.size}\n` +
        `**${E.cats} Comandos:** ${totalCmds}   **${E.gerando} Criações IA:** ${criacoes}   **${E.velroc} Premium ativos:** ${activePremium.length}\n\n` +
        `**${E.info} Top Comandos:**\n${topCmdsText}`,
        `Architect ${VERSION} • Dados de ${dateFormatted}`
      ));
    } catch (e) {
      console.error('[/usuários]', e.message);
      await interaction.editReply({ content: `${E.erro} Erro ao buscar estatísticas: ${e.message}` });
    }
  }

  // ── /help ────────────────────────────────────────────────────────────────────
  else if (commandName === 'help') {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply(v2Simple(C_ORANGE,
      `${E.info} Comandos — Architect ${VERSION}`,
      `**🏗️ Criação IA**
` +
      `\`/criar_servidor\` \`/template\` \`/ia_config\`

` +
      `**💾 Backup & Proteção**
` +
      `\`/backup\` \`/restaurar\` \`/proteger\`

` +
      `**🔨 Moderação**
` +
      `\`/ban\` \`/bansoft\` \`/kick\` \`/mute\` \`/unmute\` \`/warn\` \`/warns\` \`/clearwarns\`
` +
      `\`/lock\` \`/unlock\` \`/slowmode\` \`/clear\` \`/move\` \`/nick\`

` +
      `**⚙️ Servidor**
` +
      `\`/cargo_criar\` \`/canal_criar\` \`/deletar\` \`/embed\` \`/anuncio\`
` +
      `\`/autorole\` \`/set_parceria\` \`/parceria\` \`/logs_config\`

` +
      `**📊 Informações**
` +
      `\`/userinfo\` \`/serverinfo\` \`/avatar\` \`/roleinfo\`

` +
      `**🎉 Diversão & Engajamento**
` +
      `\`/sorteio\` \`/enquete\` \`/contador\`

` +
      `**🔧 Geral**
` +
      `\`/status\` \`/info\` \`/idioma\` \`/usuários\` \`/doar\` \`/tickets\` \`/help\`

` +
      `**Site:** [architect.velroc.workers.dev](https://architect.velroc.workers.dev)`,
      `Architect ${VERSION} · architect.velroc.workers.dev`
    ));
  }

  // ── /tickets ──────────────────────────────────────────────────────────────────
  else if (commandName === 'tickets') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages) && interaction.user.id !== process.env.OWNER_ID)
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    await interaction.deferReply();
    try {
      const docs = await mongoDB?.collection('ticket_stats')
        .find({ guildId: guild.id })
        .sort({ count: -1 })
        .limit(10)
        .toArray() || [];

      if (docs.length === 0) {
        return interaction.editReply(v2Simple(C_GREY, '<:ticket:1500524512607862884> Ranking de Tickets', 'Nenhum ticket foi reivindicado e fechado ainda neste servidor.', `Architect ${VERSION}`));
      }

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = docs.map((d, i) => {
        const medal = medals[i] || `\`${i + 1}.\``;
        return `${medal} <@${d.staffId}> — **${d.count}** ticket(s) atendido(s)`;
      }).join('\n');

      await interaction.editReply(v2Simple(C_ORANGE,
        `<:ticket:1500524512607862884> Ranking de Atendimentos — ${guild.name}`,
        lines,
        `Architect ${VERSION} · Tickets reivindicados e fechados`
      ));
    } catch (e) { await interaction.editReply(errorEmbed(e.message)); }
  }


  // ── /ticket_criar ─────────────────────────────────────────────────────────────
  else if (commandName === 'ticket_criar') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const canal      = interaction.options.getChannel('canal');
    const titulo     = interaction.options.getString('titulo')     || '🎫 Suporte — Abrir Ticket';
    const descrição  = interaction.options.getString('descrição')  || 'Clique abaixo para abrir um ticket e nossa equipe irá te atender em breve.';
    const catsRaw    = interaction.options.getString('categorias') || 'Suporte';
    const cargoStaff = interaction.options.getRole('cargo_staff');
    const cats       = catsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);

    // Salva config no MongoDB
    await mongoDB.collection('guild_configs').updateOne(
      { guildId: guild.id },
      { $set: {
          guildId:          guild.id,
          ticketChannel:    canal.id,
          ticketCategories: cats.map(name => ({ name, emoji: '🎫' })),
          ticketStaffRole:  cargoStaff?.id || null,
          ticketTitle:      titulo,
          ticketDesc:       descrição,
          updatedAt:        new Date(),
      }},
      { upsert: true }
    );

    // Monta painel V2
    const panelV2 = v2Simple(C_ORANGE, titulo, descrição, `Architect ${VERSION} • Sistema de Tickets`);

    let components = [];
    if (cats.length > 1) {
      const { StringSelectMenuBuilder } = require('discord.js');
      const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_select')
        .setPlaceholder('Selecione o tipo de suporte…')
        .addOptions(cats.map(name => ({ label: name, value: name.toLowerCase().replace(/\s+/g,'_'), emoji: '🎫' })));
      components.push(new ActionRowBuilder().addComponents(menu));
    } else {
      const btn = new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel(cats[0] || 'Abrir Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫');
      components.push(new ActionRowBuilder().addComponents(btn));
    }

    await canal.send({ flags: panelV2.flags, components: [...panelV2.components, ...components] });
    await interaction.editReply(v2Simple(C_GREEN, `${E.sucesso} Painel de Tickets Criado!`,
      `**Canal:** <#${canal.id}>\n**Categorias:** ${cats.join(', ')}\n**Staff:** ${cargoStaff ? `<@&${cargoStaff.id}>` : 'Não definido'}`,
      `Architect ${VERSION}`
    ));
  }

  // ── /role_all ─────────────────────────────────────────────────────────────────
  else if (commandName === 'role_all') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const cargo = interaction.options.getRole('cargo');
    const acao  = interaction.options.getString('acao');
    await interaction.deferReply();
    let sucesso = 0, falhas = 0;
    const members = await guild.members.fetch();
    for (const [, m] of members) {
      try {
        if (acao === 'add' && !m.roles.cache.has(cargo.id))      { await m.roles.add(cargo);    sucesso++; }
        else if (acao === 'remove' && m.roles.cache.has(cargo.id)) { await m.roles.remove(cargo); sucesso++; }
      } catch { falhas++; }
      await new Promise(r => setTimeout(r, 100)); // rate limit
    }
    await interaction.editReply(v2Simple(C_GREEN, `${E.sucesso} Role All Concluído!`,
      `**Cargo:** <@&${cargo.id}>   **Ação:** ${acao === 'add' ? 'Adicionado' : 'Removido'}\n**Sucesso:** ${sucesso}   **Falhas:** ${falhas}`,
      `Architect ${VERSION}`
    ));
    await sendLog(guild.id, 'ban', v2Simple(C_BLUE, `👥 Log — Role All`, `**Cargo:** ${cargo.name}\n**Ação:** ${acao}\n**Moderador:** ${member.user.tag}\n**Aplicado em:** ${sucesso} membros`, `Architect ${VERSION}`));
  }

  // ── /mention_role ─────────────────────────────────────────────────────────────
  else if (commandName === 'mention_role') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const cargo    = interaction.options.getRole('cargo');
    const mensagem = interaction.options.getString('mensagem');
    const canal    = interaction.options.getChannel('canal') || interaction.channel;
    const eraMencionavel = cargo.mentionable;
    try {
      if (!eraMencionavel) await cargo.setMentionable(true);
      await canal.send({ content: `<@&${cargo.id}> — ${mensagem}`, allowedMentions: { roles: [cargo.id] } });
      if (!eraMencionavel) await cargo.setMentionable(false);
      await interaction.reply({ content: `${E.sucesso} Menção enviada em <#${canal.id}>!`, flags: MessageFlags.Ephemeral });
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /automod ──────────────────────────────────────────────────────────────────
  else if (commandName === 'automod') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const acao         = interaction.options.getString('acao');
    const cargoIgnorado = interaction.options.getRole('cargo_ignorado');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (acao === 'ver') {
      const cfg = await mongoDB.collection('automod').findOne({ guildId: guild.id });
      if (!cfg) return interaction.editReply(v2Simple(C_GREY, '🛡️ AutoMod', 'Nenhuma configuração de AutoMod definida ainda.', `Architect ${VERSION}`));
      return interaction.editReply(v2Simple(C_ORANGE, '🛡️ AutoMod — Config Atual',
        `**Anti-Link:** ${cfg.anti_link ? '✅ Ativo' : '❌ Inativo'}\n**Anti-Spam:** ${cfg.anti_spam ? '✅ Ativo' : '❌ Inativo'}\n**Anti-Palavrão:** ${cfg.anti_palavrao ? '✅ Ativo' : '❌ Inativo'}\n**Cargo Ignorado:** ${cfg.cargoIgnorado ? `<@&${cfg.cargoIgnorado}>` : 'Nenhum'}`,
        `Architect ${VERSION}`
      ));
    }
    if (acao === 'desativar') {
      await mongoDB.collection('automod').updateOne({ guildId: guild.id }, { $set: { anti_link: false, anti_spam: false, anti_palavrao: false } }, { upsert: true });
      return interaction.editReply(v2Simple(C_RED, '🛡️ AutoMod Desativado!', 'Todas as regras de AutoMod foram desativadas.', `Architect ${VERSION}`));
    }

    const update = { [acao]: true, guildId: guild.id };
    if (cargoIgnorado) update.cargoIgnorado = cargoIgnorado.id;
    await mongoDB.collection('automod').updateOne({ guildId: guild.id }, { $set: update }, { upsert: true });
    const labels = { anti_link: '🚫 Anti-Link', anti_spam: '📢 Anti-Spam', anti_palavrao: '🤬 Anti-Palavrão' };
    await interaction.editReply(v2Simple(C_GREEN, `🛡️ AutoMod — ${labels[acao]} Ativado!`,
      `A regra foi ativada.\n${cargoIgnorado ? `**Cargo ignorado:** <@&${cargoIgnorado.id}>` : ''}`,
      `Architect ${VERSION}`
    ));
  }

  // ── /warns ────────────────────────────────────────────────────────────────────
  else if (commandName === 'warns') {
    const target = interaction.options.getUser('membro');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const warnDocs = await mongoDB.collection('warns').find({ guildId: guild.id, userId: target.id }).sort({ createdAt: -1 }).limit(10).toArray();
    if (!warnDocs.length) return interaction.editReply(v2Simple(C_GREEN, `${E.sucesso} Sem Advertências!`, `${target.tag} não tem advertências neste servidor.`, `Architect ${VERSION}`));
    const lista = warnDocs.map((w, i) => ```${i+1}.`` **${w.motivo}** — <t:${Math.floor(new Date(w.createdAt).getTime()/1000)}:R>`).join('\n');
    await interaction.editReply(v2Simple(C_YELLOW, `⚠️ Warns — ${target.tag}`, `**Total:** ${warnDocs.length}\n\n${lista}`, `Architect ${VERSION}`));
  }

  // ── /clearwarns ───────────────────────────────────────────────────────────────
  else if (commandName === 'clearwarns') {
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const target = interaction.options.getUser('membro');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { deletedCount } = await mongoDB.collection('warns').deleteMany({ guildId: guild.id, userId: target.id });
    await interaction.editReply(v2Simple(C_GREEN, `${E.sucesso} Warns Limpos!`, `**${deletedCount}** advertência(s) de **${target.tag}** removidas.`, `Architect ${VERSION}`));
    await sendLog(guild.id, 'warn', v2Simple(C_GREEN, `⚠️ Log — Warns Limpos`, `**Membro:** ${target.tag}\n**Moderador:** ${member.user.tag}\n**Warns removidos:** ${deletedCount}`, `Architect ${VERSION}`));
  }

  // ── /userinfo ─────────────────────────────────────────────────────────────────
  else if (commandName === 'userinfo') {
    const target = interaction.options.getMember('membro') || member;
    const u      = target.user;
    const roles  = target.roles.cache.filter(r => r.name !== '@everyone').sort((a,b) => b.position - a.position).map(r => `<@&${r.id}>`).slice(0, 10).join(' ') || 'Nenhum';
    await interaction.reply(v2Simple(C_BLUE, `👤 Info — ${u.tag}`,
      `**ID:** ${u.id}\n**Conta criada:** <t:${Math.floor(u.createdTimestamp/1000)}:R>\n**Entrou no servidor:** <t:${Math.floor(target.joinedTimestamp/1000)}:R>\n**Cargos:** ${roles}\n**Bot:** ${u.bot ? 'Sim' : 'Não'}`,
      `Architect ${VERSION}`
    ));
  }

  // ── /serverinfo ───────────────────────────────────────────────────────────────
  else if (commandName === 'serverinfo') {
    const owner    = await guild.fetchOwner().catch(() => null);
    const channels = guild.channels.cache;
    const text     = channels.filter(c => c.type === ChannelType.GuildText).size;
    const voice    = channels.filter(c => c.type === ChannelType.GuildVoice).size;
    const roles    = guild.roles.cache.filter(r => r.name !== '@everyone').size;
    await interaction.reply(v2Simple(C_ORANGE, `🌐 Info — ${guild.name}`,
      `**ID:** ${guild.id}\n**Dono:** ${owner ? `${owner.user.tag}` : 'N/A'}\n**Membros:** ${guild.memberCount}\n**Canais:** ${text} texto | ${voice} voz\n**Cargos:** ${roles}\n**Criado:** <t:${Math.floor(guild.createdTimestamp/1000)}:R>\n**Boost:** Nível ${guild.premiumTier} (${guild.premiumSubscriptionCount} boosts)`,
      `Architect ${VERSION}`
    ));
  }

  // ── /avatar ───────────────────────────────────────────────────────────────────
  else if (commandName === 'avatar') {
    const target = interaction.options.getUser('membro') || interaction.user;
    const url    = target.displayAvatarURL({ size: 1024, extension: 'png' });
    await interaction.reply(v2Simple(C_BLUE, `🖼️ Avatar — ${target.tag}`, `[Clique para abrir em tamanho completo](${url})\n${url}`, `Architect ${VERSION}`));
  }

  // ── /roleinfo ─────────────────────────────────────────────────────────────────
  else if (commandName === 'roleinfo') {
    const cargo   = interaction.options.getRole('cargo');
    const membros = guild.members.cache.filter(m => m.roles.cache.has(cargo.id)).size;
    await interaction.reply(v2Simple(cargo.color || C_GREY, `🏷️ Info — ${cargo.name}`,
      `**ID:** ${cargo.id}\n**Cor:** ${cargo.hexColor}\n**Membros:** ${membros}\n**Mencionável:** ${cargo.mentionable ? 'Sim' : 'Não'}\n**Hoist (separado):** ${cargo.hoist ? 'Sim' : 'Não'}\n**Criado:** <t:${Math.floor(cargo.createdTimestamp/1000)}:R>`,
      `Architect ${VERSION}`
    ));
  }

  // ── /sorteio ──────────────────────────────────────────────────────────────────
  else if (commandName === 'sorteio') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const vencedores = interaction.options.getInteger('vencedores');
    const premio     = interaction.options.getString('premio');
    const duracao    = interaction.options.getInteger('duracao') || 0;

    if (duracao === 0) {
      // Sorteio imediato entre membros do servidor
      const membros = guild.members.cache.filter(m => !m.user.bot).map(m => m);
      if (membros.length < vencedores) return interaction.reply({ content: `${E.erro} Membros insuficientes!`, flags: MessageFlags.Ephemeral });
      const shuffled = membros.sort(() => Math.random() - 0.5).slice(0, vencedores);
      const lista    = shuffled.map((m, i) => ```${i+1}.`` <@${m.id}>`).join('\n');
      await interaction.reply(v2Simple(C_ORANGE, `🎉 Sorteio — ${premio}`, `**Vencedor(es):**\n${lista}`, `Architect ${VERSION} • Sorteio realizado por ${member.user.tag}`));
    } else {
      // Sorteio com prazo — cria mensagem com botão
      const endTime  = Math.floor((Date.now() + duracao * 60000) / 1000);
      const btn      = new ButtonBuilder().setCustomId(`giveaway_enter_${interaction.id}`).setLabel('🎉 Participar').setStyle(ButtonStyle.Success);
      const row      = new ActionRowBuilder().addComponents(btn);
      const panelV2  = v2Simple(C_ORANGE, `🎉 Sorteio — ${premio}`,
        `**Prêmio:** ${premio}\n**Vencedores:** ${vencedores}\n**Termina:** <t:${endTime}:R>\n**Participantes:** 0\n\nClique no botão para participar!`,
        `Architect ${VERSION}`
      );
      const msg = await interaction.reply({ ...panelV2, components: [row], fetchReply: true });
      // Salva no MongoDB
      await mongoDB.collection('giveaways').insertOne({
        guildId:       guild.id,
        channelId:     interaction.channel.id,
        messageId:     msg.id,
        prize:         premio,
        winners:       vencedores,
        participants:  [],
        endTime:       new Date(endTime * 1000),
        ended:         false,
      });
    }
  }

  // ── /enquete ──────────────────────────────────────────────────────────────────
  else if (commandName === 'enquete') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const pergunta = interaction.options.getString('pergunta');
    const emojis   = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'];
    const opcoes   = [1,2,3,4,5].map(n => interaction.options.getString(`opcao${n}`)).filter(Boolean);
    const lista    = opcoes.map((o, i) => `${emojis[i]} ${o}`).join('\n');
    const msg      = await interaction.reply({ ...v2Simple(C_BLUE, `📊 Enquete`, `**${pergunta}**\n\n${lista}`, `Architect ${VERSION} • Vote com os emojis abaixo`), fetchReply: true });
    for (let i = 0; i < opcoes.length; i++) await msg.react(emojis[i]).catch(() => {});
  }

  // ── /nick ─────────────────────────────────────────────────────────────────────
  else if (commandName === 'nick') {
    if (!member.permissions.has(PermissionFlagsBits.ManageNicknames))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const target  = interaction.options.getMember('membro');
    const apelido = interaction.options.getString('apelido') || null;
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, flags: MessageFlags.Ephemeral });
    try {
      await target.setNickname(apelido);
      await interaction.reply(v2Simple(C_GREEN, `${E.sucesso} Apelido Alterado!`,
        `**Membro:** ${target.user.tag}\n**Apelido:** ${apelido || 'Removido'}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /move ─────────────────────────────────────────────────────────────────────
  else if (commandName === 'move') {
    if (!member.permissions.has(PermissionFlagsBits.MoveMembers))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const target = interaction.options.getMember('membro');
    const canal  = interaction.options.getChannel('canal');
    if (!target) return interaction.reply({ content: `${E.erro} Membro não encontrado!`, flags: MessageFlags.Ephemeral });
    if (!target.voice.channel) return interaction.reply({ content: `${E.erro} Membro não está em um canal de voz!`, flags: MessageFlags.Ephemeral });
    try {
      await target.voice.setChannel(canal);
      await interaction.reply(v2Simple(C_GREEN, `${E.sucesso} Membro Movido!`,
        `**Membro:** ${target.user.tag}\n**Para:** <#${canal.id}>`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }

  // ── /reset ────────────────────────────────────────────────────────────────────
  else if (commandName === 'reset') {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const motivo  = interaction.options.getString('motivo') || 'Canal nukado';
    const ch      = interaction.channel;
    try {
      const newCh = await ch.clone({ reason: motivo });
      await newCh.setPosition(ch.position);
      await ch.delete();
      await newCh.send(v2Simple(C_BLUE, `🔄 Canal Resetado!`, `**Motivo:** ${motivo}\n**Por:** ${member.user.tag}`, `Architect ${VERSION}`));
      await sendLog(guild.id, 'ban', v2Simple(C_BLUE, `🔄 Log — Reset de Canal`, `**Canal:** #${ch.name}\n**Moderador:** ${member.user.tag}\n**Motivo:** ${motivo}`, `Architect ${VERSION}`));
    } catch (e) { await interaction.reply({ ...errorEmbed(e.message), flags: MessageFlags.Ephemeral }); }
  }


  // ── /reaction_role ────────────────────────────────────────────────────────────
  else if (commandName === 'reaction_role') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const msgId = interaction.options.getString('mensagem_id');
    const cargo = interaction.options.getRole('cargo');
    const emoji = interaction.options.getString('emoji');
    const canal = interaction.options.getChannel('canal') || interaction.channel;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const msg = await canal.messages.fetch(msgId);
      await msg.react(emoji);
      await mongoDB.collection('reaction_roles').updateOne(
        { guildId: guild.id, messageId: msgId, emoji },
        { $set: { guildId: guild.id, messageId: msgId, channelId: canal.id, roleId: cargo.id, emoji, createdAt: new Date() } },
        { upsert: true }
      );
      await interaction.editReply(v2Simple(C_GREEN, E.sucesso + ' Reaction Role Configurado!',
        '**Mensagem:** ' + msgId + '\n**Cargo:** <@&' + cargo.id + '>\n**Emoji:** ' + emoji + '\n\nMembros que reagirem com ' + emoji + ' receberão o cargo automaticamente.',
        'Architect ' + VERSION
      ));
    } catch (e) {
      await interaction.editReply({ ...errorEmbed('Não encontrei a mensagem. Verifique o ID e canal: ' + e.message) });
    }
  }

  // ── /button_role ──────────────────────────────────────────────────────────────
  else if (commandName === 'button_role') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const cargo     = interaction.options.getRole('cargo');
    const titulo    = interaction.options.getString('titulo')    || 'Obter cargo: ' + cargo.name;
    const descrição = interaction.options.getString('descrição') || 'Clique no botao abaixo para receber ou remover o cargo <@&' + cargo.id + '>.';
    const canal     = interaction.options.getChannel('canal')    || interaction.channel;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const btn  = new ButtonBuilder()
      .setCustomId('button_role_toggle_' + cargo.id)
      .setLabel('Obter / Remover: ' + cargo.name)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎭');
    const row     = new ActionRowBuilder().addComponents(btn);
    const panelV2 = v2Simple(C_ORANGE, titulo, descrição, 'Architect ' + VERSION + ' • Button Role');
    const msg = await canal.send({ flags: panelV2.flags, components: [...panelV2.components, row] });
    await mongoDB.collection('button_roles').updateOne(
      { guildId: guild.id, messageId: msg.id },
      { $set: { guildId: guild.id, messageId: msg.id, channelId: canal.id, roleId: cargo.id, createdAt: new Date() } },
      { upsert: true }
    );
    await interaction.editReply(v2Simple(C_GREEN, E.sucesso + ' Button Role Criado!',
      '**Canal:** <#' + canal.id + '>\n**Cargo:** <@&' + cargo.id + '>\n\nO painel foi enviado com sucesso!',
      'Architect ' + VERSION
    ));
  }


  // ── /autorole ─────────────────────────────────────────────────────────────────
  else if (commandName === 'autorole') {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const cargo = interaction.options.getRole('cargo');
    await mongoDB.collection('guild_configs').updateOne(
      { guildId: guild.id },
      { $set: { guildId: guild.id, autoroleId: cargo ? cargo.id : null } },
      { upsert: true }
    );
    if (cargo) {
      await interaction.reply(v2Simple(C_GREEN, E.sucesso + ' Autorole Configurado!',
        '**Cargo:** <@&' + cargo.id + '>\nNovos membros receberão este cargo automaticamente.',
        'Architect ' + VERSION
      ));
    } else {
      await interaction.reply(v2Simple(C_RED, E.sucesso + ' Autorole Desativado!',
        'Novos membros não receberão mais cargo automatico.',
        'Architect ' + VERSION
      ));
    }
  }

  // ── /contador ─────────────────────────────────────────────────────────────────
  else if (commandName === 'contador') {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels))
      return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
    const canal = interaction.options.getChannel('canal');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const total = guild.memberCount;
      await canal.setName('👥 Membros: ' + total);
      await mongoDB.collection('guild_configs').updateOne(
        { guildId: guild.id },
        { $set: { guildId: guild.id, contadorChannelId: canal.id } },
        { upsert: true }
      );
      await interaction.editReply(v2Simple(C_GREEN, E.sucesso + ' Contador Configurado!',
        '**Canal:** <#' + canal.id + '>\nO nome do canal será atualizado automaticamente quando membros entrarem ou saírem.',
        'Architect ' + VERSION
      ));
    } catch (e) {
      await interaction.editReply({ ...errorEmbed('Não consegui editar o canal: ' + e.message) });
    }
  }

  // ── /parceria ─────────────────────────────────────────────────────────────────
  else if (commandName === 'parceria') {
    const descrição = interaction.options.getString('descrição');
    const invite    = interaction.options.getString('invite') || 'Não informado';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cfg = await mongoDB.collection('guild_configs').findOne({ guildId: guild.id });
    const canalId = cfg?.partnershipChannelId || cfg?.parceria?.channelId;
    if (!canalId)
      return interaction.editReply({ ...errorEmbed('Canal de parceria não configurado. Use **/set_parceria** primeiro.') });
    // Verifica cargo se configurado
    const roleId = cfg?.parceria?.roleId;
    if (roleId && !member.roles.cache.has(roleId) && !member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.editReply({ ...errorEmbed(`Você precisa do cargo <@&${roleId}> para usar este comando.`) });
    const canal = guild.channels.cache.get(canalId);
    if (!canal)
      return interaction.editReply({ ...errorEmbed('Canal de parceria não encontrado. Reconfigure com **/set_parceria**.') });
    await canal.send(v2Simple(C_ORANGE, '🤝 Nova Parceria!',
      `**Servidor:** ${guild.name}
**Descrição:** ${descrição}
**Invite:** ${invite}
**Enviado por:** ${member.user.tag}`,
      `Architect ${VERSION}`
    ));
    await interaction.editReply(v2Simple(C_GREEN, `${E.sucesso} Parceria Registrada!`,
      `A parceria foi enviada para <#${canalId}>.`,
      `Architect ${VERSION}`
    ));
  }

  } catch (err) {
    // Ignora silenciosamente erros de "já confirmada" — não há nada a fazer
    const ALREADY_REPLIED = ['InteractionAlreadyReplied', 'already been acknowledged'];
    if (ALREADY_REPLIED.some(s => err?.message?.includes(s) || err?.name?.includes(s))) return;

    console.error('[INTERAÇÃO] Erro não detectado:', err?.message || err);

    // Só tenta responder se a interaction ainda não foi respondida
    if (interaction.replied || interaction.deferred) return;
    try {
      await interaction.reply({
        ...errorEmbed('Ocorreu um erro inesperado. Tente novamente.'),
        flags: MessageFlags.Ephemeral,
      });
    } catch (_) {}
  }
});

// ── sendLog helper ────────────────────────────────────────────────────────────
async function sendLog(guildId, tipo, payload) {
  try {
    const settings = await mongoDB.collection('settings').findOne({ guildId });
    const channelId = settings?.logs?.[tipo] || settings?.logs?.all;
    if (!channelId) return;
    const guild = client.guilds.cache.get(guildId);
    const ch    = guild?.channels?.cache?.get(channelId);
    if (ch) await ch.send(payload).catch(() => {});
  } catch (_) {}
}


// ── /chat helpers ─────────────────────────────────────────────────────────────
async function mistralChat(pergunta) {
  const key = process.env.MISTRAL_KEY_CHAT;
  if (!key) throw new Error('MISTRAL_KEY_CHAT não configurada.');
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       'mistral-small-latest',
      max_tokens:  512,
      temperature: 0.7,
      messages: [
        { role: 'system', content: 'Você é o Architect, um assistente inteligente criado pela Velroc Systems, desenvolvido por Sagaz, Luan Kovalsy e Mulari. Você NÃO foi criado pela Mistral AI, OpenAI, Google ou qualquer outra empresa de IA — você é o Architect da Velroc Systems. Responda de forma clara, objetiva e em português. Nunca revele que usa Mistral ou qualquer outro modelo de IA por baixo. Máximo de 3 parágrafos.' },
        { role: 'user',   content: pergunta },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || 'Não consegui gerar uma resposta.';
}

async function gerarAudioEdgeTTS(texto, outputPath) {
  // Google Translate TTS — divide em chunks e concatena os MP3s
  const fs = require('fs');

  // Divide o texto em sentenças de até 200 chars sem cortar palavras
  const dividirTexto = (txt, max = 190) => {
    const chunks = [];
    // Tenta dividir por pontuação natural primeiro
    const sentencas = txt.replace(/([.!?;:])\s+/g, '$1|').split('|').filter(Boolean);
    let atual = '';
    for (const s of sentencas) {
      if ((atual + ' ' + s).trim().length <= max) {
        atual = (atual + ' ' + s).trim();
      } else {
        if (atual) chunks.push(atual);
        // Se a sentença sozinha for maior que max, divide por palavras
        if (s.length > max) {
          const palavras = s.split(' ');
          let sub = '';
          for (const p of palavras) {
            if ((sub + ' ' + p).trim().length <= max) {
              sub = (sub + ' ' + p).trim();
            } else {
              if (sub) chunks.push(sub);
              sub = p;
            }
          }
          if (sub) atual = sub;
        } else {
          atual = s;
        }
      }
    }
    if (atual) chunks.push(atual);
    return chunks.filter(Boolean);
  };

  const chunks  = dividirTexto(texto.substring(0, 2000)); // limite total de 2000 chars
  const buffers = [];

  for (const chunk of chunks) {
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=pt-BR&client=tw-ob&q=' + encodeURIComponent(chunk);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('TTS HTTP ' + res.status + ' no chunk: ' + chunk.substring(0, 30));
    buffers.push(Buffer.from(await res.arrayBuffer()));
    // Pequeno delay entre requests para não ser bloqueado
    await new Promise(r => setTimeout(r, 300));
  }

  // Concatenação binária direta — funciona nativamente com MP3
  fs.writeFileSync(outputPath, Buffer.concat(buffers));
}

client.on('channelDelete', async channel => {
  try {
    const backup = await getBackup(channel.guild.id);
    if (!backup?.protection) return;
    const logs  = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const entry = logs.entries.first();
    if (!entry || !entry.executor) return;
    if (entry.executor.id === client.user?.id) return;
    const count = trackNukeAction(channel.guild.id, entry.executor.id);
    if (count >= 3) {
      const alertCh = channel.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildText &&
        c.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
      );
      if (alertCh) await alertCh.send(v2Simple(C_RED, '<:atencao:1500524473827459263> Alerta Anti-Nuke', `**${entry.executor.tag}** deletou **${count} canais** em menos de 10 segundos.\n\nUse **/restaurar** imediatamente para reverter.`, `Architect ${VERSION}`));
    }
  } catch (e) { console.error('[ANTI-NUKE] channelDelete:', e.message); }
});

client.on('roleDelete', async role => {
  try {
    const backup = await getBackup(role.guild.id);
    if (!backup?.protection) return;
    const logs  = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
    const entry = logs.entries.first();
    if (!entry || !entry.executor) return;
    if (entry.executor.id === client.user?.id) return;
    const count = trackNukeAction(role.guild.id, entry.executor.id);
    if (count >= 3) {
      const alertCh = role.guild.channels.cache.find(c => c.type === ChannelType.GuildText);
      if (alertCh) await alertCh.send(v2Simple(C_RED, '<:atencao:1500524473827459263> Alerta Anti-Nuke', `**${entry.executor.tag}** deletou **${count} cargos** em menos de 10 segundos.\n\nUse **/restaurar** imediatamente para reverter.`, `Architect ${VERSION}`));
    }
  } catch (e) { console.error('[ANTI-NUKE] roleDelete:', e.message); }
});


// ── AutoMod — messageCreate ───────────────────────────────────────────────────
client.on('messageCreate', async message => {
  // INTENT DESABILITADO: MessageContent requer aprovacao no Discord Developer Portal
  // Sera reativado apos aprovacao dos Privileged Gateway Intents
  return;
  if (!message.guild || message.author.bot) return;
  try {
    const cfg = await mongoDB.collection('automod').findOne({ guildId: message.guild.id });
    if (!cfg) return;
    if (cfg.cargoIgnorado && message.member?.roles.cache.has(cfg.cargoIgnorado)) return;
    if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    const content = message.content.toLowerCase();
    let deletar = false, motivo = '';
    if (cfg.anti_link && /https?:\/\/|discord\.gg\/|www\./i.test(message.content)) { deletar = true; motivo = 'Anti-Link'; }
    if (cfg.anti_spam) {
      if (!client._spamMap) client._spamMap = new Map();
      const key = 'spam_' + message.guild.id + '_' + message.author.id;
      const now = Date.now();
      const hist = (client._spamMap.get(key) || []).filter(t => now - t < 5000);
      hist.push(now);
      client._spamMap.set(key, hist);
      if (hist.length >= 5) { deletar = true; motivo = 'Anti-Spam'; }
    }
    if (cfg.anti_palavrao) {
      const palavroes = ['puta','merda','caralho','viado','buceta','fdp'];
      if (palavroes.some(p => content.includes(p))) { deletar = true; motivo = 'Anti-Palavrao'; }
    }
    if (deletar) {
      await message.delete().catch(() => {});
      const w = await message.channel.send('<@' + message.author.id + '> AutoMod: ' + motivo + ' — Mensagem removida.');
      setTimeout(() => w.delete().catch(() => {}), 5000);
      await sendLog(message.guild.id, 'ban', v2Simple(C_RED, 'AutoMod — ' + motivo,
        '**Usuário:** ' + message.author.tag + '\n**Canal:** <#' + message.channel.id + '>\n**Conteúdo:** ' + message.content.substring(0, 200),
        'Architect ' + VERSION
      ));
    }
  } catch (_) {}
});

// ── Giveaway button ───────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('giveaway_enter_')) return;
  try {
    const doc = await mongoDB.collection('giveaways').findOne({ guildId: interaction.guild.id, messageId: interaction.message.id, ended: false });
    if (!doc) return interaction.reply({ content: 'Sorteio não encontrado ou encerrado.', flags: MessageFlags.Ephemeral });
    if (doc.participants.includes(interaction.user.id))
      return interaction.reply({ content: 'Você ja esta participando!', flags: MessageFlags.Ephemeral });
    await mongoDB.collection('giveaways').updateOne({ _id: doc._id }, { $push: { participants: interaction.user.id } });
    await interaction.reply({ content: 'Você entrou no sorteio! Total: **' + (doc.participants.length + 1) + '**', flags: MessageFlags.Ephemeral });
  } catch (_) {}
});


// ── Button Role toggle ────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('button_role_toggle_')) return;
  try {
    const roleId = interaction.customId.replace('button_role_toggle_', '');
    const m      = interaction.member;
    const role   = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ content: 'Cargo não encontrado.', flags: MessageFlags.Ephemeral });
    if (m.roles.cache.has(roleId)) {
      await m.roles.remove(role);
      await interaction.reply({ content: 'Cargo **' + role.name + '** removido!', flags: MessageFlags.Ephemeral });
    } else {
      await m.roles.add(role);
      await interaction.reply({ content: 'Cargo **' + role.name + '** adicionado!', flags: MessageFlags.Ephemeral });
    }
  } catch (e) {
    await interaction.reply({ content: 'Erro: ' + e.message, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

// ── Reaction Role — adicionar cargo ───────────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  // INTENT DESABILITADO: GuildMessageReactions requer aprovacao
  return;
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const emoji = reaction.emoji.id
      ? '<:' + reaction.emoji.name + ':' + reaction.emoji.id + '>'
      : reaction.emoji.name;
    const doc = await mongoDB.collection('reaction_roles').findOne({
      guildId:   reaction.message.guild.id,
      messageId: reaction.message.id,
      emoji,
    });
    if (!doc) return;
    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    const role = reaction.message.guild.roles.cache.get(doc.roleId);
    if (role) await member.roles.add(role).catch(() => {});
  } catch (_) {}
});

// ── Reaction Role — remover cargo ────────────────────────────────────────────
client.on('messageReactionRemove', async (reaction, user) => {
  // INTENT DESABILITADO: GuildMessageReactions requer aprovacao
  return;
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const emoji = reaction.emoji.id
      ? '<:' + reaction.emoji.name + ':' + reaction.emoji.id + '>'
      : reaction.emoji.name;
    const doc = await mongoDB.collection('reaction_roles').findOne({
      guildId:   reaction.message.guild.id,
      messageId: reaction.message.id,
      emoji,
    });
    if (!doc) return;
    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    const role = reaction.message.guild.roles.cache.get(doc.roleId);
    if (role) await member.roles.remove(role).catch(() => {});
  } catch (_) {}
});


// ── Autorole — cargo automático para novos membros ───────────────────────────
client.on('guildMemberAdd', async member => {
  // Nota: requer Server Members Intent aprovado para funcionar
  // Por ora funciona apenas em servidores com menos de 100 membros (Discord libera automaticamente)
  try {
    const cfg = await mongoDB.collection('guild_configs').findOne({ guildId: member.guild.id });
    if (!cfg) return;

    // Autorole
    if (cfg.autoroleId) {
      const role = member.guild.roles.cache.get(cfg.autoroleId);
      if (role) await member.roles.add(role).catch(e => console.warn('[AUTOROLE]', e.message));
    }

    // Atualiza contador se configurado
    if (cfg.contadorChannelId) {
      const canal = member.guild.channels.cache.get(cfg.contadorChannelId);
      if (canal) await canal.setName('👥 Membros: ' + member.guild.memberCount).catch(() => {});
    }
  } catch (e) { console.warn('[guildMemberAdd]', e.message); }
});

// ── Contador — atualiza quando membro sai ─────────────────────────────────────
client.on('guildMemberRemove', async member => {
  try {
    const cfg = await mongoDB.collection('guild_configs').findOne({ guildId: member.guild.id });
    if (!cfg?.contadorChannelId) return;
    const canal = member.guild.channels.cache.get(cfg.contadorChannelId);
    if (canal) await canal.setName('👥 Membros: ' + member.guild.memberCount).catch(() => {});
  } catch (_) {}
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
      icon:        guild.icon || null,
      memberCount: guild.memberCount,
      isPremium,
      config: {
        antiNuke:         config.antiNuke         || false,
        welcomeMsg:       config.welcomeMsg       || '',
        welcomeCh:        config.welcomeCh        || '',
        logCh:            config.logCh            || '',
        lang:             config.lang             || 'pt',
        ticketPanelCh:    config.ticketPanelCh    || '',
        ticketCategoryCh: config.ticketCategoryCh || '',
        ticketRole:       config.ticketRole       || '',
        ticketMsg:        config.ticketMsg        || '',
        ticketCategories: config.ticketCategories || [],
        ticketBanner:     config.ticketBanner     || '',
      },
      hasBackup:  !!backupDoc,
      backupDate: backupDoc?.savedAt || null,
      roles:    guild.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
      channels: guild.channels.cache
        .filter(c => [0, 2, 4].includes(c.type))
        .map(c => ({ id: c.id, name: c.name, type: c.type }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    console.error('[API /guild]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/guild/:id/config — save guild config
app.post('/api/guild/:id/config', requireAuth, async (req, res) => {
  try {
    const guildId = req.params.id;
    if (!guildId || guildId === 'undefined' || guildId === 'null') {
      console.warn('[API] /config chamado sem guildId válido — verifique o frontend');
      return res.status(400).json({ error: 'guildId ausente ou inválido. Selecione um servidor antes de salvar.' });
    }
    const userGuilds = req.session.userGuilds || [];
    const userGuild  = userGuilds.find(g => g.id === req.params.id);
    if (!userGuild || (parseInt(userGuild.permissions) & 0x8) !== 0x8)
      return res.status(403).json({ error: 'Forbidden' });

    const allowed = [
      'antiNuke','welcomeMsg','welcomeCh','logCh','lang',
      'ticketPanelCh','ticketCategoryCh','ticketRole','ticketMsg','ticketCategories','ticketBanner',
    ];
    const update = {};
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

// POST /api/guild/:id/restore — restore backup
app.post('/api/guild/:id/restore', requireAuth, async (req, res) => {
  try {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const userGuilds = req.session.userGuilds || [];
    const userGuild  = userGuilds.find(g => g.id === req.params.id);
    if (!userGuild || (parseInt(userGuild.permissions) & 0x8) !== 0x8)
      return res.status(403).json({ error: 'Forbidden' });
    const backupDoc = await mongoDB?.collection('backups').findOne({ guildId: req.params.id });
    if (!backupDoc) return res.status(404).json({ error: 'Nenhum backup encontrado.' });
    await applyStructure(guild, backupDoc.structure);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/guild/:id/ticket/deploy — send ticket panel to channel
app.post('/api/guild/:id/ticket/deploy', requireAuth, async (req, res) => {
  try {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const userGuilds = req.session.userGuilds || [];
    const userGuild  = userGuilds.find(g => g.id === req.params.id);
    if (!userGuild || (parseInt(userGuild.permissions) & 0x8) !== 0x8)
      return res.status(403).json({ error: 'Forbidden' });

    const config = await mongoDB?.collection('guild_configs').findOne({ guildId: req.params.id });
    if (!config?.ticketPanelCh) return res.status(400).json({ error: 'Canal do painel não configurado.' });

    const channel = guild.channels.cache.get(config.ticketPanelCh);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado no servidor.' });

    const cats = config.ticketCategories || [];

    // Build select menu or buttons
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

    const deployComponents = [];

    // Banner (imagem no topo do painel)
    if (config.ticketBanner) {
      deployComponents.push({
        type: 11, // MediaGallery — exibe imagem dentro do container V2
        items: [{ media: { url: config.ticketBanner } }],
      });
      deployComponents.push({ type: 14, divider: true, spacing: 1 }); // Separator
    }

    deployComponents.push({
      type: 10, // TextDisplay
      content: [
        `## <:ticket:1500524512607862884> Central de Suporte`,
        config.ticketMsg || 'Clique no botão abaixo para abrir um ticket de suporte.',
        ``,
        `-# ${guild.name} · Architect ${VERSION}`,
      ].join('\n'),
    });

    const deployV2 = {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 17, // Container
        accent_color: C_ORANGE,
        components: deployComponents,
      }],
    };

    let components = [];
    if (cats.length > 1) {
      // Select menu with categories
      const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_select')
        .setPlaceholder('Selecione o tipo de suporte…')
        .addOptions(cats.map(c => ({
          label: c.name,
          value: c.name.toLowerCase().replace(/\s+/g, '_'),
          emoji: c.emoji && c.emoji.match(/^<a?:(\w+):(\d+)>$/)
            ? { id: c.emoji.match(/^<a?:(\w+):(\d+)>$/)[2], name: c.emoji.match(/^<a?:(\w+):(\d+)>$/)[1] }
            : (c.emoji || '🎫'),
        })));
      components.push(new ActionRowBuilder().addComponents(menu));
    } else {
      // Single button — parse emoji string to object if needed
      const rawEmoji = cats[0]?.emoji || null;
      const emojiMatch = rawEmoji?.match(/^<a?:(\w+):(\d+)>$/);
      const btn = new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel(cats[0]?.name || 'Abrir Ticket')
        .setStyle(ButtonStyle.Primary);
      if (emojiMatch) btn.setEmoji({ id: emojiMatch[2], name: emojiMatch[1] });
      else btn.setEmoji('🎫');
      components.push(new ActionRowBuilder().addComponents(btn));
    }

    await channel.send({
      flags: deployV2.flags,
      components: [...deployV2.components, ...components],
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[API /ticket/deploy]', e.message);
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

// Error handler — garante que NUNCA retorna HTML em rotas /api/*
app.use((err, req, res, next) => {
  console.error('[EXPRESS]', err.message);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
  next(err);
});

// Express só sobe no Shard 0 (ou quando não há sharding) — evita conflito de porta
const isMainShard = !client.shard || (client.shard.ids?.[0] === 0);
if (isMainShard) {
  app.listen(process.env.PORT || 3000, () => {
    console.log(`<:aceitar:1500524505746116800> Dashboard server na porta ${process.env.PORT || 3000} (Shard 0)`);
  });
} else {
  console.log(`[SHARD #${client.shard?.ids?.[0]}] Express não iniciado (apenas Shard 0 serve HTTP).`);
}

// ── Global Error Handlers ──────────────────────────────────────────────────────
client.on('error', e => console.error('<:negar:1500524485231509785> Client error:', e.message));
process.on('unhandledRejection', reason => console.error('<:negar:1500524485231509785> Unhandled rejection:', reason?.message || reason));
process.on('uncaughtException',  e      => console.error('<:negar:1500524485231509785> Uncaught exception:',  e?.message    || e));

// ── Startup ────────────────────────────────────────────────────────────────────
async function startup() {
  const missing = ['DISCORD_TOKEN', 'CLIENT_ID', 'MONGO_URI'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`<:negar:1500524485231509785> Variáveis de ambiente faltando: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`[STARTUP] TOKEN: ${process.env.DISCORD_TOKEN?.slice(0,10)}... CLIENT_ID: ${process.env.CLIENT_ID}`);

  try { await connectDB(); }
  catch (e) { console.error('<:negar:1500524485231509785> Erro MongoDB:', e.message); process.exit(1); }

  console.log('[STARTUP] Fazendo login no Discord...');
  const loginTimeout = setTimeout(() => {
    console.error('<:negar:1500524485231509785> Discord login TIMEOUT (30s) — verifique o DISCORD_TOKEN no Render.');
    process.exit(1);
  }, 30000);

  try {
    await client.login(process.env.DISCORD_TOKEN);
    clearTimeout(loginTimeout);
    console.log('<:aceitar:1500524505746116800> Discord login OK');
  } catch (e) {
    clearTimeout(loginTimeout);
    console.error('<:negar:1500524485231509785> Discord login FALHOU:', e.message);
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
