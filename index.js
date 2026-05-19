require('dotenv').config();
const {
    Client, GatewayIntentBits, Partials, Collection, REST, Routes,
    SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// Yetki sistemi modülü
const { 
    checkPermission, addBotAdmin, removeBotAdmin, 
    addServerAdmin, removeServerAdmin, 
    addModerator, removeModerator, 
    getAllPermissions 
} = require('./permissions');

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const axios = require('axios');
const { createReadStream } = require('fs');
const ffmpeg = require('ffmpeg-static');

console.log('[DEBUG] FFmpeg path:', ffmpeg);

const ytdl = require('ytdl-core');

// Süper yönetici ID (tüm komutlar, tüm yetkilerde)
const SUPER_USER_ID = '1415643836079673466';

// ================== GELİŞTİRİLMİŞ GÜVENLİK SİSTEMİ ==================

// Şüpheli aktivite ve hesap takibi
const suspiciousActivity = new Map(); // userId -> { warnings, lastAction, actions: [] }
const userSecurityScore = new Map(); // userId -> { score, reasons: [] }

// Spam desenleri
const SPAM_PATTERNS = {
    excessive_caps: /^[A-Z\s!?]{10,}$/,
    repeated_chars: /(.)\1{4,}/gi,
    zalgo_text: /[\u0300-\u036f]{2,}/g,
    mention_spam: /<@!?(\d{16,21})>/g,
    url_spam: /(https?:\/\/[^\s]+)/gi,
    emoji_spam: /[\u{1F300}-\u{1F9FF}]{5,}/gu,
    ping_spam: /@(everyone|here)/gi,
    role_ping: /<@&\d{16,21}>/g
};

// Tehlikeli kelimeler (DDoS, hacking, zararlı komut vb.)
const DANGEROUS_KEYWORDS = [
    'ddos', 'hack', 'crack', 'ransomware', 'malware', 'trojan', 'virus',
    'exploit', 'vulnerability', 'sql injection', 'buffer overflow',
    'zero day', 'botnet', 'worm', 'spyware', 'rootkit', 'backdoor',
    'phishing', 'social engineering', 'credential stuffing'
];

// Fonksiyon: Hesap güvenlik puanı hesapla
function calculateSecurityScore(member) {
    let score = 100;
    const reasons = [];

    // Hesap yaşı kontrolü
    const accountAge = Date.now() - member.user.createdTimestamp;
    const dayOld = accountAge / (1000 * 60 * 60 * 24);
    
    if (dayOld < 1) {
        score -= 50;
        reasons.push('Çok yeni hesap (< 1 gün)');
    } else if (dayOld < 7) {
        score -= 30;
        reasons.push('Yeni hesap (< 7 gün)');
    } else if (dayOld < 30) {
        score -= 15;
        reasons.push('Oldukça yeni hesap (< 30 gün)');
    }

    // Sunucuya katılış zamanı
    const joinAge = Date.now() - member.joinedTimestamp;
    const joinDays = joinAge / (1000 * 60 * 60 * 24);

    if (joinDays < 0.1) {
        score -= 20;
        reasons.push('Çok kısa süre önce katıldı');
    }

    // Avatar kontrolü
    if (!member.user.avatar) {
        score -= 15;
        reasons.push('Avatar yok');
    }

    // Bio kontrolü
    if (!member.user.bio) {
        score -= 5;
        reasons.push('Bio yok');
    }

    // Rol sayısı
    if (member.roles.cache.size === 1) {
        score -= 10;
        reasons.push('Rol yok');
    }

    // İsminde sayı veya garip karakterler
    if (/^\d+$/.test(member.user.username)) {
        score -= 25;
        reasons.push('Şüpheli kullanıcı adı (sadece sayı)');
    }

    return { score: Math.max(0, score), reasons };
}

// Fonksiyon: Spam deseni kontrolü
function checkSpamPatterns(content) {
    const violations = [];

    if (SPAM_PATTERNS.excessive_caps.test(content)) {
        violations.push({ type: 'excessive_caps', severity: 'low' });
    }

    if (SPAM_PATTERNS.repeated_chars.test(content)) {
        violations.push({ type: 'repeated_chars', severity: 'low' });
    }

    if (SPAM_PATTERNS.zalgo_text.test(content)) {
        violations.push({ type: 'zalgo_text', severity: 'medium' });
    }

    const mentionMatches = content.match(SPAM_PATTERNS.mention_spam) || [];
    if (mentionMatches.length > 3) {
        violations.push({ type: 'mention_spam', severity: 'high', count: mentionMatches.length });
    }

    const emojiMatches = content.match(SPAM_PATTERNS.emoji_spam) || [];
    if (emojiMatches.length > 0) {
        violations.push({ type: 'emoji_spam', severity: 'low' });
    }

    if (SPAM_PATTERNS.ping_spam.test(content)) {
        violations.push({ type: 'ping_spam', severity: 'critical' });
    }

    const roleMatches = content.match(SPAM_PATTERNS.role_ping) || [];
    if (roleMatches.length > 2) {
        violations.push({ type: 'role_ping', severity: 'high', count: roleMatches.length });
    }

    // Tehlikeli kelime kontrolü
    const lowerContent = content.toLowerCase();
    for (const keyword of DANGEROUS_KEYWORDS) {
        if (lowerContent.includes(keyword)) {
            violations.push({ type: 'dangerous_keyword', severity: 'critical', keyword });
        }
    }

    return violations;
}

// Fonksiyon: Şüpheli aktiviteyi kaydet ve yönet
async function recordSuspiciousActivity(guild, member, type, severity, details = '') {
    const userId = member.id;
    const guildId = guild.id;

    if (!db[guildId].securityLog) {
        db[guildId].securityLog = [];
    }

    const log = {
        userId,
        username: member.user.tag,
        type,
        severity,
        details,
        timestamp: Date.now()
    };

    db[guildId].securityLog.push(log);

    // Son 1000 logu tut
    if (db[guildId].securityLog.length > 1000) {
        db[guildId].securityLog.shift();
    }

    saveDB();

    // Tehlikeli aktiviteler otomatik loglanır
    const logChannel = guild.channels.cache.get(db[guildId]?.securitylog);
    if (logChannel && severity === 'critical') {
        const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle(`🚨 KRİTİK GÜVENLİK UYARISI`)
            .setDescription(`**Kullanıcı:** ${member}\n**Tip:** ${type}\n**Detay:** ${details}`)
            .setTimestamp();
        
        try {
            await logChannel.send({ embeds: [embed] });
        } catch (e) {
            console.error('Güvenlik logu gönderilemedi:', e);
        }
    }
}

// Fonksiyon: Otomatik yükselme sistemi
async function applySecurityAction(guild, member, reason) {
    if (!suspiciousActivity.has(member.id)) {
        suspiciousActivity.set(member.id, { warnings: 0, lastAction: Date.now(), actions: [] });
    }

    let activity = suspiciousActivity.get(member.id);
    activity.warnings++;
    activity.lastAction = Date.now();
    activity.actions.push({ action: reason, timestamp: Date.now() });

    const warnings = activity.warnings;

    try {
        if (warnings === 1) {
            // Uyarı: 10 dakika timeout
            await member.timeout(10 * 60 * 1000, `[OTOMATIK] ${reason}`);
            await recordSuspiciousActivity(guild, member, 'auto_timeout_1', 'medium', `1. Uyarı: ${reason}`);
        } else if (warnings === 2) {
            // 2. Uyarı: 1 saat timeout
            await member.timeout(60 * 60 * 1000, `[OTOMATIK] ${reason} (2. Uyarı)`);
            await recordSuspiciousActivity(guild, member, 'auto_timeout_2', 'high', `2. Uyarı: ${reason}`);
        } else if (warnings >= 3) {
            // 3. Uyarı: Ban
            await guild.members.ban(member, { reason: `[OTOMATIK] ${reason} (Otomatik Ban - 3+ Uyarı)` });
            await recordSuspiciousActivity(guild, member, 'auto_ban', 'critical', `Otomatik ban: ${reason}`);
        }
    } catch (error) {
        console.error('Güvenlik işlemi başarısız:', error);
    }
}

// Fonksiyon: Güvenlik log kanalını ayarla (slash command için)
async function setSecurityLog(interaction, channel) {
    if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
    
    const targetChannel = channel || interaction.options.getChannel('kanal');
    if (!targetChannel) return interaction.reply({ content: 'Kanal belirtilmedi.', ephemeral: true });
    
    db[interaction.guild.id].securitylog = targetChannel.id;
    saveDB();
    await interaction.reply(`✅ Güvenlik log kanalı ${targetChannel} olarak ayarlandı.`);
}

// Google TTS ile seslendir
async function googleSeslendir(metin, dosyaAdi) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(metin)}&tl=tr&client=gtx&total=1&idx=0`;
    const response = await axios.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        responseType: 'arraybuffer'
    });
    fs.writeFileSync(dosyaAdi, response.data);
    
    // Dosya boyutu kontrol
    const stats = fs.statSync(dosyaAdi);
    console.log(`[Google TTS] Dosya oluşturuldu: ${dosyaAdi} (${stats.size} bytes)`);
    
    if (stats.size === 0) {
        throw new Error('Google TTS ses dosyası boş (0 bytes)');
    }
    
    return dosyaAdi;
}

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

// Küfür listesini yükle
let swearwordsData = {};
try {
    swearwordsData = JSON.parse(fs.readFileSync('./swearwords.json', 'utf8'));
} catch (e) {
    console.warn("⚠️ swearwords.json yüklenemedi, varsayılan liste kullanılıyor.");
    swearwordsData = { enabled: true, swearwords: ["amk", "aq", "sg", "oç", "orospu", "pic", "piç", "sikerim", "yavşak", "yavsak", "gavat", "ibne", "pezevenk", "yarram", "31", "pornhub"] };
}
const kufurListesi = swearwordsData.swearwords || [];

const dbPath = './db.json';
let db = {};

// Veritabanı yükleme - hata yönetimi ile
function loadDB() {
    try {
        if (fs.existsSync(dbPath)) {
            const data = fs.readFileSync(dbPath, 'utf8');
            db = JSON.parse(data);
            console.log('[DB] Veritabanı başarıyla yüklendi.');
        } else {
            console.log('[DB] Veritabanı dosyası bulunamadı, yeni oluşturuluyor...');
            db = {};
        }
    } catch (error) {
        console.error('[DB] Veritabanı yükleme hatası:', error.message);
        // Backup oluştur
        if (fs.existsSync(dbPath)) {
            const backupPath = `${dbPath}.backup.${Date.now()}`;
            fs.copyFileSync(dbPath, backupPath);
            console.log(`[DB] Bozuk veritabanı yedeklendi: ${backupPath}`);
        }
        db = {};
    }
}

loadDB();

// Bot Admin Listesi başlat
if (!db.botAdmins) {
    db.botAdmins = [];
}

// Veritabanı kaydetme - hata yönetimi ve debounce ile
let saveTimeout = null;
const saveDB = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        try {
            // Önce geçici dosyaya yaz
            const tempPath = `${dbPath}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(db, null, 4), 'utf8');
            // Başarılıysa asıl dosyayı değiştir
            fs.renameSync(tempPath, dbPath);
            console.log('[DB] Veritabanı kaydedildi.');
        } catch (error) {
            console.error('[DB] Veritabanı kaydetme hatası:', error.message);
        }
    }, 500); // 500ms debounce
};

