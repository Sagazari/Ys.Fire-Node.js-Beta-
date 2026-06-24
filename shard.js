const { ShardingManager } = require('discord.js');
require('dotenv').config();

if (!process.env.DISCORD_TOKEN) {
  console.error('[SHARD] DISCORD_TOKEN não encontrado!');
  process.exit(1);
}

const manager = new ShardingManager('./index.js', {
  token:       process.env.DISCORD_TOKEN,
  totalShards: 2,     // Fixo em 2 — mínimo para +1000 servidores, máximo que o Render free aguenta
  mode:        'process',
  respawn:     true,
  shardArgs:   ['--max-old-space-size=180'], // 2 shards × 180MB = 360MB, sobra margem nos 512MB
});

manager.on('shardCreate', shard => {
  console.log(`[SHARD] Shard #${shard.id} iniciado.`);
  shard.on('ready',        ()  => console.log(`[SHARD #${shard.id}] Ready ✅`));
  shard.on('disconnect',   ()  => console.warn(`[SHARD #${shard.id}] Desconectado ⚠️`));
  shard.on('reconnecting', ()  => console.log(`[SHARD #${shard.id}] Reconectando...`));
  shard.on('death',        (p) => console.error(`[SHARD #${shard.id}] Morreu (código ${p.exitCode}) — reiniciando...`));
  shard.on('error',        (e) => console.error(`[SHARD #${shard.id}] Erro: ${e.message}`));
});

// Spawna um shard por vez com 15s de intervalo — evita pico simultâneo de RAM
manager.spawn({ amount: 2, delay: 15000, timeout: 120000 })
  .then(() => console.log(`[SHARD] Todos os shards prontos! Total: ${manager.totalShards}`))
  .catch(e => {
    console.error('[SHARD] Falha ao iniciar shards:', e.message);
    process.exit(1);
  });
