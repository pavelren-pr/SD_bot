const fs = require('fs');
const path = require('path');

const loyaltyPath = path.join(__dirname, 'loyalty.json');

// Создаём файл, если его нет
if (!fs.existsSync(loyaltyPath)) {
  fs.writeFileSync(loyaltyPath, JSON.stringify({}, null, 2));
}

function loadData() {
  return JSON.parse(fs.readFileSync(loyaltyPath, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(loyaltyPath, JSON.stringify(data, null, 2));
}

function getLoyaltyInfo(userId) {
  const data = loadData();
  const user = data[userId];
  return { 
    discountPercent: user?.discount || 0, 
    isLoyal: !!user?.discount 
  };
}

function calculatePrice(basePrice, userId) {
  const { discountPercent } = getLoyaltyInfo(userId);
  const finalPrice = Math.round(basePrice * (1 - discountPercent / 100));
  return { basePrice, discountPercent, finalPrice };
}

// Добавляем сумму к общему обороту пользователя (для накопительной скидки)
function addToTotal(userId, username, amount) {
  const data = loadData();
  
  if (!data[userId]) {
    data[userId] = { 
      username: username || '', 
      totalSpent: 0, 
      discount: 0 
    };
  }
  
  data[userId].totalSpent = (data[userId].totalSpent || 0) + amount;
  data[userId].username = username || data[userId].username;
  
  saveData(data);
}

module.exports = { getLoyaltyInfo, calculatePrice, addToTotal };