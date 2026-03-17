require('dotenv').config();
const {
    Client, GatewayIntentBits, Partials, Collection, REST, Routes,
    SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType, AuditLogEvent
} = require('discord.js');
const fs = require('fs');

let groq;
try {
    const Groq = require('groq-sdk');
    groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
} catch (e) {
    console.log("Groq SDK yüklü değil.");
}

const kufurListesi = ["amk", "aq", "sg", "oç", "orospu", "pic", "piç", "sikerim", "yavşak", "yavsak", "gavat", "ibne", "pezevenk"];


const dbPath = './db.json';
let db = {};
if (fs.existsSync(dbPath)) {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}
const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 4));


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});


const commands = [

    new SlashCommandBuilder().setName('yardim').setDescription('Botun komutlarını listeler.'),
    new SlashCommandBuilder().setName('ping').setDescription('Botun gecikme süresini gösterir.'),
    new SlashCommandBuilder().setName('stats').setDescription('Bot istatistiklerini gösterir.'),
    new SlashCommandBuilder().setName('uptime').setDescription('Botun ne kadar süredir aktif olduğunu gösterir.'),
    new SlashCommandBuilder().setName('shardinfo').setDescription('Shard bilgilerini gösterir.'),


    new SlashCommandBuilder().setName('mute').setDescription('Kullanıcıyı susturur.')
        .addUserOption(o => o.setName('kullanici').setDescription('Susturulacak kullanıcı').setRequired(true))
        .addIntegerOption(o => o.setName('sure').setDescription('Dakika cinsinden süre').setRequired(true))
        .addStringOption(o => o.setName('sebep').setDescription('Susturma sebebi')),
    new SlashCommandBuilder().setName('unmute').setDescription('Kullanıcının susturmasını kaldırır.')
        .addUserOption(o => o.setName('kullanici').setDescription('Susturması kaldırılacak kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Kullanıcıyı sunucudan atar.')
        .addUserOption(o => o.setName('kullanici').setDescription('Atılacak kullanıcı').setRequired(true))
        .addStringOption(o => o.setName('sebep').setDescription('Atılma sebebi')),
    new SlashCommandBuilder().setName('ban').setDescription('Kullanıcıyı sunucudan yasaklar.')
        .addUserOption(o => o.setName('kullanici').setDescription('Yasaklanacak kullanıcı').setRequired(true))
        .addStringOption(o => o.setName('sebep').setDescription('Yasaklanma sebebi')),
    new SlashCommandBuilder().setName('warn').setDescription('Kullanıcıyı uyarır.')
        .addUserOption(o => o.setName('kullanici').setDescription('Uyarılacak kullanıcı').setRequired(true))
        .addStringOption(o => o.setName('sebep').setDescription('Uyarı sebebi')),
    new SlashCommandBuilder().setName('purge').setDescription('Belirtilen miktarda mesajı siler.')
        .addIntegerOption(o => o.setName('miktar').setDescription('Silinecek mesaj sayısı (1-100)').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Belirtilen miktarda mesajı siler.')
        .addIntegerOption(o => o.setName('miktar').setDescription('Silinecek mesaj sayısı (1-100)').setRequired(true)),


    new SlashCommandBuilder().setName('avatar').setDescription('Kullanıcının profil fotoğrafını gösterir.')
        .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı seçin')),
    new SlashCommandBuilder().setName('banner').setDescription('Kullanıcının afişini gösterir.')
        .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı seçin')),
    new SlashCommandBuilder().setName('userinfo').setDescription('Kullanıcı bilgilerini gösterir.')
        .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı seçin')),
    new SlashCommandBuilder().setName('roleinfo').setDescription('Rol bilgilerini gösterir.')
        .addRoleOption(o => o.setName('rol').setDescription('Rol seçin').setRequired(true)),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Sunucu bilgilerini gösterir.'),


    new SlashCommandBuilder().setName('addrole').setDescription('Kullanıcıya rol verir.')
        .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
        .addRoleOption(o => o.setName('rol').setDescription('Verilecek Rol').setRequired(true)),
    new SlashCommandBuilder().setName('removerole').setDescription('Kullanıcıdan rol alır.')
        .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
        .addRoleOption(o => o.setName('rol').setDescription('Alınacak Rol').setRequired(true)),
    new SlashCommandBuilder().setName('lockrole').setDescription('Rolün bahsetme (mention) ayarını değiştirir.')
        .addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)),
    new SlashCommandBuilder().setName('autorole').setDescription('Sunucuya katılanlara otomatik verilecek rolü ayarlar (rolü belirtmezseniz kapatır).')
        .addRoleOption(o => o.setName('rol').setDescription('Oto-Rol (opsiyonel)')),


    new SlashCommandBuilder().setName('modlog').setDescription('Moderasyon log kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('leavelog').setDescription('Çıkış log kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('joinlog').setDescription('Giriş log kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('editlog').setDescription('Mesaj düzenleme log kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('messagelog').setDescription('Mesaj silinme log kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('setlog').setDescription('Tüm logları tek bir kanala ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Ana log kanalı').addChannelTypes(ChannelType.GuildText)),


    new SlashCommandBuilder().setName('antimention').setDescription('Toplu etiket atılmasını engeller (Aç/Kapat).')
        .addBooleanOption(o => o.setName('durum').setDescription('Aktif mi?').setRequired(true)),
    new SlashCommandBuilder().setName('antiraid').setDescription('Sunucuya ani girişleri (Raid) engeller.')
        .addBooleanOption(o => o.setName('durum').setDescription('Aktif mi?').setRequired(true)),
    new SlashCommandBuilder().setName('antibot').setDescription('Sunucuya bot eklenmesini engeller.')
        .addBooleanOption(o => o.setName('durum').setDescription('Aktif mi?').setRequired(true)),
    new SlashCommandBuilder().setName('antilink').setDescription('Link paylaşımını engeller.')
        .addBooleanOption(o => o.setName('durum').setDescription('Aktif mi?').setRequired(true)),
    new SlashCommandBuilder().setName('antispam').setDescription('Spam yapılmasını engeller.')
        .addBooleanOption(o => o.setName('durum').setDescription('Aktif mi?').setRequired(true)),
    new SlashCommandBuilder().setName('antiinvite').setDescription('Discord davet linklerini engeller.')
        .addBooleanOption(o => o.setName('durum').setDescription('Aktif mi?').setRequired(true)),
    new SlashCommandBuilder().setName('capslimit').setDescription('Büyük harf kullanım sınırını açar/kapatır.')
        .addBooleanOption(o => o.setName('durum').setDescription('Aktif mi?').setRequired(true)),


    new SlashCommandBuilder().setName('ticket_setup').setDescription('Ticket sistemini kurar.'),
    new SlashCommandBuilder().setName('verification').setDescription('Doğrulama (Kayıt) sistemini kurar.')
        .addRoleOption(o => o.setName('verilecek_rol').setDescription('Doğrulanınca verilecek rol').setRequired(true)),
    new SlashCommandBuilder().setName('welcome').setDescription('Hoş geldin mesajı kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('goodbye').setDescription('Görüşürüz mesajı kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('setprefix').setDescription('Slash komutları olduğu için prefix kullanılmaz, sadece bilgi amaçlıdır.'),
    

    new SlashCommandBuilder().setName('sunucukur').setDescription('Sunucuyu otomatik olarak baştan kurar.'),
    new SlashCommandBuilder().setName('reset').setDescription('Sunucu yapılandırmasını sıfırlar (Kişiselleştirmeyi bitirir).'),
    new SlashCommandBuilder().setName('motivasyon').setDescription('Rastgele bir motivasyon sözü gönderir.'),
    new SlashCommandBuilder().setName('tkm').setDescription('Taş, Kağıt, Makas oynatır.')
        .addStringOption(o => o.setName('secim').setDescription('Seçiminiz').setRequired(true).addChoices({name: 'Taş', value: 'tas'}, {name: 'Kağıt', value: 'kagit'}, {name: 'Makas', value: 'makas'})),
    new SlashCommandBuilder().setName('mesaj').setDescription('Bota istediğiniz mesajı yazdırırsınız.')
        .addStringOption(o => o.setName('metin').setDescription('Botun yazacağı mesaj').setRequired(true)),
    new SlashCommandBuilder().setName('selamla').setDescription('Bot belirtilen kullanıcıyı selamlar.')
        .addUserOption(o => o.setName('kisi').setDescription('Selamlanacak kişi').setRequired(true))
];


const checkPerm = (interaction, perm) => {
    if (!interaction.member.permissions.has(perm)) {
        interaction.reply({ content: 'Bu komutu kullanmak için yeterli yetkiniz yok.', ephemeral: true });
        return false;
    }
    return true;
};

const sendModLog = async (guild, action, target, moderator, reason) => {
    const conf = db[guild.id] || {};
    if (!conf.modlog) return;
    const channel = guild.channels.cache.get(conf.modlog);
    if (!channel) return;
    const embed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('Moderasyon İşlemi')
        .addFields(
            { name: 'İşlem', value: action, inline: true },
            { name: 'Hedef', value: `${target} (${target.id})`, inline: true },
            { name: 'Yetkili', value: `${moderator} (${moderator.id})`, inline: true },
            { name: 'Sebep', value: reason || 'Belirtilmemiş' }
        )
        .setTimestamp();
    channel.send({ embeds: [embed] });
};

const safeText = (v, fallback = '—') => {
    if (v === null || v === undefined) return fallback;
    const s = String(v);
    if (!s.trim()) return fallback;
    return s.length > 1024 ? s.slice(0, 1021) + '...' : s;
};

const pickLogChannel = (guild, keys = []) => {
    const conf = db[guild.id] || {};
    for (const k of keys) {
        const id = conf[k];
        if (!id) continue;
        const ch = guild.channels.cache.get(id);
        if (ch) return ch;
    }

    const fallbackId = conf.modlog || conf.messagelog || conf.joinlog || conf.leavelog;
    return fallbackId ? guild.channels.cache.get(fallbackId) : null;
};

const sendLogEmbed = async (guild, keys, embed) => {
    const channel = pickLogChannel(guild, keys);
    if (!channel) return;
    return channel.send({ embeds: [embed] }).catch(() => {});
};

const fetchRecentAuditEntry = async (guild, type, targetId, maxAgeMs = 12_000) => {
    try {
        const logs = await guild.fetchAuditLogs({ type, limit: 6 });
        const now = Date.now();
        const entry = logs.entries.find(e => {
            if (!e) return false;
            if (targetId && e.target?.id !== targetId) return false;
            if (e.createdTimestamp && now - e.createdTimestamp > maxAgeMs) return false;
            return true;
        });
        return entry || null;
    } catch {
        return null;
    }
};


client.once('ready', async () => {
    console.log(`${client.user.tag} olarak giriş yapıldı!`);

    const statuslar = [
        'Spamcıları avlıyorum 🦊',
        'Sunucuyu izliyorum 👀',
        '/yardım yazmayı unutma 💡',
        'Logları kontrol ediyorum 📂',
        'Moderasyon aktif 🔨'
    ];

    let i = 0;

    setInterval(() => {
        client.user.setActivity(statuslar[i], { type: ActivityType.Watching });
        i++;
        if (i >= statuslar.length) i = 0;
    }, 5000);

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        console.log('(/) komutları yükleniyor...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('Komutlar başarıyla yüklendi.');
    } catch (error) {
        console.error('Komut yüklenirken hata:', error);
    }
});

client.on('interactionCreate', async interaction => {

    if (interaction.isButton()) {
        if (interaction.customId === 'ticket_olustur') {
            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            await interaction.reply({ content: `Biletiniz oluşturuldu: ${channel}`, ephemeral: true });
            return channel.send(`Hoş geldin <@${interaction.user.id}>, yetkililer yakında ilgilenecektir. Sorununu Bu Kanalda Açıkla`);
        }
        if (interaction.customId === 'kayit_ol') {
            const conf = db[interaction.guild.id] || {};
            const kayitRolu = conf.verificationRole;
            if (kayitRolu) {
                await interaction.member.roles.add(kayitRolu).catch(() => {});
                return interaction.reply({ content: 'Başarıyla doğrulandınız!', ephemeral: true });
            }
            return interaction.reply({ content: 'Doğrulama rolü ayarlanmamış.', ephemeral: true });
        }
        return;
    }

    if (!interaction.isCommand()) return;
    const { commandName, options, guild, user, member } = interaction;
    if (!guild) return interaction.reply({ content: 'Bu komutlar sadece sunucularda kullanılabilir.', ephemeral: true });
    
    const guildId = guild.id;
    if (!db[guildId]) db[guildId] = {};

    try {
        switch (commandName) {

            case 'yardim': {
                const helpEmbed = new EmbedBuilder()
                    .setColor('Blue')
                    .setTitle('Bot Komutları')
                    .setDescription('Aşağıda kullanabileceğiniz komutların listesi bulunmaktadır.')
                    .addFields(
                        { name: '🛠️ Moderasyon', value: '`/mute`, `/unmute`, `/kick`, `/ban`, `/purge`, `/clear`' },
                        { name: 'ℹ️ Bilgi', value: '`/avatar`, `/banner`, `/userinfo`, `/roleinfo`, `/serverinfo`' },
                        { name: '🎭 Rol', value: '`/addrole`, `/removerole`, `/lockrole`, `/autorole`' },
                        { name: '📋 Log', value: '`/modlog`, `/leavelog`, `/joinlog`, `/editlog`, `/messagelog`, `/setlog`' },
                        { name: '🛡️ Güvenlik', value: '`/antimention`, `/antiraid`, `/antibot`, `/antilink`, `/antispam`, `/antiinvite`, `/capslimit`' },
                        { name: '⚙️ Sistem', value: '`/ticket_setup`, `/verification`, `/welcome`, `/goodbye`, `/setprefix`, `/sunucukur`, `/reset`' },
                        { name: '✨ Eğlence & Diğer', value: '`/motivasyon`, `/tkm`, `/mesaj`, `/selamla`' }
                    );
                await interaction.reply({ embeds: [helpEmbed] });
                break;
            }
            case 'ping':
                await interaction.reply(`Pong! Gecikme: ${client.ws.ping}ms`);
                break;
            case 'stats': {
                const totalMembers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
                await interaction.reply(`Sunucu Sayısı: ${client.guilds.cache.size}\nKullanıcı Sayısı: ${totalMembers}\nPing: ${client.ws.ping}ms`);
                break;
            }
            case 'uptime': {
                const uptime = process.uptime();
                const d = Math.floor(uptime / 86400);
                const h = Math.floor(uptime / 3600) % 24;
                const m = Math.floor(uptime / 60) % 60;
                const s = Math.floor(uptime % 60);
                await interaction.reply(`Aktif kalma süresi: ${d}g ${h}s ${m}d ${s}s`);
                break;
            }
            case 'shardinfo':
                await interaction.reply(`Bu bot tek shard ile çalışmaktadır. Shard ID: 0`);
                break;


            case 'mute': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
                const target = options.getMember('kullanici');
                const duration = options.getInteger('sure') * 60 * 1000;
                const reason = options.getString('sebep') || 'Sebep belirtilmedi';
                await target.timeout(duration, reason);
                await interaction.reply(`${target.user.tag} başarıyla susturuldu. (${options.getInteger('sure')} dakika)`);
                sendModLog(guild, 'Mute', target.user, user, reason);
                break;
            }
            case 'unmute': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
                const target = options.getMember('kullanici');
                await target.timeout(null);
                await interaction.reply(`${target.user.tag} susturması kaldırıldı.`);
                sendModLog(guild, 'Unmute', target.user, user, 'Susturma kaldırıldı');
                break;
            }
            case 'kick': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.KickMembers)) return;
                const target = options.getMember('kullanici');
                const reason = options.getString('sebep') || 'Sebep belirtilmedi';
                await target.kick(reason);
                await interaction.reply(`${target.user.tag} sunucudan atıldı.`);
                sendModLog(guild, 'Kick', target.user, user, reason);
                break;
            }
            case 'ban': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.BanMembers)) return;
                const target = options.getUser('kullanici');
                const reason = options.getString('sebep') || 'Sebep belirtilmedi';
                await guild.members.ban(target, { reason });
                await interaction.reply(`${target.tag} sunucudan yasaklandı.`);
                sendModLog(guild, 'Ban', target, user, reason);
                break;
            }
            case 'warn': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
                const target = options.getUser('kullanici');
                const reason = options.getString('sebep') || 'Sebep belirtilmedi';
                if (!db[guildId].warnings) db[guildId].warnings = {};
                db[guildId].warnings[target.id] = (db[guildId].warnings[target.id] || 0) + 1;
                saveDB();
                await interaction.reply(`${target.tag} uyarıldı. (Toplam uyarı: ${db[guildId].warnings[target.id]})`);
                sendModLog(guild, 'Warn', target, user, reason);
                break;
            }
            case 'purge':
            case 'clear': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ManageMessages)) return;
                const amount = options.getInteger('miktar');
                if (amount < 1 || amount > 100) return interaction.reply({ content: '1 ile 100 arasında bir sayı girin.', ephemeral: true });
                await interaction.channel.bulkDelete(amount, true);
                await interaction.reply({ content: `${amount} mesaj silindi.`, ephemeral: true });
                break;
            }


            case 'avatar': {
                const target = options.getUser('kullanici') || user;
                await interaction.reply(target.displayAvatarURL({ size: 1024, dynamic: true }));
                break;
            }
            case 'banner': {
                const target = options.getUser('kullanici') || user;
                const fetched = await client.users.fetch(target.id, { force: true });
                if (fetched.banner) {
                    await interaction.reply(fetched.bannerURL({ size: 1024, dynamic: true }));
                } else {
                    await interaction.reply('Bu kullanıcının afişi bulunmuyor.');
                }
                break;
            }
            case 'userinfo': {
                const target = options.getMember('kullanici') || member;
                const embed = new EmbedBuilder()
                    .setColor(target.displayHexColor || 'Random')
                    .setTitle(`${target.user.tag} Bilgileri`)
                    .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        { name: 'Sunucuya Katılma', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
                        { name: 'Hesap Oluşturma', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
                        { name: 'Roller', value: target.roles.cache.filter(r => r.id !== guild.id).map(r => r.toString()).join(', ') || 'Yok' }
                    );
                await interaction.reply({ embeds: [embed] });
                break;
            }
            case 'roleinfo': {
                const role = options.getRole('rol');
                const embed = new EmbedBuilder()
                    .setColor(role.color || 'Default')
                    .setTitle(`Rol Bilgisi: ${role.name}`)
                    .addFields(
                        { name: 'ID', value: role.id, inline: true },
                        { name: 'Renk', value: role.hexColor, inline: true },
                        { name: 'Kişi Sayısı', value: role.members.size.toString(), inline: true },
                        { name: 'Oluşturulma', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true },
                        { name: 'Bahsedilebilir', value: role.mentionable ? 'Evet' : 'Hayır', inline: true }
                    );
                await interaction.reply({ embeds: [embed] });
                break;
            }
            case 'serverinfo': {
                const embed = new EmbedBuilder()
                    .setColor('Gold')
                    .setTitle(guild.name)
                    .setThumbnail(guild.iconURL({ dynamic: true }))
                    .addFields(
                        { name: 'Sahip', value: `<@${guild.ownerId}>`, inline: true },
                        { name: 'Üyeler', value: guild.memberCount.toString(), inline: true },
                        { name: 'Kanal Sayısı', value: guild.channels.cache.size.toString(), inline: true },
                        { name: 'Rol Sayısı', value: guild.roles.cache.size.toString(), inline: true },
                        { name: 'Boost Seviyesi', value: guild.premiumTier.toString(), inline: true },
                        { name: 'Oluşturulma', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
                    );
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'addrole': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ManageRoles)) return;
                const target = options.getMember('kullanici');
                const role = options.getRole('rol');
                if (role.position >= member.roles.highest.position && member.id !== guild.ownerId) {
                    return interaction.reply({ content: 'Bu rolü verme yetkiniz yok.', ephemeral: true });
                }
                await target.roles.add(role);
                await interaction.reply(`${target.user.tag} kullanıcısına ${role.name} rolü verildi.`);
                break;
            }
            case 'removerole': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ManageRoles)) return;
                const target = options.getMember('kullanici');
                const role = options.getRole('rol');
                if (role.position >= member.roles.highest.position && member.id !== guild.ownerId) {
                    return interaction.reply({ content: 'Bu rolü alma yetkiniz yok.', ephemeral: true });
                }
                await target.roles.remove(role);
                await interaction.reply(`${target.user.tag} kullanıcısından ${role.name} rolü alındı.`);
                break;
            }
            case 'lockrole': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ManageRoles)) return;
                const role = options.getRole('rol');
                await role.setMentionable(!role.mentionable);
                await interaction.reply(`${role.name} rolünün bahsedilebilirliği ${role.mentionable ? 'açıldı' : 'kapatıldı'}.`);
                break;
            }
            case 'autorole': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                const role = options.getRole('rol');
                if (role) {
                    db[guildId].autorole = role.id;
                } else {
                    delete db[guildId].autorole;
                }
                saveDB();
                await interaction.reply(role ? `Otomatik rol ${role.name} olarak ayarlandı.` : 'Otomatik rol kapatıldı.');
                break;
            }


            case 'modlog':
            case 'leavelog':
            case 'joinlog':
            case 'editlog':
            case 'messagelog':
            case 'welcome':
            case 'goodbye': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                const channel = options.getChannel('kanal');
                if (!channel) return interaction.reply({ content: 'Kanal belirtilmedi.', ephemeral: true });
                db[guildId][commandName] = channel.id;
                saveDB();
                await interaction.reply(`${commandName} kanalı ${channel} olarak ayarlandı.`);
                break;
            }
            case 'setlog': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                const channel = options.getChannel('kanal');
                if (!channel) return interaction.reply({ content: 'Kanal belirtilmedi.', ephemeral: true });
                const logs = ['modlog', 'leavelog', 'joinlog', 'editlog', 'messagelog'];
                logs.forEach(l => db[guildId][l] = channel.id);
                saveDB();
                await interaction.reply(`Tüm log kanalları ${channel} olarak ayarlandı.`);
                break;
            }

            case 'antimention':
            case 'antiraid':
            case 'antibot':
            case 'antilink':
            case 'antispam':
            case 'antiinvite':
            case 'capslimit': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                const durum = options.getBoolean('durum');
                db[guildId][commandName] = durum;
                saveDB();
                await interaction.reply(`${commandName} sistemi ${durum ? 'aktif edildi' : 'kapatıldı'}.`);
                break;
            }


            case 'ticket_setup': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                const embed = new EmbedBuilder()
                    .setTitle('Destek Sistemi')
                    .setDescription('Destek talebi oluşturmak için aşağıdaki butona tıklayın.')
                    .setColor('Green');
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_olustur').setLabel('🎫 Ticket Oluştur').setStyle(ButtonStyle.Success)
                );
                await interaction.channel.send({ embeds: [embed], components: [row] });
                await interaction.reply({ content: 'Ticket sistemi kuruldu.', ephemeral: true });
                break;
            }
            case 'verification': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                const role = options.getRole('verilecek_rol');
                db[guildId].verificationRole = role.id;
                saveDB();
                const embed = new EmbedBuilder()
                    .setTitle('Kayıt Sistemi')
                    .setDescription('Sunucuya erişmek için aşağıdaki butona tıklayarak doğrulama işlemini tamamlayın.')
                    .setColor('Blue');
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('kayit_ol').setLabel('✅ Doğrula').setStyle(ButtonStyle.Primary)
                );
                await interaction.channel.send({ embeds: [embed], components: [row] });
                await interaction.reply({ content: 'Doğrulama sistemi kuruldu.', ephemeral: true });
                break;
            }
            case 'setprefix':
                await interaction.reply('Bu bot tamamen Slash (/) komutları kullanmaktadır. Prefix ayarlamanıza gerek yoktur.');
                break;


            case 'sunucukur': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                await interaction.reply({ content: 'Sunucu kanalları ve kategorileri oluşturuluyor...', ephemeral: false });
                
                const kategori = await guild.channels.create({ name: 'FoxBot Topluluk', type: ChannelType.GuildCategory });
                await guild.channels.create({ name: 'sohbet', type: ChannelType.GuildText, parent: kategori.id });
                await guild.channels.create({ name: 'hoş-geldin', type: ChannelType.GuildText, parent: kategori.id });
                await guild.channels.create({ name: 'kurallar', type: ChannelType.GuildText, parent: kategori.id });
                await guild.roles.create({ name: 'Üye', color: 'Blue', reason: 'FoxBot Sunucu Kurma' });

                await interaction.editReply('Sunucu başarıyla kuruldu ve kişiselleştirildi!');
                break;
            }
            case 'reset': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                delete db[guildId];
                saveDB();
                await interaction.reply('Kişiselleştirme ve tüm veritabanı ayarları başarıyla sıfırlandı.');
                break;
            }
            case 'motivasyon': {
                const motivationWords = [
                    "Başlamak için mükemmel olmayı beklemeyin.", 
                    "Zorluklar, başarının süsüdür.", 
                    "Dünyayı değiştirmek istiyorsan, önce kendini değiştir.", 
                    "Sadece vazgeçtiğinde kaybedersin.", 
                    "Geçmişin senin geleceğini belirlemez."
                ];
                const w = motivationWords[Math.floor(Math.random() * motivationWords.length)];
                await interaction.reply(`🌟 Motivasyon Sözü: **${w}**`);
                break;
            }
            case 'tkm': {
                const secim = options.getString('secim');
                const botChoices = ['tas', 'kagit', 'makas'];
                const botSecim = botChoices[Math.floor(Math.random() * botChoices.length)];
                
                let sonuc = '';
                if (secim === botSecim) sonuc = 'Berabere!';
                else if ((secim === 'tas' && botSecim === 'makas') || (secim === 'kagit' && botSecim === 'tas') || (secim === 'makas' && botSecim === 'kagit')) {
                    sonuc = 'Kazandın! 🥳';
                } else {
                    sonuc = 'Ben kazandım! 😎';
                }

                await interaction.reply(`Sen: **${secim}** 🤜 🤛 Ben: **${botSecim}**\nSonuç: **${sonuc}**`);
                break;
            }
            case 'mesaj': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ManageMessages)) return;
                const metin = options.getString('metin');
                await interaction.reply({ content: 'Mesaj gönderiliyor...', ephemeral: true });
                await interaction.channel.send(metin);
                break;
            }
            case 'selamla': {
                const kisi = options.getUser('kisi');
                await interaction.reply(`Merhaba ${kisi}! 👋 Biri sana selam gönderdi.`);
                break;
            }
        }
    } catch (error) {
        console.error(error);
        const reply = { content: 'Komut çalıştırılırken bir hata oluştu.', ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
        else await interaction.reply(reply);
    }
});


