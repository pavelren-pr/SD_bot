const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const BACKUP_TEMP_DIR = process.env.BACKUP_TEMP_DIR || path.join(__dirname, '../../backups_temp');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_TEMP_DIR)) {
    fs.mkdirSync(BACKUP_TEMP_DIR, { recursive: true });
  }
}

// 🌟 Создание ZIP-архива бэкапа
async function createBackupArchive() {
  ensureBackupDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const archiveName = `SD_Bot_Backup_${timestamp}.zip`;
  const archivePath = path.join(BACKUP_TEMP_DIR, archiveName);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 6 } }); // Среднее сжатие

    output.on('close', () => {
      const sizeBytes = archive.pointer();
      console.log(`📦 Архив создан: ${archiveName} (${(sizeBytes / (1024 * 1024)).toFixed(2)} МБ)`);
      resolve({ path: archivePath, name: archiveName, size: sizeBytes });
    });

    archive.on('error', (err) => {
      console.error('❌ Ошибка создания архива:', err);
      reject(err);
    });

    archive.pipe(output);

    // 1. Файлы базы данных
    const dataDir = path.join(__dirname, '../data');
    const dbFiles = ['catalog.json', 'loyalty.json', 'orders.json'];
    for (const file of dbFiles) {
      const filePath = path.join(dataDir, file);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: `data/${file}` });
      }
    }

    // 2. Логи
    const logsDir = path.join(__dirname, '../../logs');
    if (fs.existsSync(logsDir)) {
      archive.directory(logsDir, 'logs');
    }

    // 3. Исходные данные заказов (customer_data)
    try {
      const storage = require('./storage');
      if (storage.ORDERS_DIR && fs.existsSync(storage.ORDERS_DIR)) {
        archive.directory(storage.ORDERS_DIR, 'customer_data');
      }
    } catch (e) {
      console.log('⚠️ Модуль хранилища не найден, пропускаем customer_data');
    }

    // 4. Файл конфигурации .env
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      archive.file(envPath, { name: '.env' });
    }

    archive.finalize();
  });
}

module.exports = { createBackupArchive, BACKUP_TEMP_DIR };