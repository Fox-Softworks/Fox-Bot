GÜNCELLEME YAPILDI
# Fox Bot Dökümantasyonu

![Fox Bot Logo](logo.png)

**Fox Bot**, Discord sunucuları için gelişmiş moderasyon, güvenlik, eğlence ve yapay zeka destekli seslendirme özellikleri sunan bir bottur. Tamamen slash (/) komutları ile çalışır, prefix gerektirmez.

![Status](https://img.shields.io/badge/status-stable-green) ![Node.js](https://img.shields.io/badge/node-%3E%3D16.9.0-brightgreen) ![Discord.js](https://img.shields.io/badge/discord.js-v14-blue)

---

## 📌 Özellikler

- **Moderasyon**: Mute, unmute, kick, ban, mesaj silme (purge/clear)
- **Güvenlik**: Anti-spam, anti-link, anti-invite, anti-mention, caps limit, anti-bot, anti-raid
- **Loglama**: Moderasyon işlemleri, üye giriş/çıkış, mesaj silme/düzenleme, rol ve kanal değişiklikleri
- **Rol Yönetimi**: Rol ekleme/çıkarma, rol bahsedilebilirliğini kapatma, otomatik rol (autorole)
- **Bilgi Komutları**: Kullanıcı bilgisi, rol bilgisi, sunucu bilgisi, avatar ve banner görüntüleme
- **Sistem Kurulumu**: Ticket sistemi, doğrulama (kayıt) sistemi, hoş geldin/görüşürüz mesajları
- **Otomatik Sunucu Kurulumu**: `/sunucukur` komutu ile roller ve kanallar otomatik oluşturulur (genel/oyun teması)
- **Seslendirme (TTS)**: ElevenLabs API ile yazılan metinleri ses kanalında okuma
- **AI Sohbet**: Groq API (llama-3.1-8b-instant) ile "fox bot" ile başlayan mesajlara akıllı yanıt verme
- **Eğlence**: Taş-kağıt-makas oyunu, motivasyon sözleri

---

## 🛠 Gereksinimler

- **Node.js** v16.9.0 veya üzeri ([indir](https://nodejs.org/))
- **Discord Bot Token** ([Discord Developer Portal](https://discord.com/developers/applications))
- **ElevenLabs API Anahtarı** ([ElevenLabs](https://elevenlabs.io/))
- **Groq API Anahtarı** (AI sohbet için, opsiyonel)
- **npm** (Node.js ile gelir)

---

## 📦 Kurulum

### 1. Projeyi indirin

```bash
git clone https://github.com/MustafaDevloper/FoxBot.git
cd FoxBot
```

### 2. Bağımlılıkları yükleyin

```bash
npm install
```

Bu işlem `discord.js`, `@discordjs/voice`, `elevenlabs-node`, `groq-sdk`, `dotenv` gibi gerekli paketleri yükler.

### 3. `.env` dosyasını oluşturun

Proje kök dizininde `.env` adlı bir dosya oluşturun ve aşağıdaki bilgileri girin:

```env
TOKEN="DISCORD_BOT_TOKENINIZ"
CLIENT_ID="BOTUNUZUN_CLIENT_ID_SI"
GROQ_API_KEY="GROQ_API_ANAHTARINIZ"    # (Opsiyonel)
ELEVEN_API_KEY="ELEVENLABS_API_ANAHTARINIZ"
```

- **TOKEN**: Discord Bot Token'ınız (Developer Portal'dan kopyalayın).
- **CLIENT_ID**: Botunuzun uygulama ID'si (Developer Portal'da "General Information" kısmında bulunur).
- **GROQ_API_KEY**: AI sohbet özelliğini kullanmak isterseniz Groq'dan alın.
- **ELEVEN_API_KEY**: Seslendirme özelliği için ElevenLabs'dan alın.

---

## 🚀 Çalıştırma

Botu başlatmak için:

```bash
node index.js
```

Bot çalıştığında konsola `BotAdı olarak giriş yapıldı!` ve komutların yüklendiğine dair mesajlar gelir.

**Not**: Botu kalıcı olarak çalıştırmak için **PM2** kullanabilirsiniz:

```bash
npm install -g pm2
pm2 start index.js --name "FoxBot"
pm2 save
pm2 startup
```

---

## 📝 Komutlar

Tüm komutlar slash (`/`) komutlarıdır. Komut listesini `/yardim` ile görebilirsiniz.

### 🔹 Genel Komutlar

| Komut | Açıklama |
|-------|----------|
| `/yardim` | Tüm komutları listeler. |
| `/ping` | Botun gecikme süresini (ms) gösterir. |
| `/stats` | Sunucu sayısı, kullanıcı sayısı ve ping değerlerini gösterir. |
| `/uptime` | Botun ne kadar süredir aktif olduğunu gösterir (gün, saat, dakika, saniye). |
| `/shardinfo` | Shard bilgilerini gösterir (bot tek shard ile çalışır). |

---

### 🛡️ Moderasyon Komutları

| Komut | Açıklama |
|-------|----------|
| `/mute <kullanici> <sure> [sebep]` | Kullanıcıyı belirtilen dakika boyunca susturur. |
| `/unmute <kullanici>` | Kullanıcının susturmasını kaldırır. |
| `/kick <kullanici> [sebep]` | Kullanıcıyı sunucudan atar. |
| `/ban <kullanici> [sebep]` | Kullanıcıyı sunucudan yasaklar. |
| `/purge <miktar>` veya `/clear <miktar>` | Belirtilen sayıda (1-100) mesajı siler. |

---

### ℹ️ Bilgi Komutları

| Komut | Açıklama |
|-------|----------|
| `/avatar [kullanici]` | Kullanıcının profil fotoğrafını gösterir (büyük boy). |
| `/banner [kullanici]` | Kullanıcının afişini gösterir (varsa). |
| `/userinfo [kullanici]` | Kullanıcı hakkında detaylı bilgi (sunucuya katılma, hesap oluşturma, rolleri). |
| `/roleinfo <rol>` | Rol hakkında bilgi (ID, renk, üye sayısı, oluşturulma tarihi). |
| `/serverinfo` | Sunucu hakkında bilgi (sahip, üye sayısı, kanal/rol sayısı, boost seviyesi). |

---

### 🎭 Rol Komutları

| Komut | Açıklama |
|-------|----------|
| `/addrole <kullanici> <rol>` | Kullanıcıya rol verir. |
| `/removerole <kullanici> <rol>` | Kullanıcıdan rol alır. |
| `/lockrole <rol>` | Rolün bahsedilebilirliğini açar/kapatır. |
| `/autorole [rol]` | Sunucuya katılan yeni üyelere otomatik verilecek rolü ayarlar. Rol belirtilmezse otomatik rol kapatılır. |

---

### 📋 Log Sistemleri

| Komut | Açıklama |
|-------|----------|
| `/modlog <kanal>` | Moderasyon işlemlerinin (mute, ban, kick vb.) loglanacağı kanalı ayarlar. |
| `/leavelog <kanal>` | Üye çıkış log kanalını ayarlar. |
| `/joinlog <kanal>` | Üye giriş log kanalını ayarlar. |
| `/editlog <kanal>` | Mesaj düzenlenme log kanalını ayarlar. |
| `/messagelog <kanal>` | Mesaj silinme log kanalını ayarlar. |
| `/setlog <kanal>` | Yukarıdaki tüm log kanallarını aynı kanala ayarlar. |

---

### 🛡️ Güvenlik Sistemleri

| Komut | Açıklama |
|-------|----------|
| `/antimention <durum>` | Bir mesajda 5'ten fazla kişi etiketlenmesini engeller. |
| `/antiraid <durum>` | 10 saniye içinde 5'ten fazla üye girişi olduğunda sunucu güvenlik seviyesini yükseltir ve log gönderir. |
| `/antibot <durum>` | Sunucuya bot eklenmesini engeller (botlar otomatik atılır). |
| `/antilink <durum>` | Link paylaşımını engeller (http, https, www vb.). |
| `/antispam <durum>` | 5 saniyede 5 mesaj atan kullanıcının son 10 mesajını siler ve 5 dakika susturur. |
| `/antiinvite <durum>` | Discord davet linklerini engeller (discord.gg, discord.com/invite vb.). |
| `/capslimit <durum>` | Mesajdaki büyük harf oranı %70'i geçerse mesaj silinir. |

---

### ⚙️ Sistem ve Kurulum Komutları

| Komut | Açıklama |
|-------|----------|
| `/ticket_setup` | Ticket sistemi kurar. Belirtilen kanala butonlu bir mesaj gönderir, butona tıklayan kullanıcı için özel bir bilet kanalı oluşturur. |
| `/verification <verilecek_rol>` | Doğrulama (kayıt) sistemi kurar. Butona tıklayan kullanıcıya belirtilen rolü verir. |
| `/welcome <kanal>` | Hoş geldin mesajlarının gönderileceği kanalı ayarlar. |
| `/goodbye <kanal>` | Görüşürüz mesajlarının gönderileceği kanalı ayarlar. |
| `/sunucukur <tema>` | Sunucuyu otomatik olarak kurar. Roller, kategoriler ve kanallar oluşturur. **Temalar**: `genel` (Genel Topluluk) veya `oyun` (Oyun Sunucusu). |
| `/reset` | Sunucuya ait tüm ayarları sıfırlar (`db.json`'dan ilgili sunucunun verilerini siler). |

---

### ✨ Eğlence ve Diğer Komutlar

| Komut | Açıklama |
|-------|----------|
| `/motivasyon` | Rastgele bir motivasyon sözü gönderir. |
| `/tkm <secim>` | Taş, kağıt, makas oyunu oynar. Seçenekler: `tas`, `kagit`, `makas`. |
| `/mesaj <metin>` | Bot belirtilen metni kanala yazar. (Mesajları Yönet yetkisi gerekir) |
| `/selamla <kisi>` | Belirtilen kullanıcıyı selamlar. |
| `/seslendir <metin>` | Yazılan metni ElevenLabs ile seslendirir ve bulunduğunuz ses kanalında oynatır. |

---

### 🧠 AI Sohbet

`fox bot` ile başlayan mesajlara Groq API üzerinden yanıt verir.

**Örnek**:
```
fox bot merhaba, nasılsın?
```
Bot, sistem promptuna göre bir yanıt üretecektir.

**Not**: AI sohbet özelliği için `.env`'de `GROQ_API_KEY` tanımlı olmalı ve `systemprompt.txt` dosyası proje dizininde bulunmalıdır. Dosya yoksa varsayılan bir prompt kullanılır.

---

## 📂 Veritabanı (db.json)

Bot tüm sunucu ayarlarını `db.json` dosyasında saklar. Dosya yoksa otomatik oluşturulur.

**Örnek yapı**:
```json
{
  "123456789012345678": {
    "autorole": "987654321098765432",
    "modlog": "123456789012345678",
    "leavelog": "123456789012345678",
    "joinlog": "123456789012345678",
    "editlog": "123456789012345678",
    "messagelog": "123456789012345678",
    "welcome": "123456789012345678",
    "goodbye": "123456789012345678",
    "verificationRole": "987654321098765432",
    "antimention": true,
    "antiraid": false,
    "antibot": true,
    "antilink": true,
    "antispam": true,
    "antiinvite": true,
    "capslimit": false
  }
}
```

---

## 📝 Loglama Detayları

Bot aşağıdaki olayları otomatik olarak loglar (log kanalı ayarlanmışsa):

- **Moderasyon işlemleri** (mute, unmute, kick, ban) → `/modlog`
- **Üye girişi** → `/joinlog`
- **Üye çıkışı** → `/leavelog`
- **Mesaj silinmesi** → `/messagelog`
- **Mesaj düzenlenmesi** → `/editlog`
- **Rol oluşturulması/silinmesi** → `/modlog` veya `/messagelog` (hangisi ayarlanmışsa)
- **Kanal silinmesi** → `/modlog` veya `/messagelog`
- **Rol eklenmesi/alınması** → `/modlog` veya `/messagelog`

Log mesajları embed olarak gönderilir ve moderasyon işlemlerinde sebep 1024 karakterden uzunsa kesilir, tam hali ayrı bir mesajda eklenir.

---

## 🎤 Seslendirme (TTS) Nasıl Çalışır?

`/seslendir <metin>` komutu kullanıldığında:

1. ElevenLabs API'ye istek gönderilir ve metin MP3 dosyası olarak oluşturulur.
2. Bot kullanıcının bulunduğu ses kanalına bağlanır.
3. Oluşturulan ses dosyası çalınır.
4. Ses bitince bot kanaldan ayrılır ve geçici dosya silinir.

**Not**: ElevenLabs API anahtarınızın geçerli ve yeterli kredisi olduğundan emin olun.

---

## 🔧 Özel Ayarlar ve Dosyalar

### `systemprompt.txt`
AI sohbet özelliğinde kullanılan sistem prompt'unu içerir. İsteğe göre düzenleyebilirsiniz. Örnek içerik:

```
Sen Fox Bot adında yardımsever bir Discord botusun. Kullanıcılara kibar ve yardımcı bir şekilde cevap ver.
```

### `db.json`
Veritabanı dosyası. Elle müdahale etmeden önce botu durdurun.

---

## 🧪 Test ve Hata Ayıklama

Bot çalışırken konsolda çıkan hataları inceleyin. Yaygın sorunlar:

- **"Groq SDK yüklü değil"** → `groq-sdk` paketi yüklenmemiş, `npm install groq-sdk` ile yükleyin.
- **"ElevenLabs hatası"** → API anahtarınızı kontrol edin, ElevenLabs hesabınızda kredi olup olmadığını kontrol edin.
- **"DiscordAPIError[50001]: Missing Access"** → Botun ilgili kanal veya role erişim yetkisi yok, yetkileri kontrol edin.
- **Komutlar görünmüyor** → Botu sunucuya eklerken `applications.commands` yetkisi verdiğinizden emin olun. Komutların yüklenmesi birkaç dakika sürebilir.

---

## 📄 Lisans

Bu proje açık kaynaklıdır. Detaylar için `LICENSE` dosyasına bakın.

---

## 👨‍💻 Geliştirici

**MustafaDev / Fox Software**

Projeye katkıda bulunmak için pull request gönderebilir, hata bildirimlerini Issues kısmından iletebilirsiniz.

---

## 📞 Destek

Sorularınız için Discord sunucumuza katılın: [Discord Bağlantısı](https://discord.gg/mYq23y5GAR)

---

*Son Güncelleme: Mayıs 2026*
