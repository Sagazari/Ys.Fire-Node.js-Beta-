/**
 * Architect API Server v1.5.0
 * Roda no Render — conecta com MongoDB e serve o Dashboard
 * Developed by Alzhayds
 */

const express = require('express');
const { MongoClient } = require('mongodb');
const fetch   = require('node-fetch');
const path    = require('path');
const cors    = require('cors');
require('dotenv').config();

const app      = express();
const PORT     = process.env.PORT || 3000;
const API_KEY  = process.env.API_KEY || 'architect-secret-key';
const MONGO_URI = process.env.MONGO_URI;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const DASH_URL  = process.env.DASH_URL || 'https://termsarch-ez.onrender.com';
const REDIRECT_URI = `${process.env.API_URL || 'https://architect-api.onrender.com'}/auth/callback`;

app.use(express.json());
app.use(cors({ origin: '*' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── MongoDB ────────────────────────────────────────────────────────────────────
let db;
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('architect');
  console.log('✅ MongoDB conectado!');
}

async function getBackup(guildId) {
  return await db.collection('backups').findOne({ guildId });
}

async function saveBackup(guildId, guildName, structure) {
  await db.collection('backups').updateOne(
    { guildId },
    { $set: { guildId, guildName, structure, savedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

async function setProtection(guildId, active) {
  await db.collection('backups').updateOne({ guildId }, { $set: { protection: active } });
}

async function setLogChannel(guildId, channelId) {
  await db.collection('backups').updateOne({ guildId }, { $set: { logChannelId: channelId } });
}

// ── Auth middleware ────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const key = req.headers['authorization'];
  if (key !== `Bearer ${API_KEY}`) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'online', version: 'v1.5.0' }));

// ── Dashboard (serve HTML) ─────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ── OAuth2 Callback ────────────────────────────────────────────────────────────
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).send('Failed to get token');

    const userRes   = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const userData  = await userRes.json();

    const guildsRes  = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const guildsData = await guildsRes.json();

    // Get guilds where user is admin AND bot has backup data
    const backups   = await db.collection('backups').find({}).toArray();
    const botGuildIds = backups.map(b => b.guildId);
    const adminGuilds = guildsData
      .filter(g => (g.permissions & 0x8) === 0x8)
      .map(g => ({ id: g.id, name: g.name, icon: g.icon }));

    const data = encodeURIComponent(JSON.stringify({ user: userData, guilds: adminGuilds }));
    res.redirect(`/?auth=${data}`);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ── GET /api/guild ─────────────────────────────────────────────────────────────
app.get('/api/guild', auth, async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });
  try {
    const backup = await getBackup(guildId);
    res.json({
      id:          guildId,
      name:        backup?.guildName || 'Servidor',
      memberCount: backup?.memberCount || 0,
      roleCount:   backup?.structure?.roles?.length || 0,
      textCount:   backup?.structure?.categories?.reduce((a, c) => a + c.channels.filter(ch => ch.type === 'text').length, 0) || 0,
      voiceCount:  backup?.structure?.categories?.reduce((a, c) => a + c.channels.filter(ch => ch.type === 'voice').length, 0) || 0,
      forumCount:  backup?.structure?.categories?.reduce((a, c) => a + c.channels.filter(ch => ch.type === 'forum').length, 0) || 0,
      protection:  backup?.protection || false,
      hasBackup:   !!backup,
      backupDate:  backup?.savedAt || null,
      logChannelId: backup?.logChannelId || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/backup ────────────────────────────────────────────────────────────
app.get('/api/backup', auth, async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });
  try {
    const backup = await getBackup(guildId);
    if (!backup) return res.status(404).json({ error: 'No backup found' });
    res.json({
      savedAt:    backup.savedAt,
      guildName:  backup.guildName,
      roles:      backup.structure?.roles?.length || 0,
      categories: backup.structure?.categories?.length || 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/roles ─────────────────────────────────────────────────────────────
app.get('/api/roles', auth, async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });
  try {
    const backup = await getBackup(guildId);
    if (!backup) return res.json([]);
    const roles = (backup.structure?.roles || []).map((r, i) => ({
      id:          i.toString(),
      name:        r.name,
      color:       r.color,
      memberCount: 0,
      position:    r.position || i,
    }));
    res.json(roles);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/channels ──────────────────────────────────────────────────────────
app.get('/api/channels', auth, async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });
  try {
    const backup = await getBackup(guildId);
    if (!backup) return res.json([]);
    const channels = [];
    for (const cat of backup.structure?.categories || []) {
      channels.push({ id: cat.name, name: cat.name, type: 4, parentId: null });
      for (const ch of cat.channels || []) {
        channels.push({ id: ch.name, name: ch.name, type: ch.type === 'voice' ? 2 : ch.type === 'forum' ? 15 : 0, parentId: cat.name });
      }
    }
    res.json(channels);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/protection ───────────────────────────────────────────────────────
app.post('/api/protection', auth, async (req, res) => {
  const { guildId, active } = req.body;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });
  try {
    const backup = await getBackup(guildId);
    if (!backup) return res.status(400).json({ error: 'No backup found. Use /backup in Discord first.' });
    await setProtection(guildId, active);
    res.json({ success: true, protection: active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/logs ─────────────────────────────────────────────────────────────
app.post('/api/logs', auth, async (req, res) => {
  const { guildId, channelId } = req.body;
  if (!guildId || !channelId) return res.status(400).json({ error: 'Missing fields' });
  try {
    await setLogChannel(guildId, channelId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/backup/restore ───────────────────────────────────────────────────
app.post('/api/backup/restore', auth, async (req, res) => {
  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });
  try {
    const backup = await getBackup(guildId);
    if (!backup) return res.status(404).json({ error: 'No backup found' });
    // Signal to bot via DB flag
    await db.collection('commands').insertOne({ type: 'restore', guildId, createdAt: new Date() });
    res.json({ success: true, message: 'Restauração iniciada! O bot irá processar em breve.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/reaction-roles ───────────────────────────────────────────────────
app.post('/api/reaction-roles', auth, async (req, res) => {
  const { guildId, channelId, roleId, emoji, description } = req.body;
  if (!guildId || !channelId || !roleId || !emoji) return res.status(400).json({ error: 'Missing fields' });
  try {
    await db.collection('commands').insertOne({ type: 'reaction-role', guildId, channelId, roleId, emoji, description, createdAt: new Date() });
    res.json({ success: true, message: 'Reaction role será criado pelo bot em breve.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ──────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => console.log(`✅ Architect API rodando na porta ${PORT}`));
}).catch(e => {
  console.error('❌ Erro ao conectar MongoDB:', e.message);
  process.exit(1);
});
