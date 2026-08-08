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

// 🌟 Получить следующий номер заказа
function getNextOrderNumber() {
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
  
  // Если счётчика ещё нет — инициализируем с 10001
  if (!meta || !meta.nextOrderNumber) {
    const newMeta = { nextOrderNumber: 10001 };
    if (data.length === 0) {
      data.unshift({ _meta: newMeta });
    } else if (metaIndex === 0) {
      data[0]._meta = newMeta;
    } else {
      data._meta = newMeta;
    }
    saveData(data);
    return 10001;
  }
  
  return meta.nextOrderNumber;
}

// 🌟 Функция увеличения счётчика после создания заказа
function incrementOrderNumber() {
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
  
  meta.nextOrderNumber += 1;
  saveData(data);
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
  const orderNumber = getNextOrderNumber();
  
  const newOrder = {
    orderNumber: orderNumber, // 🌟 НОВЫЙ ПОЛЕ: читаемый номер заказа
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
    status: 'pending',
    createdAt: orderData.createdAt || new Date().toLocaleString('ru-RU'),
    acceptedAt: null,
    completedAt: null
  };
  
  orders.push(newOrder);
  incrementOrderNumber(); // 🌟 Увеличиваем счётчик
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

// 🌟 Найти заказ по связке заказчик + работа (чтобы не дублировать)
function findActiveOrder(customerId, workId) {
  return loadData().find(o => 
    (o.customerId === customerId || String(o.customerId) === String(customerId)) &&
    o.workId === workId &&
    o.status !== 'completed'
  );
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