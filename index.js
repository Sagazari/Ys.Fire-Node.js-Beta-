/**
 * Architect v1.5.0
 * Developed by Alzhayds
 * Create. Protect. Restore.
 */

const {
  Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ChannelType, AuditLogEvent,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const fetch    = require('node-fetch');
const { MongoClient } = require('mongodb');
const express  = require('express');
const path     = require('path');
const cors     = require('cors');
require('dotenv').config();

const VERSION       = 'v1.5.0';
const MISTRAL_MODEL = 'mistral-large-latest';
const API_KEY       = process.env.API_KEY || 'architect-secret-key';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://termsarch-ez.onrender.com/dashboard.html';

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
  if (!mongoDB) return null;
  return await mongoDB.collection('backups').findOne({ guildId });
}

async function setProtection(guildId, val) {
  await mongoDB.collection('backups').updateOne({ guildId }, { $set: { protection: val } });
}

// ── Discord Client ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
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
async function callGroq(messages, maxTokens = 8000) {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: MISTRAL_MODEL, max_tokens: maxTokens, temperature: 0.4, messages }),
  });
  if (!res.ok) throw new Error(`Mistral API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let raw = data.choices[0].message.content.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const arr = raw.trimStart().startsWith('[');
  const s   = raw.indexOf(arr ? '[' : '{');
  const e   = raw.lastIndexOf(arr ? ']' : '}');
  if (s === -1 || e === -1) throw new Error('IA retornou JSON inválido. Tente novamente.');
  return JSON.parse(raw.substring(s, e + 1));
}

// ── Generate Structure ─────────────────────────────────────────────────────────
async function generateStructure(prompt) {
  prompt = prompt.replace(/"/g, "'").replace(/`/g, "'");
  const roles = await callGroq([
    { role: 'system', content: 'You generate Discord server roles. JSON only, no markdown. Always use proper Portuguese accents.' },
    { role: 'user',   content: `Create ALL roles for this server: "${prompt}"\nJSON array:\n[{"name":"Nome","color":"#hex","permissions":["ADMINISTRATOR"]}]` },
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const categories = await callGroq([
    { role: 'system', content: 'You design Discord servers. JSON only, no markdown. Always use proper Portuguese accents.' },
    { role: 'user',   content: `Design the COMPLETE server structure for: "${prompt}"\n\nCATEGORY FORMAT: EMOJI + SPACE + DIVIDER + SPACE + NAME IN ALL CAPS (ex: 🏛️ ◆ INFORMAÇÕES)\nCHANNEL FORMAT: EMOJI + DIVIDER + name NO SPACES (ex: 🚩・entrada)\nCHANNEL TYPES: text, voice, forum, announcement, stage\nJSON array:\n[{"name":"🏛️ ◆ CATEGORIA","channels":[{"name":"🚩・canal","type":"text","topic":"Tópico","allowedRoles":[]}]}]` },
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const wRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MISTRAL_MODEL, max_tokens: 400, temperature: 0.8, messages: [{ role: 'system', content: 'Write short Discord welcome messages in Portuguese. Plain text only.' }, { role: 'user', content: `Welcome message for: "${prompt}"` }] }),
  });
  const wData = await wRes.json();
  return { roles: Array.isArray(roles) ? roles : [], categories: Array.isArray(categories) ? categories : [], welcomeMessage: wData.choices?.[0]?.message?.content?.trim() || '' };
}

// ── Permission Builder ─────────────────────────────────────────────────────────
function buildPermissions(perms = []) {
  const map = { ADMINISTRATOR: PermissionFlagsBits.Administrator, MANAGE_GUILD: PermissionFlagsBits.ManageGuild, MANAGE_CHANNELS: PermissionFlagsBits.ManageChannels, MANAGE_ROLES: PermissionFlagsBits.ManageRoles, KICK_MEMBERS: PermissionFlagsBits.KickMembers, BAN_MEMBERS: PermissionFlagsBits.BanMembers, SEND_MESSAGES: PermissionFlagsBits.SendMessages, VIEW_CHANNEL: PermissionFlagsBits.ViewChannel };
  return perms.reduce((acc, p) => map[p] ? acc | map[p] : acc, 0n);
}