const userMessageCache = new Map(); 

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const guildId = message.guild.id;
    const conf = db[guildId] || {};


    if (message.embeds?.length) {
        const embed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle('Embed Mesaj')
            .setDescription(`**Yazan:** ${message.author}\n**Kanal:** ${message.channel}\n**Embed Sayısı:** ${message.embeds.length}`)
            .setTimestamp();
        sendLogEmbed(message.guild, ['messagelog'], embed);
    }


    const lowerMessage = message.content.toLowerCase();
    const hasKufur = kufurListesi.some(word => lowerMessage.includes(word));
    if (hasKufur) {
        if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await message.delete().catch(() => {});
            return message.channel.send(`Küfürlü bir kelime kullandın! Lütfen edepli ol <@${message.author.id}>.`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }


    if (lowerMessage.startsWith('fox bot')) {
        if (groq) {
            const userPrompt = message.content.substring(7).trim();
            if (!userPrompt) return message.reply("Efendim? Benimle konuşmak için 'fox bot merhaba' gibi bir şey yazabilirsin.");
            
            try {
                await message.channel.sendTyping();
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: 'system', content: 'Sen Fox Bot isimli Türkçe konuşan, esprili ve çok zeki bir yapay zeka Discord botusun.' },
                        { role: 'user', content: userPrompt }
                    ],
                    model: 'llama3-8b-8192',
                });
                const cevap = completion.choices[0]?.message?.content || 'Üzgünüm, şu an bağlantı kuramıyorum.';
                return message.reply(cevap);
            } catch (err) {
                console.error("Groq Hatası:", err);
                return message.reply("Sanırım devrelerim biraz karıştı, daha sonra tekrar dener misin?");
            }
        } else {
            return message.reply("Groq API anahtarım bağlı değil, sana cevap veremiyorum.");
        }
    }

    if (message.member && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;


    if (conf.antilink) {
        const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|net|org|xyz|io|gg|me|tr|ru|net|gov|edu)\b([a-zA-Z0-9()@:%_\+.~#?&//=]*))/i;
        if (linkRegex.test(message.content)) {
            await message.delete().catch(() => {});
            return message.channel.send(`${message.author}, bu sunucuda link paylaşımı yasaktır!`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }

    if (conf.antiinvite) {
        const inviteRegex = /(discord\.(gg|io|me|li)\/|discordapp\.com\/invite\/)/i;
        if (inviteRegex.test(message.content)) {
            await message.delete().catch(() => {});
            return message.channel.send(`${message.author}, bu sunucuda davet linki paylaşımı yasaktır!`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }


    if (conf.capslimit && message.content.length > 5) {
        const caps = message.content.replace(/[^A-Z]/g, '').length;
        if (caps / message.content.length > 0.7) { // %70'den fazlası büyük harfse
            await message.delete().catch(() => {});
            return message.channel.send(`${message.author}, lütfen çok fazla büyük harf kullanmayın!`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }


    if (conf.antimention && message.mentions.users.size > 5) {
        await message.delete().catch(() => {});
        return message.channel.send(`${message.author}, bir mesajda en fazla 5 kişi etiketleyebilirsiniz!`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }

    if (conf.antispam) {
        const userId = message.author.id;
        const now = Date.now();
        if (!userMessageCache.has(userId)) {
            userMessageCache.set(userId, { count: 1, timer: now });
        } else {
            let data = userMessageCache.get(userId);
            if (now - data.timer < 5000) {
                data.count++;
                if (data.count === 5) {
                    await message.channel.messages.fetch({ limit: 10 }).then(msgs => {
                        const userMsgs = msgs.filter(m => m.author.id === userId);
                        message.channel.bulkDelete(userMsgs).catch(() => {});
                    }).catch(() => {});
                    if (message.member) await message.member.timeout(5 * 60 * 1000, 'Spam Koruması').catch(() => {});
                    message.channel.send(`${message.author} spam yaptığı için 5 dakika susturuldu.`);
                }
            } else {
                data.count = 1;
                data.timer = now;
            }
            userMessageCache.set(userId, data);
        }
    }
});


client.on('messageCreate', async message => {
    if (!message.guild) return;
    if (!message.author?.bot) return;
    const conf = db[message.guild.id] || {};
    if (!conf.messagelog && !conf.modlog) return;
    const embed = new EmbedBuilder()
        .setColor('Grey')
        .setTitle('Bot Mesajı')
        .setDescription(`**Bot:** ${message.author}\n**Kanal:** ${message.channel}\n**İçerik:** ${safeText(message.content || '—')}`)
        .setTimestamp();
    sendLogEmbed(message.guild, ['messagelog'], embed);
});


client.on('guildMemberAdd', async member => {
    const guildId = member.guild.id;
    const conf = db[guildId] || {};


    if (conf.antibot && member.user.bot) {
        await member.kick('Anti-Bot sistemi aktif.');
        return;
    }


    if (conf.autorole && !member.user.bot) {
        await member.roles.add(conf.autorole).catch(() => {});
    }


    if (conf.welcome) {
        const channel = member.guild.channels.cache.get(conf.welcome);
        if (channel) channel.send(`merhaba <@${member.user.id}>!`);
    }


    if (conf.joinlog) {
        const channel = member.guild.channels.cache.get(conf.joinlog);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor('Green')
                .setDescription(`${member} sunucuya katıldı.`)
                .addFields({ name: 'Hesap Kurulum', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` })
                .setTimestamp();
            channel.send({ embeds: [embed] });
        }
    }


    if (conf.antiraid) {
        const now = Date.now();
        const joins = client.guildMemberAdds?.filter(j => j.guildId === guildId && now - j.timestamp < 10000) || [];
        if (joins.length >= 5) {

            await member.guild.setVerificationLevel(3).catch(() => {});
            const logChan = member.guild.channels.cache.get(conf.modlog || conf.joinlog);
            if (logChan) logChan.send('🚨 Anti-Raid tetiklendi! Sunucu yüksek güvenliğe alındı.');
        }

        if (!client.guildMemberAdds) client.guildMemberAdds = [];
        client.guildMemberAdds.push({ guildId, timestamp: now });
        setTimeout(() => { client.guildMemberAdds.shift(); }, 10000);
    }
});


client.on('guildMemberRemove', async member => {
    const guildId = member.guild.id;
    const conf = db[guildId] || {};


    const kickEntry = await fetchRecentAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
    if (kickEntry) {
        const embed = new EmbedBuilder()
            .setColor('DarkOrange')
            .setTitle('Kick')
            .setDescription(`${member.user.tag} sunucudan atıldı (kick).`)
            .addFields(
                { name: 'Yetkili', value: safeText(kickEntry.executor ? `${kickEntry.executor} (${kickEntry.executor.id})` : 'Bilinmiyor'), inline: true },
                { name: 'Sebep', value: safeText(kickEntry.reason || 'Belirtilmemiş') }
            )
            .setTimestamp();
        await sendLogEmbed(member.guild, ['modlog', 'leavelog'], embed);

        return;
    }


    if (conf.goodbye) {
        const channel = member.guild.channels.cache.get(conf.goodbye);
        if (channel) channel.send(`güle güle <@${member.user.id}>, seni iyi biri bilirdik diye...`);
    }

    
    if (conf.leavelog) {
        const channel = member.guild.channels.cache.get(conf.leavelog);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor('Red')
                .setDescription(`${member.user.tag} sunucudan ayrıldı.`)
                .setTimestamp();
            channel.send({ embeds: [embed] });
        }
    }
});


client.on('messageDelete', async message => {
    if (message.author?.bot || !message.guild) return;
    const conf = db[message.guild.id] || {};
    if (conf.messagelog) {
        const channel = message.guild.channels.cache.get(conf.messagelog);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor('Orange')
                .setTitle('Mesaj Silindi')
                .setDescription(`**Yazan:** ${message.author}\n**Kanal:** ${message.channel}\n**İçerik:** ${message.content || 'İçerik yok/Medya'}`)
                .setTimestamp();
            channel.send({ embeds: [embed] });
        }
    }
});

// Mesaj düzenleme logu
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (oldMessage.author?.bot || !oldMessage.guild || oldMessage.content === newMessage.content) return;
    const conf = db[oldMessage.guild.id] || {};
    if (conf.editlog) {
        const channel = oldMessage.guild.channels.cache.get(conf.editlog);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor('Yellow')
                .setTitle('Mesaj Düzenlendi')
                .setDescription(`**Yazan:** ${oldMessage.author}\n**Kanal:** ${oldMessage.channel}\n**Eski:** ${oldMessage.content || 'İçerik yok/Medya'}\n**Yeni:** ${newMessage.content || 'İçerik yok/Medya'}`)
                .setTimestamp();
            channel.send({ embeds: [embed] });
        }
    }
});


client.on('guildBanAdd', async ban => {
    const entry = await fetchRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('Ban')
        .setDescription(`${ban.user.tag} sunucudan yasaklandı.`)
        .addFields(
            { name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor'), inline: true },
            { name: 'Sebep', value: safeText(entry?.reason || 'Belirtilmemiş') }
        )
        .setTimestamp();
    sendLogEmbed(ban.guild, ['modlog'], embed);
});

client.on('guildBanRemove', async ban => {
    const entry = await fetchRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    const embed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('Unban')
        .setDescription(`${ban.user.tag} sunucudan yasağı kaldırıldı.`)
        .addFields(
            { name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor'), inline: true },
            { name: 'Sebep', value: safeText(entry?.reason || 'Belirtilmemiş') }
        )
        .setTimestamp();
    sendLogEmbed(ban.guild, ['modlog'], embed);
});

// Rol oluşturma, Rol silme, Kanal silme Logları
client.on('roleCreate', async role => {
    const conf = db[role.guild.id] || {};
    if (conf.modlog || conf.messagelog) {
        const logKanal = role.guild.channels.cache.get(conf.modlog || conf.messagelog);
        if (logKanal) {
            logKanal.send({ embeds: [new EmbedBuilder().setColor('Green').setTitle('Rol Oluşturuldu').setDescription(`Yeni Rol: ${role.name}`).setTimestamp()] });
        }
    }
});

client.on('roleDelete', async role => {
    const conf = db[role.guild.id] || {};
    if (conf.modlog || conf.messagelog) {
        const logKanal = role.guild.channels.cache.get(conf.modlog || conf.messagelog);
        if (logKanal) {
            logKanal.send({ embeds: [new EmbedBuilder().setColor('Red').setTitle('Rol Silindi').setDescription(`Silinen Rol: ${role.name}`).setTimestamp()] });
        }
    }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    const changed = [];
    if (oldRole.name !== newRole.name) changed.push(`İsim: **${oldRole.name}** → **${newRole.name}**`);
    if (oldRole.color !== newRole.color) changed.push(`Renk: **${oldRole.hexColor}** → **${newRole.hexColor}**`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changed.push('İzinler değişti');
    if (!changed.length) return;
    const entry = await fetchRecentAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const embed = new EmbedBuilder()
        .setColor('Yellow')
        .setTitle('Rol Düzenlendi')
        .setDescription(`${newRole} rolü güncellendi.\n${changed.map(x => `- ${x}`).join('\n')}`)
        .addFields({ name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor') })
        .setTimestamp();
    sendLogEmbed(newRole.guild, ['modlog'], embed);
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const conf = db[channel.guild.id] || {};
    if (conf.modlog || conf.messagelog) {
        const logKanal = channel.guild.channels.cache.get(conf.modlog || conf.messagelog);
        if (logKanal) {
            logKanal.send({ embeds: [new EmbedBuilder().setColor('Red').setTitle('Kanal Silindi').setDescription(`Silinen Kanal: #${channel.name}`).setTimestamp()] });
        }
    }
});

client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const entry = await fetchRecentAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    const embed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('Kanal Oluşturuldu')
        .setDescription(`Yeni Kanal: ${channel} (${channel.name})`)
        .addFields({ name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor') })
        .setTimestamp();
    sendLogEmbed(channel.guild, ['modlog'], embed);
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const changes = [];
    if (oldChannel.name !== newChannel.name) changes.push(`İsim: **${oldChannel.name}** → **${newChannel.name}**`);
    if (oldChannel.parentId !== newChannel.parentId) changes.push('Kategori değişti');
    if (oldChannel.rawPosition !== newChannel.rawPosition) changes.push('Sıralama değişti');
    // İzin (overwrite) değişimleri detaylı hesaplanabilir ama pahalı; burada audit log'a güveniyoruz.
    if (oldChannel.permissionOverwrites?.cache?.size !== newChannel.permissionOverwrites?.cache?.size) changes.push('İzinler (overwrite) değişti');
    if (!changes.length) return;
    const entry = await fetchRecentAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    const embed = new EmbedBuilder()
        .setColor('Yellow')
        .setTitle('Kanal Güncellendi')
        .setDescription(`${newChannel}\n${changes.map(x => `- ${x}`).join('\n')}`)
        .addFields({ name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor') })
        .setTimestamp();
    sendLogEmbed(newChannel.guild, ['modlog'], embed);
});


client.on('guildUpdate', async (oldGuild, newGuild) => {
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push(`İsim: **${oldGuild.name}** → **${newGuild.name}**`);
    if (oldGuild.icon !== newGuild.icon) changes.push('Sunucu ikonu değişti');
    if (oldGuild.banner !== newGuild.banner) changes.push('Sunucu banner değişti');
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) changes.push('Doğrulama seviyesi değişti');
    if (!changes.length) return;
    const entry = await fetchRecentAuditEntry(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
    const embed = new EmbedBuilder()
        .setColor('Yellow')
        .setTitle('Sunucu Ayarları Güncellendi')
        .setDescription(changes.map(x => `- ${x}`).join('\n'))
        .addFields({ name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor') })
        .setTimestamp();
    sendLogEmbed(newGuild, ['modlog'], embed);
});


client.on('emojiCreate', async emoji => {
    const entry = await fetchRecentAuditEntry(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
    const embed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('Emoji Eklendi')
        .setDescription(`${emoji} **:${emoji.name}:**`)
        .addFields({ name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor') })
        .setTimestamp();
    sendLogEmbed(emoji.guild, ['modlog'], embed);
});

client.on('emojiDelete', async emoji => {
    const entry = await fetchRecentAuditEntry(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
    const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('Emoji Silindi')
        .setDescription(`**:${emoji.name}:**`)
        .addFields({ name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor') })
        .setTimestamp();
    sendLogEmbed(emoji.guild, ['modlog'], embed);
});


client.on('guildStickerCreate', async sticker => {
    const entry = await fetchRecentAuditEntry(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
    const embed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('Sticker Eklendi')
        .setDescription(`**${sticker.name}**`)
        .addFields({ name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor') })
        .setTimestamp();
    sendLogEmbed(sticker.guild, ['modlog'], embed);
});


client.on('webhookUpdate', async channel => {
    if (!channel?.guild) return;
    const created = await fetchRecentAuditEntry(channel.guild, AuditLogEvent.WebhookCreate, null);
    const deleted = await fetchRecentAuditEntry(channel.guild, AuditLogEvent.WebhookDelete, null);
    const entry = created || deleted;
    if (!entry) return;
    const isCreate = entry.action === AuditLogEvent.WebhookCreate;
    const embed = new EmbedBuilder()
        .setColor(isCreate ? 'Green' : 'Red')
        .setTitle(isCreate ? 'Webhook Oluşturuldu' : 'Webhook Silindi')
        .setDescription(`**Kanal:** ${channel}`)
        .addFields(
            { name: 'Yetkili', value: safeText(entry.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor'), inline: true },
            { name: 'Sebep', value: safeText(entry.reason || 'Belirtilmemiş') }
        )
        .setTimestamp();
    sendLogEmbed(channel.guild, ['modlog'], embed);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {

    if (oldMember.nickname !== newMember.nickname) {
        const entry = await fetchRecentAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
        const embed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle('Nickname Değişti')
            .setDescription(`${newMember.user}\n**Eski:** ${safeText(oldMember.nickname || oldMember.user.username)}\n**Yeni:** ${safeText(newMember.nickname || newMember.user.username)}`)
            .addFields({ name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor') })
            .setTimestamp();
        sendLogEmbed(newMember.guild, ['modlog'], embed);
    }


    const oldT = oldMember.communicationDisabledUntilTimestamp || 0;
    const newT = newMember.communicationDisabledUntilTimestamp || 0;
    if (oldT !== newT) {
        const entry = await fetchRecentAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
        const isTimedOut = newT && newT > Date.now();
        const embed = new EmbedBuilder()
            .setColor(isTimedOut ? 'Red' : 'Green')
            .setTitle(isTimedOut ? 'Timeout Uygulandı' : 'Timeout Kaldırıldı')
            .setDescription(`${newMember.user}`)
            .addFields(
                { name: 'Bitiş', value: isTimedOut ? `<t:${Math.floor(newT / 1000)}:R>` : '—', inline: true },
                { name: 'Yetkili', value: safeText(entry?.executor ? `${entry.executor} (${entry.executor.id})` : 'Bilinmiyor'), inline: true },
                { name: 'Sebep', value: safeText(entry?.reason || 'Belirtilmemiş') }
            )
            .setTimestamp();
        sendLogEmbed(newMember.guild, ['modlog'], embed);
    }

    if (oldMember.roles.cache.size < newMember.roles.cache.size) {
        const addedRole = newMember.roles.cache.find(r => !oldMember.roles.cache.has(r.id));
        const conf = db[newMember.guild.id] || {};
        if (addedRole && (conf.modlog || conf.messagelog)) {
            const logKanal = newMember.guild.channels.cache.get(conf.modlog || conf.messagelog);
            if (logKanal) {
                logKanal.send({ embeds: [new EmbedBuilder().setColor('Blue').setTitle('Rol Verildi').setDescription(`${newMember.user} kullanıcısına ${addedRole} rolü verildi.`).setTimestamp()] });
            }
        }
    } else if (oldMember.roles.cache.size > newMember.roles.cache.size) {
        const removedRole = oldMember.roles.cache.find(r => !newMember.roles.cache.has(r.id));
        const conf = db[newMember.guild.id] || {};
        if (removedRole && (conf.modlog || conf.messagelog)) {
            const logKanal = newMember.guild.channels.cache.get(conf.modlog || conf.messagelog);
            if (logKanal) {
                logKanal.send({ embeds: [new EmbedBuilder().setColor('Yellow').setTitle('Rol Alındı').setDescription(`${newMember.user} kullanıcısından ${removedRole} rolü alındı.`).setTimestamp()] });
            }
        }
    }
});

client.on('userUpdate', async (oldUser, newUser) => {
    if (oldUser.avatar === newUser.avatar) return;
    for (const guild of client.guilds.cache.values()) {
        const conf = db[guild.id] || {};
        if (!conf.modlog && !conf.messagelog) continue;
        const member = await guild.members.fetch(newUser.id).catch(() => null);
        if (!member) continue;
        const embed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle('Avatar Değişti')
            .setDescription(`${newUser} (${newUser.tag})`)
            .setThumbnail(newUser.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: 'Eski', value: safeText(oldUser.displayAvatarURL({ dynamic: true, size: 256 })), inline: false },
                { name: 'Yeni', value: safeText(newUser.displayAvatarURL({ dynamic: true, size: 256 })), inline: false }
            )
            .setTimestamp();
        sendLogEmbed(guild, ['modlog'], embed);
    }
});


client.on('voiceStateUpdate', async (oldState, newState) => {
    const guild = newState.guild;
    const member = newState.member || oldState.member;
    if (!guild || !member) return;
    const conf = db[guild.id] || {};
    if (!conf.modlog && !conf.messagelog) return;

    const oldCh = oldState.channel;
    const newCh = newState.channel;

    if (!oldCh && newCh) {
        const embed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('Ses Kanalına Girdi')
            .setDescription(`${member.user} → ${newCh}`)
            .setTimestamp();
        return sendLogEmbed(guild, ['modlog'], embed);
    }
    if (oldCh && !newCh) {
        const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('Ses Kanalından Çıktı')
            .setDescription(`${member.user} ← ${oldCh}`)
            .setTimestamp();
        return sendLogEmbed(guild, ['modlog'], embed);
    }
    if (oldCh && newCh && oldCh.id !== newCh.id) {
        const embed = new EmbedBuilder()
            .setColor('Yellow')
            .setTitle('Ses Kanalı Değişti')
            .setDescription(`${member.user}\n**Eski:** ${oldCh}\n**Yeni:** ${newCh}`)
            .setTimestamp();
        return sendLogEmbed(guild, ['modlog'], embed);
    }

    if (oldState.selfMute !== newState.selfMute) {
        const embed = new EmbedBuilder()
            .setColor(newState.selfMute ? 'Red' : 'Green')
            .setTitle(newState.selfMute ? 'Self Mute Oldu' : 'Self Mute Kaldırdı')
            .setDescription(`${member.user}`)
            .setTimestamp();
        return sendLogEmbed(guild, ['modlog'], embed);
    }

    if (oldState.selfDeaf !== newState.selfDeaf) {
        const embed = new EmbedBuilder()
            .setColor(newState.selfDeaf ? 'Red' : 'Green')
            .setTitle(newState.selfDeaf ? 'Self Deafen Oldu' : 'Self Deafen Kaldırdı')
            .setDescription(`${member.user}`)
            .setTimestamp();
        return sendLogEmbed(guild, ['modlog'], embed);
    }
});


client.login(process.env.TOKEN);
