const fs = require('fs');
const path = require('path');
const https = require('https');
const { pipeline } = require('stream/promises');

// Директория хранилища (можно задать через .env: CUSTOMER_DATA_DIR=/var/sd_bot_data)
const STORAGE_DIR = process.env.CUSTOMER_DATA_DIR || path.join(__dirname, '../../customer_data');
const ORDERS_DIR = path.join(STORAGE_DIR, 'orders');
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 МБ максимум на файл
const logger = require('./logger');

// Инициализация структуры хранилища
function initStorage() {
  try {
    if (!fs.existsSync(ORDERS_DIR)) {
      fs.mkdirSync(ORDERS_DIR, { recursive: true });
      console.log(`📁 Хранилище данных создано: ${ORDERS_DIR}`);
    }
    logger.logSystemEvent('storage_initialized', { path: ORDERS_DIR });
  } catch (err) {
    console.error('❌ Ошибка инициализации хранилища:', err);
  }
}

// Получить директорию для конкретного заказа
function getOrderDir(orderNumber) {
  return path.join(ORDERS_DIR, String(orderNumber));
}

// Сохранить текстовые данные и метаданные заказа
async function saveOrderData(orderNumber, data) {
  try {
    const orderDir = getOrderDir(orderNumber);
    if (!fs.existsSync(orderDir)) {
      fs.mkdirSync(orderDir, { recursive: true });
    }
    const metaPath = path.join(orderDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf8');
    return metaPath;
  } catch (err) {
    console.error(`❌ Ошибка сохранения данных заказа ${orderNumber}:`, err);
    return null;
  }
}

// Скачать один файл из Telegram стримом (без загрузки в память!)
async function downloadTelegramFile(telegram, fileId, destPath) {
  try {
    // Проверяем размер файла до скачивания
    const fileInfo = await telegram.getFile(fileId);
    if (fileInfo.file_size && fileInfo.file_size > MAX_FILE_SIZE) {
      console.log(`⚠️ Файл слишком большой (${(fileInfo.file_size / 1024 / 1024).toFixed(1)} МБ), пропускаем`);
      return { success: false, reason: 'file_too_large', size: fileInfo.file_size };
    }

    const fileLink = await telegram.getFileLink(fileId);

    // Скачиваем стримом
    await new Promise((resolve, reject) => {
      https.get(fileLink.href, async (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error(`HTTP ${response.statusCode}`));
        }
        const fileStream = fs.createWriteStream(destPath);
        try {
          await pipeline(response, fileStream);
          resolve();
        } catch (err) {
          // Удаляем неполный файл
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          reject(err);
        }
      }).on('error', reject);
    });

    return { success: true, path: destPath };
  } catch (err) {
    console.error('❌ Ошибка скачивания файла:', err.message);
    return { success: false, reason: err.message };
  }
}

// Скачать все файлы заказа (последовательно, чтобы не перегружать память)
async function saveOrderFiles(telegram, orderNumber, files) {
  if (!files || files.length === 0) return [];

  const orderDir = getOrderDir(orderNumber);
  if (!fs.existsSync(orderDir)) {
    fs.mkdirSync(orderDir, { recursive: true });
  }

  const results = [];
  // ВАЖНО: скачиваем ПОСЛЕДОВАТЕЛЬНО (не параллельно) — экономим память
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = file.type === 'photo' ? '.jpg' : (path.extname(file.fileName || '') || '.bin');
    const fileName = `task_${i + 1}${ext}`;
    const destPath = path.join(orderDir, fileName);

    const result = await downloadTelegramFile(telegram, file.fileId, destPath);
    results.push({
      originalName: file.fileName || `Файл ${i + 1}`,
      savedAs: result.success ? fileName : null,
      success: result.success,
      reason: result.reason || null
    });
  }
  return results;
}

// Сохранить скриншот оплаты
async function savePaymentProof(telegram, orderNumber, fileId, type) {
  try {
    const orderDir = getOrderDir(orderNumber);
    if (!fs.existsSync(orderDir)) {
      fs.mkdirSync(orderDir, { recursive: true });
    }
    const ext = type === 'photo' ? '.jpg' : '.bin';
    const destPath = path.join(orderDir, `payment_proof${ext}`);
    const result = await downloadTelegramFile(telegram, fileId, destPath);
    return result.success ? path.basename(destPath) : null;
  } catch (err) {
    console.error('❌ Ошибка сохранения чека:', err.message);
    return null;
  }
}

