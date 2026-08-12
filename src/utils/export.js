const ExcelJS = require('exceljs');
const ordersDb = require('../data/orders');
const loyalty = require('../data/loyalty');

async function generateExcelExport() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SD Bot Admin';
  workbook.created = new Date();

  // ==========================================
  // ЛИСТ 1: ЗАКАЗЫ
  // ==========================================
  const ordersSheet = workbook.addWorksheet('Заказы');
  
  // Настраиваем колонки
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

  // Стилизуем заголовки
  ordersSheet.getRow(1).font = { bold: true };
  ordersSheet.getRow(1).fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFD3D3D3'} };

  // Получаем заказы (фильтруем метаданные _meta, если они есть)
  const allOrders = ordersDb.getAllOrders().filter(o => !o._meta);
  ordersSheet.addRows(allOrders);

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

  // Читаем "сырые" данные из loyalty.json (там объект, где ключи - это ID)
  const rawLoyaltyData = loyalty.loadData();
  
  const loyaltyRows = [];
  for (const userId in rawLoyaltyData) {
    // Используем ваш же метод getLoyaltyInfo, чтобы правильно вычислить ранг и скидки
    const info = loyalty.getLoyaltyInfo(userId);
    loyaltyRows.push({
      id: userId,
      username: rawLoyaltyData[userId].username || 'не указан',
      totalSpent: info.totalSpent,
      rankName: info.rank.emoji + ' ' + info.rank.name,
      discount: info.discountPercent,
      access: info.hasFullAccess ? '🔱 Посейдон (Админ)' : (info.hasExecutorAccess ? '🔥 Прометей (Исполнитель)' : 'Клиент')
    });
  }
  
  loyaltySheet.addRows(loyaltyRows);

  // Возвращаем файл в виде Buffer (без сохранения на диск!)
  return await workbook.xlsx.writeBuffer();
}

module.exports = { generateExcelExport };