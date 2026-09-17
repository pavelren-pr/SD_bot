const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');
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

// Оригинальные ранги + секретные звания
const RANKS = [
  { name: 'Мужественный Одиссей', minSpent: 0, discount: 0, emoji: '🗡️' },
  { name: 'Меткий Тритон', minSpent: 5000, discount: 5, emoji: '🧜‍♂️' },
  { name: 'Могучий Гермес', minSpent: 7000, discount: 7, emoji: '🪽' },
  { name: 'Мудрый Аполон', minSpent: 10000, discount: 10, emoji: '👑' },
  // Секретные звания (не отображаются в публичном описании)
  { name: 'Прометей', minSpent: 999999, discount: 15, emoji: '🔥', secret: true, executorAccess: true },
  { name: 'Циклоп', minSpent: 999999, discount: 0, emoji: '👁️', secret: true, managerAccess: true },
  { name: 'Посейдон', minSpent: 999999, discount: 20, emoji: '🔱', secret: true, fullAccess: true }
];

function getLoyaltyInfo(userId) {
  const data = loadData();
  const user = data[userId];

  if (!user) {
    return {
      rank: RANKS[0],
      discountPercent: 0,
      isLoyal: false,
      totalSpent: 0,
      hasExecutorAccess: false,
      hasFullAccess: false,
      progressToNext: null,
      specialty: null,
      specialDiscount: null,
      hasManagerAccess: false,  // ✅ ИСПРАВЛЕНО: фиксированное значение
      managedChats: []          // ✅ ИСПРАВЛЕНО: пустой массив
    };
  }

  // Если у пользователя явно указан ранг — используем его
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

  // 🌟 Специальная скидка переопределяет ранговую
  const specialDiscount = user.specialDiscount !== undefined && user.specialDiscount !== null
    ? user.specialDiscount
    : null;
  const discountPercent = specialDiscount !== null ? specialDiscount : currentRank.discount;

  return {
    rank: currentRank,
    discountPercent: discountPercent,
    isLoyal: (user.totalSpent || 0) > 0,
    totalSpent: user.totalSpent || 0,
    progressToNext,
    hasExecutorAccess: currentRank.executorAccess || false,
    hasFullAccess: currentRank.fullAccess || false,
    specialty: user.specialty || null,
    specialDiscount: specialDiscount,
    // ✅ ДОБАВЛЕНО: поля для ранга Циклоп
    hasManagerAccess: currentRank.managerAccess || false,
    managedChats: user.managedChats || []
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
    data[userId] = { 
      username: username || '', 
      totalSpent: 0,
      specialty: null 
    };
  }
  
  data[userId].totalSpent = (data[userId].totalSpent || 0) + amount;
  data[userId].username = username || data[userId].username;
  
  // Сохраняем specialty если оно уже было
  if (!data[userId].hasOwnProperty('specialty')) {
    data[userId].specialty = null;
  }
  
  saveData(data);
}

// Получить специальность пользователя
function getUserSpecialty(userId) {
  const data = loadData();
  const user = data[userId];
  
  if (!user || !user.specialty) {
    return null;
  }
  
  return user.specialty;
}

// Установить специальность пользователя
function setUserSpecialty(userId, specialtyId) {
  const data = loadData();
  
  if (!data[userId]) {
    data[userId] = { 
      username: '', 
      totalSpent: 0,
      specialty: specialtyId
    };
  } else {
    data[userId].specialty = specialtyId;
  }
  
  saveData(data);
  return true;
}

// Получить список всех специальностей (теперь из catalog.json)
function getSpecialties() {
  return catalog.getSpecialties();
}

// Получить специальность по ID (теперь из catalog.json)
function getSpecialtyById(specialtyId) {
  return catalog.getSpecialtyById(specialtyId);
}

function getRanksDescription(loyaltyDocLink) {
  let msg = `<b>💵 Программа лояльности 💵\n⚓ "Посейдонов Фарватер" ⚓</b>\n\n`;
  msg += `Как это работает:\n\n`;
  msg += `1. Ваши заказы = Ваш статус: Каждый рубль, потраченный на наши работы, приближает вас к титулам, достойным Посейдона! Чем больше общая сумма ваших покупок, тем выше ваш ранг и скидка на все будущие заказы!\n\n`;
  msg += `2. Величественные Ранги Посейдона:\n\n`;
  msg += `🗡️ <b>Мужественный Одиссей</b> (0+ ₽) Скидка: 0%\n\n`;
  msg += `🧜‍♂️ <b>Меткий Тритон</b> (5000+ ₽) Скидка: 5%\n\n`;
  msg += `🪽 <b>Могучий Гермес</b> (7000+ ₽) Скидка: 7%!\n\n`;
  msg += `👑 <b>Мудрый Аполон</b> (10000+ ₽) Скидка: 10%!\n\n`;
  msg += `Подробные условия читайте <a href="${loyaltyDocLink}">тут</a> 📜`;
  
  return msg;
}

// 🌟 Обновление username при любом обращении
function updateUsername(userId, username) {
  if (!userId) return;
  const data = loadData();
  
  const currentUsername = username || '';
  
  if (!data[userId]) {
    // Создаем запись, если пользователя нет
    data[userId] = { 
      username: currentUsername, 
      totalSpent: 0,
      specialty: null 
    };
    saveData(data);
  } else if (data[userId].username !== currentUsername) {
    // Обновляем, если username изменился
    data[userId].username = currentUsername;
    saveData(data);
  }
}

// 🌟 Установить специальную скидку (переопределяет скидку по рангу)
function setSpecialDiscount(userId, discountPercent) {
  const data = loadData();
  if (!data[userId]) {
    data[userId] = {
      username: '',
      totalSpent: 0,
      specialty: null
    };
  }
  // Если discountPercent === null или 0 — удаляем спец. скидку (возврат к ранговой)
  if (discountPercent === null || discountPercent === 0) {
    delete data[userId].specialDiscount;
  } else {
    // Ограничиваем скидку диапазоном 1-100%
    data[userId].specialDiscount = Math.max(1, Math.min(100, parseInt(discountPercent)));
  }
  saveData(data);
  return true;
}

// 🌟 Получить специальную скидку (null если не установлена)
function getSpecialDiscount(userId) {
  const data = loadData();
  const user = data[userId];
  if (!user || user.specialDiscount === undefined) {
    return null;
  }
  return user.specialDiscount;
}

// 🌟 Установить чаты отделов для управляющего (Циклоп)
function setManagedChats(userId, chats) {
  const data = loadData();
  if (!data[userId]) {
    data[userId] = { username: '', totalSpent: 0 };
  }
  data[userId].managedChats = chats;
  saveData(data);
  return true;
}

// 🌟 Получить чаты отделов управляющего
function getManagedChats(userId) {
  const data = loadData();
  const user = data[userId];
  if (!user || !Array.isArray(user.managedChats)) return [];
  return user.managedChats;
}

module.exports = { 
  getLoyaltyInfo, 
  calculatePrice, 
  addToTotal, 
  getRanksDescription, 
  RANKS, 
  loadData, 
  saveData,
  getUserSpecialty,
  setUserSpecialty,
  getSpecialties,
  getSpecialtyById,
  updateUsername,
  setSpecialDiscount,
  getSpecialDiscount,
  setManagedChats,
  getManagedChats
};