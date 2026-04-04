require('dotenv').config();
const {
    Client, GatewayIntentBits, Partials, Collection, REST, Routes,
    SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const ElevenLabs = require('elevenlabs-node');
const { createReadStream } = require('fs');

const ytdl = require('ytdl-core');

const voice = new ElevenLabs({
    apiKey: process.env.ELEVEN_API_KEY, 
    voiceId: "pNInz6obpg8ndclK7Abv",
});

let groq;
try {
    const Groq = require('groq-sdk');
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.warn("⚠️  GROQ_API_KEY .env dosyasında ayarlanmamış. AI features devre dışı.");
        groq = null;
    } else {
        groq = new Groq({ apiKey });
        console.log("[✓] Groq SDK başarıyla başlatıldı.");
    }
} catch (e) {
    console.error("❌ Groq SDK yüklü değil veya başlatılamadı:", e?.message);
    groq = null;
}

const kufurListesi = ["amk", "aq", "sg", "oç", "orospu", "pic", "piç", "sikerim", "yavşak", "yavsak", "gavat", "ibne", "pezevenk", "yarram", "31", "pornhub"];

const dbPath = './db.json';
let db = {};
if (fs.existsSync(dbPath)) {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}
// Bot Admin Listesi başlat
if (!db.botAdmins) {
    db.botAdmins = [];
}
const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 4));

// Basit müzik yönetimi: guild bazlı player/connection saklama
const musicPlayers = new Map();

