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

// 🌟 Создать новый заказ
function createOrder(orderData) {
  const orders = loadData();
  const newOrder = {
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
    status: 'pending', // pending | active | completed
    createdAt: orderData.createdAt || new Date().toLocaleString('ru-RU'),
    acceptedAt: null,
    completedAt: null
  };
  orders.push(newOrder);
  saveData(orders);
  return newOrder;
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
  createOrder,
  updateOrder,
  deleteOrder,
  findActiveOrder
};