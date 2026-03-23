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
const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const express  = require('express');
const path     = require('path');
const cors     = require('cors');
require('dotenv').config();

const VERSION       = 'v1.5.0';
const MISTRAL_MODEL = 'mistral-large-latest';
const API_KEY       = process.env.API_KEY || 'architect-secret-key';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://termsarch-ez.onrender.com/dashboard.html';

// ── Database ───────────────────────────────────────────────────────────────────
const db = low(new FileSync('backups.json'));
db.defaults({ backups: [] }).write();

function saveBackup(guildId, guildName, structure) {
  const exists = db.get('backups').find({ guildId }).value();
  const data   = { guildId, guildName, structure, savedAt: new Date().toISOString() };
  if (exists) db.get('backups').find({ guildId }).assign(data).write();
  else        db.get('backups').push(data).write();
}

function getBackup(guildId)          { return db.get('backups').find({ guildId }).value(); }
function setProtection(guildId, val) { db.get('backups').find({ guildId }).assign({ protection: val }).write(); }

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
  const backup = getBackup(guildId);
  if (!backup) return res.status(400).json({ error: 'No backup found.' });
  setProtection(guildId, active);
  res.json({ success: true, protection: active });
});

app.get('/api/backup', authMiddleware, async (req, res) => {
  const { guildId } = req.query;
  const backup = getBackup(guildId);
  if (!backup) return res.status(404).json({ error: 'No backup found' });
  res.json({ savedAt: backup.savedAt, guildName: backup.guildName, roles: backup.structure.roles?.length || 0, categories: backup.structure.categories?.length || 0 });
});

app.post('/api/backup/restore', authMiddleware, async (req, res) => {
  const { guildId } = req.body;
  const guild  = client.guilds.cache.get(guildId);
  const backup = getBackup(guildId);
  if (!guild)  return res.status(404).json({ error: 'Guild not found' });
  if (!backup) return res.status(404).json({ error: 'No backup found' });
  res.json({ success: true, message: 'Restauração iniciada!' });
  await applyStructure(guild, backup.structure, async () => {});
});

app.post('/api/logs', authMiddleware, async (req, res) => {
  const { guildId, channelId } = req.body;
  const existing = db.get('backups').find({ guildId }).value();
  if (existing) db.get('backups').find({ guildId }).assign({ logChannelId: channelId }).write();
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
  if (existing) { const rrs = existing.reactionRoles || []; rrs.push({ messageId: msg.id, channelId, emoji, roleId }); db.get('backups').find({ guildId }).assign({ reactionRoles: rrs }).write(); }
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
    const backup = getBackup(guild.id);
    if (!backup) return interaction.reply({ content: '❌ Nenhum backup encontrado!', ephemeral: true });
    const confirmId = `${interaction.id}`; pendingRestore.set(confirmId, { backup }); setTimeout(() => pendingRestore.delete(confirmId), 60000);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`restore_confirm_${confirmId}`).setLabel('🔄 Restaurar').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`cancel_confirm_${confirmId}`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger));
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️ Restaurar Backup').setColor(0x3498db).setDescription('Isso irá apagar TUDO e restaurar o backup.').addFields({ name: '📅 Backup de', value: new Date(backup.savedAt).toLocaleString('pt-BR') }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()], components: [row] });
  }

  else if (commandName === 'proteger') {
    const ativo = interaction.options.getBoolean('ativo');
    const backup = getBackup(guild.id);
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
    const backup = getBackup(guild.id); const channels = await guild.channels.fetch();
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`📊 Status — ${guild.name}`).setColor(0x3498db).setThumbnail(guild.iconURL()).addFields({ name: '👥 Membros', value: String(guild.memberCount), inline: true }, { name: '🎭 Cargos', value: String(guild.roles.cache.filter(r => r.name !== '@everyone').size), inline: true }, { name: '💬 Texto', value: String(channels.filter(c => c.type === ChannelType.GuildText).size), inline: true }, { name: '🛡️ Proteção', value: backup?.protection ? '✅ Ativa' : '❌ Inativa', inline: true }, { name: '💾 Backup', value: backup ? new Date(backup.savedAt).toLocaleString('pt-BR') : '❌ Nenhum', inline: true }).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] });
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
    const backup = getBackup(channel.guild.id); if (!backup?.protection) return;
    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }); const entry = logs.entries.first(); if (!entry) return;
    const count = trackNukeAction(channel.guild.id, entry.executor.id);
    if (count >= 3) { const alertCh = channel.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)); if (alertCh) await alertCh.send({ embeds: [new EmbedBuilder().setTitle('🚨 ALERTA DE NUKE!').setColor(0xe74c3c).setDescription(`⚠️ **${entry.executor.tag}** deletou **${count} canais** em menos de 10s!\n\nUse **/restaurar** imediatamente!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
  } catch (e) { console.error('Anti-nuke:', e.message); }
});

client.on('roleDelete', async role => {
  try {
    const backup = getBackup(role.guild.id); if (!backup?.protection) return;
    const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }); const entry = logs.entries.first(); if (!entry) return;
    const count = trackNukeAction(role.guild.id, entry.executor.id);
    if (count >= 3) { const alertCh = role.guild.channels.cache.find(c => c.type === ChannelType.GuildText); if (alertCh) await alertCh.send({ embeds: [new EmbedBuilder().setTitle('🚨 ALERTA DE NUKE!').setColor(0xe74c3c).setDescription(`⚠️ **${entry.executor.tag}** deletou **${count} cargos** em menos de 10s!\n\nUse **/restaurar** imediatamente!`).setFooter({ text: `Architect ${VERSION}` }).setTimestamp()] }); }
  } catch (e) { console.error('Anti-nuke role:', e.message); }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const backup = getBackup(reaction.message.guild?.id); if (!backup?.reactionRoles) return;
    const rr = backup.reactionRoles.find(r => r.messageId === reaction.message.id && r.emoji === reaction.emoji.name); if (!rr) return;
    const member = await reaction.message.guild.members.fetch(user.id); await member.roles.add(rr.roleId).catch(() => {});
  } catch (e) { console.error('ReactionRole:', e.message); }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const backup = getBackup(reaction.message.guild?.id); if (!backup?.reactionRoles) return;
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
    new SlashCommandBuilder().setName('info').setDescription('Informações do Architect'),
    new SlashCommandBuilder().setName('help').setDescription('Lista de comandos'),
  ].map(c => c.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log(`✅ ${commands.length} comandos registrados!`);
});

client.login(process.env.DISCORD_TOKEN);