async function playUrlInGuild(guild, url, requesterId, voiceChannel, textChannel) {
    if (!db[guild.id]) db[guild.id] = {};
    if (!db[guild.id].musicQueue) db[guild.id].musicQueue = [];

    // Eğer zaten çalan bir player varsa sıraya ekle
    const existing = musicPlayers.get(guild.id);
    if (existing && existing.player.state.status !== AudioPlayerStatus.Idle) {
        db[guild.id].musicQueue.push({ url, requesterId });
        saveDB();
        if (textChannel) textChannel.send(`<@${requesterId}> şarkı sıraya eklendi. Sırada ${db[guild.id].musicQueue.length} şarkı var.`).catch(() => {});
        return;
    }

    try {
        try {
            // URL validasyonu
            if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
                if (textChannel) textChannel.send('❌ Geçersiz YouTube URL si.').catch(() => {});
                return;
            }
        } catch (e) {
            if (textChannel) textChannel.send('❌ Şarkı linki doğrulanamadı.').catch(() => {});
            return;
        }

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        const player = createAudioPlayer();
        const ytdlOptions = {

            filter: 'audioonly',
            quality: 'lowestaudio',
            highWaterMark: 1 << 25,
            dlChunkSize: 0
        };

        let stream;
        try {
            stream = ytdl(url, ytdlOptions);
        } catch (streamErr) {
            console.error('ytdl stream hatasə:', streamErr?.message);
            if (textChannel) textChannel.send(`❌ Şarkı indirilemedi: ${streamErr?.message?.substring(0, 100) || 'Bilinmiş hata'}`).catch(() => {});
            try { connection.destroy(); } catch (e) {}
            musicPlayers.delete(guild.id);
            return;
        }

        // Stream error listener
        stream.on('error', (err) => {
            console.error('Stream error:', err?.message);
            if (textChannel) textChannel.send(`⚠️ Müzik akışı hatası: ${err?.message?.substring(0, 80)}`).catch(() => {});
            try { connection.destroy(); } catch (e) {}
            musicPlayers.delete(guild.id);
        });

        const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

        player.play(resource);
        connection.subscribe(player);

        musicPlayers.set(guild.id, { connection, player });

        if (textChannel) textChannel.send(`🎶 Şimdi çalınıyor: ${url} (istek: <@${requesterId}>)`).catch(() => {});

        player.on(AudioPlayerStatus.Idle, async () => {
            // Sıradaki varsa devam et
            const q = db[guild.id].musicQueue || [];
            if (q.length > 0) {
                const next = q.shift();
                saveDB();
                try {
                    const nextYtdlOptions = { filter: 'audioonly', quality: 'lowestaudio', highWaterMark: 1 << 25, dlChunkSize: 0 };
                    const nextStream = ytdl(next.url, nextYtdlOptions);
                    nextStream.on('error', (err) => {
                        console.error('Next stream error:', err?.message);
                        if (textChannel) textChannel.send(`⚠️ Sıradaki şarkıda hata: ${err?.message?.substring(0, 80)}`).catch(() => {});
                    });
                    const nextRes = createAudioResource(nextStream, { inputType: StreamType.Arbitrary });
                    player.play(nextRes);
                    if (textChannel) textChannel.send(`🎵 Sıradan oynatılıyor: ${next.url} (istek: <@${next.requesterId}>)`).catch(() => {});
                } catch (e) {
                    console.error('Sıradaki şarkı oynatılamadı:', e?.message);
                    if (textChannel) textChannel.send(`❌ Sıradaki şarkı çalınamadı: ${e?.message?.substring(0, 80)}`).catch(() => {});
                    setTimeout(() => {
                        try { connection.destroy(); } catch (e) {}
                        musicPlayers.delete(guild.id);
                    }, 1000);
                }
            } else {
                setTimeout(() => {
                    try { connection.destroy(); } catch (e) {}
                    musicPlayers.delete(guild.id);
                }, 1000);
            }
        });

        player.on('error', error => {
            console.error('Audio Player Hatası:', error);
            try { connection.destroy(); } catch (e) {}
            musicPlayers.delete(guild.id);
        });

    } catch (err) {
        console.error('playUrlInGuild hata:', err);
        if (textChannel) textChannel.send('Şarkı oynatılırken hata oluştu.').catch(() => {});
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const commands = [
    new SlashCommandBuilder().setName('yardim').setDescription('Botun komutlarını listeler.'),
    new SlashCommandBuilder().setName('ping').setDescription('Botun gecikme süresini gösterir.'),
    new SlashCommandBuilder().setName('stats').setDescription('Bot istatistiklerini gösterir.'),
    new SlashCommandBuilder().setName('uptime').setDescription('Botun ne kadar süredir aktif olduğunu gösterir.'),
    new SlashCommandBuilder().setName('shardinfo').setDescription('Shard bilgilerini gösterir.'),

    new SlashCommandBuilder().setName('setadmin').setDescription('Bir kullanıcıyı bot yöneticisi yapar (Sadece bot sahibi).')
        .addUserOption(o => o.setName('kullanici').setDescription('Yönetici yapılacak kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('removeadmin').setDescription('Bir kullanıcının bot yöneticisini kaldırır (Sadece bot sahibi).')
        .addUserOption(o => o.setName('kullanici').setDescription('Yönetici kaldırılacak kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('admins').setDescription('Bot yöneticilerinin listesini gösterir.'),
    new SlashCommandBuilder().setName('adminpanel').setDescription('Yönetim paneline erişir (Sadece admin).'),

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

    new SlashCommandBuilder().setName('blockword').setDescription('Engelli kelime ekler/kaldırır (Admin).')
        .addStringOption(o => o.setName('islem').setDescription('Ekle veya Sil').setRequired(true)
            .addChoices({name: 'Ekle', value: 'ekle'}, {name: 'Sil', value: 'sil'}, {name: 'Listele', value: 'listele'})
        )
        .addStringOption(o => o.setName('kelime').setDescription('Kelime (Listele için opsiyonel)')),
    new SlashCommandBuilder().setName('setyavaslas').setDescription('Sunucu hakkında otomatik mesaj ayarlar (Admin).')
        .addStringOption(o => o.setName('kanal').setDescription('Kanal ID (Kaldırmak için "sil")').setRequired(true)),

    new SlashCommandBuilder().setName('ticket_setup').setDescription('Ticket sistemini kurar.'),
    new SlashCommandBuilder().setName('verification').setDescription('Doğrulama (Kayıt) sistemini kurar.')
        .addRoleOption(o => o.setName('verilecek_rol').setDescription('Doğrulanınca verilecek rol').setRequired(true)),
    new SlashCommandBuilder().setName('welcome').setDescription('Hoş geldin mesajı kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('goodbye').setDescription('Görüşürüz mesajı kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('setprefix').setDescription('Sunucu mesaj prefixini ayarlar.').addStringOption(o => o.setName('prefix').setDescription('Yeni prefix').setRequired(true)),
    
    new SlashCommandBuilder().setName('sunucukur').setDescription('Sunucuyu profesyonel bir şekilde otomatik kurar.')
        .addStringOption(o => o.setName('tema').setDescription('Kurulacak tema').setRequired(true)
            .addChoices({name: 'Genel Topluluk', value: 'genel'}, {name: 'Oyun Sunucusu', value: 'oyun'})),
    new SlashCommandBuilder().setName('reset').setDescription('Sunucu yapılandırmasını sıfırlar (Kişiselleştirmeyi bitirir).'),
    new SlashCommandBuilder().setName('motivasyon').setDescription('Rastgele bir motivasyon sözü gönderir.'),
    new SlashCommandBuilder().setName('tkm').setDescription('Taş, Kağıt, Makas oynatır.')
        .addStringOption(o => o.setName('secim').setDescription('Seçiminiz').setRequired(true).addChoices({name: 'Taş', value: 'tas'}, {name: 'Kağıt', value: 'kagit'}, {name: 'Makas', value: 'makas'})),
    new SlashCommandBuilder().setName('mesaj').setDescription('Bota istediğiniz mesajı yazdırırsınız.')
        .addStringOption(o => o.setName('metin').setDescription('Botun yazacağı mesaj').setRequired(true)),
    new SlashCommandBuilder().setName('selamla').setDescription('Bot belirtilen kullanıcıyı selamlar.')
        .addUserOption(o => o.setName('kisi').setDescription('Selamlanacak kişi').setRequired(true)),
    new SlashCommandBuilder().setName('seslendir').setDescription('Yazdığınız metni sesli kanalda okur.')
        .addStringOption(o => o.setName('metin').setDescription('Okunacak metin').setRequired(true)),
];

const checkPerm = (interaction, perm) => {
    if (!interaction.member.permissions.has(perm)) {
        interaction.reply({ content: 'Bu komutu kullanmak için yeterli yetkiniz yok.', ephemeral: true });
        return false;
    }
    return true;
};

// Bot Admin Kontrolü
const checkBotAdmin = (interaction) => {
    const botAdmins = db.botAdmins || [];
    if (!botAdmins.includes(interaction.user.id) && interaction.user.id !== process.env.BOT_OWNER) {
        interaction.reply({ content: '❌ Bu komutu kullanmak için bot yöneticisi olmalısın.', ephemeral: true });
        return false;
    }
    return true;
};

const sendModLog = async (guild, action, target, moderator, reason) => {
    const conf = db[guild.id] || {};
    if (!conf.modlog) return;

    const channel = guild.channels.cache.get(conf.modlog);
    if (!channel) return;

    // 🔒 Sebep uzunsa kes (embed limit 1024)
    let safeReason = reason || 'Belirtilmemiş';
    if (safeReason.length > 1000) {
        safeReason = safeReason.slice(0, 1000) + '... (kısaltıldı)';
    }

    const embed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('Moderasyon İşlemi')
        .addFields(
            { name: 'İşlem', value: action, inline: true },
            { name: 'Hedef', value: `${target} (${target.id})`, inline: true },
            { name: 'Yetkili', value: `${moderator} (${moderator.id})`, inline: true },
            { name: 'Sebep', value: safeReason }
        )
        .setTimestamp();

    await channel.send({ embeds: [embed] });

    // 🔥 Eğer kesildiyse TAM halini ayrı mesaj olarak at
    if (reason && reason.length > 1000) {
        const chunks = [];
        for (let i = 0; i < reason.length; i += 4000) { 
            chunks.push(reason.slice(i, i + 4000));
        }

        for (const part of chunks) {
            await channel.send(`📄 **Tam Sebep:**\n${part}`);
        }
    }
};

client.once('ready', async () => {
    console.log(`${client.user.tag} olarak giriş yapıldı!`);

    const statuslar = [
        'Spamcıları avlıyorum',
        'Sunucuyu izliyorum',
        '/yardım yazmayı unutma',
        'Logları kontrol ediyorum',
        'Moderasyon aktif',
        '89 Sunucuda'
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
                    .setColor('#7289DA')
                    .setTitle('🤖 Fox Bot - Komut Rehberi')
                    .setDescription('Tüm özellikleri ve bunları nasıl kullanacağını öğren.\n\n' +
                        '**Slash Komutları:** `/komut` şeklinde kullanılır\n' +
                        '**Mesaj Komutları:** Mesajda belirtilen kelimeler\n' +
                        '**Prefix:** Özel prefixler kullanılabilir')
                    .addFields(
                        { 
                            name: '🎙️ SES & MÜZİK & AI', 
                            value: '📖 **AI Sohbet:** `fox bot <soru>` - Yapay zekayla sohbet et\n' +
                                '🎙️ **Seslendir:** `/seslendir <metin>` - Metni sesle sitesi kanalında oku (AI sesi ile)\n' +
                                '📍 **Sese Gel:** `sese gel` - Bota bulunduğun ses kanalına bağlan\n' +
                                '🎵 **Müzik:** YouTube linki yaz - Otomatik olarak şarkı çal\n' +
                                '📌 **Not:** Seslendir özelliği için bot ses kanalında olmalı',
                            inline: false 
                        },
                        { 
                            name: '🛠️ MODERASYON & YÖNETIM', 
                            value: '**Mute:** `/mute <kullanıcı> <dakika> [sebep]` - Kullanıcıyı sus\n' +
                                '**Unmute:** `/unmute <kullanıcı>` - Susturmayı kaldır\n' +
                                '**Kick:** `/kick <kullanıcı> [sebep]` - Sunucudan at\n' +
                                '**Ban:** `/ban <kullanıcı> [sebep]` - Sunucudan yasakla\n' +
                                '**Purge/Clear:** `/purge <sayı>` - Mesaj sil (1-100)\n' +
                                '📌 **Gerekli İzin:** Moderasyon İzni', 
                            inline: false 
                        },
                        { 
                            name: '🎭 ROL YÖNETIMI', 
                            value: '**Rol Ver:** `/addrole <kullanıcı> <rol>` - Kullanıcıya rol ekle\n' +
                                '**Rol Al:** `/removerole <kullanıcı> <rol>` - Kullanıcıdan rol çıkar\n' +
                                '**Rol Kilidi:** `/lockrole <rol>` - Rolü bahsedilebilir/bahsedilemez yap\n' +
                                '**Oto-Rol:** `/autorole [rol]` - Sunucuya katılanlara otomatik rol\n' +
                                '📌 **Gerekli İzin:** Rol Yönetimi',
                            inline: false 
                        },
                        { 
                            name: 'ℹ️ BİLGİ & İSTATİSTİK', 
                            value: '**Avatar:** `/avatar [kullanıcı]` - Profil fotoğrafını göster\n' +
                                '**Banner:** `/banner [kullanıcı]` - Kişinin afişini göster\n' +
                                '**Kullanıcı Info:** `/userinfo [kullanıcı]` - Öğrenci bilgileri\n' +
                                '**Rol Info:** `/roleinfo <rol>` - Rol detayları\n' +
                                '**Sunucu Info:** `/serverinfo` - Sunucu istatistikleri\n' +
                                '**Ping:** `/ping` - Bot gecikmesini göster\n' +
                                '**Stats:** `/stats` - Bot istatistikleri\n' +
                                '**Uptime:** `/uptime` - Kaç süredir aktif',
                            inline: false 
                        },
                        { 
                            name: '📋 LOG & İZLEME SİSTEMİ', 
                            value: '**Modlog:** `/modlog <kanal>` - Moderasyon logları\n' +
                                '**Joinlog:** `/joinlog <kanal>` - Sunucuya girmeler\n' +
                                '**Leavelog:** `/leavelog <kanal>` - Çıkışlar\n' +
                                '**Messagelog:** `/messagelog <kanal>` - Silinen mesajlar\n' +
                                '**Editlog:** `/editlog <kanal>` - Düzenlenen mesajlar\n' +
                                '**Tümünü Ayarla:** `/setlog <kanal>` - Tüm logları bir kanala\n' +
                                '📌 **Gerekli İzin:** Admin',
                            inline: false 
                        },
                        { 
                            name: '🛡️ GÜVENLİK SİSTEMLERİ', 
                            value: '**Antimention:** `/antimention <durum>` - Toplu etiketleme engelle\n' +
                                '**Antiraid:** `/antiraid <durum>` - Ani giriş salını engelle\n' +
                                '**Antibot:** `/antibot <durum>` - Bot eklenmesini engelle\n' +
                                '**Antilink:** `/antilink <durum>` - Link paylaşımını engelle\n' +
                                '**Antispam:** `/antispam <durum>` - Spam mesajlara karşı\n' +
                                '**Antiinvite:** `/antiinvite <durum>` - Discord davet engelle\n' +
                                '**Capslimit:** `/capslimit <durum>` - Büyük harf sınırla\n' +
                                '**Engelli Kelimeler:** `/blockword <ekle/sil/listele> [kelime]` - Küfür ve yasak kelimeler',
                            inline: false 
                        },
                        { 
                            name: '⚙️ SİSTEM & KURULUM', 
                            value: '**Ticket Sistemi:** `/ticket_setup` - Destek tiketi sistemi\n' +
                                '**Doğrulama:** `/verification <rol>` - Kayıt sistemi\n' +
                                '**Hoş Geldin:** `/welcome <kanal>` - Giriş mesajı\n' +
                                '**Görüşürüz:** `/goodbye <kanal>` - Çıkış mesajı\n' +
                                '**Prefix:** `/setprefix <prefix>` - Mesaj komut prefixi\n' +
                                '**Sunucu Kur:** `/sunucukur <tema>` - Otomatik sunucu yapısı\n' +
                                '**Sıfırla:** `/reset` - Tüm ayarları sıfırla\n' +
                                '📌 **Gerekli İzin:** Admin',
                            inline: false 
                        },
                        { 
                            name: '🎉 EĞLENCE KOMUTLARI', 
                            value: '**Motivasyon:** `/motivasyon` - Motivasyon sözü\n' +
                                '**Taş Kağıt Makas:** `/tkm <tas|kagit|makas>` - Oyun oyna\n' +
                                '**Mesaj:** `/mesaj <metin>` - Bota kendi mesajını yaz\n' +
                                '**Selamla:** `/selamla <kişi>` - Birini selamla\n' +
                                '✨ **Eğlenceli komutlar, herkes tarafından kullanılabilir',
                            inline: false 
                        },
                        { 
                            name: '👑 ADMIN KOMUTLARI', 
                            value: '**Admin Ata:** `/setadmin <kullanıcı>` - Bot yöneticisi yap\n' +
                                '**Admin Çıkar:** `/removeadmin <kullanıcı>` - Bot yöneticiliği kaldır\n' +
                                '**Adminler:** `/admins` - Bot yöneticileri listesi\n' +
                                '**Admin Panel:** `/adminpanel` - Yönetim paneline erişim\n' +
                                '📌 **Sadece Bot Sahibi ve Yöneticileri**',
                            inline: false 
                        }
                    )
                    .addFields(
                        { 
                            name: '\n📌 HIZLI İPUÇLARI & ÖNEMLİ BİLGİLER', 
                            value: '💡 **Seslendir için:** Bot ses kanalında olmalı ve dosya /tmp klasöründe yazılabilir olmalı\n' +
                                '💡 **YouTube Müzik:** Direkt YouTube linki yapıştır, otomatik başlar\n' +
                                '💡 **Admin Kontrol:** Yönetim komutları sadece bot yöneticileri tarafından\n' +
                                '💡 **Loglar:** Ayarlandığında otomatik olarak kaydedilir\n' +
                                '💡 **Tüm Slash komutları:** `/` ile başlar\n' +
                                '💡 **Hata varsa:** Yöneticiye bildir',
                            inline: false 
                        }
                    )
                    .setFooter({ text: 'Fox Software © 2024 | Prefix: ' + (db[guild.id]?.prefix || '?'), iconURL: guild.iconURL() })
                    .setTimestamp();

                try {
                    await interaction.reply({ embeds: [helpEmbed] });
                } catch (err) {
                    console.error('Yardım komutu hatası:', err);
                    const helpText = [
                        '**🤖 FOX BOT KOMUT REHBERI**',
                        '',
                        '**VOICEAI:** `fox bot <soru>` - Yapay zekayla sohbet\n**Seslendir:** `/seslendir <metin>` - Metni sesle oku\n**Müzik:** YouTube linki yapıştır\n**Sese Gel:** `sese gel`',
                        '',
                        '**MODERASYON:** `/mute` `/kick` `/ban` `/purge`',
                        '',
                        '**ROLLER:** `/addrole` `/removerole` `/lockrole` `/autorole`',
                        '',
                        '**LOG:** `/modlog` `/joinlog` `/leavelog` `/editlog` `/messagelog`',
                        '',
                        '**GÜVENLİK:** `/antimention` `/antiraid` `/antibot` `/antilink` `/antispam` `/antiinvite` `/capslimit` `/blockword`',
                        '',
                        '**ADMIN:** `/setadmin` `/removeadmin` `/admins` `/adminpanel`',
                        '',
                        'Detaylı bilgi için: `/yardim`'
                    ].join('\n');

                    try {
                        if (interaction.replied || interaction.deferred) {
                            await interaction.followUp({ content: helpText, ephemeral: true });
                        } else {
                            await interaction.reply({ content: helpText, ephemeral: true });
                        }
                    } catch (err2) {
                        console.error('Yardım fallback gönderilemedi:', err2);
                    }
                }

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
            case 'setprefix': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                const newPrefix = options.getString('prefix');
                db[guildId].prefix = newPrefix;
                saveDB();
                await interaction.reply({ content: `Prefix başarıyla '${newPrefix}' olarak ayarlandı. Mesaj komutları için bu prefiksi kullanın.`, ephemeral: true });
                break;
            }

            case 'sunucukur': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                const tema = options.getString('tema');
                await interaction.reply({ content: `**${tema.toUpperCase()}** temalı sunucu yapısı oluşturuluyor... Lütfen bekleyin.`, ephemeral: false });
                
                try {
                    // 1. Rolleri oluştur
                    const kurucuRol = await guild.roles.create({ name: '👑 Kurucu', color: '#FF0000', hoist: true, permissions: [PermissionsBitField.Flags.Administrator] });
                    const yoneticiRol = await guild.roles.create({ name: '🔨 Yönetici', color: '#FFA500', hoist: true, permissions: [PermissionsBitField.Flags.ManageGuild, PermissionsBitField.Flags.BanMembers] });
                    const modRol = await guild.roles.create({ name: '🛡️ Moderatör', color: '#00FF00', hoist: true, permissions: [PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.ManageMessages] });
                    const vipRol = await guild.roles.create({ name: '💎 VIP', color: '#00FFFF', hoist: true });
                    const uyeRol = await guild.roles.create({ name: '✅ Üye', color: '#FFFFFF', hoist: false });

                    // 2. Kategoriler ve Kanallar
                    // --- BİLGİ MERKEZİ ---
                    const infoKat = await guild.channels.create({ name: '📢 BİLGİ MERKEZİ', type: ChannelType.GuildCategory });
                    await guild.channels.create({ 
                        name: '📜│kurallar', 
                        type: ChannelType.GuildText, 
                        parent: infoKat.id,
                        permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.SendMessages] }]
                    });
                    await guild.channels.create({ 
                        name: '📢│duyurular', 
                        type: ChannelType.GuildText, 
                        parent: infoKat.id,
                        permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.SendMessages] }]
                    });
                    await guild.channels.create({ name: '🎁│çekiliş', type: ChannelType.GuildText, parent: infoKat.id });

                    // --- GENEL SOHBET ---
                    const chatKat = await guild.channels.create({ name: '💬 GENEL SOHBET', type: ChannelType.GuildCategory });
                    await guild.channels.create({ name: '💬│sohbet', type: ChannelType.GuildText, parent: chatKat.id });
                    await guild.channels.create({ name: '📷│medya', type: ChannelType.GuildText, parent: chatKat.id });
                    await guild.channels.create({ name: '🤖│bot-komut', type: ChannelType.GuildText, parent: chatKat.id });

                    // --- SES KANALLARI ---
                    const voiceKat = await guild.channels.create({ name: '🔊 SES KANALLARI', type: ChannelType.GuildCategory });
                    await guild.channels.create({ name: '🔊 Sohbet Odası', type: ChannelType.GuildVoice, parent: voiceKat.id });
                    if (tema === 'oyun') {
                        await guild.channels.create({ name: '🎮 Oyun Odası 1', type: ChannelType.GuildVoice, parent: voiceKat.id });
                        await guild.channels.create({ name: '🎮 Oyun Odası 2', type: ChannelType.GuildVoice, parent: voiceKat.id });
                    }
                    await guild.channels.create({ name: '🎵 Müzik Odası', type: ChannelType.GuildVoice, parent: voiceKat.id });

                    // --- YÖNETİM --- (Özel)
                    const modKat = await guild.channels.create({ 
                        name: '🛡️ YÖNETİM', 
                        type: ChannelType.GuildCategory,
                        permissionOverwrites: [
                            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: yoneticiRol.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                            { id: modRol.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                        ]
                    });
                    const modLog = await guild.channels.create({ name: '📔│mod-log', type: ChannelType.GuildText, parent: modKat.id });
                    await guild.channels.create({ name: '💬│yetkili-sohbet', type: ChannelType.GuildText, parent: modKat.id });

                    // Modlog kanalını veritabanına kaydet
                    db[guild.id].modlog = modLog.id;
                    saveDB();

                    await interaction.editReply(`✅ **${tema === 'oyun' ? 'Oyun' : 'Genel Topluluk'}** temasıyla sunucu başarıyla kuruldu! roller ve kanallar hazır.`);
                } catch (e) {
                    console.error(e);
                    await interaction.editReply('❌ Sunucu kurulurken bir hata oluştu. İzinlerimi kontrol edin.');
                }
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

            // ====== ADMIN KOMUTLARI ======
            case 'setadmin': {
                // Sadece bot sahibi ve mevcut adminler
                const botAdmins = db.botAdmins || [];
                if (!botAdmins.includes(interaction.user.id) && interaction.user.id !== process.env.BOT_OWNER) {
                    return interaction.reply({ content: '❌ Sadece bot sahibi bu komutu kullanabilir.', ephemeral: true });
                }
                const target = options.getUser('kullanici');
                if (!db.botAdmins) db.botAdmins = [];
                if (db.botAdmins.includes(target.id)) {
                    return interaction.reply({ content: `${target.tag} zaten bot yöneticisi.`, ephemeral: true });
                }
                db.botAdmins.push(target.id);
                saveDB();
                await interaction.reply(`✅ ${target.tag} bot yöneticisi olarak eklendi.`);
                break;
            }
            case 'removeadmin': {
                const botAdmins = db.botAdmins || [];
                if (!botAdmins.includes(interaction.user.id) && interaction.user.id !== process.env.BOT_OWNER) {
                    return interaction.reply({ content: '❌ Sadece bot sahibi bu komutu kullanabilir.', ephemeral: true });
                }
                const target = options.getUser('kullanici');
                if (!db.botAdmins || !db.botAdmins.includes(target.id)) {
                    return interaction.reply({ content: `${target.tag} bot yöneticisi değil.`, ephemeral: true });
                }
                db.botAdmins = db.botAdmins.filter(id => id !== target.id);
                saveDB();
                await interaction.reply(`✅ ${target.tag} bot yöneticiliği kaldırıldı.`);
                break;
            }
            case 'admins': {
                const botAdmins = db.botAdmins || [];
                if (botAdmins.length === 0) {
                    return interaction.reply('Henüz bot yöneticisi tanımlanmamış.');
                }
                const adminList = botAdmins.map(id => `<@${id}> (${id})`).join('\n');
                const embed = new EmbedBuilder()
                    .setTitle('👑 Bot Yöneticileri')
                    .setDescription(adminList)
                    .setColor('Gold')
                    .setFooter({ text: 'Toplam: ' + botAdmins.length });
                await interaction.reply({ embeds: [embed] });
                break;
            }
            case 'adminpanel': {
                // Admin kontrol
                const botAdmins = db.botAdmins || [];
                if (!botAdmins.includes(interaction.user.id) && interaction.user.id !== process.env.BOT_OWNER) {
                    return interaction.reply({ content: '❌ Sadece bot yöneticileri bu panele erişebilir.', ephemeral: true });
                }
                const guildConf = db[guildId] || {};
                const embed = new EmbedBuilder()
                    .setTitle('⚙️ Admin Yönetim Paneli')
                    .setColor('Purple')
                    .addFields(
                        { name: 'Sunucu ID', value: guildId, inline: true },
                        { name: 'Modlog Kanalı', value: guildConf.modlog ? `<#${guildConf.modlog}>` : 'Ayarlanmamış', inline: true },
                        { name: 'Join Log', value: guildConf.joinlog ? `<#${guildConf.joinlog}>` : 'Ayarlanmamış', inline: true },
                        { name: 'Anti-Mention', value: guildConf.antimention ? '✅ Aktif' : '❌ Pasif', inline: true },
                        { name: 'Anti-Raid', value: guildConf.antiraid ? '✅ Aktif' : '❌ Pasif', inline: true },
                        { name: 'Anti-bot', value: guildConf.antibot ? '✅ Aktif' : '❌ Pasif', inline: true },
                        { name: 'Anti-Link', value: guildConf.antilink ? '✅ Aktif' : '❌ Pasif', inline: true },
                        { name: 'Anti-Spam', value: guildConf.antispam ? '✅ Aktif' : '❌ Pasif', inline: true },
                        { name: 'Anti-Invite', value: guildConf.antiinvite ? '✅ Aktif' : '❌ Pasif', inline: true },
                        { name: 'Caps Limit', value: guildConf.capslimit ? '✅ Aktif' : '❌ Pasif', inline: true },
                        { name: 'Oto-Rol', value: guildConf.autorole ? `<@&${guildConf.autorole}>` : 'Ayarlanmamış', inline: true },
                        { name: 'Engelli Kelimeler', value: (guildConf.blockWords?.length || 0) + ' kelime', inline: true }
                    )
                    .setFooter({ text: 'Fox Software Admin Panel' })
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }

            case 'blockword': {
                if (!checkBotAdmin(interaction)) return;
                const islem = options.getString('islem');
                const kelime = options.getString('kelime');

                if (!db[guildId].blockWords) db[guildId].blockWords = [];

                if (islem === 'ekle') {
                    if (!kelime) return interaction.reply({ content: 'Eklemek için kelime belirt.', ephemeral: true });
                    if (db[guildId].blockWords.includes(kelime.toLowerCase())) {
                        return interaction.reply({ content: 'Bu kelime zaten engelli.', ephemeral: true });
                    }
                    db[guildId].blockWords.push(kelime.toLowerCase());
                    saveDB();
                    await interaction.reply(`✅ "${kelime}" engelli kelimeler listesine eklendi.`);
                } else if (islem === 'sil') {
                    if (!kelime) return interaction.reply({ content: 'Silmek için kelime belirt.', ephemeral: true });
                    const index = db[guildId].blockWords.indexOf(kelime.toLowerCase());
                    if (index === -1) return interaction.reply({ content: 'Bu kelime engelli değil.', ephemeral: true });
                    db[guildId].blockWords.splice(index, 1);
                    saveDB();
                    await interaction.reply(`✅ "${kelime}" engelli kelimeler listesinden çıkarıldı.`);
                } else if (islem === 'listele') {
                    if (db[guildId].blockWords.length === 0) {
                        return interaction.reply('Engelli kelime yok.');
                    }
                    const list = db[guildId].blockWords.join(', ');
                    const safeList = list.length > 1024 ? list.substring(0, 1021) + '...' : list;
                    const embed = new EmbedBuilder()
                        .setTitle('📋 Engelli Kelimeler')
                        .setDescription(safeList)
                        .setColor('Red')
                        .setFooter({ text: 'Toplam: ' + db[guildId].blockWords.length });
                    await interaction.reply({ embeds: [embed] });
                }
                break;
            }

            case 'seslendir': {
                const metin = options.getString('metin');
                const voiceChannel = member.voice.channel;

                if (!voiceChannel) return interaction.reply({ content: 'Önce bir ses kanalına girmelisin!', ephemeral: true });

                // Defer reply güvenli şekilde yapılır
                let deferred = false;
                try {
                    await interaction.deferReply();
                    deferred = true;
                } catch (e) {
                    console.warn('deferReply başarısız:', e?.message || e);
                }
                try {
                    const fileName = path.join(__dirname, `ses_${user.id}.mp3`);

                    if (!process.env.ELEVEN_API_KEY) {
                        throw new Error('❌ ElevenLabs API key yüklü değil.');
                    }

                    // 1. ElevenLabs üzerinden sesi oluştur
                    console.log(`[TTS] Generating for voiceId: ${voice.voiceId || 'unknown'}`);
                    await voice.textToSpeech({
                        fileName: fileName,
                        textInput: metin,
                        stability: 0.5,
                        similarityBoost: 0.5,
                        modelId: "eleven_multilingual_v2"
                    });
                    console.log(`[TTS] File saved: ${fileName}`);

                    // 2. Ses kanalına bağlan
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: guild.id,
                        adapterCreator: guild.voiceAdapterCreator,
                        selfDeaf: false,
                        selfMute: false
                    });

                    const player = createAudioPlayer();
                    
                    // FIX: createReadStream kullanarak dosyayı oku
                    const audioStream = createReadStream(fileName);
                    const resource = createAudioResource(audioStream, { inputType: StreamType.Arbitrary });

                    player.play(resource);
                    connection.subscribe(player);

                    if (deferred) {
                        await interaction.editReply(`🎙️ **"${metin.substring(0, 50)}${metin.length > 50 ? '...' : ''}"** seslendiriliyor...`);
                    } else {
                        try { await interaction.reply(`🎙️ **"${metin.substring(0, 50)}${metin.length > 50 ? '...' : ''}"** seslendiriliyor...`); } catch (e) { console.warn('reply başarısız:', e?.message || e); }
                    }

                    // 3. Ses bitince kanaldan çık ve dosyayı sil
                    player.on(AudioPlayerStatus.Idle, () => {
                        setTimeout(() => {
                            try {
                                connection.destroy();
                            } catch (e) {}
                            if (fs.existsSync(fileName)) {
                                try {
                                    fs.unlinkSync(fileName);
                                } catch (e) { console.warn('Dosya silme hatası:', e); }
                            }
                        }, 1000);
                    });

                    player.on('error', error => {
                        console.error('Audio Player Hatası:', error);
                        try {
                            connection.destroy();
                        } catch (e) {}
                        if (fs.existsSync(fileName)) {
                            try {
                                fs.unlinkSync(fileName);
                            } catch (e) {}
                        }
                    });

                } catch (error) {
                    console.error('Seslendirme Hatası:', error?.message || error);
                    const errorMsg = error?.response?.status === 404 
                        ? '❌ ElevenLabs API hatası: voiceId veya API key geçersiz.' 
                        : error?.message?.includes('401') 
                        ? '❌ ElevenLabs API anahtarı geçersiz.'
                        : '❌ Seslendirme yapılırken hata oluştu. API anahtarını veya ses dosyası yazmak için izinleri kontrol et.';
                    try { 
                        if (deferred) {
                            await interaction.editReply(errorMsg);
                        } else {
                            await interaction.reply(errorMsg);
                        }
                    } catch (e) { console.warn('editReply/reply başarısız:', e?.message || e); }
                }
                break;
            }
        }
    } catch (error) {
        console.error(error);
        const reply = { content: 'Komut çalıştırılırken bir hata oluştu.', ephemeral: true };
        try {
            if (interaction && (interaction.replied || interaction.deferred)) {
                await interaction.followUp(reply).catch(e => console.warn('followUp başarısız:', e?.message || e));
            } else if (interaction) {
                await interaction.reply(reply).catch(e => console.warn('reply başarısız:', e?.message || e));
            } else {
                console.warn('Interaction nesnesi mevcut değil, cevap gönderilemedi.');
            }
        } catch (e) {
            console.error('Hata cevabı gönderilemedi:', e);
        }
    }
});

