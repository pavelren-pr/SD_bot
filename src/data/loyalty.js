const fs = require('fs');
const path = require('path');

const loyaltyPath = path.join(__dirname, 'loyalty.json');

// Создаём файл, если его нет
if (!fs.existsSync(loyaltyPath)) {
  fs.writeFileSync(loyaltyPath, JSON.stringify({}, null, 2));
}

function getLoyaltyInfo(userId) {
  const data = JSON.parse(fs.readFileSync(loyaltyPath, 'utf8'));
  const user = data[userId];
  // Ожидаем формат: { "123456789": { discount: 10 } } (скидка в процентах)
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

module.exports = { getLoyaltyInfo, calculatePrice };