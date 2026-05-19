const fs = require('fs');
const path = require('path');

const dbPath = './db.json';

// Veritabanı yükleme
function loadDB() {
    if (fs.existsSync(dbPath)) {
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
    return {};
}

// Veritabanı kaydetme
function saveDB(db) {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 4));
}

/**
 * Kullanıcının yetkisini kontrol et
 * @param {string} userId - Kullanıcı ID'si
 * @param {string} guildId - Sunucu ID'si
 * @param {string} permission - Kontrol edilecek yetki
 * @returns {object} Yetki sonucu
 */
function checkPermission(userId, guildId, permission) {
    const db = loadDB();
    
    // Bot yöneticileri
    const botAdmins = db.botAdmins || [];
    const isBotAdmin = botAdmins.includes(userId);

    // Sunucu admini
    const guildData = db[guildId] || {};
    const serverAdmins = guildData.admins || [];
    const isServerAdmin = serverAdmins.includes(userId);

    // Moderatörler
    const moderators = guildData.moderators || [];
    const isModerator = moderators.includes(userId);

    return {
        isBotAdmin,
        isServerAdmin,
        isModerator,
        canModerate: isBotAdmin || isServerAdmin || isModerator,
        permissions: {
            mute: isBotAdmin || isServerAdmin || isModerator,
            kick: isBotAdmin || isServerAdmin || isModerator,
            ban: isBotAdmin || isServerAdmin,
            warn: isBotAdmin || isServerAdmin || isModerator,
            blockword: isBotAdmin || isServerAdmin,
            editLog: isBotAdmin || isServerAdmin,
            deleteAdminPanel: isBotAdmin,
            addBotAdmin: isBotAdmin
        }
    };
}

/**
 * Bot yöneticisi ekle
 * @param {string} userId - Eklenecek kullanıcı ID'si
 */
function addBotAdmin(userId) {
    const db = loadDB();
    if (!db.botAdmins) db.botAdmins = [];
    if (!db.botAdmins.includes(userId)) {
        db.botAdmins.push(userId);
        saveDB(db);
        return { success: true, message: `✅ ${userId} Bot Yöneticisi yapıldı.` };
    }
    return { success: false, message: `⚠️ ${userId} zaten Bot Yöneticisi.` };
}

/**
 * Bot yönetticisini kaldır
 * @param {string} userId - Kaldırılacak kullanıcı ID'si
 */
function removeBotAdmin(userId) {
    const db = loadDB();
    if (!db.botAdmins) db.botAdmins = [];
    const index = db.botAdmins.indexOf(userId);
    if (index > -1) {
        db.botAdmins.splice(index, 1);
        saveDB(db);
        return { success: true, message: `✅ ${userId}'nin Bot Yöneticisi statüsü kaldırıldı.` };
    }
    return { success: false, message: `⚠️ ${userId} Bot Yöneticisi değil.` };
}

/**
 * Sunucu admini ekle
 * @param {string} userId - Eklenecek kullanıcı ID'si
 * @param {string} guildId - Sunucu ID'si
 */
function addServerAdmin(userId, guildId) {
    const db = loadDB();
    if (!db[guildId]) db[guildId] = {};
    if (!db[guildId].admins) db[guildId].admins = [];
    if (!db[guildId].admins.includes(userId)) {
        db[guildId].admins.push(userId);
        saveDB(db);
        return { success: true, message: `✅ ${userId} Sunucu Yöneticisi yapıldı.` };
    }
    return { success: false, message: `⚠️ ${userId} zaten Sunucu Yöneticisi.` };
}

/**
 * Sunucu admini kaldır
 * @param {string} userId - Kaldırılacak kullanıcı ID'si
 * @param {string} guildId - Sunucu ID'si
 */
function removeServerAdmin(userId, guildId) {
    const db = loadDB();
    if (!db[guildId]) db[guildId] = {};
    if (!db[guildId].admins) db[guildId].admins = [];
    const index = db[guildId].admins.indexOf(userId);
    if (index > -1) {
        db[guildId].admins.splice(index, 1);
        saveDB(db);
        return { success: true, message: `✅ ${userId}'nin Sunucu Yöneticisi statüsü kaldırıldı.` };
    }
    return { success: false, message: `⚠️ ${userId} Sunucu Yöneticisi değil.` };
}

/**
 * Moderatör ekle
 * @param {string} userId - Eklenecek kullanıcı ID'si
 * @param {string} guildId - Sunucu ID'si
 */
function addModerator(userId, guildId) {
    const db = loadDB();
    if (!db[guildId]) db[guildId] = {};
    if (!db[guildId].moderators) db[guildId].moderators = [];
    if (!db[guildId].moderators.includes(userId)) {
        db[guildId].moderators.push(userId);
        saveDB(db);
        return { success: true, message: `✅ ${userId} Moderatör yapıldı.` };
    }
    return { success: false, message: `⚠️ ${userId} zaten Moderatör.` };
}

/**
 * Moderatörü kaldır
 * @param {string} userId - Kaldırılacak kullanıcı ID'si
 * @param {string} guildId - Sunucu ID'si
 */
function removeModerator(userId, guildId) {
    const db = loadDB();
    if (!db[guildId]) db[guildId] = {};
    if (!db[guildId].moderators) db[guildId].moderators = [];
    const index = db[guildId].moderators.indexOf(userId);
    if (index > -1) {
        db[guildId].moderators.splice(index, 1);
        saveDB(db);
        return { success: true, message: `✅ ${userId}'nin Moderatör statüsü kaldırıldı.` };
    }
    return { success: false, message: `⚠️ ${userId} Moderatör değil.` };
}

/**
 * Tüm yetkili listesi
 * @param {string} guildId - Sunucu ID'si
 */
function getAllPermissions(guildId) {
    const db = loadDB();
    const guildData = db[guildId] || {};
    
    return {
        botAdmins: db.botAdmins || [],
        serverAdmins: guildData.admins || [],
        moderators: guildData.moderators || [],
        totalAdmins: (db.botAdmins || []).length + (guildData.admins || []).length,
        totalModerators: (guildData.moderators || []).length
    };
}

module.exports = {
    checkPermission,
    addBotAdmin,
    removeBotAdmin,
    addServerAdmin,
    removeServerAdmin,
    addModerator,
    removeModerator,
    getAllPermissions,
    loadDB,
    saveDB
};