// Global hata yakalayıcılar - çöküşleri engelle ve logla
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', err => {
    console.error('Uncaught Exception:', err);
});

const userMessageCache = new Map();

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const guildId = message.guild.id;
    const conf = db[guildId] || {};

    const lowerMessage = message.content.toLowerCase();

    // Engelli Kelimeler Kontrolü
    if (conf.blockWords && conf.blockWords.length > 0) {
        const hasBlockedWord = conf.blockWords.some(word => lowerMessage.includes(word));
        if (hasBlockedWord && !message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await message.delete().catch(() => {});
            return message.channel.send(`❌ Bu kelimeleri kullanamazsın! <@${message.author.id}>`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }

    // Küfür filtresi
    const hasKufur = kufurListesi.some(word => lowerMessage.includes(word));
    if (hasKufur) {
        if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await message.delete().catch(() => {});
            return message.channel.send(`Küfürlü bir kelime kullandın! Lütfen edepli ol <@${message.author.id}>.`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }

    // Mesaj tabanlı müzik komutları ve YouTube algılama
    const ytRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[^\s]+)/i;
    const ytMatch = message.content.match(ytRegex);

    const trimmed = lowerMessage.trim();

    // 'sese gel' -> yazarın bulunduğu ses kanalına bağlan
    if (trimmed === 'sese gel') {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) return message.reply('Önce bir ses kanalına girmen gerekiyor.');
        const perms = voiceChannel.permissionsFor ? voiceChannel.permissionsFor(client.user) : null;
        if (!perms || !perms.has(PermissionsBitField.Flags.Connect) || !perms.has(PermissionsBitField.Flags.Speak)) {
            return message.reply('Ses kanalına bağlanma veya konuşma iznim yok.');
        }
        try {
            joinVoiceChannel({ channelId: voiceChannel.id, guildId: message.guild.id, adapterCreator: voiceChannel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
            return message.reply('Ses kanalına bağlandım.');
        } catch (e) {
            console.error('Sese gel hatası:', e);
            return message.reply('Sese bağlanırken hata oluştu.');
        }
    }

    // Play komutları: eğer mesajda YouTube linki varsa ve yazan veya etiketlenen birinin ses kanalında varsa çal
    if (ytMatch) {
        const url = ytMatch[0];

        // Kullanıcı etiketlendiyse onun ses kanalına bağlan, yoksa mesajı atan kişinin ses kanalına
        const mentionedUser = message.mentions.users.first();
        let targetVoiceChannel = null;
        if (mentionedUser) {
            const member = message.guild.members.cache.get(mentionedUser.id);
            targetVoiceChannel = member?.voice?.channel;
        }
        if (!targetVoiceChannel) targetVoiceChannel = message.member?.voice?.channel;

        if (!targetVoiceChannel) return message.reply('Şarkıyı çalabilmem için önce bir ses kanalına gir veya bir kullanıcı etiketle.');

        const perms = targetVoiceChannel.permissionsFor ? targetVoiceChannel.permissionsFor(client.user) : null;
        if (!perms || !perms.has(PermissionsBitField.Flags.Connect) || !perms.has(PermissionsBitField.Flags.Speak)) {
            return message.reply('Ses kanalına bağlanma veya konuşma iznim yok.');
        }

        await message.react('🎵').catch(() => {});
        return playUrlInGuild(message.guild, url, message.author.id, targetVoiceChannel, message.channel);
    }

    // Fox Bot AI Sohbet
    if (lowerMessage.startsWith('fox bot')) {
        const userPrompt = message.content.substring(7).trim();
        
        if (!userPrompt) return message.reply("Efendim? 'fox bot merhaba' gibi bir soru sor. ✨");

        // .env kontrolü
        if (!process.env.GROQ_API_KEY) {
            console.error('[AI] GROQ_API_KEY not found in .env');
            return message.reply("❌ GROQ_API_KEY .env dosyasında ayarlanmamış. Yöneticiye bildirin.");
        }

        // Groq SDK kontrolü
        if (!groq) {
            console.error('[AI] Groq SDK not initialized');
            return message.reply("❌ Groq SDK başlatılamadı. Yöneticiye bildirin.");
        }

        let systemPrompt = "Sen Fox Bot adında yardımsever bir Discord botusun. Türkçe konuş, kısa ve bilgilendirici ol.";
        try {
            const customPrompt = fs.readFileSync(path.join(__dirname, 'systemprompt.txt'), 'utf-8').trim();
            if (customPrompt) systemPrompt = customPrompt;
        } catch (err) {
            // systemprompt.txt yoksa varsayılan kullan
        }

        try {
            console.log(`[AI] Incoming: "${userPrompt.substring(0, 50)}..."`);
            await message.channel.sendTyping();
            
            const completion = await groq.chat.completions.create({
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 500,
                top_p: 0.9
            });
            
            const cevap = completion.choices[0]?.message?.content?.trim();
            if (!cevap) {
                console.error('[AI] Empty response from Groq');
                return message.reply("Cevap üretilemiyor. Daha sonra dene.");
            }
            
            console.log(`[AI] Response: "${cevap.substring(0, 50)}..."`);
            if (cevap.length > 2000) return message.reply(cevap.substring(0, 1997) + '...');
            return message.reply(cevap);
            
        } catch (err) {
            console.error('[AI] Error:', err?.status || err?.code, err?.message);
            
            // Spesifik hata mesajları
            if (err?.status === 401 || err?.message?.includes('401')) {
                return message.reply("❌ Groq API key geçersiz. Yönetici kontrol etsin.");
            }
            if (err?.status === 429 || err?.message?.includes('429')) {
                return message.reply("⏱️ Çok hızlı sordu. Biraz bekle ve tekrar dene.");
            }
            if (err?.status === 500 || err?.message?.includes('500')) {
                return message.reply("⚠️ Groq servisi şu an çalışmıyor. Biraz sonra dene.");
            }
            if (err?.message?.includes('ERR_MODULE_NOT_FOUND')) {
                console.error('[AI] Groq module not found - needs installation');
                return message.reply("❌ Groq SDK kurulu değil. Bot yeniden başlatmayı doneyin.");
            }
            
            return message.reply(`❌ Hata: ${err?.message?.substring(0, 100) || 'Bilinmiş hata'}`);
        }
    }

    if (message.member && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

    // Link Engeli
    if (conf.antilink) {
        const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|net|org|xyz|io|gg|me|tr|ru|net|gov|edu)\b([a-zA-Z0-9()@:%_\+.~#?&//=]*))/i;
        if (linkRegex.test(message.content)) {
            await message.delete().catch(() => {});
            return message.channel.send(`${message.author}, bu sunucuda link paylaşımı yasaktır!`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }

    // Davet Engeli
    if (conf.antiinvite) {
        const inviteRegex = /(discord\.(gg|io|me|li)\/|discordapp\.com\/invite\/)/i;
        if (inviteRegex.test(message.content)) {
            await message.delete().catch(() => {});
            return message.channel.send(`${message.author}, bu sunucuda davet linki paylaşımı yasaktır!`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }

    // Caps Limit
    if (conf.capslimit && message.content.length > 5) {
        const caps = message.content.replace(/[^A-Z]/g, '').length;
        if (caps / message.content.length > 0.7) {
            await message.delete().catch(() => {});
            return message.channel.send(`${message.author}, lütfen çok fazla büyük harf kullanmayın!`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }

    // Etiket Engeli
    if (conf.antimention && message.mentions.users.size > 5) {
        await message.delete().catch(() => {});
        return message.channel.send(`${message.author}, bir mesajda en fazla 5 kişi etiketleyebilirsiniz!`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }

    // Spam Engeli
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

client.on('guildMemberUpdate', async (oldMember, newMember) => {
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



client.login(process.env.TOKEN);