// Basit müzik yönetimi: guild bazlı player/connection saklama
const musicPlayers = new Map();

async function playUrlInGuild(guild, url, requesterId, voiceChannel, textChannel) {
    if (!db[guild.id]) db[guild.id] = {};
    if (!db[guild.id].musicQueue) db[guild.id].musicQueue = [];

    // Eğer zaten çalan bir player varsa sıraya ekle
    const existing = musicPlayers.get(guild.id);
    if (existing && existing.player && existing.player.state.status !== AudioPlayerStatus.Idle) {
        db[guild.id].musicQueue.push({ url, requesterId });
        saveDB();
        if (textChannel) textChannel.send(`<@${requesterId}> şarkı sıraya eklendi. Sırada ${db[guild.id].musicQueue.length} şarkı var.`).catch(() => {});
        return;
    }

    try {
        // URL validasyonu
        if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
            if (textChannel) textChannel.send('❌ Geçersiz YouTube URL si.').catch(() => {});
            return;
        }
        
        // ytdl-core ile URL doğrulama
        if (!ytdl.validateURL(url)) {
            if (textChannel) textChannel.send('❌ Geçersiz YouTube URL si.').catch(() => {});
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
            const q = db[guild.id]?.musicQueue || [];
            if (q.length > 0) {
                const next = q.shift();
                saveDB();
                try {
                    // URL validasyonu
                    if (!ytdl.validateURL(next.url)) {
                        console.error('Sıradaki şarkı geçersiz URL:', next.url);
                        if (textChannel) textChannel.send(`❌ Sıradaki şarkı geçersiz URL.`).catch(() => {});
                        // Bir sonraki şarkıya geç
                        player.emit(AudioPlayerStatus.Idle);
                        return;
                    }
                    
                    const nextYtdlOptions = { filter: 'audioonly', quality: 'lowestaudio', highWaterMark: 1 << 25, dlChunkSize: 0 };
                    const nextStream = ytdl(next.url, nextYtdlOptions);
                    nextStream.on('error', (err) => {
                        console.error('Next stream error:', err?.message);
                        if (textChannel) textChannel.send(`⚠️ Sıradaki şarkıda hata: ${err?.message?.substring(0, 80)}`).catch(() => {});
                        // Bağlantıyı kapat
                        setTimeout(() => {
                            try { connection.destroy(); } catch (e) {}
                            musicPlayers.delete(guild.id);
                        }, 1000);
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

    // ===== GELİŞTİRİLMİŞ GÜVENLİK KOMUTLARI =====
    new SlashCommandBuilder().setName('securitylog').setDescription('Güvenlik log kanalını ayarlar.')
        .addChannelOption(o => o.setName('kanal').setDescription('Güvenlik log kanalı').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('usersecurity').setDescription('Bir kullanıcının güvenlik bilgilerini gösterir.')
        .addUserOption(o => o.setName('kullanici').setDescription('Kontrol edilecek kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('checksuspicious').setDescription('Şüpheli aktiviteleri kontrol et ve raporla.'),
    new SlashCommandBuilder().setName('securitystatus').setDescription('Sunucu güvenlik durumunu gösterir.'),
    new SlashCommandBuilder().setName('acountage').setDescription('Bir hesabın yaşını kontrol et.')
        .addUserOption(o => o.setName('kullanici').setDescription('Kontrol edilecek kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('verifyaccount').setDescription('Yeni bir hesabı doğrulandı olarak işaretle.')
        .addUserOption(o => o.setName('kullanici').setDescription('Doğrulanacak kullanıcı').setRequired(true)),

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
    new SlashCommandBuilder().setName('sevetkonu').setDescription('Ses kanalında canlı konuş (Groq AI ile).')
        .addStringOption(o => o.setName('metin').setDescription('Söylenecek mesaj').setRequired(true)),
    new SlashCommandBuilder().setName('seskapatveya_ac').setDescription('Ses kanalında bot\'u aç/kapat.')
        .addBooleanOption(o => o.setName('durum').setDescription('Açık mı? (true=açık, false=kapalı)').setRequired(true)),
    
    // ===== GÜVENLİK KOMUTLARı =====
    new SlashCommandBuilder().setName('usersecurity').setDescription('Kullanıcının güvenlik bilgilerini gösterir.')
        .addUserOption(o => o.setName('kullanici').setDescription('Kontrol edilecek kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('checksuspicious').setDescription('Son şüpheli aktiviteleri gösterir (Moderatör+).'),
    new SlashCommandBuilder().setName('securitystatus').setDescription('Sunucu güvenlik durumunu gösterir (Moderatör+).'),
    new SlashCommandBuilder().setName('acountage').setDescription('Kullanıcının hesap yaşını kontrol eder.')
        .addUserOption(o => o.setName('kullanici').setDescription('Kontrol edilecek kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('verifyaccount').setDescription('Kullanıcıyı güvenilir olarak işaretler (Moderatör+).')
        .addUserOption(o => o.setName('kullanici').setDescription('Doğrulanacak kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('securitylog').setDescription('Güvenlik log kanalını ayarlar (Admin+).')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').addChannelTypes(ChannelType.GuildText).setRequired(true)),
];

const checkPerm = (interaction, perm) => {
    
    if (interaction.user.id === SUPER_USER_ID) {
        return true;
    }
    
    if (!interaction.member.permissions.has(perm)) {
        interaction.reply({ content: 'Bu komutu kullanmak için yeterli yetkiniz yok.', ephemeral: true });
        return false;
    }
    return true;
};


const checkBotAdmin = (interaction) => {
    
    if (interaction.user.id === SUPER_USER_ID) {
        return true;
    }
    
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
    console.log(`✅ ${client.user.tag} olarak giriş yapıldı!`);
    console.log(`📊 ${client.guilds.cache.size} sunucuda aktif`);
    console.log(`👥 ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)} kullanıcıya hizmet veriyor`);

    const statuslar = [
        'Spamcıları avlıyorum',
        'Sunucuyu izliyorum',
        '/yardım yazmayı unutma',
        'Logları kontrol ediyorum',
        'Moderasyon aktif',
        `${client.guilds.cache.size} Sunucuda`
    ];

    let i = 0;

    setInterval(() => {
        try {
            client.user.setActivity(statuslar[i], { type: ActivityType.Watching });
            i++;
            if (i >= statuslar.length) i = 0;
        } catch (error) {
            console.error('Status güncelleme hatası:', error.message);
        }
    }, 10000); // 10 saniyede bir güncelle (rate limit için)

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        console.log('⏳ Slash komutları yükleniyor...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Komutlar başarıyla yüklendi.');
    } catch (error) {
        console.error('❌ Komut yüklenirken hata:', error);
        console.error('Detay:', error.message);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        // YENİ: Ticket Sistemi - Menü Butonları
        if (interaction.customId.startsWith('ticket_type_')) {
            const ticketType = interaction.customId.replace('ticket_type_', '');
            const ticketCategories = {
                'application': { emoji: '📝', name: 'Yetkili Başvuru', color: '#3498db' },
                'complaint': { emoji: '⚠️', name: 'Şikayet', color: '#e74c3c' },
                'advertisement': { emoji: '📢', name: 'Reklam Verme', color: '#f39c12' },
                'other': { emoji: '❓', name: 'Diğer', color: '#95a5a6' }
            };

            const category = ticketCategories[ticketType];
            if (!category) return interaction.reply({ content: '❌ Geçersiz ticket türü.', ephemeral: true });

            const ticketNumber = Math.floor(Math.random() * 10000);
            const ticketName = `${ticketType}-${interaction.user.username}-${ticketNumber}`;

            try {
                // Ticket kategorisini bul veya oluştur
                let ticketCategory = interaction.guild.channels.cache.find(
                    c => c.type === ChannelType.GuildCategory && c.name.includes('🎫 TICKETLER')
                );

                if (!ticketCategory) {
                    ticketCategory = await interaction.guild.channels.create({
                        name: '🎫 TICKETLER',
                        type: ChannelType.GuildCategory,
                        permissionOverwrites: [
                            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }
                        ]
                    });
                }

                // Ticket kanalını oluştur
                const ticketChannel = await interaction.guild.channels.create({
                    name: ticketName,
                    type: ChannelType.GuildText,
                    parent: ticketCategory.id,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] }
                    ]
                });

                // Yönetici rollerine erişim ver
                const modRoles = interaction.guild.roles.cache.filter(r => r.permissions.has(PermissionsBitField.Flags.ManageGuild));
                for (const role of modRoles.values()) {
                    await ticketChannel.permissionOverwrites.create(role.id, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    }).catch(() => {});
                }

                // Ticket embed'i oluştur
                const ticketEmbed = new EmbedBuilder()
                    .setColor(category.color)
                    .setTitle(`${category.emoji} ${category.name}`)
                    .setDescription(`Hoş geldin <@${interaction.user.id}>!\n\nBuraya sorununu, şikayetini veya talebini detaylı bir şekilde açıkla. Yetkililer en kısa sürede sana yardımcı olacak.`)
                    .addFields(
                        { name: 'Ticket No', value: `#${ticketNumber}`, inline: true },
                        { name: 'Tür', value: category.name, inline: true },
                        { name: 'Durum', value: '🟢 Açık', inline: true },
                        { name: 'Not', value: 'Aşağıdaki butonları kullanarak bu ticketi yönetebilirsin.' }
                    )
                    .setFooter({ text: 'Fox Bot Ticket Sistemi' })
                    .setTimestamp();

                // Yönetici butonları
                const managerRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_close_${ticketChannel.id}`)
                        .setLabel('Kapat')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒'),
                    new ButtonBuilder()
                        .setCustomId(`ticket_delete_${ticketChannel.id}`)
                        .setLabel('Sil')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🗑️')
                );

                const ticketMessage = await ticketChannel.send({
                    embeds: [ticketEmbed],
                    components: [managerRow]
                });

                // Ticket bilgilerini kaydet
                if (!db[interaction.guild.id].tickets) {
                    db[interaction.guild.id].tickets = {};
                }
                db[interaction.guild.id].tickets[ticketChannel.id] = {
                    userId: interaction.user.id,
                    type: ticketType,
                    createdAt: Date.now(),
                    messageId: ticketMessage.id,
                    status: 'open'
                };
                saveDB();

                await interaction.reply({ 
                    content: `✅ Ticket başarıyla oluşturuldu!\n${ticketChannel}`, 
                    ephemeral: true 
                });
            } catch (error) {
                console.error('Ticket oluşturma hatası:', error);
                await interaction.reply({ 
                    content: '❌ Ticket oluşturulurken hata oluştu.', 
                    ephemeral: true 
                });
            }
        }

        // YENİ: Ticket Kapatma
        if (interaction.customId.startsWith('ticket_close_')) {
            const channelId = interaction.customId.replace('ticket_close_', '');
            const ticketData = db[interaction.guild.id]?.tickets?.[channelId];

            if (!ticketData) return interaction.reply({ content: '❌ Ticket verisi bulunamadı.', ephemeral: true });

            // Sadece yöneticiler kapatabilir
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ Bu işlem için yönetici olmalısın.', ephemeral: true });
            }

            try {
                const channel = interaction.guild.channels.cache.get(channelId);
                if (!channel) return interaction.reply({ content: '❌ Kanal bulunamadı.', ephemeral: true });

                // Ticket'i kapalı olarak işaretle
                ticketData.status = 'closed';
                ticketData.closedAt = Date.now();
                ticketData.closedBy = interaction.user.id;
                saveDB();

                // Kanalın ismini değiştir
                await channel.setName(`${channel.name}-kapalı`).catch(() => {});

                // Kapalı embed'i gönder
                const closedEmbed = new EmbedBuilder()
                    .setColor('#95a5a6')
                    .setTitle('🔒 Ticket Kapatıldı')
                    .setDescription(`Bu ticket <@${interaction.user.id}> tarafından kapatılmıştır.`)
                    .setTimestamp();

                await channel.send({ embeds: [closedEmbed] });
                await interaction.reply({ content: '✅ Ticket kapatıldı.', ephemeral: true });
            } catch (error) {
                console.error('Ticket kapatma hatası:', error);
                await interaction.reply({ content: '❌ Kapata bilmedi.', ephemeral: true });
            }
        }

        // YENİ: Ticket Silme
        if (interaction.customId.startsWith('ticket_delete_')) {
            const channelId = interaction.customId.replace('ticket_delete_', '');
            const ticketData = db[interaction.guild.id]?.tickets?.[channelId];

            if (!ticketData) return interaction.reply({ content: '❌ Ticket verisi bulunamadı.', ephemeral: true });

            // Sadece yöneticiler silebilir
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ Bu işlem için yönetici olmalısın.', ephemeral: true });
            }

            try {
                const channel = interaction.guild.channels.cache.get(channelId);
                if (!channel) return interaction.reply({ content: '❌ Kanal bulunamadı.', ephemeral: true });

                // Ticket'i veritabanından sil
                delete db[interaction.guild.id].tickets[channelId];
                saveDB();

                await interaction.reply({ content: '✅ Ticket kanal 5 saniyede silinecek...', ephemeral: true });

                // 5 saniye sonra kanalı sil
                setTimeout(async () => {
                    try {
                        await channel.delete();
                        console.log(`[Ticket] Kanal silindi: ${channel.name}`);
                    } catch (error) {
                        console.error('Kanal silme hatası:', error);
                    }
                }, 5000);
            } catch (error) {
                console.error('Ticket silme hatası:', error);
                await interaction.reply({ content: '❌ Silemedi.', ephemeral: true });
            }
        }

        // YENİ: Mesaj Silme (Yönetici Reaksiyonu)
        if (interaction.customId === 'msg_delete') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: '❌ Bu işlem için mesaj yönetimi izni gerekli.', ephemeral: true });
            }

            try {
                const channel = interaction.channel;
                // Son 50 mesajı çek
                const messages = await channel.messages.fetch({ limit: 50 });
                // İlk mesajı (cevapladığı mesajı) sil
                const targetMsg = interaction.message.reference ? 
                    await channel.messages.fetch(interaction.message.reference.messageId).catch(() => null) : 
                    interaction.message;

                if (targetMsg) {
                    await targetMsg.delete();
                    await interaction.reply({ content: '✅ Mesaj silindi.', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ Silenecek mesaj bulunamadı.', ephemeral: true });
                }
            } catch (error) {
                console.error('Mesaj silme hatası:', error);
                await interaction.reply({ content: '❌ Mesaj silinemedi.', ephemeral: true });
            }
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
                
                if (!target) {
                    return interaction.reply({ content: '❌ Kullanıcı bulunamadı veya sunucuda değil.', ephemeral: true });
                }
                
                if (target.id === interaction.user.id) {
                    return interaction.reply({ content: '❌ Kendinizi susturamassınız.', ephemeral: true });
                }
                
                if (target.roles.highest.position >= interaction.member.roles.highest.position) {
                    return interaction.reply({ content: '❌ Bu kullanıcıyı susturma yetkiniz yok (rol hiyerarşisi).', ephemeral: true });
                }
                
                const duration = options.getInteger('sure') * 60 * 1000;
                const reason = options.getString('sebep') || 'Sebep belirtilmedi';
                
                try {
                    await target.timeout(duration, reason);
                    await interaction.reply(`✅ ${target.user.tag} başarıyla susturuldu. (${options.getInteger('sure')} dakika)`);
                    sendModLog(guild, 'Mute', target.user, user, reason);
                } catch (error) {
                    console.error('Mute hatası:', error);
                    await interaction.reply({ content: `❌ Susturma başarısız: ${error.message}`, ephemeral: true });
                }
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
                
                if (!target) {
                    return interaction.reply({ content: '❌ Kullanıcı bulunamadı veya sunucuda değil.', ephemeral: true });
                }
                
                if (target.id === interaction.user.id) {
                    return interaction.reply({ content: '❌ Kendinizi atamazsınız.', ephemeral: true });
                }
                
                if (!target.kickable) {
                    return interaction.reply({ content: '❌ Bu kullanıcıyı atamıyorum (yetki/rol hiyerarşisi).', ephemeral: true });
                }
                
                const reason = options.getString('sebep') || 'Sebep belirtilmedi';
                
                try {
                    await target.kick(reason);
                    await interaction.reply(`✅ ${target.user.tag} sunucudan atıldı.`);
                    sendModLog(guild, 'Kick', target.user, user, reason);
                } catch (error) {
                    console.error('Kick hatası:', error);
                    await interaction.reply({ content: `❌ Atma başarısız: ${error.message}`, ephemeral: true });
                }
                break;
            }
            case 'ban': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.BanMembers)) return;
                const target = options.getUser('kullanici');
                
                if (!target) {
                    return interaction.reply({ content: '❌ Kullanıcı bulunamadı.', ephemeral: true });
                }
                
                if (target.id === interaction.user.id) {
                    return interaction.reply({ content: '❌ Kendinizi yasaklayamazsınız.', ephemeral: true });
                }
                
                const member = await guild.members.fetch(target.id).catch(() => null);
                if (member && !member.bannable) {
                    return interaction.reply({ content: '❌ Bu kullanıcıyı yasaklayamıyorum (yetki/rol hiyerarşisi).', ephemeral: true });
                }
                
                const reason = options.getString('sebep') || 'Sebep belirtilmedi';
                
                try {
                    await guild.members.ban(target, { reason });
                    await interaction.reply(`✅ ${target.tag} sunucudan yasaklandı.`);
                    sendModLog(guild, 'Ban', target, user, reason);
                } catch (error) {
                    console.error('Ban hatası:', error);
                    await interaction.reply({ content: `❌ Yasaklama başarısız: ${error.message}`, ephemeral: true });
                }
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
                
                const ticketEmbed = new EmbedBuilder()
                    .setTitle('🎫 Destek Ticket Sistemi')
                    .setDescription('Aşağıdaki seçeneklerden birisini seç ve destek talebi oluştur.\n\nYetkililer en kısa sürede sana yardımcı olacak!')
                    .setColor('#2ecc71')
                    .addFields(
                        { name: '📝 Yetkili Başvuru', value: 'Sunucuda yetkili olmak için başvur', inline: false },
                        { name: '⚠️ Şikayet', value: 'Bir kullanıcı hakkında şikayet bildirin', inline: false },
                        { name: '📢 Reklam Verme', value: 'Sunucunuzu veya projenizi tanıt', inline: false },
                        { name: '❓ Diğer', value: 'Yukarıdaki kategoriler dışında sorunlar', inline: false }
                    )
                    .setFooter({ text: 'Her ticket için gizli bir kanal oluşturulacak' })
                    .setTimestamp();

                const buttonRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_type_application')
                        .setLabel('Yetkili Başvuru')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('📝'),
                    new ButtonBuilder()
                        .setCustomId('ticket_type_complaint')
                        .setLabel('Şikayet')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('⚠️'),
                    new ButtonBuilder()
                        .setCustomId('ticket_type_advertisement')
                        .setLabel('Reklam Verme')
                        .setStyle(ButtonStyle.Warning)
                        .setEmoji('📢'),
                    new ButtonBuilder()
                        .setCustomId('ticket_type_other')
                        .setLabel('Diğer')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('❓')
                );

                await interaction.channel.send({ embeds: [ticketEmbed], components: [buttonRow] });
                await interaction.reply({ content: '✅ Ticket sistemi başarıyla kuruldu!', ephemeral: true });
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
                // Sadece bot sahibi ve süper yönetici
                if (interaction.user.id !== process.env.BOT_OWNER && interaction.user.id !== SUPER_USER_ID) {
                    const perm = checkPermission(interaction.user.id, guildId, 'addBotAdmin');
                    if (!perm.permissions.addBotAdmin) {
                        return interaction.reply({ 
                            content: '❌ Sadece **Bot Sahibi** bu komutu kullanabilir.\n\n' +
                                     '📌 **Yetki Seviyesi:**\n' +
                                     '👑 **Bot Sahibi** (sudo)\n' +
                                     '🔨 **Bot Yöneticisi** (özel yetkilere sahip)\n' +
                                     '🛡️ **Sunucu Yöneticisi** (sunucu bazlı)\n' +
                                     '💬 **Moderatör** (sınırlı yetki)',
                            ephemeral: true 
                        });
                    }
                }
                
                const target = options.getUser('kullanici');
                const result = addBotAdmin(target.id);
                
                if (result.success) {
                    const perm = checkPermission(target.id, guildId, 'all');
                    await interaction.reply({
                        content: `✅ ${target.tag} **Bot Yöneticisi** yapıldı!\n\n` +
                                 `📋 **Yeni Yetkileri:**\n` +
                                 `✔️ Mute / Kick / Ban\n` +
                                 `✔️ Mesaj Yönetimi\n` +
                                 `✔️ Engelli Kelime Ekleme\n` +
                                 `✔️ Sunucu Kurma\n` +
                                 `✔️ Admin Panel Erişimi`
                    });
                } else {
                    await interaction.reply({ content: result.message, ephemeral: true });
                }
                break;
            }
            case 'removeadmin': {
                if (interaction.user.id !== process.env.BOT_OWNER && interaction.user.id !== SUPER_USER_ID) {
                    return interaction.reply({ content: '❌ Sadece **Bot Sahibi** bu komutu kullanabilir.', ephemeral: true });
                }
                
                const target = options.getUser('kullanici');
                const result = removeBotAdmin(target.id);
                
                if (result.success) {
                    await interaction.reply(`✅ ${target.tag}'nin **Bot Yöneticisi** statüsü kaldırıldı.`);
                } else {
                    await interaction.reply({ content: result.message, ephemeral: true });
                }
                break;
            }
            case 'admins': {
                const allPerms = getAllPermissions(guildId);
                const botAdmins = allPerms.botAdmins || [];
                const serverAdmins = allPerms.serverAdmins || [];
                const mods = allPerms.moderators || [];
                
                const embed = new EmbedBuilder()
                    .setColor('Purple')
                    .setTitle('👑 Yetki Hiyerarşisi - Fox Bot')
                    .addFields(
                        {
                            name: '👑 BOT YÖNETİCİLERİ (Sudo)',
                            value: botAdmins.length > 0 
                                ? botAdmins.map((id, i) => `${i+1}. <@${id}>`).join('\n')
                                : '❌ Henüz tanımlanmamış',
                            inline: false
                        },
                        {
                            name: '🔨 SUNUCU YÖNETİCİLERİ',
                            value: serverAdmins.length > 0 
                                ? serverAdmins.map((id, i) => `${i+1}. <@${id}>`).join('\n')
                                : '❌ Henüz tanımlanmamış',
                            inline: false
                        },
                        {
                            name: '🛡️ MODERATÖRLER',
                            value: mods.length > 0 
                                ? mods.map((id, i) => `${i+1}. <@${id}>`).join('\n')
                                : '❌ Henüz tanımlanmamış',
                            inline: false
                        },
                        {
                            name: '📊 İSTATİSTİK',
                            value: `👑 Bot Admin: ${botAdmins.length}\n🔨 Sunucu Admin: ${serverAdmins.length}\n🛡️ Moderatör: ${mods.length}`,
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Fox Bot Yetki Sistemi' })
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
                break;
            }
            case 'adminpanel': {
                // Admin kontrol - Süper yönetici herkesi bypass eder
                if (interaction.user.id !== SUPER_USER_ID) {
                    const perm = checkPermission(interaction.user.id, guildId, 'all');
                    if (!perm.canModerate) {
                        return interaction.reply({ 
                            content: '❌ Bu panele erişme yetkiniz yok.\n\n' +
                                     '📌 **Gerekli Yetkilendirme:**\n' +
                                     '• 👑 Bot Yöneticisi\n' +
                                     '• 🔨 Sunucu Yöneticisi\n' +
                                     '• 🛡️ Moderatör',
                            ephemeral: true 
                        });
                    }
                }
                
                const guildConf = db[guildId] || {};
                const embed = new EmbedBuilder()
                    .setTitle('⚙️ Admin Yönetim Paneli')
                    .setColor('Purple')
                    .addFields(
                        { name: 'Sunucu İD', value: guildId, inline: true },
                        { name: 'Prefix', value: guildConf.prefix || '?', inline: true },
                        { name: '\u200B', value: '\u200B', inline: true },
                        { name: '📋 LOG KANALLARı', value: 
                            `**Modlog:** ${guildConf.modlog ? `<#${guildConf.modlog}>` : '❌'}\n` +
                            `**Joinlog:** ${guildConf.joinlog ? `<#${guildConf.joinlog}>` : '❌'}\n` +
                            `**Leavelog:** ${guildConf.leavelog ? `<#${guildConf.leavelog}>` : '❌'}\n` +
                            `**Messagelog:** ${guildConf.messagelog ? `<#${guildConf.messagelog}>` : '❌'}\n` +
                            `**Editlog:** ${guildConf.editlog ? `<#${guildConf.editlog}>` : '❌'}`,
                            inline: false
                        },
                        { name: '🛡️ GÜVENLİK SİSTEMLERİ', value:
                            `**Anti-Mention:** ${guildConf.antimention ? '✅' : '❌'}\n` +
                            `**Anti-Raid:** ${guildConf.antiraid ? '✅' : '❌'}\n` +
                            `**Anti-Bot:** ${guildConf.antibot ? '✅' : '❌'}\n` +
                            `**Anti-Link:** ${guildConf.antilink ? '✅' : '❌'}\n` +
                            `**Anti-Spam:** ${guildConf.antispam ? '✅' : '❌'}\n` +
                            `**Anti-Invite:** ${guildConf.antiinvite ? '✅' : '❌'}\n` +
                            `**Caps Limit:** ${guildConf.capslimit ? '✅' : '❌'}`,
                            inline: false
                        },
                        { name: '⚡ DİĞER AYARLAR', value:
                            `**Oto-Rol:** ${guildConf.autorole ? `<@&${guildConf.autorole}>` : '❌'}\n` +
                            `**Engelli Kelimeler:** ${(guildConf.blockWords?.length || 0)} kelime`,
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Fox Software Admin Panel | Yetkiniz: ' + (perm.isBotAdmin ? '👑 Bot Admin' : perm.isServerAdmin ? '🔨 Sunucu Admin' : '🛡️ Moderatör') })
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

                    // 1. Google TTS üzerinden sesi oluştur (Bedava!)
                    console.log(`[Google TTS] Generatıng: "${metin.substring(0, 30)}..."`);
                    try {
                        await googleSeslendir(metin, fileName);
                        console.log(`[Google TTS] File saved: ${fileName}`);
                    } catch (ttsError) {
                        console.error('Google TTS Hatası:', ttsError?.message);
                        throw new Error('❌ Ses üretme başarısız. İnternet bağlantınızı kontrol edin.');
                    }

                    // 2. Ses kanalına bağlan
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: guild.id,
                        adapterCreator: guild.voiceAdapterCreator,
                        selfDeaf: false,
                        selfMute: false
                    });

                    const player = createAudioPlayer();
                    
                    // FIX: MP3 dosyasını FFmpeg ile çizelık içinde alın
                    const { spawn } = require('child_process');
                    const ffmpegProc = spawn(ffmpeg, [
                        '-i', fileName,
                        '-acodec', 'libopus',
                        '-f', 'ogg',
                        '-'
                    ], { stdio: ['pipe', 'pipe', 'pipe'] });
                    
                    // FFmpeg stderr'ını logla
                    ffmpegProc.stderr.on('data', (data) => {
                        console.log(`[FFmpeg] ${data.toString().trim()}`);
                    });
                    
                    ffmpegProc.on('error', (err) => {
                        console.error('[FFmpeg] Başlatma hatası:', err.message);
                    });
                    
                    const resource = createAudioResource(ffmpegProc.stdout, { inputType: StreamType.OggOpus, inlineVolume: true });

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
                        try {
                            ffmpegProc.kill();
                        } catch (e) {}
                        if (fs.existsSync(fileName)) {
                            try {
                                fs.unlinkSync(fileName);
                            } catch (e) {}
                        }
                    });

                } catch (error) {
                    console.error('Seslendirme Hatası:', error?.message || error);
                    let errorMsg = '❌ Seslendirme yapılırken hata oluştu.';
                    
                    if (error?.message?.includes('Google TTS')) {
                        errorMsg = '❌ **Google TTS Hatası:**\n• İnternet bağlantınızı kontrol edin\n• Ya da Google sitesi kapalı olabilir';
                    } else if (error?.message?.includes('Ses üretme')) {
                        errorMsg = '❌ **Ses Üretilemedi:**\n• İnternet bağlantısını kontrol et\n• Metin çok uzun olabilir (max 200 karakter)';
                    } else if (error?.message?.includes('ENOTFOUND')) {
                        errorMsg = '❌ **İnternet Bağlantısı Yok** veya API sunucusu kapalı.';
                    } else if (error?.message?.includes('EACCES') || error?.message?.includes('Permission')) {
                        errorMsg = '❌ **Dosya Yazma İzni Yok:**\nBot klasörüne yazma izni ver.';
                    }
                    
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

            // YENİ: Ses konuşma özelliği
            case 'sevetkonu': {
                const metin = options.getString('metin');
                const voiceChannel = member.voice.channel;

                if (!voiceChannel) return interaction.reply({ content: 'Önce bir ses kanalına girmelisin!', ephemeral: true });

                await interaction.deferReply();

                try {
                    if (!groq) throw new Error('AI sistemi aktif değil');

                    // AI'dan yanıt al
                    console.log(`[VOICE] Generating response for: "${metin.substring(0, 50)}..."`);
                    const completion = await groq.chat.completions.create({
                        model: 'llama-3.1-8b-instant',
                        messages: [
                            { role: "system", content: "Sen bir Discord ses asistanısın. Kısa, doğru cevaplar ver." },
                            { role: "user", content: metin }
                        ],
                        temperature: 0.7,
                        max_tokens: 200,
                        top_p: 0.9
                    });

                    const cevap = completion.choices[0]?.message?.content?.trim();
                    if (!cevap) throw new Error('Yanıt alınamadı');

                    console.log(`[VOICE] AI Response: "${cevap.substring(0, 50)}..."`);

                    // Yanıtı sese çevir ve oynat (Google TTS - Bedava!)
                    const fileName = path.join(__dirname, `ses_voice_${user.id}_${Date.now()}.mp3`);
                    
                    try {
                        await googleSeslendir(cevap, fileName);
                    } catch (ttsErr) {
                        throw new Error('Google TTS hatası: ' + ttsErr?.message);
                    }

                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: guild.id,
                        adapterCreator: guild.voiceAdapterCreator,
                        selfDeaf: false,
                        selfMute: false
                    });

                    const player = createAudioPlayer();
                    
                    // FIX: MP3 dosyasını FFmpeg ile çizelık içinde alın
                    const { spawn } = require('child_process');
                    const ffmpegProc = spawn(ffmpeg, [
                        '-i', fileName,
                        '-acodec', 'libopus',
                        '-f', 'ogg',
                        '-'
                    ], { stdio: ['pipe', 'pipe', 'pipe'] });
                    
                    // FFmpeg stderr'ını logla
                    ffmpegProc.stderr.on('data', (data) => {
                        console.log(`[FFmpeg] ${data.toString().trim()}`);
                    });
                    
                    ffmpegProc.on('error', (err) => {
                        console.error('[FFmpeg] Başlatma hatası:', err.message);
                    });
                    
                    const resource = createAudioResource(ffmpegProc.stdout, { inputType: StreamType.OggOpus, inlineVolume: true });

                    player.play(resource);
                    connection.subscribe(player);

                    await interaction.editReply(`🤖 **AI Yanıtı:** "${cevap.substring(0, 80)}..."\n*Ses olarak oynatılıyor...*`);

                    player.on(AudioPlayerStatus.Idle, () => {
                        setTimeout(() => {
                            try { connection.destroy(); } catch (e) {}
                            try { ffmpegProc.kill(); } catch (e) {}
                            if (fs.existsSync(fileName)) {
                                try { fs.unlinkSync(fileName); } catch (e) {}
                            }
                        }, 500);
                    });

                    player.on('error', error => {
                        console.error('Audio Player Hatası:', error);
                        try { connection.destroy(); } catch (e) {}
                        try { ffmpegProc.kill(); } catch (e) {}
                        if (fs.existsSync(fileName)) {
                            try { fs.unlinkSync(fileName); } catch (e) {}
                        }
                    });

                } catch (error) {
                    console.error('Ses konuşma hatası:', error?.message || error);
                    let errorMsg = '❌ Ses konuşma yapılırken hata oluştu.';
                    
                    if (error?.message?.includes('AI sistemi aktif değil')) {
                        errorMsg = '❌ **AI Sistemi Aktif Değil:**\n• `.env`\'de GROQ_API_KEY kontrol et\n• API key: https://console.groq.com/keys';
                    } else if (error?.message?.includes('Google TTS')) {
                        errorMsg = '❌ **Ses Üretme Hatası (Google TTS):**\n• İnternet bağlantınızı kontrol edin\n• Metin çok uzun olabilir (max 200 karakter)';
                    } else if (error?.message?.includes('429')) {
                        errorMsg = '⏱️ **Rate Limit Aşıldı:**\nBiraz bekle ve tekrar dene.';
                    } else if (error?.message?.includes('ENOTFOUND') || error?.message?.includes('ECONNREFUSED')) {
                        errorMsg = '❌ **Bağlantı Hatası:**\nİnterneti kontrol et veya Google sitesi kapalı.';
                    }
                    
                    await interaction.editReply(errorMsg);
                }
                break;
            }

            // YENİ: Ses kanalı kontrolü
            case 'seskapatveya_ac': {
                const durum = options.getBoolean('durum');
                const voiceChannel = member.voice.channel;

                if (!voiceChannel) return interaction.reply({ content: 'Önce bir ses kanalına girmelisin!', ephemeral: true });

                try {
                    if (durum) {
                        // Botu açık bırak
                        const connection = joinVoiceChannel({
                            channelId: voiceChannel.id,
                            guildId: guild.id,
                            adapterCreator: guild.voiceAdapterCreator,
                            selfDeaf: false,
                            selfMute: false
                        });
                        await interaction.reply(`🔊 Bot "${voiceChannel.name}" kanalında **AÇIK** durumda. Hazırlanıyor...`);
                    } else {
                        // Bot'u kapat
                        const existing = musicPlayers.get(guild.id);
                        if (existing) {
                            try { existing.connection.destroy(); } catch (e) {}
                            musicPlayers.delete(guild.id);
                        }
                        await interaction.reply(`🔇 Bot ses kanalından **KAPATILDI**. Kanaldan ayrılıyor...`);
                    }
                } catch (error) {
                    console.error('Ses kontrol hatası:', error);
                    await interaction.reply({ content: `❌ Hata: ${error?.message?.substring(0, 100)}`, ephemeral: true });
                }
                break;
            }

            // ===== GÜVENLİK KOMUTLARı =====
            case 'usersecurity': {
                const user = options.getUser('kullanici');
                const member = await guild.members.fetch(user.id).catch(() => null);
                
                if (!member) {
                    return interaction.reply({ 
                        content: '❌ Üye bulunamadı.',
                        ephemeral: true 
                    });
                }

                // Güvenlik puanı hesapla
                const securityScore = calculateSecurityScore(member);
                const accountAge = Date.now() - user.createdTimestamp;
                const accountAgeDays = Math.floor(accountAge / (1000 * 60 * 60 * 24));
                
                // Risk seviyesi belirle
                let riskLevel = '🟢 Düşük';
                if (securityScore < 30) riskLevel = '🔴 Kritik';
                else if (securityScore < 50) riskLevel = '🟠 Yüksek';
                else if (securityScore < 70) riskLevel = '🟡 Orta';

                // Şüpheli aktivite sayısı
                const guildConf = db[guildId] || {};
                const suspiciousCount = (guildConf.securityLog || []).filter(log => log.userId === user.id).length;

                const embed = new EmbedBuilder()
                    .setColor(securityScore < 50 ? 'Red' : securityScore < 70 ? 'Yellow' : 'Green')
                    .setTitle(`🛡️ ${user.username} - Güvenlik Bilgileri`)
                    .setThumbnail(user.displayAvatarURL())
                    .addFields(
                        { name: '👤 Kullanıcı', value: `${user.tag}\n(ID: ${user.id})`, inline: false },
                        { name: '🔐 Güvenlik Puanı', value: `${securityScore}/100`, inline: true },
                        { name: '⚠️ Risk Seviyesi', value: riskLevel, inline: true },
                        { name: '\u200B', value: '\u200B', inline: true },
                        { name: '📅 Hesap Yaşı', value: `${accountAgeDays} gün`, inline: true },
                        { name: '🎭 Avatar', value: user.avatar ? '✅ Var' : '❌ Yok', inline: true },
                        { name: '⚡ Roller Sayısı', value: `${member.roles.cache.size}`, inline: true },
                        { name: '⚠️ Şüpheli Aktivite', value: `${suspiciousCount} olay`, inline: false }
                    )
                    .setFooter({ text: 'Fox Bot Güvenlik Sistemi' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'checksuspicious': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
                
                const guildConf = db[guildId] || {};
                const logs = (guildConf.securityLog || []).slice(-20).reverse();

                if (logs.length === 0) {
                    return interaction.reply({
                        content: '✅ Son zamanlarda şüpheli aktivite kaydı bulunmamaktadır.',
                        ephemeral: true
                    });
                }

                const embed = new EmbedBuilder()
                    .setColor('Orange')
                    .setTitle('⚠️ Son Şüpheli Aktiviteler (Son 20)')
                    .setDescription(logs.map((log, i) => {
                        const severity = {
                            'critical': '🔴 KRİTİK',
                            'high': '🟠 YÜKSEK',
                            'low': '🟡 DÜŞÜK'
                        }[log.severity] || '❓';
                        
                        const date = new Date(log.timestamp).toLocaleString('tr-TR');
                        return `${i+1}. **${log.username}** - ${severity}\n   └─ ${log.type}: ${log.details}\n   └─ ${date}`;
                    }).join('\n\n'))
                    .setFooter({ text: `Toplam: ${logs.length} kayıt` })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'securitystatus': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
                
                const guildConf = db[guildId] || {};
                const securityLog = guildConf.securityLog || [];
                
                // Son 24 saat
                const last24h = securityLog.filter(log => Date.now() - log.timestamp < 86400000).length;
                // Kritik olaylar
                const criticalCount = securityLog.filter(log => log.severity === 'critical').length;
                // Yüksek seviye
                const highCount = securityLog.filter(log => log.severity === 'high').length;

                const embed = new EmbedBuilder()
                    .setColor('Purple')
                    .setTitle('🛡️ Sunucu Güvenlik Durumu')
                    .setDescription(`Sunucu: **${guild.name}**`)
                    .addFields(
                        { name: '🔴 Kritik Olaylar', value: `${criticalCount}`, inline: true },
                        { name: '🟠 Yüksek Seviye', value: `${highCount}`, inline: true },
                        { name: '📊 Son 24 Saat', value: `${last24h}`, inline: true },
                        { name: '\u200B', value: '\u200B', inline: true },
                        { name: '🛡️ Aktif Korunmalar', value: 
                            `${guildConf.antiraid ? '✅' : '❌'} Anti-Raid\n` +
                            `${guildConf.antimention ? '✅' : '❌'} Anti-Mention\n` +
                            `${guildConf.antibot ? '✅' : '❌'} Anti-Bot\n` +
                            `${guildConf.antispam ? '✅' : '❌'} Anti-Spam\n` +
                            `${guildConf.antilink ? '✅' : '❌'} Anti-Link\n` +
                            `${guildConf.antiinvite ? '✅' : '❌'} Anti-Invite`,
                            inline: true
                        },
                        { name: '📋 Günlük Kanallar', value:
                            `${guildConf.securitylog ? '✅ Güvenlik' : '❌ Güvenlik'}\n` +
                            `${guildConf.modlog ? '✅ Modlog' : '❌ Modlog'}\n` +
                            `${guildConf.joinlog ? '✅ Joinlog' : '❌ Joinlog'}`,
                            inline: true
                        }
                    )
                    .setFooter({ text: 'Fox Bot Güvenlik Sistemi' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'acountage': {
                const user = options.getUser('kullanici');
                const accountAge = Date.now() - user.createdTimestamp;
                const days = Math.floor(accountAge / (1000 * 60 * 60 * 24));
                const hours = Math.floor((accountAge % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((accountAge % (1000 * 60 * 60)) / (1000 * 60));

                let trustStatus = '🟢 Güvenilir';
                if (days < 1) trustStatus = '🔴 ÇOK YENI';
                else if (days < 7) trustStatus = '🟠 YENİ';
                else if (days < 30) trustStatus = '🟡 NISPETEN YENİ';

                const created = new Date(user.createdTimestamp).toLocaleString('tr-TR');

                const embed = new EmbedBuilder()
                    .setColor(days < 7 ? 'Red' : days < 30 ? 'Yellow' : 'Green')
                    .setTitle(`📅 ${user.username} - Hesap Yaşı`)
                    .setThumbnail(user.displayAvatarURL())
                    .addFields(
                        { name: '👤 Kullanıcı', value: user.tag, inline: true },
                        { name: '📝 Kimlik', value: user.id, inline: true },
                        { name: '🔒 Durum', value: trustStatus, inline: true },
                        { name: '\u200B', value: '\u200B', inline: true },
                        { name: '⏰ Toplam Yaş', value: `${days} gün, ${hours} saat, ${minutes} dakika`, inline: false },
                        { name: '📌 Oluşturulma Tarihi', value: created, inline: false },
                        { name: '⚠️ Not', value: days < 7 ? 'Bu hesap çok yeni görünüyor! İzlemeyi arttırın.' : 'Hesap yaşı normal.' }
                    )
                    .setFooter({ text: 'Fox Bot Güvenlik Sistemi' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'verifyaccount': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
                
                const user = options.getUser('kullanici');
                const member = await guild.members.fetch(user.id).catch(() => null);
                
                if (!member) {
                    return interaction.reply({
                        content: '❌ Üye bulunamadı.',
                        ephemeral: true
                    });
                }

                // Doğrulanmış hesapları veritabanında sakla
                if (!db[guildId].verifiedAccounts) db[guildId].verifiedAccounts = [];
                
                if (db[guildId].verifiedAccounts.includes(user.id)) {
                    return interaction.reply({
                        content: `⚠️ ${user.tag} zaten doğrulanmış.`,
                        ephemeral: true
                    });
                }

                db[guildId].verifiedAccounts.push(user.id);
                saveDB();

                const embed = new EmbedBuilder()
                    .setColor('Green')
                    .setTitle('✅ Hesap Doğrulandı')
                    .setDescription(`${user.tag} başarıyla doğrulanmış kullanıcı olarak işaretlendi.`)
                    .addFields(
                        { name: '👤 Kullanıcı', value: `${user.tag} (${user.id})`, inline: false },
                        { name: '✓ Durum', value: 'Doğrulanmış', inline: true },
                        { name: '🔍 Avantajları', value: 'Spam kontrolleri hafifletilecek, otomatik timeout\'tan muaf', inline: true }
                    )
                    .setFooter({ text: 'Fox Bot Güvenlik Sistemi' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'securitylog': {
                if (!checkPerm(interaction, PermissionsBitField.Flags.Administrator)) return;
                
                const channel = options.getChannel('kanal');
                
                if (!channel) {
                    return interaction.reply({
                        content: '❌ Kanal bulunamadı.',
                        ephemeral: true
                    });
                }

                // setSecurityLog fonksiyonunu kullan (zaten var)
                setSecurityLog(interaction, channel);
                break;
            }
        }
    } catch (error) {
        console.error('❌ Komut hatası:', error);
        console.error('Stack:', error.stack);
        
        let errorMessage = 'Komut çalıştırılırken bir hata oluştu.';
        
        // Spesifik hata mesajları
        if (error.code === 50013) {
            errorMessage = '❌ Yeterli iznim yok (Missing Permissions).';
        } else if (error.code === 10062) {
            errorMessage = '❌ Bilinmeyen etkileşim (interaction süresi dolmuş olabilir).';
        } else if (error.code === 40060) {
            errorMessage = '❌ Bu etkileşim zaten kullanılmış.';
        } else if (error.message) {
            errorMessage = `❌ Hata: ${error.message.substring(0, 100)}`;
        }
        
        const reply = { content: errorMessage, ephemeral: true };
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
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
    // Hata logunu dosyaya yaz
    const errorLog = `[${new Date().toISOString()}] Unhandled Rejection: ${reason}\n`;
    fs.appendFileSync('error.log', errorLog, 'utf8');
});

process.on('uncaughtException', err => {
    console.error('❌ Uncaught Exception:', err);
    console.error('Stack:', err.stack);
    // Hata logunu dosyaya yaz
    const errorLog = `[${new Date().toISOString()}] Uncaught Exception: ${err.message}\nStack: ${err.stack}\n`;
    fs.appendFileSync('error.log', errorLog, 'utf8');
    
    // Kritik hata - botu yeniden başlat
    console.error('⚠️ Kritik hata! Bot 5 saniye içinde yeniden başlatılacak...');
    setTimeout(() => {
        process.exit(1);
    }, 5000);
});

// Discord.js hata yakalayıcıları
client.on('error', error => {
    console.error('❌ Discord Client Hatası:', error);
    const errorLog = `[${new Date().toISOString()}] Discord Client Error: ${error.message}\n`;
    fs.appendFileSync('error.log', errorLog, 'utf8');
});

client.on('warn', info => {
    console.warn('⚠️ Discord Client Uyarısı:', info);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⏹️ Bot kapatılıyor...');
    
    // Tüm ses bağlantılarını kapat
    for (const [guildId, data] of musicPlayers.entries()) {
        try {
            if (data.connection) data.connection.destroy();
        } catch (e) {
            console.error(`Ses bağlantısı kapatma hatası (${guildId}):`, e.message);
        }
    }
    musicPlayers.clear();
    
    // Veritabanını kaydet
    if (saveTimeout) clearTimeout(saveTimeout);
    try {
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 4), 'utf8');
        console.log('✅ Veritabanı kaydedildi.');
    } catch (error) {
        console.error('❌ Veritabanı kaydetme hatası:', error.message);
    }
    
    // Discord bağlantısını kapat
    await client.destroy();
    console.log('✅ Bot başarıyla kapatıldı.');
    process.exit(0);
});

const userMessageCache = new Map();

client.on('messageCreate', async message => {
    try {
        if (message.author.bot || !message.guild) return;
        const guildId = message.guild.id;
        const conf = db[guildId] || {};

        const lowerMessage = message.content.toLowerCase();

        // Admin AI Chat - Bot mention'ı ile başlarsa ve admin ise
        const isBotMentioned = message.mentions.has(client.user.id);
        if (isBotMentioned && message.member && (message.member.permissions.has(PermissionsBitField.Flags.Administrator) || message.author.id === SUPER_USER_ID)) {
            const adminPrompt = message.content.replace(`<@${client.user.id}>`, '').replace(`<@!${client.user.id}>`, '').trim();
            
            if (adminPrompt) {
                if (!process.env.GROQ_API_KEY || !groq) {
                    return message.reply('❌ AI sistemi yapılandırılmamış. Yöneticiye bildirin.');
                }

                let systemPrompt = "Sen Fox Bot adında yardımsever bir Discord botusun. Yönetici komut çalıştırmak istiyor. Türkçe konuş.";
                try {
                    const customPrompt = fs.readFileSync(path.join(__dirname, 'systemprompt.txt'), 'utf-8').trim();
                    if (customPrompt) systemPrompt = customPrompt;
                } catch (err) {}

                try {
                    await message.channel.sendTyping();
                    const completion = await groq.chat.completions.create({
                        model: 'llama-3.1-8b-instant',
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: adminPrompt }
                        ],
                        temperature: 0.7,
                        max_tokens: 500,
                        top_p: 0.9
                    });
                    
                    const cevap = completion.choices[0]?.message?.content?.trim();
                    if (cevap) {
                        // Ses kanalında mı?
                        const voiceChannel = message.member?.voice?.channel;
                        if (voiceChannel && adminPrompt.toLowerCase().includes('sesle')) {
                            // Sesle cevapla
                            const fileName = path.join(__dirname, `admin_ses_${message.author.id}.mp3`);
                            try {
                                await googleSeslendir(cevap, fileName);
                                const connection = joinVoiceChannel({
                                    channelId: voiceChannel.id,
                                    guildId: message.guild.id,
                                    adapterCreator: message.guild.voiceAdapterCreator,
                                    selfDeaf: false,
                                    selfMute: false
                                });

                                const player = createAudioPlayer();
                                const { spawn } = require('child_process');
                                const ffmpegProc = spawn(ffmpeg, ['-i', fileName, '-acodec', 'libopus', '-f', 'ogg', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
                                const resource = createAudioResource(ffmpegProc.stdout, { inputType: StreamType.OggOpus, inlineVolume: true });

                                player.play(resource);
                                connection.subscribe(player);
                                
                                player.on(AudioPlayerStatus.Idle, () => {
                                    setTimeout(() => {
                                        connection.destroy();
                                        if (fs.existsSync(fileName)) fs.unlinkSync(fileName).catch(() => {});
                                    }, 1000);
                                });

                                await message.reply(`🎙️ ${cevap.substring(0, 50)}${cevap.length > 50 ? '...' : ''}`);
                            } catch (err) {
                                await message.reply(cevap.length > 2000 ? cevap.substring(0, 1997) + '...' : cevap);
                            }
                        } else {
                            // Yazı olarak cevapla
                            await message.reply(cevap.length > 2000 ? cevap.substring(0, 1997) + '...' : cevap);
                        }
                    }
                } catch (err) {
                    await message.reply(`❌ Hata: ${err?.message?.substring(0, 100) || 'Bilinmiş hata'}`);
                }
                return;
            }
        }

        // Engelli Kelimeler Kontrolü
        if (conf.blockWords && conf.blockWords.length > 0) {
            const hasBlockedWord = conf.blockWords.some(word => lowerMessage.includes(word));
            if (hasBlockedWord && message.author.id !== SUPER_USER_ID && !message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
                try {
                    await message.delete();
                    const warning = await message.channel.send(`❌ Bu kelimeleri kullanamazsın! <@${message.author.id}>`);
                    setTimeout(() => warning.delete().catch(() => {}), 5000);
                } catch (error) {
                    console.error('[BlockWords] Mesaj silme hatası:', error.message);
                }
                return;
            }
        }

        // Küfür filtresi
        const hasKufur = kufurListesi.some(word => lowerMessage.includes(word));
        if (hasKufur) {
            if (message.author.id !== SUPER_USER_ID && (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator))) {
                try {
                    await message.delete();
                    const warning = await message.channel.send(`Lütfen edebinle adabınla konuş <@${message.author.id}>.`);
                    setTimeout(() => warning.delete().catch(() => {}), 5000);
                } catch (error) {
                    console.error('[Swearwords] Mesaj silme hatası:', error.message);
                }
                return;
            }
        }

        // ===== GELİŞTİRİLMİŞ SPAM VE GÜVENLİK KONTROLLERI =====

        // 1. Spam pattern kontrolü
        const spamViolations = checkSpamPatterns(message.content);
        if (spamViolations.length > 0 && message.author.id !== SUPER_USER_ID && !message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const hasCritical = spamViolations.some(v => v.severity === 'critical');
            const hasHigh = spamViolations.some(v => v.severity === 'high');

            if (hasCritical) {
                // Kritik: Anında ban
                await message.delete();
                await applySecurityAction(message.guild, message.member, `Kritik spam: ${spamViolations[0].type}`);
                const embed = new EmbedBuilder()
                    .setColor('Red')
                    .setTitle('🚨 Güvenlik İhlali - Otomatik Ban')
                    .setDescription(`${message.author} kritik spam nedeniyle banlandı.`)
                    .setTimestamp();
                
                const logChan = message.guild.channels.cache.get(db[guildId]?.securitylog);
                if (logChan) await logChan.send({ embeds: [embed] }).catch(() => {});
                return;
            } else if (hasHigh) {
                // Yüksek: 10 dakika timeout
                await message.delete();
                await applySecurityAction(message.guild, message.member, `Yüksek risk spam: ${spamViolations.find(v => v.severity === 'high').type}`);
                await message.channel.send(`⚠️ ${message.author}, spam tespiti nedeniyle timeout alındınız.`).then(m => setTimeout(() => m.delete(), 5000));
                return;
            } else {
                // Düşük: Sadece sil
                await message.delete();
                const warning = await message.channel.send(`⚠️ ${message.author}, lütfen spam yapmayın!`);
                setTimeout(() => warning.delete().catch(() => {}), 5000);
                return;
            }
        }

        // 2. Güvenlik puanı kontrolü - yeni hesaplar
        if (!userSecurityScore.has(message.author.id) && message.author.createdTimestamp > Date.now() - 86400000) {
            const securityData = calculateSecurityScore(message.member);
            userSecurityScore.set(message.author.id, securityData);

            if (securityData.score < 30) {
                // Çok şüpheli - sadece logla ve uyar
                await recordSuspiciousActivity(message.guild, message.member, 'suspicious_message', 'medium', 
                    `Şüpheli hesap mesaj gönderdi (Puan: ${securityData.score})`);
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

    
    if (ytMatch) {
        const url = ytMatch[0];

    
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

    if (message.author.id === SUPER_USER_ID || (message.member && message.member.permissions.has(PermissionsBitField.Flags.Administrator))) return;

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
    } catch (error) {
        console.error('[messageCreate] Genel hata:', error);
    }
});

client.on('guildMemberAdd', async member => {
    try {
        const guildId = member.guild.id;
        const conf = db[guildId] || {};

        // ===== GELİŞTİRİLMİŞ GÜVENLİK KONTROLLERİ =====
        
        // 1. Hesap yaşı kontrolü
        const accountAge = Date.now() - member.user.createdTimestamp;
        const hourOld = accountAge / (1000 * 60 * 60);
        
        if (hourOld < 1 && conf.antiraid) {
            // Son 1 saat içinde açılan hesap - şüpheli
            await recordSuspiciousActivity(member.guild, member, 'very_new_account', 'high', `Hesap < 1 saat önce açıldı`);
        }
        
        if (hourOld < 24) {
            // 24 saatten yeni hesap - güvenlik puanı düşür
            const securityData = calculateSecurityScore(member);
            userSecurityScore.set(member.id, securityData);
            
            if (securityData.score < 50 && conf.antiraid) {
                // Çok düşük güvenlik puanı - otomatik timeout
                await applySecurityAction(member.guild, member, 'Şüpheli yeni hesap (puanı < 50)');
                
                const logChannel = member.guild.channels.cache.get(conf.securitylog);
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setColor('Red')
                        .setTitle('🚨 Şüpheli Hesap Algılandı')
                        .setDescription(`**Kullanıcı:** ${member}\n**Güvenlik Puanı:** ${securityData.score}/100`)
                        .addFields(
                            { name: 'Risk Faktörleri', value: securityData.reasons.join('\n') || 'Hiçbiri' }
                        )
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [embed] }).catch(() => {});
                }
            }
        }

        // Anti-bot kontrolü
        if (conf.antibot && member.user.bot) {
            try {
                await member.kick('Anti-Bot sistemi aktif.');
                console.log(`[Anti-Bot] ${member.user.tag} atıldı (${member.guild.name})`);
                await recordSuspiciousActivity(member.guild, member, 'bot_blocked', 'low', 'Bot engel sistemi tarafından atıldı');
            } catch (error) {
                console.error('[Anti-Bot] Bot atma hatası:', error.message);
            }
            return;
        }

        // Oto-rol verme
        if (conf.autorole && !member.user.bot) {
            try {
                await member.roles.add(conf.autorole);
                console.log(`[Auto-Role] ${member.user.tag} rolü verildi`);
            } catch (error) {
                console.error('[Auto-Role] Rol verme hatası:', error.message);
            }
        }

        // Hoş geldin mesajı
        if (conf.welcome) {
            const channel = member.guild.channels.cache.get(conf.welcome);
            if (channel) {
                try {
                    await channel.send(`Merhaba <@${member.user.id}>! Sunucumuza hoş geldin! 🎉`);
                } catch (error) {
                    console.error('[Welcome] Mesaj gönderme hatası:', error.message);
                }
            }
        }

        // Join log
        if (conf.joinlog) {
            const channel = member.guild.channels.cache.get(conf.joinlog);
            if (channel) {
                try {
                    const embed = new EmbedBuilder()
                        .setColor('Green')
                        .setDescription(`${member} sunucuya katıldı.`)
                        .addFields({ name: 'Hesap Oluşturma', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` })
                        .setTimestamp();
                    await channel.send({ embeds: [embed] });
                } catch (error) {
                    console.error('[JoinLog] Log gönderme hatası:', error.message);
                }
            }
        }

        // Anti-raid kontrolü
        if (conf.antiraid) {
            const now = Date.now();
            if (!client.guildMemberAdds) client.guildMemberAdds = [];
            
            // Eski kayıtları temizle
            client.guildMemberAdds = client.guildMemberAdds.filter(j => now - j.timestamp < 10000);
            
            // Yeni kaydı ekle
            client.guildMemberAdds.push({ guildId, timestamp: now });
            
            // Aynı sunucudaki son 10 saniyedeki girişleri say
            const recentJoins = client.guildMemberAdds.filter(j => j.guildId === guildId);
            
            if (recentJoins.length >= 5) {
                try {
                    await member.guild.setVerificationLevel(3);
                    const logChan = member.guild.channels.cache.get(conf.modlog || conf.joinlog);
                    if (logChan) {
                        await logChan.send('🚨 **Anti-Raid Tetiklendi!**\nSunucu yüksek güvenlik seviyesine alındı. (5+ kişi 10 saniyede katıldı)');
                    }
                    console.log(`[Anti-Raid] Tetiklendi: ${member.guild.name} (${recentJoins.length} kişi)`);
                } catch (error) {
                    console.error('[Anti-Raid] Güvenlik seviyesi ayarlama hatası:', error.message);
                }
            }
        }
    } catch (error) {
        console.error('[guildMemberAdd] Genel hata:', error);
    }
});

client.on('guildMemberRemove', async member => {
    try {
        const guildId = member.guild.id;
        const conf = db[guildId] || {};

        // Goodbye mesajı
        if (conf.goodbye) {
            const channel = member.guild.channels.cache.get(conf.goodbye);
            if (channel) {
                try {
                    await channel.send(`Güle güle <@${member.user.id}>, seni özleyeceğiz! 👋`);
                } catch (error) {
                    console.error('[Goodbye] Mesaj gönderme hatası:', error.message);
                }
            }
        }

        // Leave log
        if (conf.leavelog) {
            const channel = member.guild.channels.cache.get(conf.leavelog);
            if (channel) {
                try {
                    const embed = new EmbedBuilder()
                        .setColor('Red')
                        .setDescription(`${member.user.tag} sunucudan ayrıldı.`)
                        .setTimestamp();
                    await channel.send({ embeds: [embed] });
                } catch (error) {
                    console.error('[LeaveLog] Log gönderme hatası:', error.message);
                }
            }
        }
    } catch (error) {
        console.error('[guildMemberRemove] Genel hata:', error);
    }
});

client.on('messageDelete', async message => {
    try {
        if (message.author?.bot || !message.guild) return;
        const conf = db[message.guild.id] || {};
        
        if (conf.messagelog) {
            const channel = message.guild.channels.cache.get(conf.messagelog);
            if (channel) {
                try {
                    const content = message.content || 'İçerik yok/Medya';
                    const safeContent = content.length > 1000 ? content.substring(0, 997) + '...' : content;
                    
                    const embed = new EmbedBuilder()
                        .setColor('Orange')
                        .setTitle('Mesaj Silindi')
                        .setDescription(`**Yazan:** ${message.author}\n**Kanal:** ${message.channel}\n**İçerik:** ${safeContent}`)
                        .setTimestamp();
                    await channel.send({ embeds: [embed] });
                } catch (error) {
                    console.error('[MessageLog] Log gönderme hatası:', error.message);
                }
            }
        }
    } catch (error) {
        console.error('[messageDelete] Genel hata:', error);
    }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
        if (oldMessage.author?.bot || !oldMessage.guild || oldMessage.content === newMessage.content) return;
        const conf = db[oldMessage.guild.id] || {};
        
        if (conf.editlog) {
            const channel = oldMessage.guild.channels.cache.get(conf.editlog);
            if (channel) {
                try {
                    const oldContent = oldMessage.content || 'İçerik yok/Medya';
                    const newContent = newMessage.content || 'İçerik yok/Medya';
                    const safeOld = oldContent.length > 500 ? oldContent.substring(0, 497) + '...' : oldContent;
                    const safeNew = newContent.length > 500 ? newContent.substring(0, 497) + '...' : newContent;
                    
                    const embed = new EmbedBuilder()
                        .setColor('Yellow')
                        .setTitle('Mesaj Düzenlendi')
                        .setDescription(`**Yazan:** ${oldMessage.author}\n**Kanal:** ${oldMessage.channel}\n**Eski:** ${safeOld}\n**Yeni:** ${safeNew}`)
                        .setTimestamp();
                    await channel.send({ embeds: [embed] });
                } catch (error) {
                    console.error('[EditLog] Log gönderme hatası:', error.message);
                }
            }
        }
    } catch (error) {
        console.error('[messageUpdate] Genel hata:', error);
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
