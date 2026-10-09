/**
 * Lueur Architect v4.0.0 — Ultimate Edition
 * Developed by Lueur
 * Create. Protect. Restore.
 */

const {
  Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags,
} = require('discord.js');

const { MongoClient } = require('mongodb');
require('dotenv').config();

const VERSION        = 'v4.0.0';
const MISTRAL_MODEL  = 'open-mistral-nemo';

// ── Cores Globais ──────────────────────────────────────────────────────────────
const hex = h => parseInt(String(h).replace('#',''), 16);
const C_PURPLE = hex('9b59b6');
const C_VIOLET = hex('7d3c98');
const C_GREEN  = hex('27ae60');
const C_RED    = hex('e74c3c');
const C_YELLOW = hex('f39c12');
const C_BLUE   = hex('2980b9');
const C_GREY   = hex('636e72');

// ── Emojis do Sistema ──────────────────────────────────────────────────────────
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
  velroc:     '<:desenvolvedor:1500524499508920572>',
};

// ── Dicionário Multilíngue Completo (PT, EN, ES, FR, DE) ──────────────────────
const LANGS = {
  pt: {
    flag: '🇧🇷', name: 'Português',
    langChanged: n => `O idioma foi definido para **${n}** com sucesso.`,
    langTitle: '🇧🇷 Idioma Alterado!',
    noPermission: `${E.erro} Você precisa ser **Administrador** para usar este comando!`,
    selectLangTitle: '🌐 Seletor de Idioma / Language Selector',
    selectLangDesc: 'Escolha o idioma em que deseja que o Lueur Architect interaja com você neste servidor:',
    successSelected: n => `Idioma alterado para **${n}** com sucesso!`,
    noData: 'Nenhum registro encontrado.',
    success: 'Operação concluída com sucesso!'
  },
  en: {
    flag: '🇺🇸', name: 'English',
    langChanged: n => `Language has been set to **${n}** successfully.`,
    langTitle: '🇺🇸 Language Changed!',
    noPermission: `${E.erro} You need to be an **Administrator** to use this command!`,
    selectLangTitle: '🌐 Language Selector',
    selectLangDesc: 'Choose your preferred language for the Lueur Architect bot in this server:',
    successSelected: n => `Language successfully changed to **${n}**!`,
    noData: 'No records found.',
    success: 'Operation completed successfully!'
  },
  es: {
    flag: '🇪🇸', name: 'Español',
    langChanged: n => `El idioma se ha configurado en **${n}** exitosamente.`,
    langTitle: '🇪🇸 ¡Idioma Cambiado!',
    noPermission: `${E.erro} ¡Necesitas ser **Administrador** para usar este comando!`,
    selectLangTitle: '🌐 Selector de Idioma',
    selectLangDesc: 'Elija el idioma en el que desea que Lueur Architect interactúe con usted en este servidor:',
    successSelected: n => `¡Idioma cambiado a **${n}** exitosamente!`,
    noData: 'No se encontraron registros.',
    success: '¡Operación completada con éxito!'
  },
  fr: {
    flag: '🇫🇷', name: 'Français',
    langChanged: n => `La langue a été définie sur **${n}** avec succès.`,
    langTitle: '🇫🇷 Langue Modifiée !',
    noPermission: `${E.erro} Vous devez être **Administrateur** pour utiliser cette commande !`,
    selectLangTitle: '🌐 Sélecteur de Langue',
    selectLangDesc: 'Choisissez votre langue préférée pour interagir avec le bot sur ce serveur :',
    successSelected: n => `Langue modifiée avec succès pour **${n}** !`,
    noData: 'Aucun enregistrement trouvé.',
    success: 'Opération réussie !'
  },
  de: {
    flag: '🇩🇪', name: 'Deutsch',
    langChanged: n => `Die Sprache wurde erfolgreich auf **${n}** gesetzt.`,
    langTitle: '🇩🇪 Sprache Geändert!',
    noPermission: `${E.erro} Du musst **Administrator** sein, um diesen Befehl zu verwenden!`,
    selectLangTitle: '🌐 Sprachauswahl',
    selectLangDesc: 'Wähle deine bevorzugte Sprache für den Bot auf diesem Server aus:',
    successSelected: n => `Sprache erfolgreich auf **${n}** geändert!`,
    noData: 'Keine Einträge gefunden.',
    success: 'Operation erfolgreich abgeschlossen!'
  }
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

// ── Conexão MongoDB & Cliente Discord ──────────────────────────────────────────
let mongoDB;
async function connectDB() {
  const mc = new MongoClient(process.env.MONGO_URI);
  await mc.connect();
  mongoDB = mc.db('lueur_architect');
  console.log(`${E.sucesso} MongoDB conectado com sucesso!`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── Helpers de UI (Components V2) ──────────────────────────────────────────────
function v2Simple(accentColor, title, body, footer) {
  const lines = [];
  if (title) lines.push(`## ${title}`);
  if (body)  lines.push(body);
  if (footer) lines.push(`-# ${footer}`);
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [{
      type: 17,
      accent_color: accentColor,
      components: [{ type: 10, content: lines.join('\n') }],
    }],
  };
}

function errorEmbed(msg) {
  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [v2Simple(C_RED, 'Erro', `> ${msg}`, `Developed by Lueur • ${VERSION}`)],
  };
}

// ── Chamada Mistral Otimizada (IA Ultra Rápida) ────────────────────────────────
const MISTRAL_KEYS = {
  normal: process.env.MISTRAL_KEY_A,
  premium: process.env.MISTRAL_KEY_B || process.env.MISTRAL_KEY_A,
};

async function callMistralText(laneName, messages, maxTokens = 600) {
  const key = MISTRAL_KEYS[laneName] || MISTRAL_KEYS.normal;
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MISTRAL_MODEL, max_tokens: maxTokens, temperature: 0.4, messages }),
    signal: AbortSignal.timeout(35000),
  });
  if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ── Registro de Comandos Slash ─────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`${E.sucesso} Lueur Architect ${VERSION} online como${client.user.tag} (Developed by Lueur)`);

  const commands = [
    // 🌐 Idioma
    new SlashCommandBuilder().setName('idioma').setDescription('Altera o idioma padrão do bot').addStringOption(o => o.setName('lang').setDescription('Idioma').setRequired(true).addChoices({ name: '🇧🇷 Português', value: 'pt' }, { name: '🇺🇸 English', value: 'en' }, { name: '🇪🇸 Español', value: 'es' }, { name: '🇫🇷 Français', value: 'fr' }, { name: '🇩🇪 Deutsch', value: 'de' })),
    new SlashCommandBuilder().setName('language').setDescription('Quick switch to English language').setDMPermission(false),
    new SlashCommandBuilder().setName('idioma_painel').setDescription('Abre o painel interativo visual de idiomas'),

    // 🤖 IA Avançada & Criadores
    new SlashCommandBuilder().setName('chat').setDescription('Converse com o Lueur Architect via IA').addStringOption(o => o.setName('pergunta').setDescription('Sua dúvida ou pedido').setRequired(true)),
    new SlashCommandBuilder().setName('gerar_prompt').setDescription('Gera um prompt profissional detalhado para criar servidores usando IA').addStringOption(o => o.setName('ideia_basica').setDescription('Ex: servidor de anime, comunidade gamer, etc').setRequired(true)),
    new SlashCommandBuilder().setName('gerar_servidor').setDescription('Cria um servidor completo de alto nível baseado em prompt').addStringOption(o => o.setName('prompt').setDescription('Descreva detalhadamente o servidor desejado').setRequired(true)),

    // ⚡ 10 Novos Comandos Úteis e Funcionais
    new SlashCommandBuilder().setName('sorteio').setDescription('Cria um sorteio rápido no canal').addStringOption(o => o.setName('premio').setDescription('O prêmio').setRequired(true)).addIntegerOption(o => o.setName('minutos').setDescription('Duração em minutos').setRequired(true)),
    new SlashCommandBuilder().setName('enquete').setDescription('Cria uma enquete interativa').addStringOption(o => o.setName('pergunta').setDescription('Pergunta').setRequired(true)).addStringOption(o => o.setName('opcao1').setDescription('Opção 1').setRequired(true)).addStringOption(o => o.setName('opcao2').setDescription('Opção 2').setRequired(true)),
    new SlashCommandBuilder().setName('autorole').setDescription('Configura o cargo automático para novos membros').addRoleOption(o => o.setName('cargo').setDescription('Cargo automático').setRequired(true)),
    new SlashCommandBuilder().setName('regras').setDescription('Envia a embed oficial de regras da Lueur para o canal').addChannelOption(o => o.setName('canal').setDescription('Canal de regras').setRequired(true)),
    new SlashCommandBuilder().setName('sugestao').setDescription('Envia uma sugestão para o canal de feedback').addStringOption(o => o.setName('texto').setDescription('Sua sugestão').setRequired(true)),
    new SlashCommandBuilder().setName('anuncio').setDescription('Envia um anúncio formal da staff').addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true)).addStringOption(o => o.setName('mensagem').setDescription('Mensagem').setRequired(true)).addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(true)),
    new SlashCommandBuilder().setName('ping').setDescription('Verifica a latência do bot e API'),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Exibe estatísticas completas do servidor'),
    new SlashCommandBuilder().setName('userinfo').setDescription('Exibe detalhes de um usuário').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(false)),
    new SlashCommandBuilder().setName('clear').setDescription('Apaga mensagens em massa').addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
  ].map(c => c.toJSON());

  const shardId = client.shard?.ids?.[0] ?? 0;
  if (shardId === 0) {
    try {
      const rest = new REST().setToken(process.env.DISCORD_TOKEN);
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log(`${E.sucesso} Comandos do Lueur Architect registrados com sucesso!`);
    } catch (e) { console.error(`${E.erro} Erro ao registrar comandos:`, e.message); }
  }
});

