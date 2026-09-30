const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { LOG_FILE } = require('../utils/logger');
const storage = require('../utils/storage');
const ordersDb = require('../data/orders');
const backup = require('../utils/backup');

function register(bot) {
  // 🌟 Ежедневный бэкап в 3:00 по Москве (архив)
  cron.schedule('0 3 * * *', async () => {
    const backupChatId = process.env.BACKUP_CHAT_ID || '-5433385765';
    console.log(`⏰ [${new Date().toLocaleString('ru-RU')}] Начинаю создание архива бэкапа...`);

    try {
      // Создаём архив
      const archiveInfo = await backup.createBackupArchive();
      const sizeMB = archiveInfo.size / (1024 * 1024);

      // Проверяем лимит размера
      if (sizeMB > 49) {
        console.warn(`⚠️ Архив слишком большой (${sizeMB.toFixed(1)} МБ), отправляю файлы по отдельности...`);
        fs.unlinkSync(archiveInfo.path);
        await sendFilesIndividually(bot, backupChatId);
        return;
      }

      // Отправляем заголовок
      await bot.telegram.sendMessage(
        backupChatId,
        `📦 *Ежедневный бэкап данных (архив)*\n📅 ${new Date().toLocaleDateString('ru-RU')}\n💾 *Размер:* ${sizeMB.toFixed(2)} МБ`,
        { parse_mode: 'Markdown' }
      );

      // Отправляем архив
      await bot.telegram.sendDocument(
        backupChatId,
        { source: fs.createReadStream(archiveInfo.path), filename: archiveInfo.name },
        { caption: `📁 ${archiveInfo.name}` }
      );

      console.log(`✅ Бэкап отправлен: ${archiveInfo.name}`);

      // Удаляем временный архив
      fs.unlinkSync(archiveInfo.path);
    } catch (err) {
      console.error('❌ Ошибка создания бэкапа:', err.message);
      try {
        await bot.telegram.sendMessage(backupChatId, `🚨 *Ошибка бэкапа!*\n\`${err.message}\``, { parse_mode: 'Markdown' });
      } catch (e) { /* ignore */ }
    }
  }, { timezone: 'Europe/Moscow' });

  // 🌟 Запасной вариант: отправка файлов по отдельности (если архив слишком большой)
  async function sendFilesIndividually(bot, backupChatId) {
    const dataDir = path.join(__dirname, '../data');
    const files = [
      { name: 'catalog.json', path: path.join(dataDir, 'catalog.json') },
      { name: 'loyalty.json', path: path.join(dataDir, 'loyalty.json') },
      { name: 'orders.json', path: path.join(dataDir, 'orders.json') },
      { name: 'bot_events.jsonl', path: LOG_FILE },
    ];

    await bot.telegram.sendMessage(
      backupChatId,
      `📦 *Ежедневный бэкап данных (файлы)*\n📅 ${new Date().toLocaleDateString('ru-RU')}`,
      { parse_mode: 'Markdown' }
    );

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
      }
    }
    console.log('✅ Бэкап завершён (файлы по отдельности)!');
  }

  // 🌟 Ежедневная очистка данных старше 180 дней (в 3:30 ночи)
  cron.schedule('30 3 * * *', async () => {
    console.log('🧹 Запуск плановой очистки хранилища...');
    try {
      const result = await storage.cleanupOldOrders(ordersDb, 180);
      if (result.deletedCount > 0) {
        console.log(`🧹 Очищено заказов: ${result.deletedCount}`);
      }
      // Проверяем свободное место на диске
      const stats = storage.getStorageStats();
      if (stats && parseFloat(stats.freeDiskGB) < 1) {
        const supportChatId = process.env.SUPPORT_CHAT_ID;
        if (supportChatId) {
          await bot.telegram.sendMessage(
            supportChatId,
            `⚠️ *ВНИМАНИЕ!* На сервере заканчивается место!\n` +
            `🆓 Свободно: ${stats.freeDiskGB} ГБ из ${stats.totalDiskGB} ГБ\n` +
            `Зайдите в Админ-панель → Хранилище данных и проведите очистку.`
          );
        }
      }
    } catch (err) {
      console.error('❌ Ошибка очистки хранилища:', err.message);
    }
  }, { timezone: 'Europe/Moscow' });

  console.log('⏰ Планировщик запущен: бэкап в 3:00 МСК, очистка хранилища в 3:30 МСК');
}

module.exports = { register };