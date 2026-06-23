const { ShardingManager } = require('discord.js');
require('dotenv').config();

if (!process.env.DISCORD_TOKEN) {
  console.error('[SHARD] DISCORD_TOKEN não encontrado!');
  process.exit(1);
}

const manager = new ShardingManager('./index.js', {
  token:       process.env.DISCORD_TOKEN,
  totalShards: 'auto', // Discord define o mínimo necessário (2 para +1000 servidores)
  mode:        'process',
  respawn:     true,
  shardArgs:   ['--max-old-space-size=200'], // limita heap por shard a 200MB
});

manager.on('shardCreate', shard => {
  console.log(`[SHARD] Shard #${shard.id} iniciado.`);
  shard.on('ready',        ()  => console.log(`[SHARD #${shard.id}] Ready ✅`));
  shard.on('disconnect',   ()  => console.warn(`[SHARD #${shard.id}] Desconectado ⚠️`));
  shard.on('reconnecting', ()  => console.log(`[SHARD #${shard.id}] Reconectando...`));
  shard.on('death',        (p) => console.error(`[SHARD #${shard.id}] Morreu (código ${p.exitCode}) — reiniciando...`));
  shard.on('error',        (e) => console.error(`[SHARD #${shard.id}] Erro: ${e.message}`));
});

// Spawn um shard por vez com intervalo de 10s — evita pico de RAM simultâneo
manager.spawn({ amount: 'auto', delay: 10000, timeout: 120000 })
  .then(() => console.log(`[SHARD] Todos os shards prontos! Total: ${manager.totalShards}`))
  .catch(e => {
    console.error('[SHARD] Falha ao iniciar shards:', e.message);
    process.exit(1);
  });
