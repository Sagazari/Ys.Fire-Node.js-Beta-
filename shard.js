/**
 * Architect — Shard Manager
 * Entry point para produção. Substitui o `node index.js` direto.
 * Use: node shard.js
 */

const { ShardingManager } = require('discord.js');
require('dotenv').config();

if (!process.env.DISCORD_TOKEN) {
  console.error('[SHARD] DISCORD_TOKEN não encontrado! Defina no .env / Render.');
  process.exit(1);
}

const manager = new ShardingManager('./index.js', {
  token:       process.env.DISCORD_TOKEN,
  totalShards: 1,    // Forçar 1 shard — Render free tier não suporta múltiplos processos
  mode:        'process',
  respawn:     true,
});

manager.on('shardCreate', shard => {
  console.log(`[SHARD] Shard #${shard.id} iniciado.`);

  shard.on('ready',        ()  => console.log(`[SHARD #${shard.id}] Ready ✅`));
  shard.on('disconnect',   ()  => console.warn(`[SHARD #${shard.id}] Desconectado ⚠️`));
  shard.on('reconnecting', ()  => console.log(`[SHARD #${shard.id}] Reconectando...`));
  shard.on('death',        (p) => console.error(`[SHARD #${shard.id}] Morreu (código ${p.exitCode}) — reiniciando...`));
  shard.on('error',        (e) => console.error(`[SHARD #${shard.id}] Erro: ${e.message}`));
});

manager.spawn({ timeout: 120000 }) // 2 min — tempo suficiente para boot completo no Render
  .then(() => console.log(`[SHARD] Todos os shards iniciados! Total: ${manager.totalShards}`))
  .catch(e => {
    console.error('[SHARD] Falha ao iniciar shards:', e.message);
    process.exit(1);
  });