// Прочитать сохранённые данные заказа
function readOrderData(orderNumber) {
  try {
    const metaPath = path.join(getOrderDir(orderNumber), 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    console.error(`❌ Ошибка чтения данных заказа ${orderNumber}:`, err);
    return null;
  }
}

// Получить список файлов заказа
function getOrderFiles(orderNumber) {
  try {
    const orderDir = getOrderDir(orderNumber);
    if (!fs.existsSync(orderDir)) return [];
    return fs.readdirSync(orderDir)
      .filter(f => f !== 'meta.json')
      .map(f => ({
        name: f,
        path: path.join(orderDir, f),
        size: fs.statSync(path.join(orderDir, f)).size
      }));
  } catch (err) {
    return [];
  }
}

// Статистика использования хранилища
function getStorageStats() {
  try {
    let totalSize = 0;
    let ordersCount = 0;
    let filesCount = 0;

    if (fs.existsSync(ORDERS_DIR)) {
      const orders = fs.readdirSync(ORDERS_DIR);
      ordersCount = orders.length;
      for (const order of orders) {
        const orderPath = path.join(ORDERS_DIR, order);
        const files = fs.readdirSync(orderPath);
        filesCount += files.length;
        for (const file of files) {
          totalSize += fs.statSync(path.join(orderPath, file)).size;
        }
      }
    }

    // Свободное место на диске
    const stats = fs.statfsSync(STORAGE_DIR);
    const totalDiskGB = (stats.blocks * stats.bsize) / (1024 ** 3);
    const freeDiskGB = (stats.bavail * stats.bsize) / (1024 ** 3);

    return {
      ordersCount,
      filesCount,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      totalDiskGB: totalDiskGB.toFixed(2),
      freeDiskGB: freeDiskGB.toFixed(2),
      usedPercent: ((1 - freeDiskGB / totalDiskGB) * 100).toFixed(1)
    };
  } catch (err) {
    console.error('❌ Ошибка статистики хранилища:', err);
    return null;
  }
}

// Очистка данных заказов старше N дней (кроме активных)
async function cleanupOldOrders(ordersDb, daysOld = 180) {
  try {
    const cutoffDate = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const allOrders = ordersDb.getAllOrders();
    const activeStatuses = ['pending', 'active', 'paid', 'waiting_acceptance', 'waiting_price', 'price_negotiating'];

    let deletedCount = 0;
    let freedBytes = 0;

    if (!fs.existsSync(ORDERS_DIR)) return { deletedCount, freedBytes };

    const storedOrders = fs.readdirSync(ORDERS_DIR);
    for (const orderNum of storedOrders) {
      // Ищем заказ в БД
      const order = allOrders.find(o => String(o.orderNumber) === String(orderNum));

      // Пропускаем активные заказы
      if (order && activeStatuses.includes(order.status)) continue;

      // Проверяем дату (по дате создания директории)
      const orderPath = path.join(ORDERS_DIR, orderNum);
      const dirStat = fs.statSync(orderPath);
      if (dirStat.mtimeMs > cutoffDate) continue;

      // Считаем размер перед удалением
      const files = fs.readdirSync(orderPath);
      for (const file of files) {
        freedBytes += fs.statSync(path.join(orderPath, file)).size;
      }

      // Удаляем директорию
      fs.rmSync(orderPath, { recursive: true, force: true });
      deletedCount++;
    }

    if (deletedCount > 0) {
      logger.logSystemEvent('storage_cleanup', {
        deletedCount,
        freedMB: (freedBytes / (1024 * 1024)).toFixed(2)
      });
    }
    return { deletedCount, freedBytes };
  } catch (err) {
    console.error('❌ Ошибка очистки хранилища:', err);
    return { deletedCount: 0, freedBytes: 0 };
  }
}

// Удалить данные конкретного заказа
function deleteOrderData(orderNumber) {
  try {
    const orderDir = getOrderDir(orderNumber);
    if (fs.existsSync(orderDir)) {
      fs.rmSync(orderDir, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch (err) {
    console.error(`❌ Ошибка удаления данных заказа ${orderNumber}:`, err);
    return false;
  }
}

// Инициализация при загрузке модуля
initStorage();

module.exports = {
  STORAGE_DIR,
  ORDERS_DIR,
  saveOrderData,
  saveOrderFiles,
  savePaymentProof,
  readOrderData,
  getOrderFiles,
  getOrderDir,
  getStorageStats,
  cleanupOldOrders,
  deleteOrderData
};