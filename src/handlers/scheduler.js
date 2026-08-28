const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

function register(bot) {
  // 🌟 Ежедневная отправка файлов в 9:00 по Москве
  cron.schedule('0 9 * * *', async () => {
    const backupChatId = process.env.BACKUP_CHAT_ID || '-5433385765';
    const dataDir = path.join(__dirname, '../data');

    const files = [
      { name: 'catalog.json', path: path.join(dataDir, 'catalog.json') },
      { name: 'loyalty.json', path: path.join(dataDir, 'loyalty.json') },
      { name: 'orders.json', path: path.join(dataDir, 'orders.json') },
    ];

    console.log(`⏰ [${new Date().toLocaleString('ru-RU')}] Начинаю отправку бэкапов...`);

    try {
      await bot.telegram.sendMessage(backupChatId, `📦 *Ежедневный бэкап данных*\n📅 ${new Date().toLocaleDateString('ru-RU')}`, { parse_mode: 'Markdown' });

      for (const file of files) {
        if (fs.existsSync(file.path)) {
          const stats = fs.statSync(file.path);
          const sizeKB = (stats.size / 1024).toFixed(1);
          
          await bot.telegram.sendDocument(backupChatId, {
            source: fs.createReadStream(file.path),
            filename: file.name
          }, {
            caption: `📄 ${file.name} (${sizeKB} КБ)`
          });

          console.log(`  ✅ Отправлен: ${file.name}`);
        } else {
          console.log(`  ⚠️ Файл не найден: ${file.name}`);
        }
      }

      console.log('  ✅ Бэкап завершён!');
    } catch (err) {
      console.error('  ❌ Ошибка отправки бэкапа:', err.message);
    }
  }, {
    timezone: 'Europe/Moscow' // 🌟 Важно: время по Москве
  });

  console.log('⏰ Планировщик бэкапов запущен (ежедневно в 9:00 МСК)');
}

module.exports = { register };