// ── Apply Structure ────────────────────────────────────────────────────────────
async function applyStructure(guild, structure, onStep) {
  await onStep('🗑️', 'Removendo canais...');
  const channels = await guild.channels.fetch();
  for (const [, ch] of channels) await ch.delete().catch(() => {});
  await new Promise(r => setTimeout(r, 1000));
  await onStep('🗑️', 'Removendo cargos...');
  const roles = await guild.roles.fetch();
  for (const [, role] of roles) { if (!role.managed && role.name !== '@everyone') await role.delete().catch(() => {}); }
  await new Promise(r => setTimeout(r, 500));
  await onStep('👥', 'Criando cargos...');
  const createdRoles = new Map();
  for (const r of structure.roles || []) {
    try {
      const role = await guild.roles.create({ name: r.name, color: r.color || '#99aab5', permissions: buildPermissions(r.permissions || []) });
      createdRoles.set(r.name, role);
      await onStep('✅', `Cargo: **${r.name}**`);
      await new Promise(r => setTimeout(r, 200));
    } catch (e) { console.error('Cargo:', e.message); }
  }
  for (const category of structure.categories || []) {
    try {
      await onStep('📁', `Categoria: **${category.name}**`);
      const cat = await guild.channels.create({ name: category.name.substring(0, 100), type: ChannelType.GuildCategory });
      await new Promise(r => setTimeout(r, 500));
      for (const ch of category.channels || []) {
        try {
          const typeMap = { voice: ChannelType.GuildVoice, announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum, stage: ChannelType.GuildStageVoice, text: ChannelType.GuildText };
          const type = typeMap[ch.type] || ChannelType.GuildText;
          const safeName = ch.name.substring(0, 100) || 'canal';
          const overwrites = ch.allowedRoles?.length > 0 ? [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, ...ch.allowedRoles.map(n => createdRoles.get(n)).filter(Boolean).map(r => ({ id: r.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))] : [{ id: guild.id, allow: [PermissionFlagsBits.ViewChannel] }];
          const channelData = { name: safeName, type, parent: cat.id, permissionOverwrites: overwrites };
          if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement) channelData.topic = ch.topic?.substring(0, 1024) || '';
          await guild.channels.create(channelData);
          await onStep('💬', `Canal: **${safeName}**`);
          await new Promise(r => setTimeout(r, 350));
        } catch (e) { console.error('Canal:', e.message); }
      }
    } catch (e) { console.error('Categoria:', e.message); }
  }
  if (structure.welcomeMessage) {
    const first = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel));
    if (first) await first.send(structure.welcomeMessage).catch(() => {});
  }
}

// ── Capture Backup ─────────────────────────────────────────────────────────────
async function captureStructure(guild) {
  const roles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).sort((a, b) => b.position - a.position).map(r => ({ name: r.name, color: r.hexColor, permissions: r.permissions.toArray(), position: r.position, hoist: r.hoist, mentionable: r.mentionable }));
  const channels = await guild.channels.fetch();
  const categories = [];
  for (const [, cat] of channels) {
    if (cat.type !== ChannelType.GuildCategory) continue;
    const children = [];
    for (const [, ch] of channels) {
      if (ch.parentId !== cat.id) continue;
      const permOverwrites = [];
      for (const [, ow] of ch.permissionOverwrites.cache) permOverwrites.push({ id: ow.id, type: ow.type, allow: ow.allow.toArray(), deny: ow.deny.toArray() });
      children.push({ name: ch.name, type: ch.type === ChannelType.GuildVoice ? 'voice' : ch.type === ChannelType.GuildAnnouncement ? 'announcement' : ch.type === ChannelType.GuildForum ? 'forum' : ch.type === ChannelType.GuildStageVoice ? 'stage' : 'text', topic: ch.topic || '', nsfw: ch.nsfw || false, position: ch.position, permOverwrites, messages: [], allowedRoles: [] });
    }
    children.sort((a, b) => a.position - b.position);
    categories.push({ name: cat.name, position: cat.position, channels: children });
  }
  categories.sort((a, b) => a.position - b.position);
  return { roles: [...roles.values()], categories };
}

// ── Pending confirmations ──────────────────────────────────────────────────────
const pendingCreate  = new Map();
const pendingRestore = new Map();

