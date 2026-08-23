const fs = require('fs');
const path = require('path');

const ordersPath = path.join(__dirname, 'orders.json');

// Создаём файл, если его нет
if (!fs.existsSync(ordersPath)) {
  fs.writeFileSync(ordersPath, JSON.stringify([], null, 2));
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  } catch (error) {
    console.error('Ошибка чтения orders.json:', error);
    return [];
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(ordersPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Ошибка записи orders.json:', error);
    return false;
  }
}

// 🌟 Получить все заказы
function getAllOrders() {
  return loadData();
}

// 🌟 Получить заказы пользователя (заказчика)
function getUserOrders(userId) {
  return loadData().filter(o => o.customerId === userId || String(o.customerId) === String(userId));
}

// 🌟 Получить заказы исполнителя
function getExecutorOrders(executorId) {
  return loadData().filter(o => o.executorId === executorId || String(o.executorId) === String(executorId));
}

// 🌟 Получить один заказ по ID
function getOrder(orderId) {
  return loadData().find(o => o.id === orderId);
}

// 🌟 Миграция: присваиваем номера старым заказам, у которых их нет
function migrateOrders() {
  const data = loadData();
  
  // Проверяем, является ли первый элемент метаданными
  let meta = null;
  let metaIndex = -1;
  
  if (data.length > 0 && data[0]._meta && Object.keys(data[0]).length === 1) {
    // _meta находится в первом элементе как отдельный объект
    meta = data[0]._meta;
    metaIndex = 0;
  } else if (data._meta) {
    // _meta как свойство массива
    meta = data._meta;
  }
  
  if (!meta) {
    meta = { nextOrderNumber: 10001 };
    if (data.length === 0) {
      data.unshift({ _meta: meta });
    } else if (metaIndex === 0) {
      data[0]._meta = meta;
    } else {
      data._meta = meta;
    }
  }
  
  let migrated = false;
  let nextNum = meta.nextOrderNumber;
  
  // Находим все заказы без номера (пропуская элемент с _meta если он первый)
  const ordersWithoutNumber = data.filter((o, index) => {
    // Пропускаем первый элемент, если он содержит только _meta
    if (index === 0 && o._meta && Object.keys(o).length === 1) {
      return false;
    }
    return !o.orderNumber;
  });
  
  if (ordersWithoutNumber.length > 0) {
    // Присваиваем номера начиная с текущего счётчика
    ordersWithoutNumber.forEach(order => {
      order.orderNumber = nextNum;
      nextNum++;
      migrated = true;
    });
    
    meta.nextOrderNumber = nextNum;
    saveData(data);
    console.log(`✅ Мигрировано заказов: ${ordersWithoutNumber.length}. Следующий номер: ${nextNum}`);
  }
}

// Запускаем миграцию при загрузке модуля
migrateOrders();

// 🌟 Создать новый заказ
function createOrder(orderData) {
    const orders = loadData();
    
    // 🌟 Находим или инициализируем объект _meta в текущем массиве orders
    let meta = null;
    if (orders.length > 0 && orders[0] && orders[0]._meta && Object.keys(orders[0]).length === 1) {
        meta = orders[0]._meta;
    } else if (orders._meta) {
        meta = orders._meta;
    }
    
    // Если счётчика ещё нет — инициализируем с 10001
    if (!meta || !meta.nextOrderNumber) {
        meta = { nextOrderNumber: 10001 };
        if (orders.length === 0) {
            orders.unshift({ _meta: meta });
        } else if (orders[0] && orders[0]._meta) {
            orders[0]._meta = meta;
        } else {
            orders._meta = meta;
        }
    }
    
    // 🌟 Получаем текущий номер заказа
    const orderNumber = meta.nextOrderNumber;
    
    const newOrder = {
        orderNumber: orderNumber,
        id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        workId: orderData.workId || null,
        workTitle: orderData.workTitle || 'Не указано',
        subjectName: orderData.subjectName || 'Не указано',
        courseName: orderData.courseName || 'Не указано',
        customerId: orderData.customerId,
        customerUsername: orderData.customerUsername || null,
        executorId: null,
        executorUsername: null,
        price: orderData.price,
        commission: orderData.commission || 0,
        status: orderData.status || 'pending',
        createdAt: orderData.createdAt || new Date().toLocaleString('ru-RU'),
        acceptedAt: null,
        completedAt: null,
        description: orderData.description || null,
        fileName: orderData.fileName || null,
        fileId: orderData.fileId || null,
        fileType: orderData.fileType || null,
        isCustomOrder: orderData.isCustomOrder || false
    };
    
    orders.push(newOrder);
    
    // 🌟 Увеличиваем счётчик в том же объекте meta перед сохранением
    meta.nextOrderNumber += 1;
    
    // 🌟 Сохраняем обновлённый массив orders (с новым заказом и увеличенным счётчиком) ОДНИМ вызовом
    saveData(orders);
    return newOrder;
}

// 🌟 Получить заказ по номеру (удобно для поиска)
function getOrderByNumber(orderNumber) {
  return loadData().find(o => o.orderNumber === orderNumber || String(o.orderNumber) === String(orderNumber));
}

// 🌟 Обновить заказ
function updateOrder(orderId, updates) {
  const orders = loadData();
  const index = orders.findIndex(o => o.id === orderId);
  if (index === -1) return null;
  
  orders[index] = { ...orders[index], ...updates };
  saveData(orders);
  return orders[index];
}

// 🌟 Удалить заказ
function deleteOrder(orderId) {
  const orders = loadData();
  const filtered = orders.filter(o => o.id !== orderId);
  saveData(filtered);
  return filtered.length < orders.length;
}

// 🌟 Найти заказ по связке заказчик + работа
function findActiveOrder(customerId, workId) {
  const all = loadData();
  // Ищем с конца (новый заказ = последний в массиве), пропускаем уже назначенные
  for (let i = all.length - 1; i >= 0; i--) {
    const o = all[i];
    if (
      (o.customerId === customerId || String(o.customerId) === String(customerId)) &&
      o.workId === workId &&
      o.status !== 'completed' &&
      !o.executorId  // ← пропускаем заказы, у которых уже есть исполнитель
    ) {
      return o;
    }
  }
  return null;
}

module.exports = {
  getAllOrders,
  getUserOrders,
  getExecutorOrders,
  getOrder,
  getOrderByNumber,
  createOrder,
  updateOrder,
  deleteOrder,
  findActiveOrder
};