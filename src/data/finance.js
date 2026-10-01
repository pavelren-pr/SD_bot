const fs = require('fs');
const path = require('path');

const FINANCE_FILE = path.join(__dirname, '..', '..', 'data', 'finance.json');

// 🌟 Загрузка данных финансов
function loadData() {
  try {
    if (!fs.existsSync(FINANCE_FILE)) {
      const defaultData = {
        expenseConstant: 10, // Константа расходов по умолчанию 10%
        coOwners: [] // Массив совладельцев: { id, username, percent }
      };
      saveData(defaultData);
      return defaultData;
    }
    const raw = fs.readFileSync(FINANCE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Ошибка загрузки finance.json:', error);
    return { expenseConstant: 10, coOwners: [] };
  }
}

// 🌟 Сохранение данных финансов
function saveData(data) {
  try {
    const dir = path.dirname(FINANCE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(FINANCE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Ошибка сохранения finance.json:', error);
  }
}

// 🌟 Получить константу расходов (%)
function getExpenseConstant() {
  const data = loadData();
  return data.expenseConstant || 10;
}

// 🌟 Установить константу расходов (%)
function setExpenseConstant(percent) {
  const data = loadData();
  data.expenseConstant = Math.max(0, Math.min(100, parseInt(percent) || 0));
  saveData(data);
  return data.expenseConstant;
}

// 🌟 Получить список совладельцев
function getCoOwners() {
  const data = loadData();
  return data.coOwners || [];
}

// 🌟 Добавить совладельца
function addCoOwner(id, username, percent) {
  const data = loadData();
  if (!data.coOwners) data.coOwners = [];
  
  // Проверяем, не существует ли уже такой совладелец
  const existing = data.coOwners.find(c => String(c.id) === String(id));
  if (existing) {
    existing.username = username;
    existing.percent = Math.max(0, Math.min(100, parseInt(percent) || 0));
  } else {
    data.coOwners.push({
      id: String(id),
      username: username || null,
      percent: Math.max(0, Math.min(100, parseInt(percent) || 0))
    });
  }
  
  saveData(data);
  return data.coOwners;
}

// 🌟 Удалить совладельца
function removeCoOwner(id) {
  const data = loadData();
  if (!data.coOwners) return [];
  data.coOwners = data.coOwners.filter(c => String(c.id) !== String(id));
  saveData(data);
  return data.coOwners;
}

// 🌟 Обновить процент совладельца
function updateCoOwnerPercent(id, percent) {
  const data = loadData();
  if (!data.coOwners) return null;
  const coOwner = data.coOwners.find(c => String(c.id) === String(id));
  if (coOwner) {
    coOwner.percent = Math.max(0, Math.min(100, parseInt(percent) || 0));
    saveData(data);
  }
  return coOwner;
}

// 🌟 Получить общую сумму процентов совладельцев
function getTotalCoOwnersPercent() {
  const coOwners = getCoOwners();
  return coOwners.reduce((sum, c) => sum + (c.percent || 0), 0);
}

module.exports = {
  loadData,
  saveData,
  getExpenseConstant,
  setExpenseConstant,
  getCoOwners,
  addCoOwner,
  removeCoOwner,
  updateCoOwnerPercent,
  getTotalCoOwnersPercent
};