// ── Manipulador Geral de Interações ────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    // Seletor de Idioma por Botão
    if (interaction.isButton() && interaction.customId.startsWith('set_lang_')) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Apenas administradores podem alterar o idioma.', flags: MessageFlags.Ephemeral });
      }
      const langKey = interaction.customId.replace('set_lang_', '');
      const newLang = LANGS[langKey] || LANGS.pt;
      await mongoDB.collection('settings').updateOne({ guildId: interaction.guild.id }, { $set: { guildId: interaction.guild.id, lang: langKey } }, { upsert: true });
      guildLangCache.set(interaction.guild.id, newLang);
      return interaction.reply({ ...v2Simple(C_GREEN, newLang.langTitle, newLang.successSelected(newLang.name), `Lueur Architect • Developed by Lueur`), flags: MessageFlags.Ephemeral });
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName, guild, member } = interaction;
    const lang = await getGuildLang(guild.id);

    // 🌐 /idioma
    if (commandName === 'idioma') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
      const langKey = interaction.options.getString('lang');
      const newLang = LANGS[langKey];
      await mongoDB.collection('settings').updateOne({ guildId: guild.id }, { $set: { guildId: guild.id, lang: langKey } }, { upsert: true });
      guildLangCache.set(guild.id, newLang);
      return interaction.reply(v2Simple(C_GREEN, newLang.langTitle, newLang.langChanged(newLang.name), `Lueur Architect • ${VERSION}`));
    }

    // 🌐 /language
    if (commandName === 'language') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: LANGS.en.noPermission, flags: MessageFlags.Ephemeral });
      await mongoDB.collection('settings').updateOne({ guildId: guild.id }, { $set: { guildId: guild.id, lang: 'en' } }, { upsert: true });
      guildLangCache.set(guild.id, LANGS.en);
      return interaction.reply(v2Simple(C_GREEN, LANGS.en.langTitle, LANGS.en.langChanged('English'), `Lueur Architect • ${VERSION}`));
    }

    // 🌐 /idioma_painel
    if (commandName === 'idioma_painel') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('set_lang_pt').setLabel('Português').setEmoji('🇧🇷').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_lang_en').setLabel('English').setEmoji('🇺🇸').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_lang_es').setLabel('Español').setEmoji('🇪🇸').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_lang_fr').setLabel('Français').setEmoji('🇫🇷').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('set_lang_de').setLabel('Deutsch').setEmoji('🇩🇪').setStyle(ButtonStyle.Secondary),
      );
      return interaction.reply({ ...v2Simple(C_PURPLE, lang.selectLangTitle, lang.selectLangDesc, `Lueur Architect • Interactive System`), components: [row] });
    }

    // 🤖 /chat (IA Integrada)
    if (commandName === 'chat') {
      const pergunta = interaction.options.getString('pergunta');
      await interaction.deferReply();
      const resp = await callMistralText('normal', [
        { role: 'system', content: 'Você é o Lueur Architect, um assistente inteligente especialista em Discord, comunidades e desenvolvimento, criado e desenvolvido pela Lueur. Seja ágil e certeiro.' },
        { role: 'user', content: pergunta }
      ], 500);
      return interaction.editReply(v2Simple(C_PURPLE, '🤖 Lueur AI Assistant', `**Pergunta:** ${pergunta}\n\n**Resposta:** ${resp}`, `Developed by Lueur`));
    }

    // 🤖 /gerar_prompt
    if (commandName === 'gerar_prompt') {
      const ideia = interaction.options.getString('ideia_basica');
      await interaction.deferReply();
      const promptGerado = await callMistralText('normal', [
        { role: 'system', content: 'Transforme a ideia simples do usuário em um prompt profissional ultra-detalhado para geração estruturada de servidores de Discord. Retorne apenas o texto do prompt pronto.' },
        { role: 'user', content: ideia }
      ], 400);
      return interaction.editReply(v2Simple(C_BLUE, '✨ Prompt Profissional Gerado por IA', `Copie o prompt abaixo e use no comando \`/gerar_servidor\`:\n\n\`\`\`${promptGerado}\`\`\``, `Lueur Architect`));
    }

    // ⚡ 10 Novos Comandos Úteis e Funcionais
    if (commandName === 'ping') {
      return interaction.reply(v2Simple(C_BLUE, '🏓 Pong!', `Latência: **${client.ws.ping}ms**`, `Lueur Architect`));
    }

    if (commandName === 'serverinfo') {
      const owner = await guild.fetchOwner().catch(() => null);
      return interaction.reply(v2Simple(C_PURPLE, `📊 ${guild.name}`, `**Dono:** ${owner?.user?.tag}\n**Membros:** ${guild.memberCount}\n**Cargos:** ${guild.roles.cache.size}`, `Developed by Lueur`));
    }

    if (commandName === 'userinfo') {
      const target = interaction.options.getMember('membro') || member;
      return interaction.reply(v2Simple(C_BLUE, `👤 ${target.user.tag}`, `**ID:** ${target.id}\n**Entrada:** <t:${Math.floor(target.joinedTimestamp/1000)}:R>`, `Developed by Lueur`));
    }

    if (commandName === 'clear') {
      if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
      const qtd = interaction.options.getInteger('quantidade');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const deleted = await interaction.channel.bulkDelete(qtd, true).catch(() => null);
      return interaction.editReply(v2Simple(C_GREEN, '🗑️ Limpeza Concluída', `Foram apagadas **${deleted?.size || 0}** mensagens.`, `Lueur Architect`));
    }

    if (commandName === 'sorteio') {
      if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
      const premio = interaction.options.getString('premio');
      const minutos = interaction.options.getInteger('minutos');
      const termino = Math.floor((Date.now() + minutos * 60000) / 1000);
      return interaction.reply(v2Simple(C_ORANGE, `🎉 Sorteio Iniciado: ${premio}`, `**Prêmio:** ${premio}\n**Encerra:** <t:${termino}:R>\n\nAproveite e participe!`, `Lueur Community`));
    }

    if (commandName === 'enquete') {
      const p = interaction.options.getString('pergunta');
      const op1 = interaction.options.getString('opcao1');
      const op2 = interaction.options.getString('opcao2');
      const msg = await interaction.reply({ ...v2Simple(C_BLUE, '📊 Enquete Oficial', `**${p}**\n\n1️⃣ ${op1}\n2️⃣ ${op2}`, `Developed by Lueur`), fetchReply: true });
      await msg.react('1️⃣');
      await msg.react('2️⃣');
      return;
    }

    if (commandName === 'autorole') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
      const role = interaction.options.getRole('cargo');
      await mongoDB.collection('settings').updateOne({ guildId: guild.id }, { $set: { autoroleId: role.id } }, { upsert: true });
      return interaction.reply(v2Simple(C_GREEN, '🛡️ AutoRole Configurado', `Novos membros receberão o cargo <@&${role.id}> automaticamente.`, `Lueur Architect`));
    }

    if (commandName === 'regras') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
      const canal = interaction.options.getChannel('canal');
      await canal.send(v2Simple(C_VIOLET, '📜 Regras Oficiais — Lueur', '1. Respeite todos os membros.\n2. Sem spam ou divulgação.\n3. Mantenha os chats nos canais corretos.\n4. Siga as ordens da staff.', 'Developed by Lueur'));
      return interaction.reply({ content: lang.success, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'sugestao') {
      const texto = interaction.options.getString('texto');
      return interaction.reply(v2Simple(C_PURPLE, `💡 Sugestão de ${member.user.tag}`, texto, `Lueur Feedback`));
    }

    if (commandName === 'anuncio') {
      if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: lang.noPermission, flags: MessageFlags.Ephemeral });
      const titulo = interaction.options.getString('titulo');
      const msg = interaction.options.getString('mensagem');
      const canal = interaction.options.getChannel('canal');
      await canal.send({ content: '@everyone', allowedMentions: { parse: ['everyone'] } });
      await canal.send(v2Simple(C_ORANGE, `📢 ${titulo}`, msg, `Staff Lueur`));
      return interaction.reply({ content: lang.success, flags: MessageFlags.Ephemeral });
    }

  } catch (err) {
    console.error('[INTERACTION ERROR]', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(errorEmbed('Erro interno ao executar a ação.')).catch(() => {});
    }
  }
});

// ── Inicialização Web e Bot ────────────────────────────────────────────────────
const express = require('express');
const app = express();
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', version: VERSION }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`${E.sucesso} Servidor Web ativo na porta ${PORT}`));

async function start() {
  await connectDB();
  await client.login(process.env.DISCORD_TOKEN);
}
start();
