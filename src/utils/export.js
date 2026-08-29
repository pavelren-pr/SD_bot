const ExcelJS = require('exceljs');
const ordersDb = require('../data/orders');
const loyalty = require('../data/loyalty');
const logger = require('./logger');

// 🌟 Функция удаления эмодзи из строк
function removeEmojis(str) {
  if (!str) return str;
  // Удаляем эмодзи из Unicode диапазонов, оставляя текст и спецсимволы
  return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}\u{231A}-\u{231B}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/gu, '').trim();
}

async function generateExcelExport(includeLogs = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SD Bot Admin';
  workbook.created = new Date();

  // ==========================================
  // ЛИСТ 1: ЗАКАЗЫ
  // ==========================================
  const ordersSheet = workbook.addWorksheet('Заказы');
  
  ordersSheet.columns = [
    { header: '№ Заказа', key: 'orderNumber', width: 12 },
    { header: 'ID Клиента', key: 'customerId', width: 15 },
    { header: 'Username', key: 'customerUsername', width: 20 },
    { header: 'Работа', key: 'workTitle', width: 30 },
    { header: 'Предмет', key: 'subjectName', width: 20 },
    { header: 'Цена (₽)', key: 'price', width: 10 },
    { header: 'Статус', key: 'status', width: 15 },
    { header: 'Дата создания', key: 'createdAt', width: 20 },
    { header: 'Комментарий', key: 'description', width: 40 },
  ];

  ordersSheet.getRow(1).font = { bold: true };
  ordersSheet.getRow(1).fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFD3D3D3'} };

  const allOrders = ordersDb.getAllOrders().filter(o => !o._meta);
  // 🌟 Очищаем эмодзи из названий работ и предметов
  const cleanedOrders = allOrders.map(order => ({
    ...order,
    workTitle: removeEmojis(order.workTitle),
    subjectName: removeEmojis(order.subjectName)
  }));
  ordersSheet.addRows(cleanedOrders);

  // ==========================================
  // ЛИСТ 2: ПРОГРАММА ЛОЯЛЬНОСТИ
  // ==========================================
  const loyaltySheet = workbook.addWorksheet('Лояльность');
  
  loyaltySheet.columns = [
    { header: 'Telegram ID', key: 'id', width: 15 },
    { header: 'Username', key: 'username', width: 20 },
    { header: 'Сумма покупок (₽)', key: 'totalSpent', width: 18 },
    { header: 'Текущий Ранг', key: 'rankName', width: 25 },
    { header: 'Скидка (%)', key: 'discount', width: 12 },
    { header: 'Админ/Исполнитель', key: 'access', width: 20 },
  ];

  loyaltySheet.getRow(1).font = { bold: true };
  loyaltySheet.getRow(1).fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFD3D3D3'} };

  const rawLoyaltyData = loyalty.loadData();
  
  const loyaltyRows = [];
  for (const userId in rawLoyaltyData) {
    const info = loyalty.getLoyaltyInfo(userId);
    loyaltyRows.push({
      id: userId,
      username: rawLoyaltyData[userId].username || 'не указан',
      totalSpent: info.totalSpent,
      rankName: removeEmojis(info.rank.emoji + ' ' + info.rank.name),
      discount: info.discountPercent,
      access: info.hasFullAccess ? 'Посейдон (Админ)' : (info.hasExecutorAccess ? 'Прометей (Исполнитель)' : 'Клиент')
    });
  }
  
  loyaltySheet.addRows(loyaltyRows);

  return await workbook.xlsx.writeBuffer();
}

/**
 * 🌟 Генерирует Excel с логами (взаимодействия пользователей + ошибки/системные события)
 */