// ── Express API + Dashboard ────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  if (req.headers['authorization'] !== `Bearer ${API_KEY}`) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/health', (req, res) => res.json({ status: 'online', version: VERSION }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code');
  try {
    const tokenRes  = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: process.env.REDIRECT_URI }) });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).send('Failed to get token');
    const userData   = await (await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } })).json();
    const guildsData = await (await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${tokenData.access_token}` } })).json();
    const botGuildIds = client.guilds.cache.map(g => g.id);
    const adminGuilds = guildsData.filter(g => (g.permissions & 0x8) === 0x8 && botGuildIds.includes(g.id)).map(g => ({ id: g.id, name: g.name, icon: g.icon }));
    const data = encodeURIComponent(JSON.stringify({ user: userData, guilds: adminGuilds }));
    res.redirect(`/?auth=${data}`);
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/guild', authMiddleware, async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  const channels = await guild.channels.fetch();
  const backup   = getBackup(guildId);
  res.json({ id: guild.id, name: guild.name, icon: guild.iconURL(), memberCount: guild.memberCount, roleCount: guild.roles.cache.filter(r => r.name !== '@everyone').size, textCount: channels.filter(c => c.type === ChannelType.GuildText).size, voiceCount: channels.filter(c => c.type === ChannelType.GuildVoice).size, forumCount: channels.filter(c => c.type === ChannelType.GuildForum).size, protection: backup?.protection || false, hasBackup: !!backup, backupDate: backup?.savedAt || null });
});

app.get('/api/roles', authMiddleware, async (req, res) => {
  const { guildId } = req.query;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  const roles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, color: r.hexColor, memberCount: r.members.size, position: r.position }));
  res.json([...roles.values()]);
});

app.post('/api/roles', authMiddleware, async (req, res) => {
  const { guildId, action, roleId, name, color } = req.body;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  if (action === 'delete') { const role = guild.roles.cache.get(roleId); if (role) await role.delete().catch(() => {}); return res.json({ success: true }); }
  if (action === 'create') { const role = await guild.roles.create({ name, color: color || '#99aab5' }); return res.json({ success: true, id: role.id }); }
  res.status(400).json({ error: 'Unknown action' });
});

app.get('/api/channels', authMiddleware, async (req, res) => {
  const { guildId } = req.query;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  const channels = await guild.channels.fetch();
  res.json([...channels.map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId })).values()]);
});

app.post('/api/channels', authMiddleware, async (req, res) => {
  const { guildId, action, channelId, name, type } = req.body;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  if (action === 'delete') { const ch = guild.channels.cache.get(channelId); if (ch) await ch.delete().catch(() => {}); return res.json({ success: true }); }
  if (action === 'create') { const typeMap = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, forum: ChannelType.GuildForum }; await guild.channels.create({ name, type: typeMap[type] || ChannelType.GuildText }); return res.json({ success: true }); }
  res.status(400).json({ error: 'Unknown action' });
});

app.post('/api/protection', authMiddleware, async (req, res) => {
  const { guildId, active } = req.body;
  const backup = await getBackup(guildId);
  if (!backup) return res.status(400).json({ error: 'No backup found.' });
  setProtection(guildId, active);
  res.json({ success: true, protection: active });
});

app.get('/api/backup', authMiddleware, async (req, res) => {
  const { guildId } = req.query;
  const backup = await getBackup(guildId);
  if (!backup) return res.status(404).json({ error: 'No backup found' });
  res.json({ savedAt: backup.savedAt, guildName: backup.guildName, roles: backup.structure.roles?.length || 0, categories: backup.structure.categories?.length || 0 });
});

app.post('/api/backup/restore', authMiddleware, async (req, res) => {
  const { guildId } = req.body;
  const guild  = client.guilds.cache.get(guildId);
  const backup = await getBackup(guildId);
  if (!guild)  return res.status(404).json({ error: 'Guild not found' });
  if (!backup) return res.status(404).json({ error: 'No backup found' });
  res.json({ success: true, message: 'Restauração iniciada!' });
  await applyStructure(guild, backup.structure, async () => {});
});

app.post('/api/logs', authMiddleware, async (req, res) => {
  const { guildId, channelId } = req.body;
  await mongoDB.collection('backups').updateOne({ guildId }, { $set: { logChannelId: channelId } });
  res.json({ success: true });
});

app.post('/api/reaction-roles', authMiddleware, async (req, res) => {
  const { guildId, channelId, roleId, emoji, description } = req.body;
  const guild   = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const msg = await channel.send({ embeds: [new EmbedBuilder().setTitle('🎭 Seleção de Cargos').setColor(0x9b59b6).setDescription(description || 'Reaja para receber um cargo!')] });
  await msg.react(emoji);
  const existing = db.get('backups').find({ guildId }).value();
  const existing = await getBackup(guildId);
  if (existing) { const rrs = existing.reactionRoles || []; rrs.push({ messageId: msg.id, channelId, emoji, roleId }); await mongoDB.collection('backups').updateOne({ guildId }, { $set: { reactionRoles: rrs } }); }
  res.json({ success: true, messageId: msg.id });
});

app.listen(process.env.PORT || 3000, () => console.log(`✅ Architect ${VERSION} API + Dashboard rodando na porta ${process.env.PORT || 3000}`));

// ── Interaction Handler ────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split('_confirm_');
    if (action === 'create' && pendingCreate.has(id)) {
      const { prompt, structure } = pendingCreate.get(id); pendingCreate.delete(id);
      const steps = []; await interaction.update({ embeds: [buildProgressEmbed('🏗️ Construindo...', prompt, steps)], components: [] });
      const update = async (icon, msg) => { steps.push(`${icon} ${msg}`); await interaction.editReply({ embeds: [buildProgressEmbed('🏗️ Construindo...', prompt, steps)] }).catch(() => {}); };
      try { await applyStructure(interaction.guild, structure, update); await update('🎉', 'Servidor criado!'); } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)], components: [] }).catch(() => {}); }
      return;
    }
    if (action === 'restore' && pendingRestore.has(id)) {
      const { backup } = pendingRestore.get(id); pendingRestore.delete(id);
      const steps = []; const label = new Date(backup.savedAt).toLocaleString('pt-BR');
      await interaction.update({ embeds: [buildProgressEmbed('🔄 Restaurando...', `Backup de ${label}`, steps)], components: [] });
      const update = async (icon, msg) => { steps.push(`${icon} ${msg}`); await interaction.editReply({ embeds: [buildProgressEmbed('🔄 Restaurando...', `Backup de ${label}`, steps)] }).catch(() => {}); };
      try { await applyStructure(interaction.guild, backup.structure, update); await update('🎉', 'Servidor restaurado!'); } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)], components: [] }).catch(() => {}); }
      return;
    }
    if (action === 'delete' && pendingCreate.has(`del_${id}`)) {
      const { tipo, alvo, tudo, acao } = pendingCreate.get(`del_${id}`);
      pendingCreate.delete(`del_${id}`);
      await interaction.update({ embeds: [new EmbedBuilder().setTitle('🗑️ Deletando...').setColor(0xe74c3c).setDescription('Processando...').setFooter({ text: `Architect ${VERSION}` })], components: [] });
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
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✅ Deleção Concluída!').setColor(0x2ecc71).setDescription(`**${deletedCount}** item(s) deletado(s)!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [] });
      } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)], components: [] }); }
      return;
    }

    if (action === 'cancel') { pendingCreate.delete(id); pendingRestore.delete(id); await interaction.update({ embeds: [new EmbedBuilder().setTitle('❌ Cancelado').setColor(0x95a5a6).setDescription('Operação cancelada.').setFooter({ text: `Architect ${VERSION}` })], components: [] }); return; }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild, member } = interaction;
  const publicCmds = ['info', 'help', 'status'];
  if (!publicCmds.includes(commandName) && !member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Você precisa ser **Administrador**!', ephemeral: true });

  if (commandName === 'criar_servidor') {
    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply();
    try {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🧠 Gerando estrutura...').setColor(0x9b59b6).setDescription('IA analisando seu prompt...').addFields({ name: '📋 Prompt', value: prompt.substring(0, 200) }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
      const structure = await generateStructure(prompt);
      const confirmId = `${interaction.id}`; pendingCreate.set(confirmId, { prompt, structure }); setTimeout(() => pendingCreate.delete(confirmId), 60000);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`create_confirm_${confirmId}`).setLabel('✅ Confirmar').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger));
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⚠️ Confirmação').setColor(0xf39c12).setDescription('Isso irá apagar TUDO e recriar do zero.').addFields({ name: '📋 Prompt', value: prompt.substring(0, 200) }, { name: '👥 Cargos', value: String(structure.roles?.length || 0), inline: true }, { name: '📁 Categorias', value: String(structure.categories?.length || 0), inline: true }, { name: '💬 Canais', value: String(structure.categories?.reduce((a, c) => a + (c.channels?.length || 0), 0) || 0), inline: true }).setFooter({ text: `Architect ${VERSION} • Expira em 60s` }).setTimestamp()], components: [row] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }).catch(() => {}); }
  }

  else if (commandName === 'template') {
    const tipo = interaction.options.getString('tipo');
    const templates = { comunidade: 'Crie uma comunidade brasileira com informações, geral, eventos, suporte e voz', gaming: 'Crie um servidor gamer com jogos, torneios, clips, suporte e voz', militar: 'Crie um servidor militar com hierarquia, missões, treinamentos e voz', loja: 'Crie uma loja online com produtos, pedidos, promoções e suporte', anime: 'Crie um servidor de anime com discussões, recomendações e fan arts', educacional: 'Crie um servidor educacional com matérias, dúvidas e eventos' };
    await interaction.deferReply();
    try {
      const structure = await generateStructure(templates[tipo]);
      const confirmId = `${interaction.id}`; pendingCreate.set(confirmId, { prompt: templates[tipo], structure }); setTimeout(() => pendingCreate.delete(confirmId), 60000);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`create_confirm_${confirmId}`).setLabel('✅ Aplicar').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger));
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`⚠️ Template: ${tipo}`).setColor(0xf39c12).setDescription('Isso irá apagar tudo e aplicar o template.').addFields({ name: '👥 Cargos', value: String(structure.roles?.length || 0), inline: true }, { name: '📁 Categorias', value: String(structure.categories?.length || 0), inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [row] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }).catch(() => {}); }
  }

  else if (commandName === 'backup') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const structure = await captureStructure(guild);
      saveBackup(guild.id, guild.name, structure);
      const chTotal = structure.categories.reduce((a, c) => a + c.channels.length, 0);
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✅ Backup Salvo!').setColor(0x2ecc71).setDescription(`Estrutura de **${guild.name}** salva!`).addFields({ name: '👥 Cargos', value: String(structure.roles.length), inline: true }, { name: '📁 Categorias', value: String(structure.categories.length), inline: true }, { name: '💬 Canais', value: String(chTotal), inline: true }, { name: '📅 Salvo em', value: new Date().toLocaleString('pt-BR') }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }); }
  }

  else if (commandName === 'restaurar') {
    const backup = await getBackup(guild.id);
    if (!backup) return interaction.reply({ content: '❌ Nenhum backup encontrado!', ephemeral: true });
    const confirmId = `${interaction.id}`; pendingRestore.set(confirmId, { backup }); setTimeout(() => pendingRestore.delete(confirmId), 60000);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`restore_confirm_${confirmId}`).setLabel('🔄 Restaurar').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger));
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️ Restaurar Backup').setColor(0x3498db).setDescription('Isso irá apagar TUDO e restaurar o backup.').addFields({ name: '📅 Backup de', value: new Date(backup.savedAt).toLocaleString('pt-BR') }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [row] });
  }

  else if (commandName === 'proteger') {
    const ativo = interaction.options.getBoolean('ativo');
    const backup = await getBackup(guild.id);
    if (ativo && !backup) return interaction.reply({ content: '❌ Faça um **/backup** primeiro!', ephemeral: true });
    if (backup) setProtection(guild.id, ativo);
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(ativo ? '🛡️ Proteção Ativada!' : '🔓 Proteção Desativada').setColor(ativo ? 0x2ecc71 : 0xe74c3c).setDescription(ativo ? '✅ Monitorando em tempo real!' : '❌ Proteção desativada.').setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  else if (commandName === 'deletar') {
    const tipo = interaction.options.getString('tipo'); const alvo = interaction.options.getString('alvo') || ''; const tudo = interaction.options.getBoolean('tudo') || false;
    let descricao = '', acao = '';
    if (tipo === 'cargos') { if (tudo || alvo.toLowerCase() === 'everyone') { descricao = '🗑️ Todos os cargos serão deletados.'; acao = 'delete_roles_all'; } else { descricao = `🗑️ Cargos: ${alvo}`; acao = 'delete_roles_specific'; } }
    else if (tipo === 'canais') { if (tudo || alvo.toLowerCase() === 'everyone') { descricao = '🗑️ Todos os canais serão deletados.'; acao = 'delete_channels_all'; } else { descricao = `🗑️ Canais: ${alvo}`; acao = 'delete_channels_specific'; } }
    else { descricao = '🗑️ TUDO será deletado.'; acao = 'delete_all'; }
    const confirmId = `${interaction.id}`; pendingCreate.set(`del_${confirmId}`, { tipo, alvo, tudo, acao }); setTimeout(() => pendingCreate.delete(`del_${confirmId}`), 60000);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`delete_confirm_${confirmId}`).setLabel('🗑️ Deletar').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary));
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️ Confirmar Deleção').setColor(0xe74c3c).setDescription(`**Irreversível!**\n\n${descricao}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [row] });
  }

  else if (commandName === 'cargo_criar') {
    const nome = interaction.options.getString('nome'); const cor = interaction.options.getString('cor') || '#99aab5'; const adm = interaction.options.getBoolean('admin') || false;
    try { const role = await guild.roles.create({ name: nome, color: cor, permissions: adm ? [PermissionFlagsBits.Administrator] : [] }); await interaction.reply({ embeds: [new EmbedBuilder().setTitle('✅ Cargo Criado!').setColor(role.color).addFields({ name: '🎭 Nome', value: role.name, inline: true }, { name: '🎨 Cor', value: cor, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
    catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  else if (commandName === 'canal_criar') {
    const nome = interaction.options.getString('nome'); const tipo = interaction.options.getString('tipo') || 'text'; const topico = interaction.options.getString('topico') || '';
    const typeMap = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice };
    try { const channelData = { name: nome, type: typeMap[tipo] || ChannelType.GuildText }; if (topico) channelData.topic = topico; const ch = await guild.channels.create(channelData); await interaction.reply({ embeds: [new EmbedBuilder().setTitle('✅ Canal Criado!').setColor(0x2ecc71).addFields({ name: '💬 Nome', value: ch.name, inline: true }, { name: '📂 Tipo', value: tipo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
    catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  else if (commandName === 'status') {
    const backup = await getBackup(guild.id); const channels = await guild.channels.fetch();
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`📊 Status — ${guild.name}`).setColor(0x3498db).setThumbnail(guild.iconURL()).addFields({ name: '👥 Membros', value: String(guild.memberCount), inline: true }, { name: '🎭 Cargos', value: String(guild.roles.cache.filter(r => r.name !== '@everyone').size), inline: true }, { name: '💬 Texto', value: String(channels.filter(c => c.type === ChannelType.GuildText).size), inline: true }, { name: '🛡️ Proteção', value: backup?.protection ? '✅ Ativa' : '❌ Inativa', inline: true }, { name: '💾 Backup', value: backup ? new Date(backup.savedAt).toLocaleString('pt-BR') : '❌ Nenhum', inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  // /ban
  else if (commandName === 'ban') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    const dias   = interaction.options.getInteger('dias') || 0;
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: '❌ Você não tem permissão para banir!', ephemeral: true });
    if (!target) return interaction.reply({ content: '❌ Membro não encontrado!', ephemeral: true });
    if (!target.bannable) return interaction.reply({ content: '❌ Não consigo banir este membro!', ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle('🔨 Você foi banido!').setColor(0xe74c3c).setDescription(`Você foi banido de **${guild.name}**

**Motivo:** ${motivo}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      await target.ban({ reason: motivo, deleteMessageDays: dias });
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔨 Membro Banido!').setColor(0xe74c3c).addFields({ name: '👤 Membro', value: `${target.user.tag}`, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }, { name: '🗑️ Mensagens deletadas', value: `${dias} dia(s)`, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // /kick
  else if (commandName === 'kick') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.reply({ content: '❌ Você não tem permissão para expulsar!', ephemeral: true });
    if (!target) return interaction.reply({ content: '❌ Membro não encontrado!', ephemeral: true });
    if (!target.kickable) return interaction.reply({ content: '❌ Não consigo expulsar este membro!', ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle('👟 Você foi expulso!').setColor(0xe67e22).setDescription(`Você foi expulso de **${guild.name}**

**Motivo:** ${motivo}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      await target.kick(motivo);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('👟 Membro Expulso!').setColor(0xe67e22).addFields({ name: '👤 Membro', value: `${target.user.tag}`, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // /mute
  else if (commandName === 'mute') {
    const target   = interaction.options.getMember('membro');
    const motivo   = interaction.options.getString('motivo') || 'Sem motivo informado';
    const duracao  = interaction.options.getInteger('duracao') || 10;
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Você não tem permissão!', ephemeral: true });
    if (!target) return interaction.reply({ content: '❌ Membro não encontrado!', ephemeral: true });
    try {
      await target.timeout(duracao * 60 * 1000, motivo);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔇 Membro Mutado!').setColor(0xf39c12).addFields({ name: '👤 Membro', value: `${target.user.tag}`, inline: true }, { name: '⏱️ Duração', value: `${duracao} minuto(s)`, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // /unmute
  else if (commandName === 'unmute') {
    const target = interaction.options.getMember('membro');
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Você não tem permissão!', ephemeral: true });
    if (!target) return interaction.reply({ content: '❌ Membro não encontrado!', ephemeral: true });
    try {
      await target.timeout(null);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔊 Membro Desmutado!').setColor(0x2ecc71).addFields({ name: '👤 Membro', value: `${target.user.tag}`, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // /warn
  else if (commandName === 'warn') {
    const target = interaction.options.getMember('membro');
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Você não tem permissão!', ephemeral: true });
    if (!target) return interaction.reply({ content: '❌ Membro não encontrado!', ephemeral: true });
    try {
      await target.send({ embeds: [new EmbedBuilder().setTitle('⚠️ Você recebeu uma advertência!').setColor(0xf39c12).setDescription(`**Servidor:** ${guild.name}
**Motivo:** ${motivo}`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }).catch(() => {});
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️ Advertência Enviada!').setColor(0xf39c12).addFields({ name: '👤 Membro', value: `${target.user.tag}`, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // /lock
  else if (commandName === 'lock') {
    const canal  = interaction.options.getChannel('canal') || interaction.channel;
    const motivo = interaction.options.getString('motivo') || 'Canal trancado';
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Você não tem permissão!', ephemeral: true });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔒 Canal Trancado!').setColor(0xe74c3c).addFields({ name: '💬 Canal', value: `<#${canal.id}>`, inline: true }, { name: '📋 Motivo', value: motivo, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // /unlock
  else if (commandName === 'unlock') {
    const canal = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Você não tem permissão!', ephemeral: true });
    try {
      await canal.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔓 Canal Destrancado!').setColor(0x2ecc71).addFields({ name: '💬 Canal', value: `<#${canal.id}>`, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // /slowmode
  else if (commandName === 'slowmode') {
    const segundos = interaction.options.getInteger('segundos');
    const canal    = interaction.options.getChannel('canal') || interaction.channel;
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Você não tem permissão!', ephemeral: true });
    try {
      await canal.setRateLimitPerUser(segundos);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⏱️ Slowmode Configurado!').setColor(0x3498db).addFields({ name: '💬 Canal', value: `<#${canal.id}>`, inline: true }, { name: '⏱️ Intervalo', value: segundos === 0 ? 'Desativado' : `${segundos} segundo(s)`, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // /clear
  else if (commandName === 'clear') {
    const quantidade = interaction.options.getInteger('quantidade');
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Você não tem permissão!', ephemeral: true });
    try {
      await interaction.deferReply({ ephemeral: true });
      const msgs = await interaction.channel.bulkDelete(Math.min(quantidade, 100), true);
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🧹 Mensagens Deletadas!').setColor(0x2ecc71).setDescription(`**${msgs.size}** mensagem(s) deletada(s) com sucesso!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
    } catch (e) { await interaction.editReply({ embeds: [errorEmbed(e.message)] }); }
  }

  // /embed
  else if (commandName === 'embed') {
    const titulo    = interaction.options.getString('titulo');
    const descricao = interaction.options.getString('descricao');
    const cor       = interaction.options.getString('cor') || '#9b59b6';
    const canal     = interaction.options.getChannel('canal') || interaction.channel;
    const imagem    = interaction.options.getString('imagem') || null;
    const rodape    = interaction.options.getString('rodape') || null;
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Você não tem permissão!', ephemeral: true });
    try {
      const embed = new EmbedBuilder().setTitle(titulo).setDescription(descricao).setColor(cor).setTimestamp();
      if (imagem) embed.setImage(imagem);
      if (rodape) embed.setFooter({ text: rodape });
      await canal.send({ embeds: [embed] });
      await interaction.reply({ content: `✅ Embed enviado em <#${canal.id}>!`, ephemeral: true });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  // /anuncio
  else if (commandName === 'anuncio') {
    const titulo    = interaction.options.getString('titulo');
    const mensagem  = interaction.options.getString('mensagem');
    const canal     = interaction.options.getChannel('canal');
    const marcar    = interaction.options.getBoolean('marcar_everyone') || false;
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Você não tem permissão!', ephemeral: true });
    try {
      const embed = new EmbedBuilder().setTitle(`📢 ${titulo}`).setDescription(mensagem).setColor(0x9b59b6).setFooter({ text: `Anúncio por ${member.user.tag} • Architect ${VERSION}` }).setTimestamp();
      await canal.send({ content: marcar ? '@everyone' : null, embeds: [embed] });
      await interaction.reply({ content: `✅ Anúncio enviado em <#${canal.id}>!`, ephemeral: true });
    } catch (e) { await interaction.reply({ embeds: [errorEmbed(e.message)], ephemeral: true }); }
  }

  else if (commandName === 'info') {
    const uptime = process.uptime();
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏗️ Architect').setColor(0x9b59b6).setThumbnail(client.user.displayAvatarURL()).setDescription('O bot mais avançado de criação, proteção e restauração de servidores Discord.').addFields({ name: '👨‍💻 Dev', value: 'Alzhayds', inline: true }, { name: '🌐 Servidores', value: String(client.guilds.cache.size), inline: true }, { name: '⏱️ Uptime', value: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`, inline: true }, { name: '⚡ Stack', value: 'Discord.js v14 + Mistral AI', inline: true }, { name: '📦 Versão', value: VERSION, inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
  }

  else if (commandName === 'help') {
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('📋 Comandos — Architect').setColor(0x9b59b6).setDescription(`**${VERSION}** — Create. Protect. Restore.`).addFields({ name: '🏗️ /criar_servidor', value: 'Cria servidor com IA' }, { name: '🎨 /template', value: 'Templates prontos' }, { name: '💾 /backup', value: 'Salva estrutura' }, { name: '🔄 /restaurar', value: 'Restaura após nuke' }, { name: '🛡️ /proteger', value: 'Anti-nuke toggle' }, { name: '🗑️ /deletar', value: 'Deleta canais/cargos' }, { name: '👥 /cargo_criar', value: 'Cria cargo' }, { name: '💬 /canal_criar', value: 'Cria canal' }, { name: '📊 /status', value: 'Info do servidor' }, { name: '🤖 /info', value: 'Info do bot' }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], ephemeral: true });
  }
});

// ── Anti-Nuke Events ───────────────────────────────────────────────────────────
client.on('channelDelete', async channel => {
  try {
    const backup = await getBackup(channel.guild.id); if (!backup?.protection) return;
    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }); const entry = logs.entries.first(); if (!entry) return;
    const count = trackNukeAction(channel.guild.id, entry.executor.id);
    if (count >= 3) { const alertCh = channel.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)); if (alertCh) await alertCh.send({ embeds: [new EmbedBuilder().setTitle('🚨 ALERTA DE NUKE!').setColor(0xe74c3c).setDescription(`⚠️ **${entry.executor.tag}** deletou **${count} canais** em menos de 10s!\n\nUse **/restaurar** imediatamente!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
  } catch (e) { console.error('Anti-nuke:', e.message); }
});

client.on('roleDelete', async role => {
  try {
    const backup = await getBackup(role.guild.id); if (!backup?.protection) return;
    const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }); const entry = logs.entries.first(); if (!entry) return;
    const count = trackNukeAction(role.guild.id, entry.executor.id);
    if (count >= 3) { const alertCh = role.guild.channels.cache.find(c => c.type === ChannelType.GuildText); if (alertCh) await alertCh.send({ embeds: [new EmbedBuilder().setTitle('🚨 ALERTA DE NUKE!').setColor(0xe74c3c).setDescription(`⚠️ **${entry.executor.tag}** deletou **${count} cargos** em menos de 10s!\n\nUse **/restaurar** imediatamente!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
  } catch (e) { console.error('Anti-nuke role:', e.message); }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const backup = await getBackup(reaction.message.guild?.id); if (!backup?.reactionRoles) return;
    const rr = backup.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === reaction.emoji.name); if (!rr) return;
    const member = await reaction.message.guild.members.fetch(user.id); await member.roles.add(rr.roleId).catch(() => {});
  } catch (e) { console.error('ReactionRole:', e.message); }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const backup = await getBackup(reaction.message.guild?.id); if (!backup?.reactionRoles) return;
    const rr = backup.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === reaction.emoji.name); if (!rr) return;
    const member = await reaction.message.guild.members.fetch(user.id); await member.roles.remove(rr.roleId).catch(() => {});
  } catch (e) { console.error('ReactionRole:', e.message); }
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function buildProgressEmbed(title, info, steps) {
  const last = steps.slice(-6);
  const log  = last.length > 0 ? last.map((s, i) => i === last.length - 1 ? `▶ ${s}` : `✔ ${s}`).join('\n') : '▶ Iniciando...';
  return new EmbedBuilder().setTitle(title).setColor(0x9b59b6).addFields({ name: '📋 Info', value: info.substring(0, 150) }, { name: '📊 Progresso', value: `\`\`\`\n${log}\n\`\`\`` }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp();
}
function errorEmbed(msg) { return new EmbedBuilder().setTitle('❌ Erro').setColor(0xe74c3c).setDescription(`\`\`\`${msg.substring(0, 500)}\`\`\``).setFooter({ text: `Architect ${VERSION}` }); }

// ── Ready ──────────────────────────────────────────────────────────────────────
// ── Guild Create (DM ao dono) ─────────────────────────────────────────────────
client.on('guildCreate', async guild => {
  try {
    const owner = await guild.fetchOwner();
    await owner.send({
      embeds: [new EmbedBuilder()
        .setTitle('🏗️ Olá! Obrigado por adicionar o Architect!')
        .setColor(0x9b59b6)
        .setThumbnail(client.user.displayAvatarURL())
        .setDescription(`Opa, **${owner.user.username}**! Vejo que você me adicionou em **${guild.name}**. Seja bem-vindo!

Aqui estão os próximos passos:`)
        .addFields(
          { name: '📋 Comandos', value: 'Use **/help** para ver todos os comandos disponíveis', inline: false },
          { name: '💾 Backup', value: 'Use **/backup** para salvar a estrutura do seu servidor', inline: false },
          { name: '🛡️ Proteção', value: 'Use **/proteger ativo:true** para ativar o anti-nuke', inline: false },
          { name: '🌐 Dashboard', value: '[Acesse o Dashboard](https://oauth-architect.onrender.com) para gerenciar seu servidor', inline: false },
          { name: '❓ Suporte', value: 'Use **/help** ou acesse nosso servidor de suporte', inline: false },
        )
        .setFooter({ text: `Architect ${VERSION} • Create. Protect. Restore.` })
        .setTimestamp()]
    }).catch(() => {});
  } catch (e) { console.error('GuildCreate DM:', e.message); }
});

client.once('ready', async () => {
  console.log(`✅ Architect ${VERSION} online como ${client.user.tag}`);
  const statuses = [{ text: 'Building your server...', type: 4 }, { text: 'Protecting your community', type: 4 }, { text: 'Restoring after nukes', type: 4 }];
  let si = 0; const tick = () => { client.user.setActivity(statuses[si].text, { type: statuses[si].type }); si = (si + 1) % statuses.length; }; tick(); setInterval(tick, 3000);
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
    new SlashCommandBuilder().setName('ban').setDescription('Bane um membro do servidor')
      .addUserOption(o => o.setName('membro').setDescription('Membro a banir').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo do ban').setRequired(false))
      .addIntegerOption(o => o.setName('dias').setDescription('Dias de mensagens a deletar (0-7)').setMinValue(0).setMaxValue(7).setRequired(false)),
    new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro do servidor')
      .addUserOption(o => o.setName('membro').setDescription('Membro a expulsar').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('mute').setDescription('Muta um membro temporariamente')
      .addUserOption(o => o.setName('membro').setDescription('Membro a mutar').setRequired(true))
      .addIntegerOption(o => o.setName('duracao').setDescription('Duração em minutos').setRequired(true).setMinValue(1).setMaxValue(10080))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('unmute').setDescription('Desmuta um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro a desmutar').setRequired(true)),
    new SlashCommandBuilder().setName('warn').setDescription('Adverte um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro a advertir').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)),
    new SlashCommandBuilder().setName('lock').setDescription('Tranca um canal')
      .addChannelOption(o => o.setName('canal').setDescription('Canal a trancar (padrão: atual)').setRequired(false))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder().setName('unlock').setDescription('Destranca um canal')
      .addChannelOption(o => o.setName('canal').setDescription('Canal a destrancar (padrão: atual)').setRequired(false)),
    new SlashCommandBuilder().setName('slowmode').setDescription('Ativa modo lento em um canal')
      .addIntegerOption(o => o.setName('segundos').setDescription('Intervalo em segundos (0 = desativar)').setRequired(true).setMinValue(0).setMaxValue(21600))
      .addChannelOption(o => o.setName('canal').setDescription('Canal (padrão: atual)').setRequired(false)),
    new SlashCommandBuilder().setName('clear').setDescription('Apaga mensagens do canal')
      .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade de mensagens (máx: 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('embed').setDescription('Cria um embed personalizado')
      .addStringOption(o => o.setName('titulo').setDescription('Título do embed').setRequired(true))
      .addStringOption(o => o.setName('descricao').setDescription('Descrição do embed').setRequired(true))
      .addChannelOption(o => o.setName('canal').setDescription('Canal onde enviar').setRequired(false))
      .addStringOption(o => o.setName('cor').setDescription('Cor hex (ex: #ff0000)').setRequired(false))
      .addStringOption(o => o.setName('imagem').setDescription('URL da imagem').setRequired(false))
      .addStringOption(o => o.setName('rodape').setDescription('Texto do rodapé').setRequired(false)),
    new SlashCommandBuilder().setName('anuncio').setDescription('Envia um anúncio em um canal')
      .addStringOption(o => o.setName('titulo').setDescription('Título do anúncio').setRequired(true))
      .addStringOption(o => o.setName('mensagem').setDescription('Mensagem do anúncio').setRequired(true))
      .addChannelOption(o => o.setName('canal').setDescription('Canal do anúncio').setRequired(true))
      .addBooleanOption(o => o.setName('marcar_everyone').setDescription('Marcar @everyone?').setRequired(false)),
    new SlashCommandBuilder().setName('info').setDescription('Informações do Architect'),
    new SlashCommandBuilder().setName('help').setDescription('Lista de comandos'),
  ].map(c => c.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log(`✅ ${commands.length} comandos registrados!`);
});

connectDB().then(() => {
  client.login(process.env.DISCORD_TOKEN);
}).catch(e => {
  console.error('❌ Erro MongoDB:', e.message);
  process.exit(1);
});
