const fs = require('fs');
const path = require('path');

const loyaltyPath = path.join(__dirname, 'loyalty.json');

if (!fs.existsSync(loyaltyPath)) {
  fs.writeFileSync(loyaltyPath, JSON.stringify({}, null, 2));
}

function loadData() {
  return JSON.parse(fs.readFileSync(loyaltyPath, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(loyaltyPath, JSON.stringify(data, null, 2));
}

// 🌟 Оригинальные ранги + секретные звания
const RANKS = [
  { name: 'Искатель Глубин', minSpent: 0, discount: 0, emoji: '🌊' },
  { name: 'Повелитель Течений', minSpent: 5000, discount: 5, emoji: '🌀' },
  { name: 'Тритон Премудрости', minSpent: 7000, discount: 7, emoji: '🧜' },
  { name: 'Посланник Посейдона', minSpent: 10000, discount: 10, emoji: '👑' },
  // Секретные звания (не отображаются в публичном описании)
  { name: 'Прометей', minSpent: 999999, discount: 15, emoji: '🔥', secret: true, executorAccess: true },
  { name: 'Посейдон', minSpent: 999999, discount: 20, emoji: '🔱', secret: true, fullAccess: true }
];

function getLoyaltyInfo(userId) {
  const data = loadData();
  const user = data[userId];
  
  if (!user) {
    return { rank: RANKS[0], discountPercent: 0, isLoyal: false, totalSpent: 0, hasExecutorAccess: false, hasFullAccess: false, progressToNext: null };
  }
  
  // 🌟 Если у пользователя явно указан ранг — используем его
  let currentRank = RANKS[0];
  if (user.rank) {
    const foundRank = RANKS.find(r => r.name === user.rank);
    if (foundRank) {
      currentRank = foundRank;
    }
  } else {
    // Иначе определяем ранг по сумме заказов
    for (const rank of RANKS) {
      if (user.totalSpent >= rank.minSpent) {
        currentRank = rank;
      }
    }
  }
  
  let progressToNext = null;
  if (!currentRank.secret) {
    let nextPublicRank = null;
    const currentIndex = RANKS.findIndex(r => r.name === currentRank.name);
    for (let i = currentIndex + 1; i < RANKS.length; i++) {
      if (!RANKS[i].secret) {
        nextPublicRank = RANKS[i];
        break;
      }
    }
    if (nextPublicRank) {
      progressToNext = {
        nextName: nextPublicRank.name,
        need: nextPublicRank.minSpent - (user.totalSpent || 0)
      };
    }
  }

  return { 
    rank: currentRank,
    discountPercent: currentRank.discount,
    isLoyal: (user.totalSpent || 0) > 0,
    totalSpent: user.totalSpent || 0,
    progressToNext,
    hasExecutorAccess: currentRank.executorAccess || false,
    hasFullAccess: currentRank.fullAccess || false
  };
}

function calculatePrice(basePrice, userId) {
  const { discountPercent } = getLoyaltyInfo(userId);
  const finalPrice = Math.round(basePrice * (1 - discountPercent / 100));
  return { basePrice, discountPercent, finalPrice };
}

function addToTotal(userId, username, amount) {
  const data = loadData();
  if (!data[userId]) {
    data[userId] = { username: username || '', totalSpent: 0 };
  }
  data[userId].totalSpent = (data[userId].totalSpent || 0) + amount;
  data[userId].username = username || data[userId].username;
  saveData(data);
}

function getRanksDescription(loyaltyDocLink) {
  let msg = `<b>💵 Программа лояльности 💵\n⚓ "Посейдонов Фарватер" ⚓</b>\n\n`;
  msg += `Как это работает:\n\n`;
  msg += `1. Ваши заказы = Ваш статус: Каждый рубль, потраченный на наши работы, приближает вас к титулам, достойным Посейдона! Чем больше общая сумма ваших покупок, тем выше ваш ранг и скидка на все будущие заказы!\n\n`;
  msg += `2. Величественные Ранги Посейдона:\n\n`;
  msg += `🌊 <b>Искатель Глубин</b> (0+ ₽) Скидка: 0%\n\n`;
  msg += `🌀 <b>Повелитель Течений</b> (5000+ ₽) Скидка: 5%\n\n`;
  msg += `🧜 <b>Тритон Премудрости</b> (7000+ ₽) Скидка: 7%!\n\n`;
  msg += `👑 <b>Посланник Посейдона</b> (10000+ ₽) Скидка: 10%!\n\n`;
  msg += `Подробные условия читайте <a href="${loyaltyDocLink}">тут</a> 📜`;
  return msg;
}

module.exports = { getLoyaltyInfo, calculatePrice, addToTotal, getRanksDescription, RANKS };