async function generateLogsExport() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SD Bot Admin';
  workbook.created = new Date();

  const logs = logger.readAllLogs();
  
  // Разделяем логи на две категории
  const userInteractions = [];
  const systemAndErrors = [];

  logs.forEach(log => {
    if (log.type === 'error' || log.type === 'system') {
      systemAndErrors.push(log);
    } else if (log.userId) {
      userInteractions.push(log);
    } else {
      systemAndErrors.push(log);
    }
  });

  // ==========================================
  // ЛИСТ 1: ВЗАИМОДЕЙСТВИЯ ПОЛЬЗОВАТЕЛЕЙ
  // ==========================================
  const userSheet = workbook.addWorksheet('Взаимодействия');
  userSheet.columns = [
    { header: 'Дата/Время', key: 'timestamp', width: 25 },
    { header: 'Тип', key: 'type', width: 18 },
    { header: 'Действие', key: 'action', width: 20 },
    { header: 'User ID', key: 'userId', width: 15 },
    { header: 'Username', key: 'username', width: 20 },
    { header: 'Имя', key: 'firstName', width: 20 },
    { header: 'Chat ID', key: 'chatId', width: 15 },
    { header: 'Тип чата', key: 'chatType', width: 12 },
    { header: 'Тип контента', key: 'contentType', width: 15 },
    { header: 'Контент', key: 'content', width: 50 },
    { header: 'Файл', key: 'fileName', width: 30 },
    { header: 'Callback', key: 'callbackData', width: 40 },
    { header: '№ Заказа', key: 'orderNumber', width: 12 },
    { header: 'Работа', key: 'workTitle', width: 30 },
    { header: 'Цена (₽)', key: 'price', width: 10 },
    { header: 'Статус', key: 'status', width: 15 },
    { header: 'Детали', key: 'details', width: 50 },
  ];

  userSheet.getRow(1).font = { bold: true };
  userSheet.getRow(1).fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFD3D3D3'} };

  userInteractions.forEach(log => {
    userSheet.addRow({
      timestamp: log.timestamp ? new Date(log.timestamp).toLocaleString('ru-RU') : '',
      type: log.type || '',
      action: log.action || '',
      userId: log.userId || '',
      username: log.username || '',
      firstName: log.firstName || '',
      chatId: log.chatId || '',
      chatType: log.chatType || '',
      contentType: log.contentType || '',
      content: log.content || '',
      fileName: log.fileName || '',
      callbackData: log.callbackData || '',
      orderNumber: log.orderNumber || '',
      workTitle: removeEmojis(log.workTitle || ''),
      price: log.price || '',
      status: log.status || '',
      details: log.details ? JSON.stringify(log.details).substring(0, 100) : '',
    });
  });

  // ==========================================
  // ЛИСТ 2: ОШИБКИ И СИСТЕМНЫЕ СОБЫТИЯ
  // ==========================================
  const errorSheet = workbook.addWorksheet('Ошибки и события');
  errorSheet.columns = [
    { header: 'Дата/Время', key: 'timestamp', width: 25 },
    { header: 'Тип', key: 'type', width: 15 },
    { header: 'Действие', key: 'action', width: 25 },
    { header: 'Сообщение ошибки', key: 'errorMessage', width: 50 },
    { header: 'Код ошибки', key: 'errorCode', width: 15 },
    { header: 'User ID', key: 'userId', width: 15 },
    { header: 'Username', key: 'username', width: 20 },
    { header: 'Callback', key: 'callbackData', width: 40 },
    { header: 'Детали', key: 'details', width: 60 },
  ];

  errorSheet.getRow(1).font = { bold: true };
  errorSheet.getRow(1).fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFFFCCCC'} };

  systemAndErrors.forEach(log => {
    errorSheet.addRow({
      timestamp: log.timestamp ? new Date(log.timestamp).toLocaleString('ru-RU') : '',
      type: log.type || '',
      action: log.action || '',
      errorMessage: log.errorMessage || '',
      errorCode: log.errorCode || '',
      userId: log.userId || '',
      username: log.username || '',
      callbackData: log.callbackData || '',
      details: log.details ? JSON.stringify(log.details) : '',
    });
  });

  return await workbook.xlsx.writeBuffer();
}

module.exports = { generateExcelExport, generateLogsExport };