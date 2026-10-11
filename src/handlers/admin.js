const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const ordersDb = require('../data/orders');
const { formatOrderCard } = require('./menu');
const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { generateExcelExport, generateLogsExport } = require('../utils/export');
const logger = require('../utils/logger');
const storage = require('../utils/storage');
const backup = require('../utils/backup');
const finance = require('../data/finance');
const { assignExecutorToOrder, unassignExecutorFromOrder, buildGroupOrderText } = require('./order');

// 🌟 Получение доступных переменных окружения из .env
function getAvailableEnvVars() {
  const chatVars = [];
  const paymentVars = [];
  
  for (const [key, value] of Object.entries(process.env)) {
    // Переменные чатов (заканчиваются на CHAT_ID или CHAT)
    if (key.endsWith('_CHAT_ID') || key.endsWith('_CHAT')) {
      chatVars.push({ name: key, value: value || 'не задано' });
    }
    // Переменные оплаты (заканчиваются на NUMBER, NUMB, CARD)
    if (key.endsWith('_NUMBER') || key.endsWith('_NUMB') || key.endsWith('_CARD')) {
      paymentVars.push({ name: key }); // 🌟 Значения карт НЕ показываем для безопасности
    }
  }
  
  return { chatVars, paymentVars };
}

// 🌟 Форматирование списка переменных для вывода
function formatEnvVarsList(vars, type) {
  if (vars.length === 0) {
    return `<i>⚠️ Переменные не найдены в .env</i>\n\n`;
  }
  let text = type === 'chat'
    ? `💬 <b>Доступные переменные чатов:</b>\n`
    : `💳 <b>Доступные переменные оплаты:</b>\n`;
  vars.forEach(v => {
    if (type === 'chat') {
      text += `• <code>${v.name}</code> — ID: ${v.value}\n`;
    } else {
      text += `• <code>${v.name}</code>\n`;
    }
  });
  return text;
}

// 🌟 Экранирование спецсимволов Markdown
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 🌟 Безопасный вывод username (экранирование спецсимволов Markdown)
function safeUsername(username) {
  if (!username || username === 'N/A') return 'не указан';
  return '@' + String(username);
}

// 🌟 Парсинг чатов отделов из строки "Название=ПЕРЕМЕННАЯ, Название2=ПЕРЕМЕННАЯ2"
function parseManagedChats(text) {
  const chats = [];
  const parts = text.split(',').map(s => s.trim()).filter(s => s);
  for (const part of parts) {
    if (part.includes('=')) {
      const [name, chatEnv] = part.split('=').map(s => s.trim());
      if (name && chatEnv) {
        chats.push({ name: name, chatEnv: chatEnv });
      }
    } else {
      chats.push({ name: part, chatEnv: part });
    }
  }
  return chats;
}

// 🌟 Статусы для категорий (включая custom orders)
const PENDING_STATUSES = ['pending', 'waiting_acceptance', 'waiting_price', 'price_negotiating'];
const ACTIVE_STATUSES = ['active', 'paid'];
const COMPLETED_STATUSES = ['completed'];

const ORDERS_PER_PAGE = 5;

// ==========================================
// Проверка прав (только Посейдон)
// ==========================================
function isAdmin(userId) {
  const info = loyalty.getLoyaltyInfo(userId);
  return info.hasFullAccess;
}

// ==========================================
// Клавиатуры
// ==========================================
function getAdminMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🗂 Управление каталогом', 'admin:catalog')],
    [Markup.button.callback('📦 Управление заказами', 'admin:orders')],
    [Markup.button.callback('👥 База заказчиков', 'admin:customers')],
    [Markup.button.callback('💰 Финансы', 'admin:finance')],
    [Markup.button.callback('🏅 Управление персоналом', 'admin:set_user_rank')],
    [Markup.button.callback('📊 Экспорт данных', 'admin:export_excel')],
    [Markup.button.callback('💾 Хранилище данных', 'admin:storage')],
    [Markup.button.callback('🔙 Назад', 'profile:back')]
  ]);
}

function getBackToAdminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Назад в меню', 'admin:main')]
  ]);
}

// 🌟 Очистка режимов ожидания сообщения от админа заказчику
function clearAdminReplySession(ctx) {
  ctx.session = ctx.session || {};

  ctx.session.adminReplyToCustomerId = null;
  ctx.session.adminReplyOrderId = null;
  ctx.session.adminReplyOrderNumber = null;
  ctx.session.adminReplyOrderTitle = null;
  ctx.session.adminReplyOrderDate = null;
  ctx.session.adminReplyAdminId = null;
}

// ==========================================
// КЛАВИАТУРЫ КАТАЛОГА (специальность → курс → предмет → работа)
// ==========================================

// Уровень 1: Список специальностей
function getCatalogSpecialtiesMenu() {
  const specialties = catalog.getSpecialties();
  const buttons = specialties.map(s => [
    Markup.button.callback(`${s.emoji} ${s.name.replace(s.emoji, '').trim()}`, `admin:catalog_specialty:${s.id}`)
  ]);
  buttons.push([Markup.button.callback('➕ Добавить специальность', 'admin:add_specialty')]);
  buttons.push([Markup.button.callback('✏️ Изменить специальность', 'admin:edit_specialty')]);
  buttons.push([Markup.button.callback('🗑 Удалить специальность', 'admin:delete_specialty')]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
  return Markup.inlineKeyboard(buttons);
}

// Уровень 2: Курсы конкретной специальности
function getSpecialtyCourses(specialtyId) {
  const courses = catalog.getCourses(specialtyId);
  const generalWorks = catalog.getWorksBySpecialty(specialtyId);
  const buttons = courses.map(c => [
    Markup.button.callback(c.name, `admin:catalog_course:${c.id}`)
  ]);
  
  // 🌟 Пункт "Общие работы" — показываем всегда
  buttons.push([
    Markup.button.callback(`📋 Общие работы (${generalWorks.length})`, `admin:catalog_general_works:${specialtyId}`)
  ]);
  
  if (buttons.length === 1) { // только "Общие работы", курсов нет
    buttons.unshift([Markup.button.callback('— курсов пока нет —', 'noop')]);
  }
  
  buttons.push([Markup.button.callback('➕ Добавить курс', `admin:add_course:${specialtyId}`)]);
  buttons.push([Markup.button.callback('✏️ Изменить курс', `admin:edit_course:${specialtyId}`)]);
  buttons.push([Markup.button.callback('🗑 Удалить курс', `admin:delete_course:${specialtyId}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:catalog')]);
  return Markup.inlineKeyboard(buttons);
}

// Уровень 3: Предметы курса (кнопка "Назад" ведёт к специальности)
function getCourseSubjects(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const course = catalog.getCourse(courseId);
  const specialtyId = course ? course.specialty : 'navigation';
  const generalWorks = catalog.getWorksByCourse(courseId);
  
  const buttons = subjects.map(s => [Markup.button.callback(s.name, `admin:catalog_subject:${s.id}`)]);
  
  // 🌟 Пункт "Общие работы курса"
  buttons.push([
    Markup.button.callback(`📋 Общие работы курса (${generalWorks.length})`, `admin:catalog_course_general:${courseId}`)
  ]);
  
  buttons.push([Markup.button.callback('➕ Добавить предмет', `admin:add_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('✏️ Изменить предмет', `admin:edit_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('🗑 Удалить предмет', `admin:delete_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', `admin:catalog_specialty:${specialtyId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// Общие работы специальности (без курса/предмета)
function getGeneralWorks(specialtyId) {
  const works = catalog.getWorksBySpecialty(specialtyId);
  const buttons = works.map(w => [
    Markup.button.callback(`№${w.orderNumber || 'N/A'} | ${w.title.substring(0, 35)}`, `admin:catalog_work:${w.id}`)
  ]);
  if (buttons.length === 0) {
    buttons.push([Markup.button.callback('— общих работ пока нет —', 'noop')]);
  }
  buttons.push([Markup.button.callback('➕ Добавить общую работу', `admin:add_general_work:${specialtyId}`)]);
  buttons.push([Markup.button.callback('🌟 Добавить общий индив. заказ', `admin:add_general_custom_work:${specialtyId}`)]);
  buttons.push([Markup.button.callback('🗑 Удалить общую работу', `admin:delete_general_work:${specialtyId}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', `admin:catalog_specialty:${specialtyId}`)]);
return Markup.inlineKeyboard(buttons);
}

// Общие работы курса (без предмета)
function getCourseGeneralWorks(courseId) {
  const works = catalog.getWorksByCourse(courseId);
  const buttons = works.map(w => [
    Markup.button.callback(`№${w.orderNumber || 'N/A'} | ${w.title.substring(0, 35)}`, `admin:catalog_work:${w.id}`)
  ]);
  if (buttons.length === 0) {
    buttons.push([Markup.button.callback('— общих работ пока нет —', 'noop')]);
  }
  buttons.push([Markup.button.callback('➕ Добавить общую работу', `admin:add_course_general_work:${courseId}`)]);
  buttons.push([Markup.button.callback('🌟 Добавить общий индив. заказ', `admin:add_course_general_custom_work:${courseId}`)]);
  buttons.push([Markup.button.callback('🗑 Удалить общую работу', `admin:delete_course_general_work:${courseId}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', `admin:catalog_course:${courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// Список общих работ специальности для удаления
function getDeleteGeneralWorkList(specialtyId) {
  const works = catalog.getWorksBySpecialty(specialtyId);
  const buttons = works.map(w => [Markup.button.callback(`🗑 №${w.orderNumber || 'N/A'} | ${w.title.substring(0, 30)}`, `admin:delete_work_confirm:${w.id}`)]);
  if (buttons.length === 0) {
    buttons.push([Markup.button.callback('— общих работ пока нет —', 'noop')]);
  }
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_general_works:${specialtyId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// Список общих работ курса для удаления
function getDeleteCourseGeneralWorkList(courseId) {
  const works = catalog.getWorksByCourse(courseId);
  const buttons = works.map(w => [Markup.button.callback(`🗑 №${w.orderNumber || 'N/A'} | ${w.title.substring(0, 30)}`, `admin:delete_work_confirm:${w.id}`)]);
  if (buttons.length === 0) {
    buttons.push([Markup.button.callback('— общих работ пока нет —', 'noop')]);
  }
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_course_general:${courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// Списки для редактирования/удаления специальностей
function getEditSpecialtyList() {
  const specialties = catalog.getSpecialties();
  const buttons = specialties.map(s => [
    Markup.button.callback(`${s.emoji} ${s.name.replace(s.emoji, '').trim()}`, `admin:edit_specialty_select:${s.id}`)
  ]);
  buttons.push([Markup.button.callback('⬅️ Отмена', 'admin:catalog')]);
  return Markup.inlineKeyboard(buttons);
}

function getDeleteSpecialtyList() {
  const specialties = catalog.getSpecialties();
  const buttons = specialties.map(s => [
    Markup.button.callback(`🗑 ${s.emoji} ${s.name.replace(s.emoji, '').trim()}`, `admin:delete_specialty_confirm:${s.id}`)
  ]);
  buttons.push([Markup.button.callback('⬅️ Отмена', 'admin:catalog')]);
  return Markup.inlineKeyboard(buttons);
}

function getSubjectWorks(subjectId) {
  const works = catalog.getWorksBySubject(subjectId);
  const buttons = works.map(w => [Markup.button.callback(`№${w.orderNumber || 'N/A'} | ${w.title.substring(0, 35)}`, `admin:catalog_work:${w.id}`)]);
  buttons.push([Markup.button.callback('➕ Добавить работу', `admin:add_work:${subjectId}`)]);
  buttons.push([Markup.button.callback('🌟 Добавить индив. заказ', `admin:add_custom_work:${subjectId}`)]);
  buttons.push([Markup.button.callback('🗑 Удалить работу', `admin:delete_work:${subjectId}`)]);
  
  const subject = catalog.getSubject(subjectId);
  buttons.push([Markup.button.callback('⬅️ Назад', `admin:catalog_course:${subject.courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

function getWorkCard(workId) {
  const work = catalog.getWork(workId);
  const specialty = work.specialty ? loyalty.getSpecialtyById(work.specialty) : null;
  const specialtyName = specialty ? specialty.name : 'Не указана';
  
  let text = `✏️ <b>Редактирование работы</b>\n\n`;
  text += `🎓 <b>Специальность:</b> ${specialtyName}\n`;
  
  if (work.subjectId) {
    const subject = catalog.getSubject(work.subjectId);
    const course = subject ? catalog.getCourse(subject.courseId) : null;
    text += `📚 <b>Курс:</b> ${course ? escapeHtml(course.name) : '<i>не указан</i>'}\n`;
    text += `📖 <b>Предмет:</b> ${subject ? escapeHtml(subject.name) : '<i>не указан</i>'}\n\n`;
  } else if (work.courseId) {
    const course = catalog.getCourse(work.courseId);
    text += `📚 <b>Курс:</b> ${course ? escapeHtml(course.name) : '<i>не указан</i>'}\n`;
    text += `📋 <b>Тип:</b> Общая работа курса (без предмета)\n\n`;
  } else {
    text += `📋 <b>Тип:</b> Общая работа специальности (без курса/предмета)\n\n`;
  }
  
  text += `📝 <b>Название:</b> ${escapeHtml(work.title)}\n`;
  if (work.description && work.description.trim() !== '') text += `📄 <b>Описание:</b> ${escapeHtml(work.description)}\n`;
  text += `💰 <b>Цена:</b> ${work.price} ₽\n`;
  text += `📊 <b>Комиссия:</b> ${work.commission}%\n`;
  text += `💳 <b>Оплата:</b> <code>${work.paymentEnv}</code>\n`;
  text += `💬 <b>Чат:</b> <code>${work.chatEnv}</code>\n`;
  text += `📋 <b>Требования:</b> ${Array.isArray(work.needs) && work.needs.length > 0 ? work.needs.join(', ') : 'нет'}\n`;
  text += `🌟 <b>Индивидуальный заказ:</b> ${work.isCustomOrder ? 'Да' : 'Нет'}\n`;
  if (work.exampleUrl && work.exampleUrl.trim() !== '') text += `🔗 <b>Примеры:</b> ${escapeHtml(work.exampleUrl)}\n`;
  text += `\n📌 <b>Подсказка:</b>\n${escapeHtml(work.prompt)}`;
  
  let backCallback;
  if (work.subjectId) {
    backCallback = `admin:catalog_subject:${work.subjectId}`;
  } else if (work.courseId) {
    backCallback = `admin:catalog_course_general:${work.courseId}`;
  } else {
    backCallback = `admin:catalog_specialty:${work.specialty}`;
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Изменить информацию', `admin:edit_work:${workId}`)],
    [Markup.button.callback('⬅️ Назад', backCallback)]
  ]);
  return { text, keyboard };
}

function getDeleteCourseList(specialtyId = null) {
  const specialties = catalog.getSpecialties();
  const emojiMap = {};
  specialties.forEach(s => { emojiMap[s.id] = s.emoji; });

  const courses = specialtyId ? catalog.getCourses(specialtyId) : catalog.courses;

  const buttons = courses.map(c => {
    const emoji = emojiMap[c.specialty] || '📚';
    return [Markup.button.callback(`🗑 ${emoji} ${c.name}`, `admin:delete_course_confirm:${c.id}`)];
  });

  if (buttons.length === 0) {
    buttons.push([Markup.button.callback('— курсов пока нет —', 'noop')]);
  }

  const backCallback = specialtyId ? `admin:catalog_specialty:${specialtyId}` : 'admin:catalog';
  buttons.push([Markup.button.callback('⬅️ Отмена', backCallback)]);
  return Markup.inlineKeyboard(buttons);
}

function getDeleteSubjectList(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const buttons = subjects.map(s => [Markup.button.callback(`🗑 ${s.name}`, `admin:delete_subject_confirm:${s.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_course:${courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

function getDeleteWorkList(subjectId) {
  const works = catalog.getWorksBySubject(subjectId);
  const buttons = works.map(w => [Markup.button.callback(`🗑 №${w.orderNumber || 'N/A'} | ${w.title.substring(0, 30)}`, `admin:delete_work_confirm:${w.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_subject:${subjectId}`)]);
  return Markup.inlineKeyboard(buttons);
}

function getEditCourseList(specialtyId = null) {
  const specialties = catalog.getSpecialties();
  const emojiMap = {};
  specialties.forEach(s => { emojiMap[s.id] = s.emoji; });

  // Фильтруем курсы по специальности, если указана
  const courses = specialtyId ? catalog.getCourses(specialtyId) : catalog.courses;

  const buttons = courses.map(c => {
    const emoji = emojiMap[c.specialty] || '📚';
    return [Markup.button.callback(`${emoji} ${c.name}`, `admin:edit_course_select:${c.id}`)];
  });

  if (buttons.length === 0) {
    buttons.push([Markup.button.callback('— курсов пока нет —', 'noop')]);
  }

  // Кнопка "Отмена" ведёт обратно к специальности или к общему каталогу
  const backCallback = specialtyId ? `admin:catalog_specialty:${specialtyId}` : 'admin:catalog';
  buttons.push([Markup.button.callback('⬅️ Отмена', backCallback)]);

  return Markup.inlineKeyboard(buttons);
}

function getEditSubjectList(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const buttons = subjects.map(s => [Markup.button.callback(`✏️ ${s.name}`, `admin:edit_subject_select:${s.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Отмена', `admin:catalog_course:${courseId}`)]);
  return Markup.inlineKeyboard(buttons);
}

// ==========================================
// Функция показа админ-меню из других модулей
// ==========================================
async function showAdminMenu(ctx) {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав для доступа к этой панели.');
    return;
  }
  ctx.session = ctx.session || {};
  ctx.session.adminState = null;
  await ctx.reply('🛠 <b>Панель управления</b>', {
    parse_mode: 'HTML',
    ...getAdminMainMenu()
  });
}

// ==========================================
// 💰 ФИНАНСЫ: Расчёт статистики и клавиатуры
// ==========================================

// 🌟 Парсинг даты из строки "01.10.2026, 14:30:00" или "01.10.2026 14:30:00"
function parseRussianDate(dateStr) {
  if (!dateStr) return null;
  try {
    // Пробуем стандартный парсинг
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
    
    // Парсим формат "ДД.ММ.ГГГГ, ЧЧ:ММ:СС"
    const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    return null;
  } catch (e) {
    return null;
  }
}

// 🌟 Фильтрация заказов по периоду
function filterOrdersByPeriod(orders, period, fromDate = null, toDate = null) {
  const now = new Date();
  
  if (period === 'all') return orders;
  
  if (period === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return orders.filter(o => {
      const date = parseRussianDate(o.createdAt);
      return date && date >= startOfMonth;
    });
  }
  
  if (period === 'from_date' && fromDate && toDate) {
    // Устанавливаем конец дня для toDate (23:59:59)
    const endOfDay = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59);
    return orders.filter(o => {
      const date = parseRussianDate(o.createdAt);
      return date && date >= fromDate && date <= endOfDay;
    });
  }
  
  return orders;
}

// 🌟 Расчёт финансовой статистики
function calculateFinancialStats(period, fromDate = null, toDate = null) {
  const allOrders = ordersDb.getAllOrders().filter(o => !o._meta);
  const orders = filterOrdersByPeriod(allOrders, period, fromDate, toDate);
  
  let revenue = 0;
  let executorEarnings = 0;
  let totalCommission = 0;
  let discountCoverage = 0;
  let ordersCount = 0;
  
  // 🌟 Агрегация из снимков заказов
  let expenseConstantAmount = 0;
  let coOwnersTotal = 0;
  const coOwnersMap = {};
  
  orders.forEach(order => {
    if (!['paid', 'completed', 'active', 'pending', 'waiting_acceptance', 'price_negotiating'].includes(order.status)) return;
    
    ordersCount++;
    
    const basePrice = order.basePrice || order.price || 0;
    const finalPrice = order.finalPrice || order.price || 0;
    const commissionPercent = order.commissionPercent || order.commission || 0;
    const executorPrice = order.executorPrice || Math.round(basePrice * (1 - commissionPercent / 100));
    
    revenue += finalPrice;
    executorEarnings += executorPrice;
    totalCommission += Math.round(basePrice * commissionPercent / 100);
    
    // 🌟 ОПРЕДЕЛЯЕМ: есть ли у заказа финансовый снимок?
    // Снимок есть, если присутствует поле expenseConstantPercent (добавлено в новой версии)
    const hasSnapshot = (order.expenseConstantPercent !== undefined && order.expenseConstantPercent !== null);
    
    if (hasSnapshot) {
      // 🌟 ИСПОЛЬЗУЕМ ДАННЫЕ ИЗ СНИМКА ЗАКАЗА
      discountCoverage += order.commissionExpense || 0;
      expenseConstantAmount += order.expenseConstantAmount || 0;
      
      if (order.coOwnerShares && Array.isArray(order.coOwnerShares)) {
        order.coOwnerShares.forEach(co => {
          if (!coOwnersMap[co.id]) {
            coOwnersMap[co.id] = {
              id: co.id,
              username: co.username,
              percent: co.percent,
              share: 0
            };
          }
          coOwnersMap[co.id].share += co.amount || 0;
        });
      }
    } else {
      // 🌟 ФОЛЛБЕК для старых заказов (без снимка) — считаем динамически
      const orderCommission = Math.round(basePrice * commissionPercent / 100);
      const orderActualCommission = Math.max(0, finalPrice - executorPrice);
      const orderCommissionExpense = Math.max(0, orderCommission - orderActualCommission);
      
      discountCoverage += orderCommissionExpense;
      
      const currentConstant = finance.getExpenseConstant();
      const orderConstantBase = Math.round(orderCommission * currentConstant / 100);
      expenseConstantAmount += orderConstantBase - orderCommissionExpense;
      
      const coOwners = finance.getCoOwners();
      coOwners.forEach(co => {
        if (!coOwnersMap[co.id]) {
          coOwnersMap[co.id] = {
            id: co.id,
            username: co.username,
            percent: co.percent,
            share: 0
          };
        }
        coOwnersMap[co.id].share += Math.round(orderCommission * co.percent / 100);
      });
    }
  });
  
  // Чистая комиссия (после покрытия скидок)
  const netCommission = totalCommission - discountCoverage;
  
  // Текущая константа (для отображения)
  const expenseConstant = finance.getExpenseConstant();
  
  // Итоговые доли совладельцев
  const coOwnersShares = Object.values(coOwnersMap);
  coOwnersShares.forEach(co => {
    coOwnersTotal += co.share;
  });
  
  // Чистая прибыль
  const netProfit = netCommission - coOwnersTotal - expenseConstantAmount;
  
  return {
    ordersCount,
    revenue,
    executorEarnings,
    totalCommission,
    discountCoverage,
    netCommission,
    expenseConstant,
    expenseConstantAmount,
    coOwnersShares,
    coOwnersTotal,
    netProfit
  };
}

// 🌟 Клавиатура главного меню финансов
function getFinanceMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Выручка', 'admin:finance_revenue')],
    [Markup.button.callback('📈 Прибыль', 'admin:finance_profit')],
    [Markup.button.callback('📉 Расход комиссии', 'admin:finance_expenses')],
    [Markup.button.callback('👷 Заработок исполнителей', 'admin:finance_executors')],
    [Markup.button.callback('⬅️ Назад', 'admin:main')]
  ]);
}

// 🌟 Клавиатура выбора периода
function getPeriodMenu(prefix) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📅 Текущий месяц', `admin:${prefix}:month`)],
    [Markup.button.callback('📆 Выбрать период (с даты по дату)', `admin:${prefix}:from_date`)],
    [Markup.button.callback('♾️ За всё время', `admin:${prefix}:all`)],
    [Markup.button.callback('⬅️ Назад к финансам', 'admin:finance')]
  ]);
}

// 🌟 Описание периода для текста
function getPeriodLabel(period, fromDate = null, toDate = null) {
  switch (period) {
    case 'month': return '📅 Текущий месяц';
    case 'from_date':
      const fromStr = fromDate ? fromDate.toLocaleDateString('ru-RU') : '...';
      const toStr = toDate ? toDate.toLocaleDateString('ru-RU') : '...';
      return `📆 ${fromStr} — ${toStr}`;
    case 'all': return '♾️ За всё время';
    default: return '';
  }
}

// ==========================================
// Регистрация обработчиков
// ==========================================
function register(bot) {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ У вас нет прав для доступа к этой панели.');
    ctx.session = ctx.session || {};
    ctx.session.adminState = null;
    await ctx.reply('🛠 <b>Панель управления</b>', { parse_mode: 'HTML', ...getAdminMainMenu() });
  });

  // ==========================================
  // Обработчик текстовых сообщений (состояния)
  // ==========================================
  bot.on('text', async (ctx, next) => {
    ctx.session = ctx.session || {};
    if (!ctx.session.adminState) {
      await next();
      return;
    }
    if (!isAdmin(ctx.from.id)) return;
    
    const state = ctx.session.adminState;
    const text = ctx.message.text;

    // ==========================================
    // 💰 ФИНАНСЫ: Обработчики ввода данных
    // ==========================================
    
    // ==========================================
    // 💰 ФИНАНСЫ: ВВОД НАЧАЛЬНОЙ ДАТЫ (Шаг 1/2)
    // ==========================================
    if (state.startsWith('finance_date_start:')) {
      const section = state.split(':')[1]; // revenue, profit, expenses, executors
      
      const dateMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!dateMatch) {
        return ctx.reply('❌ Неверный формат даты. Введите в формате <code>ДД.ММ.ГГГГ</code>, например: <code>01.09.2026</code>', { parse_mode: 'HTML' });
      }
      
      const [, day, month, year] = dateMatch;
      const fromDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      
      if (isNaN(fromDate.getTime())) {
        return ctx.reply('❌ Некорректная дата. Проверьте правильность.');
      }
      
      // Сохраняем начальную дату в сессию
      ctx.session.financeFromDate = fromDate;
      ctx.session.adminState = `finance_date_end:${section}`;
      
      const sectionNames = {
        revenue: 'Выручка',
        profit: 'Прибыль',
        expenses: 'Расход комиссии',
        executors: 'Заработок исполнителей'
      };
      
      await ctx.reply(
        `✅ <b>Начальная дата:</b> ${fromDate.toLocaleDateString('ru-RU')}\n\n` +
        `📝 <b>Шаг 2/2: Введите КОНЕЧНУЮ дату</b>\n` +
        `Формат: <code>ДД.ММ.ГГГГ</code>\nНапример: <code>30.09.2026</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `admin:finance_${section}`)]])
        }
      );
      return;
    }
    
    // ==========================================
    // 💰 ФИНАНСЫ: ВВОД КОНЕЧНОЙ ДАТЫ (Шаг 2/2)
    // ==========================================
    if (state.startsWith('finance_date_end:')) {
      const section = state.split(':')[1];
      
      const dateMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!dateMatch) {
        return ctx.reply('❌ Неверный формат даты. Введите в формате <code>ДД.ММ.ГГГГ</code>, например: <code>30.09.2026</code>', { parse_mode: 'HTML' });
      }
      
      const [, day, month, year] = dateMatch;
      const toDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      
      if (isNaN(toDate.getTime())) {
        return ctx.reply('❌ Некорректная дата. Проверьте правильность.');
      }
      
      const fromDate = ctx.session.financeFromDate;
      
      // Проверяем, что конечная дата не раньше начальной
      if (toDate < fromDate) {
        return ctx.reply('❌ Конечная дата не может быть раньше начальной. Попробуйте ещё раз.');
      }
      
      // Очищаем сессию
      ctx.session.financeFromDate = null;
      ctx.session.adminState = null;
      
      // Рассчитываем статистику
      const stats = calculateFinancialStats('from_date', fromDate, toDate);
      const periodLabel = getPeriodLabel('from_date', fromDate, toDate);
      
      let textMsg = '';
      let backAction = '';
      
      if (section === 'revenue') {
        backAction = 'finance_revenue';
        textMsg = `📊 <b>Выручка</b>\n${periodLabel}\n\n`;
        textMsg += `💰 <b>Выручка:</b> ${stats.revenue.toLocaleString('ru-RU')} ₽\n`;
        textMsg += `📦 <b>Заказов:</b> ${stats.ordersCount}\n`;
        textMsg += `👷 <b>Выплачено исполнителям:</b> ${stats.executorEarnings.toLocaleString('ru-RU')} ₽\n`;
        textMsg += `📈 <b>Валовая комиссия:</b> ${stats.totalCommission.toLocaleString('ru-RU')} ₽\n`;
      } else if (section === 'profit') {
        backAction = 'finance_profit';
        textMsg = `📈 <b>Прибыль</b>\n${periodLabel}\n\n`;
        textMsg += `📊 <b>Комиссия общая:</b> ${stats.totalCommission.toLocaleString('ru-RU')} ₽\n`;
        textMsg += `🎁 <b>Покрытие скидок:</b> -${stats.discountCoverage.toLocaleString('ru-RU')} ₽\n`;
        textMsg += `📊 <b>Комиссия чистая:</b> ${stats.netCommission.toLocaleString('ru-RU')} ₽\n\n`;
        
        if (stats.coOwnersShares.length > 0) {
          textMsg += `👥 <b>Совладельцы:</b>\n`;
          stats.coOwnersShares.forEach(co => {
            const name = co.username ? `@${co.username}` : `ID: ${co.id}`;
            textMsg += `  • ${name}: ${co.percent}% = ${co.share.toLocaleString('ru-RU')} ₽\n`;
          });
          textMsg += `  <b>Итого совладельцам:</b> ${stats.coOwnersTotal.toLocaleString('ru-RU')} ₽\n\n`;
        }
        
        textMsg += `⚙️ <b>Константа расходов (${stats.expenseConstant}%):</b> ${stats.expenseConstantAmount.toLocaleString('ru-RU')} ₽\n\n`;
        textMsg += `💰 <b>Чистая прибыль:</b> ${stats.netProfit.toLocaleString('ru-RU')} ₽\n`;
        if (stats.netProfit < 0) textMsg += `\n⚠️ <b>Внимание: убыток!</b>`;
      } else if (section === 'expenses') {
        backAction = 'finance_expenses';
        textMsg = `📉 <b>Расход комиссии</b>\n${periodLabel}\n\n`;
        textMsg += `🎁 <b>Покрытие скидок:</b> ${stats.discountCoverage.toLocaleString('ru-RU')} ₽\n`;
        textMsg += `📊 <b>Комиссия общая:</b> ${stats.totalCommission.toLocaleString('ru-RU')} ₽\n`;
        textMsg += `📊 <b>Комиссия чистая:</b> ${stats.netCommission.toLocaleString('ru-RU')} ₽\n\n`;
        textMsg += `⚙️ <b>Константа расходов:</b> ${stats.expenseConstant}%\n`;
        textMsg += `💸 <b>Сумма константы:</b> ${stats.expenseConstantAmount.toLocaleString('ru-RU')} ₽\n\n`;
        const remainingFund = stats.expenseConstantAmount - stats.discountCoverage;
        if (remainingFund >= 0) {
          textMsg += `✅ <b>Остаток фонда:</b> ${remainingFund.toLocaleString('ru-RU')} ₽`;
        } else {
          textMsg += `⚠️ <b>Перерасход фонда:</b> ${Math.abs(remainingFund).toLocaleString('ru-RU')} ₽`;
        }
      } else if (section === 'executors') {
        backAction = 'finance_executors';
        textMsg = `👷 <b>Заработок исполнителей</b>\n${periodLabel}\n\n`;
        textMsg += `💰 <b>Выплачено исполнителям:</b> ${stats.executorEarnings.toLocaleString('ru-RU')} ₽\n`;
        textMsg += `📦 <b>Заказов:</b> ${stats.ordersCount}\n`;
        textMsg += `💵 <b>Выручка:</b> ${stats.revenue.toLocaleString('ru-RU')} ₽\n`;
        const avgEarning = stats.ordersCount > 0 ? Math.round(stats.executorEarnings / stats.ordersCount) : 0;
        textMsg += `📊 <b>Средний заработок за заказ:</b> ${avgEarning.toLocaleString('ru-RU')} ₽\n`;
      }
      
      await ctx.reply(textMsg, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Другой период', `admin:${backAction}`)],
          [Markup.button.callback('⬅️ Финансы', 'admin:finance')]
        ])
      });
      return;
    }
    
    // --- ДОБАВЛЕНИЕ СОВЛАДЕЛЬЦА: Шаг 1 - ID ---
    if (state === 'finance_add_coowner_id') {
      if (isNaN(text)) {
        return ctx.reply('❌ ID должен быть числом. Введите Telegram ID совладельца.');
      }
      
      ctx.session.tempCoOwnerId = text.trim();
      ctx.session.adminState = 'finance_add_coowner_username';
      
      await ctx.reply(
        `👤 <b>ID принят:</b> \`${text}\`\n\n📝 <b>Шаг 2/3: Введите username совладельца (без @):</b>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', 'admin:finance_coowners')]]) }
      );
      return;
    }
    
    // --- ДОБАВЛЕНИЕ СОВЛАДЕЛЬЦА: Шаг 2 - Username ---
    if (state === 'finance_add_coowner_username') {
      const username = text.replace('@', '').trim();
      if (!username) {
        return ctx.reply('❌ Username не может быть пустым.');
      }
      
      ctx.session.tempCoOwnerUsername = username;
      ctx.session.adminState = 'finance_add_coowner_percent';
      
      await ctx.reply(
        `📛 <b>Username принят:</b> @${username}\n\n📊 <b>Шаг 3/3: Введите процент дохода совладельца (0-100):</b>\n\n<i>Процент считается от изначальной комиссии до вычета скидок.</i>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', 'admin:finance_coowners')]]) }
      );
      return;
    }
    
    // --- ДОБАВЛЕНИЕ СОВЛАДЕЛЬЦА: Шаг 3 - Процент ---
    if (state === 'finance_add_coowner_percent') {
      if (isNaN(text)) {
        return ctx.reply('❌ Процент должен быть числом.');
      }
      
      const percent = parseInt(text);
      if (percent < 0 || percent > 100) {
        return ctx.reply('❌ Процент должен быть в диапазоне от 0 до 100.');
      }
      
      const coOwnerId = ctx.session.tempCoOwnerId;
      const coOwnerUsername = ctx.session.tempCoOwnerUsername;
      
      // Проверяем, не превысит ли сумма процентов 100%
      const currentTotal = finance.getTotalCoOwnersPercent();
      const expenseConstant = finance.getExpenseConstant();
      const newTotal = currentTotal + percent + expenseConstant;
      
      if (newTotal > 100) {
        return ctx.reply(
          `❌ <b>Превышен лимит 100%!</b>\n\n` +
          `Текущая сумма: ${currentTotal}% (совладельцы) + ${expenseConstant}% (константа) = ${currentTotal + expenseConstant}%\n` +
          `Новый процент: ${percent}%\n` +
          `Итого будет: ${newTotal}%\n\n` +
          `Уменьшите процент или удалите других совладельцев.`
        );
      }
      
      // Добавляем совладельца
      finance.addCoOwner(coOwnerId, coOwnerUsername, percent);
      
      // Логируем действие
      logger.logAdminAction('coowner_added', {
        coOwnerId: coOwnerId,
        username: coOwnerUsername,
        percent: percent
      }, ctx);
      
      // Очищаем временные данные
      ctx.session.tempCoOwnerId = null;
      ctx.session.tempCoOwnerUsername = null;
      ctx.session.adminState = null;
      
      await ctx.reply(
        `✅ <b>Совладелец добавлен!</b>\n\n` +
        `👤 <b>ID:</b> \`${coOwnerId}\`\n` +
        `📛 <b>Username:</b> @${coOwnerUsername}\n` +
        `📊 <b>Процент:</b> ${percent}%`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('👥 К списку совладельцев', 'admin:finance_coowners')],
            [Markup.button.callback('⬅️ Финансы', 'admin:finance')]
          ])
        }
      );
      return;
    }
    
    // --- ИЗМЕНЕНИЕ ПРОЦЕНТА СОВЛАДЕЛЬЦА ---
    if (state.startsWith('finance_edit_coowner_percent:')) {
      const coOwnerId = state.split(':')[1];
      
      if (isNaN(text)) {
        return ctx.reply('❌ Процент должен быть числом.');
      }
      
      const newPercent = parseInt(text);
      if (newPercent < 0 || newPercent > 100) {
        return ctx.reply('❌ Процент должен быть в диапазоне от 0 до 100.');
      }
      
      // Проверяем лимит
      const coOwners = finance.getCoOwners();
      const coOwner = coOwners.find(c => String(c.id) === String(coOwnerId));
      if (!coOwner) {
        ctx.session.adminState = null;
        return ctx.reply('❌ Совладелец не найден.');
      }
      
      const otherCoOwnersTotal = coOwners
        .filter(c => String(c.id) !== String(coOwnerId))
        .reduce((sum, c) => sum + (c.percent || 0), 0);
      
      const expenseConstant = finance.getExpenseConstant();
      const newTotal = otherCoOwnersTotal + newPercent + expenseConstant;
      
      if (newTotal > 100) {
        return ctx.reply(
          `❌ <b>Превышен лимит 100%!</b>\n\n` +
          `Другие совладельцы: ${otherCoOwnersTotal}%\n` +
          `Константа: ${expenseConstant}%\n` +
          `Новый процент: ${newPercent}%\n` +
          `Итого будет: ${newTotal}%`
        );
      }
      
      const oldPercent = coOwner.percent;
      finance.updateCoOwnerPercent(coOwnerId, newPercent);
      
      logger.logAdminAction('coowner_percent_changed', {
        coOwnerId: coOwnerId,
        oldPercent: oldPercent,
        newPercent: newPercent
      }, ctx);
      
      ctx.session.adminState = null;
      
      const name = coOwner.username ? `@${coOwner.username}` : coOwnerId;
      await ctx.reply(
        `✅ <b>Процент совладельца изменён!</b>\n\n` +
        `👤 <b>Совладелец:</b> ${name}\n` +
        `📊 <b>Было:</b> ${oldPercent}%\n` +
        `📊 <b>Стало:</b> ${newPercent}%`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('👥 К списку совладельцев', 'admin:finance_coowners')],
            [Markup.button.callback('⬅️ Финансы', 'admin:finance')]
          ])
        }
      );
      return;
    }
    
    // --- ИЗМЕНЕНИЕ КОНСТАНТЫ РАСХОДОВ ---
    if (state === 'finance_edit_constant') {
      if (isNaN(text)) {
        return ctx.reply('❌ Константа должна быть числом.');
      }
      
      const newConstant = parseInt(text);
      if (newConstant < 0 || newConstant > 100) {
        return ctx.reply('❌ Константа должна быть в диапазоне от 0 до 100.');
      }
      
      // Проверяем лимит с совладельцами
      const coOwnersTotal = finance.getTotalCoOwnersPercent();
      const newTotal = coOwnersTotal + newConstant;
      
      if (newTotal > 100) {
        return ctx.reply(
          `❌ <b>Превышен лимит 100%!</b>\n\n` +
          `Совладельцы: ${coOwnersTotal}%\n` +
          `Новая константа: ${newConstant}%\n` +
          `Итого будет: ${newTotal}%\n\n` +
          `Уменьшите значение или удалите совладельцев.`
        );
      }
      
      const oldConstant = finance.getExpenseConstant();
      finance.setExpenseConstant(newConstant);
      
      logger.logAdminAction('expense_constant_changed', {
        oldConstant: oldConstant,
        newConstant: newConstant
      }, ctx);
      
      ctx.session.adminState = null;
      
      await ctx.reply(
        `✅ <b>Константа расходов изменена!</b>\n\n` +
        `📊 <b>Было:</b> ${oldConstant}%\n` +
        `📊 <b>Стало:</b> ${newConstant}%\n\n` +
        `Константа используется для:\n` +
        `• Покрытия скидок пользователей\n` +
        `• Оплаты бота\n` +
        `• Прочих расходов`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📉 Расход комиссии', 'admin:finance_expenses')],
            [Markup.button.callback('📈 Прибыль', 'admin:finance_profit')],
            [Markup.button.callback('⬅️ Финансы', 'admin:finance')]
          ])
        }
      );
      return;
    }

    // --- СПЕЦИАЛЬНОСТИ: Добавление ---
    if (state === 'awaiting_specialty_name') {
      ctx.session.tempSpecialtyName = text;
      ctx.session.adminState = 'awaiting_specialty_emoji';
      await ctx.reply(
        `🎓 <b>Специальность:</b> ${text}\n\nТеперь введите эмодзи (например: 🚢, ⚙️, 📐):`,
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
      return;
    }

    // --- ПРИВЯЗКА ЗАКАЗА К ЧАТУ ---
    if (state.startsWith('order_bind_chat:')) {
      const orderId = state.split(':')[1];
      const chatEnv = text.trim();
      const chatId = process.env[chatEnv];

      if (!chatId) {
        return ctx.reply(`❌ Переменная \`${chatEnv}\` не найдена в .env или не имеет значения.`);
      }

      const order = ordersDb.getOrder(orderId);
      if (!order) {
        ctx.session.adminState = null;
        return ctx.reply('❌ Заказ не найден.');
      }

      ordersDb.updateOrder(orderId, {
        managerChatId: chatId,
        managerChatEnv: chatEnv
      });

      logger.logAdminAction('order_bound_to_chat', {
        orderId: orderId,
        orderNumber: order.orderNumber,
        chatEnv: chatEnv,
        chatId: chatId
      }, ctx);

      await ctx.reply(
        `✅ <b>Заказ привязан к чату!</b>\n\n` +
        `📦 <b>Заказ:</b> №${order.orderNumber}\n` +
        `💬 <b>Чат:</b> \`${chatEnv}\` (ID: ${chatId})`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К заказу', `admin:order_view:${orderId}`)]])
        }
      );
      ctx.session.adminState = null;
      return;
    }

    if (state === 'awaiting_specialty_emoji') {
      const name = ctx.session.tempSpecialtyName;
      const emoji = text.trim();
      const newSpecialty = catalog.addSpecialty(name, emoji);
      logger.logAdminAction('specialty_added', { specialtyId: newSpecialty.id, name }, ctx);
      await ctx.reply(
        `✅ <b>Специальность добавлена!</b>\n\n${emoji} <b>Название:</b> ${name}\n<b>ID:</b> \`${newSpecialty.id}\``,
        { parse_mode: 'HTML', ...getCatalogSpecialtiesMenu() }
      );
      ctx.session.tempSpecialtyName = null;
      ctx.session.adminState = null;
      return;
    }

    // --- СПЕЦИАЛЬНОСТИ: Редактирование названия ---
    if (state.startsWith('edit_specialty_name:')) {
      const specialtyId = state.split(':')[1];
      catalog.updateSpecialty(specialtyId, { name: text });
      await ctx.reply(
        `✅ <b>Название специальности изменено на:</b> <b>${text}</b>`,
        { parse_mode: 'HTML', ...getCatalogSpecialtiesMenu() }
      );
      ctx.session.adminState = null;
      return;
    }

    // --- КАТАЛОГ: Добавление/Изменение ---
    if (state === 'awaiting_course_name') {
      const specialtyId = ctx.session.tempCourseSpecialty || 'navigation';
      const courses = catalog.getData().courses;
      const newId = `course${Date.now()}`;
      courses.push({ id: newId, name: text, specialty: specialtyId });
      catalog.saveData({ ...catalog.getData(), courses });
      
      const specialty = catalog.getSpecialtyById(specialtyId);
      await ctx.reply(
        `✅ <b>Курс добавлен!</b>\n\n<b>Название:</b> ${text}\n<b>Специальность:</b> ${specialty ? specialty.name : specialtyId}\n<b>ID:</b> \`${newId}\``,
        { parse_mode: 'HTML', ...getSpecialtyCourses(specialtyId) }
      );
      ctx.session.tempCourseSpecialty = null;
      ctx.session.adminState = null;
      return;
    }
    if (state.startsWith('awaiting_subject_name:')) {
      const courseId = state.split(':')[1];
      const course = catalog.getCourse(courseId);
      const subjects = catalog.getData().subjects;
      subjects.push({ 
        id: `subj${Date.now()}`, 
        courseId, 
        name: text,
        specialty: course ? course.specialty : 'navigation'
      });
      catalog.saveData({ ...catalog.getData(), subjects });
      await ctx.reply(`✅ <b>Предмет добавлен!</b>\n\n<b>Название:</b> ${text}`, { parse_mode: 'HTML', ...getCourseSubjects(courseId) });
      ctx.session.adminState = null; return;
    }
    if (state.startsWith('edit_course_name:')) {
      const courseId = state.split(':')[1];
      const data = catalog.getData();
      const idx = data.courses.findIndex(c => c.id === courseId);
      if (idx !== -1) {
        const oldName = data.courses[idx].name;
        data.courses[idx].name = text;
        catalog.saveData(data);
        const specialtyId = catalog.getCourse(courseId) ? catalog.getCourse(courseId).specialty : 'navigation';
        await ctx.reply(`✅ <b>Название курса изменено!</b>\n\n📝 <b>Было:</b> ${oldName}\n📝 <b>Стало:</b> ${text}`, { parse_mode: 'HTML', ...getSpecialtyCourses(specialtyId) });
      }
      ctx.session.adminState = null; return;
    }
    if (state.startsWith('edit_subject_name:')) {
      const subjectId = state.split(':')[1];
      const data = catalog.getData();
      const idx = data.subjects.findIndex(s => s.id === subjectId);
      if (idx !== -1) {
        const oldName = data.subjects[idx].name;
        const courseId = data.subjects[idx].courseId;
        data.subjects[idx].name = text;
        catalog.saveData(data);
        await ctx.reply(`✅ <b>Название предмета изменено!</b>\n\n📝 <b>Было:</b> ${oldName}\n📝 <b>Стало:</b> ${text}`, { parse_mode: 'HTML', ...getCourseSubjects(courseId) });
      }
      ctx.session.adminState = null; return;
    }

    // ==========================================
    // 🌟 ДОБАВЛЕНИЕ ОБЩЕЙ РАБОТЫ (без курса/предмета)
    // ==========================================
    if (state.startsWith('add_general_work_title:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.title = text;
      ctx.session.adminState = `add_general_work_description:${specialtyId}`;
      await ctx.reply('📄 <b>Шаг 2/9: Введите описание работы (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_work_description:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.description = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.adminState = `add_general_work_price:${specialtyId}`;
      await ctx.reply('💵 <b>Шаг 3/9: Введите цену (только число):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_work_price:')) {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом.');
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.price = parseInt(text);
      ctx.session.adminState = `add_general_work_commission:${specialtyId}`;
      await ctx.reply('📊 <b>Шаг 4/9: Введите комиссию в %:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_work_commission:')) {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_general_work_chatEnv:${specialtyId}`;
      const envVars = getAvailableEnvVars();
      let message = '💬 <b>Шаг 5/9: Имя переменной окружения для чата</b>\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной:`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_work_chatEnv:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_general_work_paymentEnv:${specialtyId}`;
      const envVars = getAvailableEnvVars();
      let message = '💳 <b>Шаг 6/9: Имя переменной окружения для оплаты</b>\n\n';
      message += formatEnvVarsList(envVars.paymentVars, 'payment');
      message += `\nОтправьте имя переменной:`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_work_paymentEnv:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_general_work_needs:${specialtyId}`;
      await ctx.reply(
        '📎 <b>Шаг 7/9: Требования к заказу</b>\n\n' +
        'Отправьте через запятую или напишите "нет":\n\n' +
        '• <code>photo</code>\n' +
        '• <code>details</code>\n' +
        '• <code>variant</code>\n' +
        '• <code>details, photo</code>\n\n' +
        'Введите требования:',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      ); return;
    }
    if (state.startsWith('add_general_work_needs:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.needs = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.adminState = `add_general_work_prompt:${specialtyId}`;
      await ctx.reply('📌 <b>Шаг 8/9: Введите подсказку для заказчика (prompt):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_work_prompt:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      ctx.session.adminState = `add_general_work_exampleUrl:${specialtyId}`;
      await ctx.reply('🔗 <b>Шаг 9/9: Ссылка на примеры работ (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_work_exampleUrl:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.exampleUrl = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.tempWorkData.specialty = specialtyId;
      // 🌟 subjectId и courseId остаются null — это общая работа
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });
      logger.logAdminAction('catalog_general_work_added', {
        workId: ctx.session.tempWorkData.id,
        title: ctx.session.tempWorkData.title,
        specialty: specialtyId
      }, ctx);
      await ctx.reply(
        `✅ <b>Общая работа добавлена!</b>\n\n📝 <b>${ctx.session.tempWorkData.title}</b>\n💰 ${ctx.session.tempWorkData.price} ₽`,
        { parse_mode: 'HTML', ...getGeneralWorks(specialtyId) }
      );
      ctx.session.adminState = null; ctx.session.tempWorkData = null; return;
    }

    // ==========================================
    // 🌟 ДОБАВЛЕНИЕ ОБЩЕГО ИНДИВИДУАЛЬНОГО ЗАКАЗА
    // ==========================================
    if (state.startsWith('add_general_custom_work_title:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.title = text;
      ctx.session.adminState = `add_general_custom_work_description:${specialtyId}`;
      await ctx.reply('📄 <b>Шаг 2/7: Введите описание (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_custom_work_description:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.description = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.adminState = `add_general_custom_work_commission:${specialtyId}`;
      await ctx.reply('📊 <b>Шаг 3/7: Введите комиссию в %:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_custom_work_commission:')) {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_general_custom_work_chatEnv:${specialtyId}`;
      const envVars = getAvailableEnvVars();
      let message = '💬 <b>Шаг 4/7: Имя переменной окружения для чата</b>\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной:`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_custom_work_chatEnv:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_general_custom_work_paymentEnv:${specialtyId}`;
      const envVars = getAvailableEnvVars();
      let message = '💳 <b>Шаг 5/7: Имя переменной окружения для оплаты</b>\n\n';
      message += formatEnvVarsList(envVars.paymentVars, 'payment');
      message += `\nОтправьте имя переменной:`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_custom_work_paymentEnv:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_general_custom_work_prompt:${specialtyId}`;
      await ctx.reply('📌 <b>Шаг 6/7: Введите подсказку для заказчика (prompt):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_custom_work_prompt:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      ctx.session.adminState = `add_general_custom_work_exampleUrl:${specialtyId}`;
      await ctx.reply('🔗 <b>Шаг 7/7: Ссылка на примеры работ (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_general_custom_work_exampleUrl:')) {
      const specialtyId = state.split(':')[1];
      ctx.session.tempWorkData.exampleUrl = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.tempWorkData.specialty = specialtyId;
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.tempWorkData.price = 0;
      ctx.session.tempWorkData.needs = [];
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });
      await ctx.reply(
        `✅ <b>Общий индивидуальный заказ добавлен!</b>\n\n🌟 <b>${escapeHtml(ctx.session.tempWorkData.title)}</b>\n📊 Комиссия: ${ctx.session.tempWorkData.commission}%`,
        { parse_mode: 'HTML', ...getGeneralWorks(specialtyId) }
      );
      ctx.session.adminState = null; ctx.session.tempWorkData = null; return;
    }

    // ==========================================
    // 🌟 ДОБАВЛЕНИЕ ОБЩЕЙ РАБОТЫ КУРСА (без предмета)
    // ==========================================
    if (state.startsWith('add_course_general_work_title:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.title = text;
      ctx.session.adminState = `add_course_general_work_desc:${courseId}`;
      await ctx.reply('📄 <b>Шаг 2/9: Введите описание работы (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_work_desc:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.description = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.adminState = `add_course_general_work_price:${courseId}`;
      await ctx.reply('💵 <b>Шаг 3/9: Введите цену (только число):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_work_price:')) {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом.');
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.price = parseInt(text);
      ctx.session.adminState = `add_course_general_work_comm:${courseId}`;
      await ctx.reply('📊 <b>Шаг 4/9: Введите комиссию в %:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_work_comm:')) {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_course_general_work_chat:${courseId}`;
      const envVars = getAvailableEnvVars();
      let message = '💬 <b>Шаг 5/9: Имя переменной окружения для чата</b>\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной:`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_work_chat:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_course_general_work_pay:${courseId}`;
      const envVars = getAvailableEnvVars();
      let message = '💳 <b>Шаг 6/9: Имя переменной окружения для оплаты</b>\n\n';
      message += formatEnvVarsList(envVars.paymentVars, 'payment');
      message += `\nОтправьте имя переменной:`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_work_pay:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_course_general_work_needs:${courseId}`;
      await ctx.reply(
        '📎 <b>Шаг 7/9: Требования к заказу</b>\n\n' +
        'Отправьте через запятую или напишите "нет":\n\n' +
        '• <code>photo</code>\n' +
        '• <code>details</code>\n' +
        '• <code>variant</code>\n' +
        '• <code>details, photo</code>\n\n' +
        'Введите требования:',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      ); return;
    }
    if (state.startsWith('add_course_general_work_needs:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.needs = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.adminState = `add_course_general_work_prompt:${courseId}`;
      await ctx.reply('📌 <b>Шаг 8/9: Введите подсказку для заказчика (prompt):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_work_prompt:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      ctx.session.adminState = `add_course_general_work_url:${courseId}`;
      await ctx.reply('🔗 <b>Шаг 9/9: Ссылка на примеры работ (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_work_url:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.exampleUrl = text.toLowerCase() === 'нет' ? '' : text;
      // Наследуем специальность от курса
      const course = catalog.getCourse(courseId);
      ctx.session.tempWorkData.specialty = course ? course.specialty : 'navigation';
      ctx.session.tempWorkData.subjectId = null; // без предмета
      ctx.session.tempWorkData.courseId = courseId; // привязка к курсу
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });
      logger.logAdminAction('catalog_course_general_work_added', {
        workId: ctx.session.tempWorkData.id,
        title: ctx.session.tempWorkData.title,
        courseId: courseId
      }, ctx);
      await ctx.reply(
        `✅ <b>Общая работа курса добавлена!</b>\n\n📝 <b>${ctx.session.tempWorkData.title}</b>\n💰 ${ctx.session.tempWorkData.price} ₽`,
        { parse_mode: 'HTML', ...getCourseGeneralWorks(courseId) }
      );
      ctx.session.adminState = null; ctx.session.tempWorkData = null; return;
    }

    // ==========================================
    // 🌟 ДОБАВЛЕНИЕ ОБЩЕГО ИНДИВИДУАЛЬНОГО ЗАКАЗА КУРСА
    // ==========================================
    if (state.startsWith('add_course_general_custom_work_title:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.title = text;
      ctx.session.adminState = `add_course_general_custom_work_desc:${courseId}`;
      await ctx.reply('📄 <b>Шаг 2/7: Введите описание (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_custom_work_desc:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.description = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.adminState = `add_course_general_custom_work_comm:${courseId}`;
      await ctx.reply('📊 <b>Шаг 3/7: Введите комиссию в %:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_custom_work_comm:')) {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_course_general_custom_work_chat:${courseId}`;
      const envVars = getAvailableEnvVars();
      let message = '💬 <b>Шаг 4/7: Имя переменной окружения для чата</b>\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной:`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_custom_work_chat:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_course_general_custom_work_pay:${courseId}`;
      const envVars = getAvailableEnvVars();
      let message = '💳 <b>Шаг 5/7: Имя переменной окружения для оплаты</b>\n\n';
      message += formatEnvVarsList(envVars.paymentVars, 'payment');
      message += `\nОтправьте имя переменной:`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_custom_work_pay:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_course_general_custom_work_prompt:${courseId}`;
      await ctx.reply('📌 <b>Шаг 6/7: Введите подсказку для заказчика (prompt):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_custom_work_prompt:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      ctx.session.adminState = `add_course_general_custom_work_url:${courseId}`;
      await ctx.reply('🔗 <b>Шаг 7/7: Ссылка на примеры работ (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_course_general_custom_work_url:')) {
      const courseId = state.split(':')[1];
      ctx.session.tempWorkData.exampleUrl = text.toLowerCase() === 'нет' ? '' : text;
      const course = catalog.getCourse(courseId);
      ctx.session.tempWorkData.specialty = course ? course.specialty : 'navigation';
      ctx.session.tempWorkData.subjectId = null;
      ctx.session.tempWorkData.courseId = courseId;
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.tempWorkData.price = 0;
      ctx.session.tempWorkData.needs = [];
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });
      logger.logAdminAction('catalog_course_general_custom_work_added', {
        workId: ctx.session.tempWorkData.id,
        title: ctx.session.tempWorkData.title,
        courseId: courseId
      }, ctx);
      await ctx.reply(
        `✅ <b>Общий индивидуальный заказ добавлен!</b>\n\n🌟 <b>${escapeHtml(ctx.session.tempWorkData.title)}</b>\n📊 Комиссия: ${ctx.session.tempWorkData.commission}%`,
        { parse_mode: 'HTML', ...getCourseGeneralWorks(courseId) }
      );
      ctx.session.adminState = null; ctx.session.tempWorkData = null; return;
    }

    // --- КАТАЛОГ: Добавление работы ---
    if (state.startsWith('add_work_title:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData = { subjectId, title: text };
      ctx.session.adminState = `add_work_description:${subjectId}`;
      await ctx.reply('📄 <b>Шаг 2/9: Введите описание работы (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
     if (state.startsWith('add_work_description:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.description = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.adminState = `add_work_price:${subjectId}`;
      await ctx.reply('💵 <b>Шаг 3/9: Введите цену (только число):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_title:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData = { subjectId, title: text, isCustomOrder: true };
      ctx.session.adminState = `add_custom_work_description:${subjectId}`;
      await ctx.reply('📄 <b>Шаг 2/7: Введите описание индивидуального заказа (или "нет"):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
     if (state.startsWith('add_custom_work_description:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.description = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.adminState = `add_custom_work_commission:${subjectId}`;
      await ctx.reply('📊 <b>Шаг 3/7: Введите комиссию в %:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_commission:')) {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_custom_work_chatEnv:${state.split(':')[1]}`;
      
      // 🌟 Показываем доступные переменные чатов
      const envVars = getAvailableEnvVars();
      let message = '💬 <b>Шаг 4/7: Имя переменной окружения для чата исполнителей</b>\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_chatEnv:')) {
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_custom_work_paymentEnv:${state.split(':')[1]}`;
      
      // 🌟 Показываем доступные переменные оплаты
      const envVars = getAvailableEnvVars();
      let message = '💳 <b>Шаг 5/7: Имя переменной окружения для оплаты</b>\n\n';
      message += formatEnvVarsList(envVars.paymentVars, 'payment');
      message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_paymentEnv:')) {
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_custom_work_prompt:${state.split(':')[1]}`;
      await ctx.reply('📌 <b>Шаг 6/7: Введите подсказку для заказчика (prompt):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_prompt:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      ctx.session.adminState = `add_custom_work_exampleUrl:${subjectId}`;
      await ctx.reply('🔗 <b>Шаг 7/7: Ссылка на примеры работ (или "нет", если нет):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    // 🌟 НОВЫЙ ШАГ: exampleUrl для индивидуального заказа
    if (state.startsWith('add_custom_work_exampleUrl:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.exampleUrl = text.toLowerCase() === 'нет' ? '' : text;
      
      // Наследуем специальность от предмета/курса
      const subject = catalog.getSubject(subjectId);
      const course = subject ? catalog.getCourse(subject.courseId) : null;
      ctx.session.tempWorkData.specialty = course ? course.specialty : 'navigation';
      
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.tempWorkData.price = 0;
      ctx.session.tempWorkData.needs = [];
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });
      
      await ctx.reply(`✅ <b>Индивидуальный заказ добавлен!</b>\n\n🌟 <b>${escapeHtml(ctx.session.tempWorkData.title)}</b>\n📊 Комиссия: ${ctx.session.tempWorkData.commission}%`, { parse_mode: 'HTML', ...getSubjectWorks(subjectId) });
      ctx.session.adminState = null; ctx.session.tempWorkData = null; return;
    }
    if (state.startsWith('add_work_price:')) {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом.');
      ctx.session.tempWorkData.price = parseInt(text);
      ctx.session.adminState = `add_work_commission:${state.split(':')[1]}`;
      await ctx.reply('📊 <b>Шаг 4/9: Введите комиссию в %:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_commission:')) {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_work_chatEnv:${state.split(':')[1]}`;
      
      // 🌟 Показываем доступные переменные чатов
      const envVars = getAvailableEnvVars();
      let message = '💬 <b>Шаг 5/9: Имя переменной окружения для чата</b>\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_chatEnv:')) {
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_work_paymentEnv:${state.split(':')[1]}`;
      
      // 🌟 Показываем доступные переменные оплаты
      const envVars = getAvailableEnvVars();
      let message = '💳 <b>Шаг 6/9: Имя переменной окружения для оплаты</b>\n\n';
      message += formatEnvVarsList(envVars.paymentVars, 'payment');
      message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_paymentEnv:')) {
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_work_needs:${state.split(':')[1]}`;
      await ctx.reply(
        '📎 <b>Шаг 7/9: Требования к заказу</b>\n\n' +
        'Отправьте через запятую или напишите "нет":\n\n' +
        '• <code>photo</code>\n' +
        '• <code>details</code>\n' +
        '• <code>variant</code>\n' +
        '• <code>details, photo</code>\n\n' +
        'Введите требования:',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      ); return;
    }
    if (state.startsWith('add_work_needs:')) {
      ctx.session.tempWorkData.needs = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.adminState = `add_work_prompt:${state.split(':')[1]}`;
      await ctx.reply('📌 <b>Шаг 8/9: Введите подсказку для заказчика (prompt):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_prompt:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      ctx.session.adminState = `add_work_exampleUrl:${subjectId}`;
      await ctx.reply('🔗 <b>Шаг 9/9: Ссылка на примеры работ (или "нет", если нет):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    // 🌟 НОВЫЙ ШАГ: exampleUrl для обычной работы
    if (state.startsWith('add_work_exampleUrl:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.exampleUrl = text.toLowerCase() === 'нет' ? '' : text;
      
      // Наследуем специальность от предмета/курса
      const subject = catalog.getSubject(subjectId);
      const course = subject ? catalog.getCourse(subject.courseId) : null;
      ctx.session.tempWorkData.specialty = course ? course.specialty : 'navigation';
      
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });
      
      logger.logAdminAction('catalog_work_added', {
        workId: ctx.session.tempWorkData.id,
        title: ctx.session.tempWorkData.title,
        price: ctx.session.tempWorkData.price
      }, ctx);
      
      await ctx.reply(`✅ <b>Работа добавлена!</b>\n\n📝 <b>${ctx.session.tempWorkData.title}</b>\n💰 ${ctx.session.tempWorkData.price} ₽`, { parse_mode: 'HTML', ...getSubjectWorks(subjectId) });
      ctx.session.adminState = null; ctx.session.tempWorkData = null; return;
    }

    // --- КАТАЛОГ: Редактирование работы ---
    if (state.startsWith('edit_work_input:')) {
      const parts = state.split(':');
      const workId = parts[1]; const field = parts[2];
      const data = catalog.getData();
      const workIndex = data.works.findIndex(w => w.id === workId);
      if (workIndex === -1) return ctx.reply('❌ Работа не найдена.');
      
      let value = text;
      if ((field === 'price' || field === 'commission') && isNaN(text)) return ctx.reply('❌ Значение должно быть числом.');
      if (field === 'price' || field === 'commission') value = parseInt(text);
      // 🌟 Преобразуем строку в массив для поля needs
      if (field === 'needs') value = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());
      // 🌟 exampleUrl: "нет" = очистить поле
      if (field === 'exampleUrl') value = text.toLowerCase() === 'нет' ? '' : text;
      data.works[workIndex][field] = value;
      catalog.saveData(data);
      await ctx.reply(`✅ Поле "${field}" обновлено!`, { ...getWorkCard(workId).keyboard });
      ctx.session.adminState = null; return;
    }

    // --- ЗАКАЗЫ: Редактирование заказа ---
    if (state.startsWith('edit_order_input:')) {
      const parts = state.split(':');
      const orderId = parts[1]; const field = parts[2];
      let value = text;
      if ((field === 'price' || field === 'commission') && isNaN(text)) return ctx.reply('❌ Значение должно быть числом.');
      if (field === 'price' || field === 'commission') value = parseInt(text);
      if (field === 'needs') value = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());

      // 🌟 Получаем заказ ДО обновления (для сравнения старой цены)
      const orderBefore = ordersDb.getOrder(orderId);
      const oldPrice = orderBefore ? orderBefore.price : 0;

        // 🌟 При изменении цены пересчитываем итоговую цену с комиссией
      if (field === 'price' && orderBefore && orderBefore.isCustomOrder) {
        const commission = orderBefore.commission || 0;
        const finalPrice = Math.round(value / (1 - commission / 100));
        ordersDb.updateOrder(orderId, { price: value, finalPrice: finalPrice });
      } else {
        ordersDb.updateOrder(orderId, { [field]: value });
      }
      
      const order = ordersDb.getOrder(orderId);

      // 🌟 Логика уведомлений при изменении цены индивидуального заказа
      if (field === 'price' && order.isCustomOrder && order.customerId) {
        const orderNumber = order.orderNumber || orderId;

        if (order.status !== 'paid' && value > 0) {
          // Цена назначена/изменена и заказ НЕ оплачен → уведомляем заказчика
          const isNewPrice = (!oldPrice || oldPrice <= 0);
          const title = isNewPrice
            ? '💰 <b>Назначена цена за ваш заказ</b>'
            : '💰 <b>Цена за ваш заказ изменена</b>';

          const customerMessage =
            `${title}\n\n` +
            `🆔 <b>Номер заказа:</b> №${orderNumber}\n` +
            `📚 <b>Предмет:</b> ${order.subjectName || order.workTitle}\n` +
            `💵 <b>Цена:</b> ${value} ₽\n\n` +
            `Вы можете обсудить цену с исполнителем или перейти к оплате:`;

          const customerKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('✉️ Обсудить цену с исполнителем', `custom_write_executor:${orderNumber}`)],
            [Markup.button.callback('💳 Перейти к оплате', `custom_pay:${orderNumber}`)]
          ]);

          try {
            await ctx.telegram.sendMessage(order.customerId, customerMessage, {
              parse_mode: 'HTML',
              reply_markup: customerKeyboard.reply_markup
            });
          } catch (e) {
            console.log('Не удалось уведомить заказчика о цене:', e.message);
          }
        }
        // Если status === 'paid' — просто обновляем поле, без уведомления
      }

      await ctx.reply(
        `✅ Поле "${field}" обновлено!\n\nНовое значение: <code>${value}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Назад к заказу', `admin:order_view:${orderId}`)]
          ])
        }
      );
      ctx.session.adminState = null; return;
    }

     // --- ИЗМЕНЕНИЕ СУММЫ ВЫКУПА ---
    if (state.startsWith('edit_customer_spent:')) {
      const customerId = state.split(':')[1];
      if (isNaN(text)) return ctx.reply('❌ Сумма должна быть числом.');
      const newAmount = parseInt(text);
      const loyaltyData = loyalty.loadData();
      if (!loyaltyData[customerId]) {
        loyaltyData[customerId] = { username: '', totalSpent: 0 };
      }
      loyaltyData[customerId].totalSpent = newAmount;
      loyalty.saveData(loyaltyData);

      // 🌟 Логируем изменение суммы выкупа
      logger.logAdminAction('customer_spent_changed', {
        customerId: customerId,
        newAmount: newAmount
      }, ctx);

      await ctx.reply(
        `✅ Сумма выкупа для заказчика ${customerId} изменена на ${newAmount} ₽`,
        { parse_mode: 'HTML', ...getAdminMainMenu() }
      );
      ctx.session.adminState = null; return;
    }

    // ==========================================
    // 🌟 УСТАНОВКА СПЕЦИАЛЬНОЙ СКИДКИ
    // ==========================================
    if (state.startsWith('edit_special_discount:')) {
      const customerId = state.split(':')[1];
      
      if (isNaN(text)) {
        return ctx.reply('❌ Скидка должна быть числом. Введите число от 0 до 100.');
      }
      
      const discountPercent = parseInt(text);
      
      if (discountPercent < 0 || discountPercent > 100) {
        return ctx.reply('❌ Скидка должна быть в диапазоне от 0 до 100.');
      }
      
      // Устанавливаем специальную скидку
      loyalty.setSpecialDiscount(customerId, discountPercent);
      
      // 🌟 Логируем действие админа
      logger.logAdminAction('special_discount_set', {
        customerId: customerId,
        discountPercent: discountPercent
      }, ctx);
      
      // Получаем обновлённую информацию о пользователе
      const updatedLoyalty = loyalty.getLoyaltyInfo(customerId);
      const loyaltyData = loyalty.loadData();
      const userData = loyaltyData[customerId] || {};
      
      let successMessage = `✅ <b>Специальная скидка успешно ${discountPercent === 0 ? 'отменена' : 'установлена'}!</b>\n\n`;
      successMessage += `👤 <b>Заказчик:</b> <code>${customerId}</code>\n`;
      successMessage += `📛 <b>Username:</b> ${safeUsername(userData.username)}\n\n`;
      
      if (discountPercent === 0) {
        successMessage += `🏅 <b>Возврат к ранговой скидке:</b> ${updatedLoyalty.discountPercent}% (${updatedLoyalty.rank.name})\n`;
      } else {
        successMessage += `🎯 <b>Специальная скидка:</b> ${discountPercent}%\n`;
        successMessage += `⚠️ <b>Переопределяет ранговую скидку</b>\n`;
      }
      
      await ctx.reply(successMessage, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Вернуться к карточке заказчика', `admin:customer_view:${customerId}`)],
          [Markup.button.callback('👥 К списку заказчиков', 'admin:customers')]
        ])
      });
      
      ctx.session.adminState = null;
      return;
    }

    // ==========================================
    // 🌟 ДОБАВЛЕНИЕ НОВОГО ИСПОЛНИТЕЛЯ (Прометей)
    // ==========================================
    if (state === 'awaiting_new_executor_id') {
      if (isNaN(text)) return ctx.reply('❌ ID должен быть числом.');
      ctx.session.tempRankUserId = text;
      ctx.session.adminState = 'awaiting_new_executor_username';
      await ctx.reply(
        '🔥 <b>Назначение исполнителя (Прометей)</b>\n\n' +
        `👤 <b>ID:</b> <code>${text}</code>\n\n` +
        '📝 <b>Шаг 2/2: Введите username пользователя (без @):</b>',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
      return;
    }

    if (state === 'awaiting_new_executor_username') {
      const userId = ctx.session.tempRankUserId;
      const username = text.replace('@', '').trim();

      const loyaltyData = loyalty.loadData();
      if (!loyaltyData[userId]) {
        loyaltyData[userId] = { username: '', totalSpent: 0 };
      }
      loyaltyData[userId].rank = 'Прометей';
      loyaltyData[userId].username = username;
      loyalty.saveData(loyaltyData);

      // 🌟 Логируем назначение ранга
      logger.logAdminAction('rank_assigned', {
        targetUserId: userId,
        username: username,
        rankName: 'Прометей'
      }, ctx);

      await ctx.reply(
        `🔥 <b>Исполнитель назначен!</b>\n\n` +
        `👤 <b>ID:</b> <code>${userId}</code>\n` +
        `📛 <b>Username:</b> @${username}\n` +
        `🏅 <b>Ранг:</b> Прометей (исполнитель)`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К управлению рангами', 'admin:set_user_rank')]]) }
      );

      ctx.session.adminState = null;
      ctx.session.tempRankUserId = null;
      return;
    }

    // ==========================================
    // 🌟 ДОБАВЛЕНИЕ НОВОГО АДМИНИСТРАТОРА (Посейдон)
    // ==========================================
    if (state === 'awaiting_new_admin_id') {
      if (isNaN(text)) return ctx.reply('❌ ID должен быть числом.');
      ctx.session.tempRankUserId = text;
      ctx.session.adminState = 'awaiting_new_admin_username';
      await ctx.reply(
        '👑 <b>Назначение администратора (Посейдон)</b>\n\n' +
        `👤 <b>ID:</b> <code>${text}</code>\n\n` +
        '📝 <b>Шаг 2/2: Введите username пользователя (без @):</b>',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
      return;
    }

    if (state === 'awaiting_new_admin_username') {
      const userId = ctx.session.tempRankUserId;
      const username = text.replace('@', '').trim();

      const loyaltyData = loyalty.loadData();
      if (!loyaltyData[userId]) {
        loyaltyData[userId] = { username: '', totalSpent: 0 };
      }
      loyaltyData[userId].rank = 'Посейдон';
      loyaltyData[userId].username = username;
      loyalty.saveData(loyaltyData);

      // 🌟 Логируем назначение ранга
      logger.logAdminAction('rank_assigned', {
        targetUserId: userId,
        username: username,
        rankName: 'Посейдон'
      }, ctx);

      await ctx.reply(
        `👑 <b>Администратор назначен!</b>\n\n` +
        `👤 <b>ID:</b> <code>${userId}</code>\n` +
        `📛 <b>Username:</b> @${username}\n` +
        `🏅 <b>Ранг:</b> Посейдон (администратор)`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К управлению рангами', 'admin:set_user_rank')]]) }
      );

      ctx.session.adminState = null;
      ctx.session.tempRankUserId = null;
      return;
    }

    // ==========================================
    // 🌟 ДОБАВЛЕНИЕ НОВОГО УПРАВЛЯЮЩЕГО ОТДЕЛОМ (Циклоп)
    // ==========================================
    if (state === 'awaiting_new_manager_id') {
      if (isNaN(text)) return ctx.reply('❌ ID должен быть числом.');
      ctx.session.tempRankUserId = text;
      ctx.session.adminState = 'awaiting_new_manager_username';
      await ctx.reply(
        '👁️ <b>Назначение управляющего отделом (Циклоп)</b>\n\n' +
        `👤 <b>ID:</b> <code>${text}</code>\n\n` +
        '📝 <b>Шаг 2/3: Введите username пользователя (без @):</b>',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
      return;
    }

    if (state === 'awaiting_new_manager_username') {
      const username = text.replace('@', '').trim();
      ctx.session.tempRankUsername = username;
      ctx.session.adminState = 'awaiting_new_manager_chats';

      const envVars = getAvailableEnvVars();
      let message = '🏢 <b>Шаг 3/3: Чаты отделов</b>\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nВведите отделы в формате \`Название=ПЕРЕМЕННАЯ\` через запятую:\n`;
      message += `Пример: \`Математика=EXEC_MATH, Физика=EXEC_PHYS\`\n\n`;
      message += `Или отправьте \`нет\`, чтобы назначить без чатов (добавите позже).`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() });
      return;
    }

    if (state === 'awaiting_new_manager_chats') {
      const userId = ctx.session.tempRankUserId;
      const username = ctx.session.tempRankUsername;

      let managedChats = [];
      if (text.toLowerCase() !== 'нет') {
        managedChats = parseManagedChats(text);
      }

      const loyaltyData = loyalty.loadData();
      if (!loyaltyData[userId]) {
        loyaltyData[userId] = { username: '', totalSpent: 0 };
      }
      loyaltyData[userId].rank = 'Циклоп';
      loyaltyData[userId].username = username;
      loyaltyData[userId].managedChats = managedChats;
      loyalty.saveData(loyaltyData);

      logger.logAdminAction('rank_assigned', {
        targetUserId: userId,
        username: username,
        rankName: 'Циклоп',
        managedChats: managedChats
      }, ctx);

      let successMsg = `👁️ <b>Управляющий отделом назначен!</b>\n\n`;
      successMsg += `👤 <b>ID:</b> <code>${userId}</code>\n`;
      successMsg += `📛 <b>Username:</b> @${username}\n`;
      successMsg += `🏅 <b>Ранг:</b> Циклоп (управляющий отделом)\n`;
      if (managedChats.length > 0) {
        successMsg += `🏢 <b>Отделы:</b>\n`;
        managedChats.forEach(c => {
          successMsg += `  • ${c.name} (<code>${c.chatEnv}</code>)\n`;
        });
      } else {
        successMsg += `\n⚠️ Чаты отделов не назначены. Добавьте их через "Управление пользователями".`;
      }

      await ctx.reply(successMsg, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К управлению рангами', 'admin:set_user_rank')]])
      });

      ctx.session.adminState = null;
      ctx.session.tempRankUserId = null;
      ctx.session.tempRankUsername = null;
      return;
    }

    // ==========================================
    // 🌟 ИЗМЕНЕНИЕ ЧАТОВ ОТДЕЛА УПРАВЛЯЮЩЕГО
    // ==========================================
    if (state.startsWith('edit_rank_user_chats:')) {
      const userId = state.split(':')[1];
      let managedChats = [];
      if (text.toLowerCase() !== 'нет') {
        managedChats = parseManagedChats(text);
      }

      const loyaltyData = loyalty.loadData();
      if (!loyaltyData[userId]) {
        return ctx.reply('❌ Пользователь не найден.');
      }
      loyaltyData[userId].managedChats = managedChats;
      loyalty.saveData(loyaltyData);

      logger.logAdminAction('manager_chats_changed', {
        userId: userId,
        managedChats: managedChats
      }, ctx);

      let successMsg = `✅ <b>Чаты отделов обновлены!</b>\n\n`;
      successMsg += `👤 <b>Пользователь:</b> <code>${userId}</code>\n`;
      if (managedChats.length > 0) {
        successMsg += `🏢 <b>Отделы:</b>\n`;
        managedChats.forEach(c => {
          successMsg += `  • ${c.name} (<code>${c.chatEnv}</code>)\n`;
        });
      } else {
        successMsg += `⚠️ Все чаты отделов удалены.`;
      }

      await ctx.reply(successMsg, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К карточке пользователя', `admin:set_user_rank:user:${userId}`)]])
      });

      ctx.session.adminState = null;
      return;
    }

    // ==========================================
    // 🌟 ИЗМЕНЕНИЕ ДАННЫХ ПОЛЬЗОВАТЕЛЯ (ID / USERNAME)
    // ==========================================
    if (state.startsWith('edit_rank_user_id:')) {
      const oldUserId = state.split(':')[1];

      if (isNaN(text)) return ctx.reply('❌ Новый ID должен быть числом.');
      const newUserId = text.trim();

      const loyaltyData = loyalty.loadData();

      // Проверяем, не занят ли новый ID
      if (loyaltyData[newUserId]) {
        return ctx.reply(
          `❌ Пользователь с ID \`${newUserId}\` уже существует в базе!\n` +
          `Выберите другой ID или сначала удалите существующего пользователя.`
        );
      }

      // Переносим данные со старого ключа на новый
      const userData = loyaltyData[oldUserId];
      if (!userData) {
        return ctx.reply('❌ Пользователь не найден.');
      }

      // Сохраняем данные под новым ключом
      loyaltyData[newUserId] = { ...userData };

      // Удаляем старый ключ
      delete loyaltyData[oldUserId];

      loyalty.saveData(loyaltyData);

      // 🌟 Логируем изменение ID
      logger.logAdminAction('rank_user_id_changed', {
        oldUserId: oldUserId,
        newUserId: newUserId,
        username: userData.username || null
      }, ctx);

      await ctx.reply(
        `✅ <b>ID пользователя изменён!</b>\n\n` +
        `👤 <b>Старый ID:</b> <code>${oldUserId}</code>\n` +
        `👤 <b>Новый ID:</b> <code>${newUserId}</code>\n` +
        `📛 <b>Username:</b> ${userData.username ? '@' + userData.username : 'не указан'}\n` +
        `🏅 <b>Ранг:</b> ${userData.rank}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К карточке пользователя', `admin:set_user_rank:user:${newUserId}`)]]) }
      );

      ctx.session.adminState = null;
      return;
    }

    if (state.startsWith('edit_rank_user_username:')) {
      const userId = state.split(':')[1];
      const newUsername = text.replace('@', '').trim();

      if (!newUsername) return ctx.reply('❌ Username не может быть пустым.');

      const loyaltyData = loyalty.loadData();
      if (!loyaltyData[userId]) {
        return ctx.reply('❌ Пользователь не найден.');
      }

      const oldUsername = loyaltyData[userId].username;
      loyaltyData[userId].username = newUsername;
      loyalty.saveData(loyaltyData);

      // 🌟 Логируем изменение username
      logger.logAdminAction('rank_user_username_changed', {
        userId: userId,
        oldUsername: oldUsername || null,
        newUsername: newUsername
      }, ctx);

      await ctx.reply(
        `✅ <b>Username пользователя изменён!</b>\n\n` +
        `👤 <b>ID:</b> <code>${userId}</code>\n` +
        `📛 <b>Старый username:</b> ${oldUsername ? '@' + oldUsername : 'не указан'}\n` +
        `📛 <b>Новый username:</b> @${newUsername}\n` +
        `🏅 <b>Ранг:</b> ${loyaltyData[userId].rank}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К карточке пользователя', `admin:set_user_rank:user:${userId}`)]]) }
      );

      ctx.session.adminState = null;
      return;
    }

    // --- ДОБАВЛЕНИЕ ЗАКАЗА ---
    if (state === 'add_order:customer_id') {
      if (isNaN(text)) return ctx.reply('❌ ID должен быть числом.');
      ctx.session.newOrder = { customerId: parseInt(text) };
      const typeKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📦 Обычный заказ', 'admin:add_order_type:regular')],
        [Markup.button.callback('🌟 Индивидуальный заказ', 'admin:add_order_type:custom')],
        [Markup.button.callback('❌ Отмена', 'admin:orders')]
      ]);
      await ctx.reply('📋 <b>Шаг 2: Выберите тип заказа:</b>', { parse_mode: 'HTML', ...typeKeyboard });
      ctx.session.adminState = null; return;
    }
    if (state === 'add_order:title') {
      ctx.session.newOrder.workTitle = text;
      ctx.session.adminState = 'add_order:subject';
      await ctx.reply('📖 <b>Шаг 4: Введите название предмета:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state === 'add_order:subject') {
      ctx.session.newOrder.subjectName = text;
      ctx.session.adminState = 'add_order:course';
      await ctx.reply('🎓 <b>Шаг 5: Введите название курса:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state === 'add_order:course') {
      ctx.session.newOrder.courseName = text;
      // 🌟 Для обоих типов запрашиваем описание
      ctx.session.adminState = 'add_order:description';
      await ctx.reply('📝 <b>Шаг 6: Введите описание задания (или "нет", если не требуется):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
      return;
    }
    if (state === 'add_order:price') {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом.');
      ctx.session.newOrder.price = parseInt(text);
      ctx.session.adminState = 'add_order:commission';
       await ctx.reply('📊 <b>Шаг 8: Введите комиссию в %:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state === 'add_order:description') {
      // 🌟 Если пользователь ввёл "нет", сохраняем null
      ctx.session.newOrder.description = text.toLowerCase() === 'нет' ? null : text;
      if (ctx.session.newOrder.isCustomOrder) {
        ctx.session.adminState = 'add_order:price_custom';
        await ctx.reply('💰 <b>Шаг 7: Введите цену заказа (0 если ещё не назначена):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
      } else {
        ctx.session.adminState = 'add_order:price';
        await ctx.reply('💰 <b>Шаг 7: Введите цену заказа (число в рублях):</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
      }
      return;
    }
    if (state === 'add_order:price_custom') {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом.');
      ctx.session.newOrder.price = parseInt(text);
      ctx.session.adminState = 'add_order:commission';
      await ctx.reply('📊 <b>Шаг 8: Введите комиссию в %:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() }); return;
    }
    if (state === 'add_order:commission') {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      ctx.session.newOrder.commission = parseInt(text);
      ctx.session.adminState = 'add_order:chat';
      const envVars = getAvailableEnvVars();
      let message = '💬 <b>Шаг 9: Чат исполнителей</b>\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной чата (или \`нет\`, если не требуется):`;
      await ctx.reply(message, { parse_mode: 'HTML', ...getBackToAdminMenu() });
      return;
    }
    if (state === 'add_order:chat') {
      let chatEnv = null;
      let managerChatId = null;

      if (text.toLowerCase() !== 'нет') {
        chatEnv = text.trim();
        managerChatId = process.env[chatEnv];
        if (!managerChatId) {
          return ctx.reply(`❌ Переменная <code>${chatEnv}</code> не найдена в .env. Попробуйте другое имя или отправьте <code>нет</code>.`);
        }
      }

      ctx.session.newOrder.managerChatEnv = chatEnv;
      ctx.session.newOrder.managerChatId = managerChatId;

      const newOrder = ctx.session.newOrder;
      let confirmText = `📋 <b>Подтверждение нового заказа</b>\n\n`;
      confirmText += `👤 <b>Заказчик ID:</b> <code>${newOrder.customerId}</code>\n`;
      confirmText += `${newOrder.isCustomOrder ? '🌟' : '📦'} <b>Тип:</b> ${newOrder.isCustomOrder ? 'Индивидуальный' : 'Обычный'}\n`;
      confirmText += `📚 <b>Работа:</b> <code>${newOrder.workTitle}</code>\n`;
      confirmText += `📖 <b>Предмет:</b> <code>${newOrder.subjectName}</code>\n`;
      confirmText += `🎓 <b>Курс:</b> <code>${newOrder.courseName}</code>\n`;
      confirmText += `💰 <b>Цена:</b> <code>${newOrder.price}</code> ₽\n`;
      confirmText += `📊 <b>Комиссия:</b> <code>${newOrder.commission}%</code>\n`;
      confirmText += `💬 <b>Чат:</b> ${chatEnv ? `<code>${chatEnv}</code>` : '<i>не назначен</i>'}\n`;
      if (newOrder.description) confirmText += `📝 <b>Описание:</b> <code>${newOrder.description.substring(0, 100)}...</code>\n`;
      confirmText += `\nСоздать заказ?`;

      const confirmKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Создать заказ', 'admin:add_order_confirm')],
        [Markup.button.callback('❌ Отмена', 'admin:orders')]
      ]);
      await ctx.reply(confirmText, { parse_mode: 'HTML', ...confirmKeyboard });
      ctx.session.adminState = null;
      return;
    }
    if (state === 'add_order:chat') {
      let chatEnv = null;
      let managerChatId = null;

      if (text.toLowerCase() !== 'нет') {
        chatEnv = text.trim();
        managerChatId = process.env[chatEnv];
        if (!managerChatId) {
          return ctx.reply(`❌ Переменная \`${chatEnv}\` не найдена в .env. Попробуйте другое имя или отправьте \`нет\`.`);
        }
      }

      ctx.session.newOrder.managerChatEnv = chatEnv;
      ctx.session.newOrder.managerChatId = managerChatId;

      const newOrder = ctx.session.newOrder;
      let confirmText = `📋 <b>Подтверждение нового заказа</b>\n\n`;
      confirmText += `👤 <b>Заказчик ID:</b> <code>${newOrder.customerId}</code>\n`;
      confirmText += `${newOrder.isCustomOrder ? '🌟' : '📦'} <b>Тип:</b> <code>${newOrder.isCustomOrder ? 'Индивидуальный' : 'Обычный'}</code>\n`;
      confirmText += `📚 <b>Работа:</b> <code>${newOrder.workTitle}</code>\n`;
      confirmText += `📖 <b>Предмет:</b> <code>${newOrder.subjectName}</code>\n`;
      confirmText += `🎓 <b>Курс:</b> <code>${newOrder.courseName}</code>\n`;
      confirmText += `💰 <b>Цена:</b> <code>${newOrder.price}</code> ₽\n`;
      confirmText += `📊 <b>Комиссия:</b> <code>${newOrder.commission}%</code>\n`;
      confirmText += `💬 <b>Чат:</b> ${chatEnv ? `<code>${chatEnv}</code>` : '<i>не назначен</i>'}\n`;
      if (newOrder.description) confirmText += `📝 <b>Описание:</b> <code>${newOrder.description.substring(0, 100)}...</code>\n`;
      confirmText += `\nСоздать заказ?`;

      const confirmKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Создать заказ', 'admin:add_order_confirm')],
        [Markup.button.callback('❌ Отмена', 'admin:orders')]
      ]);
      await ctx.reply(confirmText, { parse_mode: 'HTML', ...confirmKeyboard });
      ctx.session.adminState = null;
      return;
    }
    // ==========================================
    // 🌟 ДОБАВЛЕНИЕ ЗАКАЗЧИКА ВРУЧНУЮ
    // ==========================================
    if (state === 'add_customer:id') {
      if (isNaN(text)) return ctx.reply('❌ ID должен быть числом.');
      const id = parseInt(text);
      const loyaltyData = loyalty.loadData();

      // 🌟 Проверка: существует ли уже такой заказчик?
      if (loyaltyData[id]) {
        const existing = loyaltyData[id];
        ctx.session.newCustomer = { id: id };
        ctx.session.adminState = 'add_customer:confirm_overwrite';
        await ctx.reply(
          `⚠️ <b>Заказчик с ID <code>${id}</code> уже существует!</b>\n\n` +
          `📛 <b>Username:</b> <code>${existing.username ? '@' + existing.username : 'не указан'}</code>\n` +
          `💰 <b>Сумма выкупа:</b> <code>${existing.totalSpent || 0}</code> ₽\n` +
          `${existing.specialty ? '🎓 <b>Специальность:</b> <code>' + (loyalty.getSpecialtyById(existing.specialty)?.name || existing.specialty) + '</code>\n' : ''}\n` +
          `<b>Продолжить и перезаписать данные?</b>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Да, перезаписать', 'admin:add_customer:overwrite_yes')],
              [Markup.button.callback('❌ Отмена', 'admin:customers')]
            ])
          }
        );
        return;
      }

      ctx.session.newCustomer = { id: id };
      ctx.session.adminState = 'add_customer:username';
      await ctx.reply(
        '📝 <b>Шаг 2/3: Введите username заказчика (без @):</b>',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
      return;
    }

    if (state === 'add_customer:username') {
      const username = text.replace('@', '').trim();
      if (!username) return ctx.reply('❌ Username не может быть пустым.');
      ctx.session.newCustomer.username = username;
      ctx.session.adminState = 'add_customer:spent';
      await ctx.reply(
        '📝 <b>Шаг 3/4: Введите сумму выкупа заказчика (число в рублях):</b>',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
      return;
    }

    if (state === 'add_customer:spent') {
      if (isNaN(text)) return ctx.reply('❌ Сумма должна быть числом.');
      ctx.session.newCustomer.totalSpent = parseInt(text);
      ctx.session.adminState = 'add_customer:special_discount';
      await ctx.reply(
        '🎯 <b>Шаг 4/4: Специальная скидка</b>\n\n' +
        'Введите процент скидки (число от 1 до 100) или отправьте `0`, если специальная скидка не требуется.\n\n' +
        '⚠️ _Специальная скидка переопределяет скидку по рангу._',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
      return;
    }
     // 🌟 НОВЫЙ ШАГ: специальная скидка при добавлении заказчика
    if (state === 'add_customer:special_discount') {
      if (isNaN(text)) return ctx.reply('❌ Скидка должна быть числом. Введите число от 0 до 100.');
      const discountPercent = parseInt(text);
      if (discountPercent < 0 || discountPercent > 100) {
        return ctx.reply('❌ Скидка должна быть в диапазоне от 0 до 100.');
      }
      const newCustomer = ctx.session.newCustomer;
      if (!newCustomer) {
        ctx.session.adminState = null;
        return ctx.reply('❌ Ошибка сессии. Начните заново.');
      }
      // 🌟 Сохраняем в loyalty.json
      const loyaltyData = loyalty.loadData();
      loyaltyData[newCustomer.id] = {
        username: newCustomer.username,
        totalSpent: newCustomer.totalSpent,
        specialty: loyaltyData[newCustomer.id] && loyaltyData[newCustomer.id].specialty
          ? loyaltyData[newCustomer.id].specialty
          : null
      };
      // Устанавливаем спец. скидку (0 = не устанавливать / удалить)
      if (discountPercent > 0) {
        loyaltyData[newCustomer.id].specialDiscount = discountPercent;
      } else {
        delete loyaltyData[newCustomer.id].specialDiscount;
      }
      loyalty.saveData(loyaltyData);
      // 🌟 Логируем действие админа
      logger.logAdminAction('customer_added_manually', {
        customerId: newCustomer.id,
        username: newCustomer.username,
        totalSpent: newCustomer.totalSpent,
        specialDiscount: discountPercent > 0 ? discountPercent : null
      }, ctx);
      let successMessage = `✅ <b>Заказчик успешно добавлен/обновлён!</b>\n\n`;
      successMessage += `👤 <b>ID:</b> <code>${newCustomer.id}</code>\n`;
      successMessage += `📛 <b>Username:</b> @<code>${newCustomer.username}</code>\n`;
      successMessage += `💰 <b>Сумма выкупа:</b> <code>${newCustomer.totalSpent}</code> ₽\n`;
      if (discountPercent > 0) {
        successMessage += `🎯 <b>Специальная скидка:</b> <code>${discountPercent}%</code>\n`;
      }
      await ctx.reply(successMessage, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👥 К списку заказчиков', 'admin:customers')],
          [Markup.button.callback('➕ Добавить ещё', 'admin:add_customer_start')]
        ])
      });
      ctx.session.adminState = null;
      ctx.session.newCustomer = null;
      return;
    }
    // --- ПОИСК ЗАКАЗА ПО НОМЕРУ ---
    if (state === 'search_order_prompt') {
      const orderNumber = parseInt(text);
      if (isNaN(orderNumber)) return ctx.reply('❌ Введите числовой номер заказа.');
      const order = ordersDb.getOrderByNumber(orderNumber);
      if (!order) {
        await ctx.reply(`❌ Заказ с номером ${orderNumber} не найден`, { ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin:orders')]]) });
      } else {
        const cardText = formatOrderCard(order, 'admin');
        const buttons = [
          [Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${order.id}`)],
          [Markup.button.callback('💬 Написать заказчику', `admin:send_msg_customer:${order.id}`)],
          [Markup.button.callback('⬅️ Назад к списку', 'admin:orders')]
        ];
        await ctx.reply(cardText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
      }
      ctx.session.adminState = null; return;
    }

    // --- ПОИСК ЗАКАЗЧИКА ПО ID/USERNAME ---
      if (state === 'search_customer_prompt') {
      const searchQuery = text.replace('@', '').trim().toLowerCase();
      if (!searchQuery) return ctx.reply('❌ Введите ID или username.');
      
      const allOrders = ordersDb.getAllOrders();
      const loyaltyData = loyalty.loadData();
      const customerMap = new Map();

      // 🌟 1. Из loyalty.json
      for (const [userId, userData] of Object.entries(loyaltyData)) {
        customerMap.set(String(userId), {
          id: userId,
          username: userData.username || 'N/A',
          totalSpent: userData.totalSpent || 0,
          orderCount: 0,
          orders: []
        });
      }

      // 🌟 2. Из orders.json
      allOrders.forEach(order => {
        const custId = String(order.customerId);
        if (!customerMap.has(custId)) {
          customerMap.set(custId, {
            id: order.customerId,
            username: order.customerUsername || 'N/A',
            totalSpent: 0,
            orderCount: 0,
            orders: []
          });
        }
        const customer = customerMap.get(custId);
        customer.orderCount++;
        customer.orders.push(order);
        if (customer.username === 'N/A' && order.customerUsername) {
          customer.username = order.customerUsername;
        }
      });

      // Ищем по ID или username
      let foundCustomer = null;
      for (const customer of customerMap.values()) {
        if (String(customer.id) === searchQuery || 
            (customer.username !== 'N/A' && customer.username.toLowerCase() === searchQuery)) {
          foundCustomer = customer;
          break;
        }
      }
      
      if (!foundCustomer) {
        await ctx.reply(
          `❌ Пользователь "${text}" не найден в базе.`,
          { ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад к списку', 'admin:customers')]]) }
        );
        ctx.session.adminState = null;
        return;
      }
      
      // Показываем карточку найденного заказчика
      const customerOrders = allOrders.filter(o => String(o.customerId) === String(foundCustomer.id));
      const loyaltyInfo = loyalty.getLoyaltyInfo(foundCustomer.id);
      
      let textMsg = `👤 <b>Информация о заказчике</b>\n\n`;
      textMsg += `ID: <code>${foundCustomer.id}</code>\n`;
      textMsg += `Username: <code>${safeUsername(foundCustomer.username)}</code>\n`;
      textMsg += `Сумма выкупа: <code>${loyaltyInfo.totalSpent}</code> ₽\n`;
      textMsg += `Количество заказов: <code>${foundCustomer.orderCount}</code>\n\n`;
      
      if (loyaltyInfo.specialDiscount !== null) {
        textMsg += `\n🎯 <b>Специальная скидка:</b> <code>${loyaltyInfo.specialDiscount}%</code> <i>(переопределяет ранговую)</i>\n`;
      }

      if (customerOrders.length > 0) {
        textMsg += `📦 <b>Последние заказы:</b>\n`;
        customerOrders.slice(0, 5).forEach((o, i) => {
          textMsg += `${i + 1}. №${o.orderNumber} | ${o.workTitle} | ${o.price} ₽ | ${o.status}\n`;
        });
      }
      
      const buttons = [
        [Markup.button.callback('✏️ Изменить сумму выкупа', `admin:customer_edit_spent:${foundCustomer.id}`)],
        [Markup.button.callback(
          loyaltyInfo.specialDiscount !== null ? '🎯 Изменить спец. скидку' : '🎯 Установить спец. скидку',
          `admin:customer_edit_special_discount:${foundCustomer.id}`
        )],
        [Markup.button.callback('💬 Написать заказчику', `admin:send_msg_customer_by_id:${foundCustomer.id}`)],
        [Markup.button.callback('⬅️ Назад к списку', 'admin:customers')]
      ];
      
      await ctx.reply(textMsg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
      ctx.session.adminState = null;
      return;
    }

      // 🌟 ОТПРАВКА СООБЩЕНИЯ ЗАКАЗЧИКУ (из карточки заказа)
      if (state.startsWith('send_message_to_customer:')) {
        const orderId = state.split(':')[1];
        const order = ordersDb.getOrder(orderId);
        if (!order) {
          await ctx.reply('❌ Заказ не найден');
          ctx.session.adminState = null;
          return;
        }
        const messageText = ctx.message.text;
        const customerId = order.customerId;
        // 🌟 Клавиатура с кнопкой ответа администратору (передаём ID админа, чтобы заказчик знал, кому отвечать)
        const replyKeyboard = Markup.inlineKeyboard([[
          Markup.button.callback('✏️ Ответить администратору', `admin_reply:${customerId}_${orderId}_${ctx.from.id}`)
        ]]);
        try {
          await ctx.telegram.sendMessage(
            customerId,
            `📬 <b>Сообщение от администрации по заказу №${order.orderNumber}</b>\n\n${messageText}`,
            { parse_mode: 'HTML', reply_markup: replyKeyboard.reply_markup }
          );
          await ctx.reply(`✅ Сообщение отправлено заказчику ${order.customerUsername ? '@' + order.customerUsername : 'ID: ' + customerId}`);
        } catch (err) {
          await ctx.reply(`❌ Не удалось отправить сообщение: ${err.message}`);
        }
        ctx.session.adminState = null;
        return;
      }

          // 🌟 ОТПРАВКА СООБЩЕНИЯ ЗАКАЗЧИКУ (из базы заказчиков по ID)
          if (state.startsWith('send_message_to_customer_by_id:')) {
            const customerId = state.split(':')[1];
            const messageText = ctx.message.text;
            try {
              await ctx.telegram.sendMessage(
                customerId,
                `📬 <b>Сообщение от администрации</b>\n\n${messageText}`,
                { parse_mode: 'HTML' }
              );
              await ctx.reply(`✅ Сообщение отправлено заказчику ID: ${customerId}`);
            } catch (err) {
              await ctx.reply(`❌ Не удалось отправить сообщение: ${err.message}`);
            }
            ctx.session.adminState = null;
            return;
          }
          // ==========================================
          // 🌟 ПОЛУЧЕНИЕ ID ИСПОЛНИТЕЛЯ И ЕГО НАЗНАЧЕНИЕ
          // ==========================================
          if (state.startsWith('awaiting_executor_id_for_order:')) {
            const orderId = state.split(':')[1];
            const executorId = parseInt(text);
            if (isNaN(executorId)) {
              await ctx.reply('❌ ID должен быть числом. Попробуйте ещё раз или нажмите Отмену.');
              return;
            }

            const order = ordersDb.getOrder(orderId);
            if (!order) {
              await ctx.reply('❌ Заказ не найден');
              ctx.session.adminState = null;
              return;
            }

            const isReassignment = !!order.executorId && String(order.executorId) !== String(executorId);
            const oldExecutorId = order.executorId;
            const orderNumber = order.orderNumber || orderId;

            try {
              // Получаем данные нового исполнителя
              let executorUser;
              try {
                executorUser = await bot.telegram.getChat(executorId);
              } catch (e) {
                throw new Error('Исполнитель с таким ID не найден или заблокировал бота');
              }

              const executorUsername = executorUser.username || null;
              const executorName = executorUser.username ? `@${executorUser.username}` : executorUser.first_name || 'Исполнитель';

              // 🌟 Определяем статус: сохраняем текущий, если заказ уже оплачен/выполнен
              let newStatus;
              if (order.status === 'paid' || order.status === 'completed') {
                newStatus = order.status; // Не сбрасываем статус оплаченных/выполненных заказов
              } else {
                newStatus = order.isCustomOrder ? 'waiting_price' : 'active';
              }

              // ==========================================
              // 🌟 ИНДИВИДУАЛЬНЫЙ ЗАКАЗ — отдельная логика
              // ==========================================
              if (order.isCustomOrder) {
                // 🌟 Определяем статус: сохраняем текущий, если заказ уже оплачен/выполнен
                let newStatus;
                if (order.status === 'paid' || order.status === 'completed') {
                  newStatus = order.status;
                } else {
                  newStatus = 'waiting_price';
                }

                // 🌟 Обновляем заказ в БД (только для индивидуальных!)
                ordersDb.updateOrder(orderId, {
                  executorId: executorId,
                  executorUsername: executorUsername,
                  status: newStatus,
                  acceptedAt: new Date().toLocaleString('ru-RU')
                });
                // 1. Уведомляем НОВОГО исполнителя с кнопками управления
                if (order.status !== 'completed') {
                  const isPaid = order.status === 'paid';
                  
                  const privateText =
                    `✅ <b>Вам назначен индивидуальный заказ!</b>\n\n` +
                    `🆔 <b>Номер заказа:</b> №${orderNumber}\n` +
                    `📚 <b>Предмет:</b> ${order.subjectName || order.workTitle}\n` +
                    `👤 <b>Заказчик:</b> ${order.customerUsername ? '@' + order.customerUsername : 'ID: ' + order.customerId}\n` +
                    (isPaid ? `💰 <b>Цена:</b> ${order.price} ₽\n` : '') +
                    `\n${isPaid ? 'Свяжитесь с заказчиком:' : 'Назначьте цену или свяжитесь с заказчиком:'}`;

                  // 🌟 Если заказ уже оплачен — кнопку "Назначить цену" не показываем
                  const privateKeyboard = isPaid
                    ? Markup.inlineKeyboard([
                        [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${orderNumber}`)]
                      ])
                    : Markup.inlineKeyboard([
                        [Markup.button.callback('💰 Назначить цену', `custom_set_price:${orderNumber}`)],
                        [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${orderNumber}`)]
                      ]);

                  try {
                    await bot.telegram.sendMessage(executorId, privateText, {
                      parse_mode: 'HTML',
                      reply_markup: privateKeyboard.reply_markup
                    });
                  } catch (e) {
                    console.log('Не удалось уведомить нового исполнителя:', e.message);
                  }

                  // Пересылаем файл задания новому исполнителю
                  if (order.fileId) {
                    try {
                      const fileCaption = `📎 Файл задания к заказу №${orderNumber}`;
                      if (order.fileType === 'photo') {
                        await bot.telegram.sendPhoto(executorId, order.fileId, { caption: fileCaption });
                      } else {
                        await bot.telegram.sendDocument(executorId, order.fileId, { caption: fileCaption });
                      }
                    } catch (e) {
                      console.log('Не удалось переслать файл новому исполнителю:', e.message);
                    }
                  }
                }

                // 2. Уведомляем заказчика (без username исполнителя, с правильным текстом)
                if (order.customerId) {
                  const actionWord = isReassignment ? 'изменён' : 'назначен';
                  const customerMessage =
                    `👷 <b>По вашему заказу ${actionWord} исполнитель</b>\n\n` +
                    `🆔 <b>Номер заказа:</b> №${orderNumber}\n` +
                    `📚 <b>Предмет:</b> ${order.subjectName || order.workTitle}\n\n` +
                    `Вы можете связаться с исполнителем для обсуждения деталей:`;

                  const customerKeyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('✏️ Написать исполнителю', `custom_write_executor:${orderNumber}`)]
                  ]);

                  try {
                    await bot.telegram.sendMessage(order.customerId, customerMessage, {
                      parse_mode: 'HTML',
                      reply_markup: customerKeyboard.reply_markup
                    });
                  } catch (e) {
                    console.log('Не удалось уведомить заказчика:', e.message);
                  }
                }

                // 3. Уведомляем СТАРОГО исполнителя о снятии
                if (isReassignment && oldExecutorId) {
                  try {
                    await bot.telegram.sendMessage(oldExecutorId,
                      `⚠️ <b>Заказ передан другому исполнителю</b>\n\n` +
                      `🆔 <b>Номер заказа:</b> №${orderNumber}\n` +
                      `📚 <b>Предмет:</b> ${order.subjectName || order.workTitle}\n\n` +
                      `Администратор назначил нового исполнителя. Вы больше не являетесь исполнителем по этому заказу.`,
                      { parse_mode: 'HTML' }
                    );
                  } catch (e) {
                    console.log('Не удалось уведомить старого исполнителя:', e.message);
                  }
                }
              }
              // ==========================================
              // 📦 ОБЫЧНЫЙ ЗАКАЗ — используем существующую функцию
              // ==========================================
              else {
                const result = await assignExecutorToOrder(orderId, executorId, bot, isReassignment);

                // При переназначении обычного заказа тоже уведомляем старого исполнителя
                if (isReassignment && oldExecutorId) {
                  try {
                    await bot.telegram.sendMessage(oldExecutorId,
                      `⚠️ <b>Заказ передан другому исполнителю</b>\n\n` +
                      `🆔 <b>Номер заказа:</b> №${orderNumber}\n` +
                      `📚 <b>Работа:</b> ${order.workTitle}\n\n` +
                      `Администратор назначил нового исполнителя. Вы больше не являетесь исполнителем по этому заказу.`,
                      { parse_mode: 'HTML' }
                    );
                  } catch (e) {
                    console.log('Не удалось уведомить старого исполнителя:', e.message);
                  }
                }
              }

              // 🌟 Логируем действие
              logger.logAdminAction(isReassignment ? 'executor_reassigned' : 'executor_assigned', {
                orderId: orderId,
                orderNumber: orderNumber,
                newExecutorId: executorId,
                oldExecutorId: oldExecutorId || null,
                isCustomOrder: order.isCustomOrder
              }, ctx);

              const actionLabel = isReassignment ? 'переназначен' : 'назначен';
              const notifyDetails = isReassignment
                ? 'новому исполнителю, заказчику и старому исполнителю'
                : 'исполнителю и заказчику';

              await ctx.reply(
                `✅ <b>Исполнитель успешно ${actionLabel}!</b>\n\n` +
                `👷 <b>Исполнитель:</b> ${executorName}\n` +
                `📦 <b>Заказ:</b> №${orderNumber}\n\n` +
                `Уведомления отправлены ${notifyDetails}.`,
                { parse_mode: 'HTML' }
              );

              // Перерисовываем карточку заказа
              const updatedOrder = ordersDb.getOrder(orderId);
              const cardText = formatOrderCard(updatedOrder, 'admin');
              const newButtons = [
                [Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${orderId}`)],
                [Markup.button.callback('💬 Написать заказчику', `admin:send_msg_customer:${orderId}`)]
              ];
              if (updatedOrder.customerUsername) newButtons.push([Markup.button.url('🔗 Профиль заказчика', `https://t.me/${updatedOrder.customerUsername}`)]);
              newButtons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
              newButtons.push([Markup.button.callback('⏳ Вернуть в ожидание', `admin:order_status:${orderId}:pending`)]);
              newButtons.push([Markup.button.callback('🗑 Удалить заказ', `admin:order_delete:${orderId}`)]);
              newButtons.push([Markup.button.callback('⬅️ Назад к списку', 'admin:orders')]);
              await ctx.reply(cardText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(newButtons) });

            } catch (err) {
              await ctx.reply(
                `❌ <b>Ошибка назначения:</b>\n\n${err.message}`,
                {
                  parse_mode: 'HTML',
                  ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Вернуться к заказу', `admin:order_view:${orderId}`)]])
                }
              );
            }
            ctx.session.adminState = null;
            return;
          }
        });

    // ==========================================
    // 🌟 Админ нажимает "Ответить заказчику" после получения ответа от заказчика
    // ==========================================
    bot.action(/^admin_reply_to_customer:(\d+)_(.+)$/, async (ctx) => {
      ctx.session = ctx.session || {};

      if (!isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('❌ У вас нет прав');
        return;
      }

      const customerId = parseInt(ctx.match[1]);
      const orderId = ctx.match[2];

      const order = ordersDb.getOrder(orderId);

      const orderNumber = order && order.orderNumber ? order.orderNumber : orderId;
      const orderTitle = order ? order.workTitle : 'Заказ';

      ctx.session.adminReplyToCustomerId = customerId;
      ctx.session.adminReplyOrderId = orderId;
      ctx.session.adminReplyOrderNumber = orderNumber;
      ctx.session.adminReplyOrderTitle = orderTitle;
      ctx.session.adminReplyOrderDate = order ? order.createdAt : new Date().toLocaleString('ru-RU');
      ctx.session.adminReplyAdminId = ctx.from.id;

const backCallback = order ? `admin:order_view:${orderId}` : 'admin:orders';

const backKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('↩️ Назад', backCallback)]
]);

      await ctx.reply(
        `💬 <b>Режим ответа заказчику</b>\n\n` +
        `🆔 <b>Номер заказа:</b> №${orderNumber}\n` +
        `📚 <b>Заказ:</b> ${escapeHtml(orderTitle)}\n\n` +
        `Напишите сообщение или прикрепите файл, которое будет отправлено заказчику.`,
        { 
          parse_mode: 'HTML',
          reply_markup: backKeyboard.reply_markup
        }
      );

      await ctx.answerCbQuery('✅ Готов к отправке ответа');
    });

  // ==========================================
  // Обработчик inline-кнопок
  // ==========================================
  bot.action(/^admin:(.+)$/, async (ctx) => {
    ctx.session = ctx.session || {};
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('❌ У вас нет прав');
      return;
    }
    const action = ctx.match[1];

    // --- ГЛАВНОЕ МЕНЮ ---
    if (action === 'main') {
      ctx.session.adminState = null;
      clearAdminReplySession(ctx);

      await ctx.editMessageText('🛠 <b>Панель управления</b>', { 
        parse_mode: 'HTML', 
        ...getAdminMainMenu() 
      });
    }

    // --- КАТАЛОГ: Навигация (специальность → курс → предмет → работа) ---
    if (action === 'catalog') {
      ctx.session.adminState = null;
      await ctx.editMessageText(
        '🗂 <b>Управление каталогом</b>\n\nВыберите специальность:',
        { parse_mode: 'HTML', ...getCatalogSpecialtiesMenu() }
      );
    }
    else if (action.startsWith('catalog_specialty:')) {
      const specialtyId = action.split(':')[1];
      const specialty = catalog.getSpecialtyById(specialtyId);
      if (!specialty) { await ctx.answerCbQuery('❌ Специальность не найдена'); return; }
      ctx.session.adminState = null;
      await ctx.editMessageText(
        `${specialty.emoji} <b>Специальность: ${specialty.name}</b>\n\nВыберите курс:`,
        { parse_mode: 'HTML', ...getSpecialtyCourses(specialtyId) }
      );
    }
    // 🌟 Общие работы специальности
    else if (action.startsWith('catalog_general_works:')) {
      const specialtyId = action.split(':')[1];
      ctx.session.adminState = null;
      await ctx.editMessageText(
        '📋 <b>Общие работы (без курса/предмета)</b>\n\nВыберите работу:',
        { parse_mode: 'HTML', ...getGeneralWorks(specialtyId) }
      );
    }
    else if (action.startsWith('catalog_course:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('📖 <b>Предметы курса</b>\n\nВыберите предмет:', { parse_mode: 'HTML', ...getCourseSubjects(action.split(':')[1]) });
    }
    else if (action.startsWith('catalog_subject:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('📝 <b>Работы предмета</b>\n\nВыберите работу:', { parse_mode: 'HTML', ...getSubjectWorks(action.split(':')[1]) });
    }
    // 🌟 Общие работы курса
    else if (action.startsWith('catalog_course_general:')) {
      const courseId = action.split(':')[1];
      ctx.session.adminState = null;
      await ctx.editMessageText(
        '📋 <b>Общие работы курса (без предмета)</b>\n\nВыберите работу:',
        { parse_mode: 'HTML', ...getCourseGeneralWorks(courseId) }
      );
    }
    else if (action.startsWith('catalog_work:')) {
      ctx.session.adminState = null;
      const card = getWorkCard(action.split(':')[1]);
      await ctx.editMessageText(card.text, { parse_mode: 'HTML', ...card.keyboard });
    }

    // --- КАТАЛОГ: Добавление ---
    // Добавление курса (теперь специальность передаётся через параметр кнопки)
    else if (action.startsWith('add_course:')) {
      const specialtyId = action.split(':')[1];
      ctx.session.tempCourseSpecialty = specialtyId;
      ctx.session.adminState = 'awaiting_course_name';
      await ctx.editMessageText('✏️ <b>Введите название нового курса:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    // Добавление специальности
    else if (action === 'add_specialty') {
      ctx.session.adminState = 'awaiting_specialty_name';
      await ctx.editMessageText(
        '✏️ <b>Введите название новой специальности:</b>\n\nНапример: 🚢 Судомеханика',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
    }
    // Изменение специальности: выбор
    else if (action === 'edit_specialty') {
      ctx.session.adminState = null;
      await ctx.editMessageText('✏️ <b>Изменение специальности</b>\n\nВыберите специальность:', { parse_mode: 'HTML', ...getEditSpecialtyList() });
    }
    else if (action.startsWith('edit_specialty_select:')) {
      const specialtyId = action.split(':')[1];
      const specialty = catalog.getSpecialtyById(specialtyId);
      if (!specialty) { await ctx.answerCbQuery('❌ Не найдено'); return; }
      ctx.session.adminState = `edit_specialty_name:${specialtyId}`;
      await ctx.editMessageText(
        `✏️ <b>Текущее название:</b> ${specialty.name}\n\nВведите новое:`,
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
    }
    // Удаление специальности: выбор
    else if (action === 'delete_specialty') {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 <b>Удаление специальности</b>\n\nВыберите специальность:', { parse_mode: 'HTML', ...getDeleteSpecialtyList() });
    }
    else if (action.startsWith('delete_specialty_confirm:')) {
      const specialtyId = action.split(':')[1];
      const specialty = catalog.getSpecialtyById(specialtyId);
      if (!specialty) { await ctx.answerCbQuery('❌ Не найдено'); return; }
      const linkedCourses = catalog.getCourses(specialtyId);
      if (linkedCourses.length > 0) {
        await ctx.editMessageText(
          `⚠️ <b>Нельзя удалить специальность</b>\n\nК специальности «${specialty.name}» привязано курсов: <b>${linkedCourses.length}</b>.\n\nСначала удалите или перенесите эти курсы.`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin:catalog')]]) }
        );
      } else {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback(`✅ Да, удалить "${specialty.name}"`, `admin:delete_specialty_execute:${specialtyId}`)],
          [Markup.button.callback('❌ Отмена', 'admin:catalog')]
        ]);
        await ctx.editMessageText(
          `⚠️ <b>Подтверждение удаления</b>\n\nСпециальность: <b>${specialty.name}</b>\n\n`,
          { parse_mode: 'HTML', ...keyboard }
        );
      }
    }
    else if (action.startsWith('delete_specialty_execute:')) {
      const specialtyId = action.split(':')[1];
      const specialty = catalog.getSpecialtyById(specialtyId);
      const result = catalog.deleteSpecialty(specialtyId);
      if (result.success) {
        logger.logAdminAction('specialty_deleted', { specialtyId }, ctx);
        await ctx.editMessageText(`✅ Специальность "${specialty.name}" удалена!`, { parse_mode: 'HTML', ...getCatalogSpecialtiesMenu() });
      } else {
        await ctx.answerCbQuery(`❌ ${result.reason}`);
      }
    }
    // 🌟 Добавление общей работы (без курса/предмета)
    else if (action.startsWith('add_general_work:')) {
      const specialtyId = action.split(':')[1];
      ctx.session.tempWorkData = { subjectId: null, courseId: null, specialty: specialtyId };
      ctx.session.adminState = `add_general_work_title:${specialtyId}`;
      await ctx.editMessageText('✍️ <b>Шаг 1/9: Введите название общей работы:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('add_general_custom_work:')) {
      const specialtyId = action.split(':')[1];
      ctx.session.tempWorkData = { subjectId: null, courseId: null, specialty: specialtyId, isCustomOrder: true };
      ctx.session.adminState = `add_general_custom_work_title:${specialtyId}`;
      await ctx.editMessageText('✍️ <b>Шаг 1/7: Введите название общего индивидуального заказа:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('add_subject:')) {
      ctx.session.adminState = `awaiting_subject_name:${action.split(':')[1]}`;
      await ctx.editMessageText('✏️ <b>Введите название нового предмета:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    // 🌟 Добавление общей работы курса
    else if (action.startsWith('add_course_general_work:')) {
      const courseId = action.split(':')[1];
      ctx.session.tempWorkData = { subjectId: null, courseId: courseId };
      ctx.session.adminState = `add_course_general_work_title:${courseId}`;
      await ctx.editMessageText('✍️ <b>Шаг 1/9: Введите название общей работы курса:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('add_work:')) {
      ctx.session.adminState = `add_work_title:${action.split(':')[1]}`;
      await ctx.editMessageText('✍️ <b>Шаг 1/9: Введите название работы:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('add_custom_work:')) {
      const subjectId = action.split(':')[1];
      ctx.session.adminState = `add_custom_work_title:${subjectId}`;
      await ctx.editMessageText('✍️ <b>Шаг 1/6: Введите название индивидуального заказа:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }

    // --- КАТАЛОГ: Изменение ---
    else if (action === 'edit_course' || action.startsWith('edit_course:')) {
      const specialtyId = action.includes(':') ? action.split(':')[1] : null;
      ctx.session.adminState = null;
      await ctx.editMessageText('✏️ <b>Изменение курса</b>\n\nВыберите курс:', { parse_mode: 'HTML', ...getEditCourseList(specialtyId) });
    }
    else if (action.startsWith('edit_course_select:')) {
      const courseId = action.split(':')[1];
      ctx.session.adminState = `edit_course_name:${courseId}`;
      await ctx.editMessageText(`✏️ <b>Текущее название:</b> ${catalog.getCourse(courseId).name}\n\nВведите новое:`, { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('edit_subject:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('✏️ <b>Изменение предмета</b>\n\nВыберите предмет:', { parse_mode: 'HTML', ...getEditSubjectList(action.split(':')[1]) });
    }
    else if (action.startsWith('edit_subject_select:')) {
      const subjectId = action.split(':')[1];
      ctx.session.adminState = `edit_subject_name:${subjectId}`;
      await ctx.editMessageText(`✏️ <b>Текущее название:</b>   ${catalog.getSubject(subjectId).name}\n\nВведите новое:`, { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('edit_work:')) {
      const workId = action.split(':')[1];
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📝 Название', 'admin:edit_field:title:' + workId)],
        [Markup.button.callback('📄 Описание', 'admin:edit_field:description:' + workId)],
        [Markup.button.callback('💰 Цена', 'admin:edit_field:price:' + workId)],
        [Markup.button.callback('📊 Комиссия', 'admin:edit_field:commission:' + workId)],
        [Markup.button.callback('💬 Чат (env)', 'admin:edit_field:chatEnv:' + workId)],
        [Markup.button.callback('💳 Оплата (env)', 'admin:edit_field:paymentEnv:' + workId)],
        [Markup.button.callback('📋 Требования', 'admin:edit_field:needs:' + workId)],
        [Markup.button.callback('📌 Подсказка', 'admin:edit_field:prompt:' + workId)],
        [Markup.button.callback('🔗 Ссылка на примеры', 'admin:edit_field:exampleUrl:' + workId)],
        [Markup.button.callback('⬅️ Назад', `admin:catalog_work:${workId}`)]
      ]);
      await ctx.editMessageText('✏️ <b>Выберите поле для изменения:</b>', { parse_mode: 'HTML', ...keyboard });
    }
    else if (action.startsWith('edit_field:')) {
      const parts = action.split(':');
      const field = parts[1]; const workId = parts[2];
      const work = catalog.getWork(workId);
      let oldValue = work ? work[field] : undefined;
      if (field === 'needs') oldValue = Array.isArray(oldValue) && oldValue.length > 0 ? oldValue.join(', ') : 'нет';
      else if (field === 'price') oldValue = `${oldValue} ₽`;
      else if (field === 'commission') oldValue = `${oldValue}%`;
      else if (!oldValue) oldValue = 'не указано';
      ctx.session.adminState = `edit_work_input:${workId}:${field}`;
      
      // 🌟 Базовое сообщение
      let message = `✏️ <b>Введите новое значение для поля "${field}":</b>\n\n📌 <b>Текущее:</b> <code>${oldValue}</code>\n\n`;
      
      // 🌟 Для переменных окружения показываем список доступных
      if (field === 'chatEnv') {
        const envVars = getAvailableEnvVars();
        message += formatEnvVarsList(envVars.chatVars, 'chat');
        message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      } else if (field === 'paymentEnv') {
        const envVars = getAvailableEnvVars();
        message += formatEnvVarsList(envVars.paymentVars, 'payment');
        message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      }
      
      await ctx.editMessageText(message, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `admin:edit_work:${workId}`)]]) });
    }

    // --- КАТАЛОГ: Удаление ---
    else if (action === 'delete_course' || action.startsWith('delete_course:')) {
      const specialtyId = action.includes(':') ? action.split(':')[1] : null;
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 <b>Удаление курса</b>\n\nВыберите курс:', { parse_mode: 'HTML', ...getDeleteCourseList(specialtyId) });
    }
    else if (action.startsWith('delete_course_confirm:')) {
      const courseId = action.split(':')[1];
      const course = catalog.getCourse(courseId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Да, удалить "${course.name}"`, `admin:delete_course_execute:${courseId}`)],
        [Markup.button.callback('❌ Отмена', 'admin:catalog')]
      ]);
      await ctx.editMessageText(`⚠️ <b>Подтверждение</b>\n\nКурс: <b>${course.name}</b>\nВсе предметы и работы будут удалены!`, { parse_mode: 'HTML', ...keyboard });
    }
    else if (action.startsWith('delete_course_execute:')) {
      const courseId = action.split(':')[1];
      const course = catalog.getCourse(courseId);
      const data = catalog.getData();
      const subIds = data.subjects.filter(s => s.courseId === courseId).map(s => s.id);
      data.subjects = data.subjects.filter(s => s.courseId !== courseId);
      data.works = data.works.filter(w => !subIds.includes(w.subjectId));
      data.courses = data.courses.filter(c => c.id !== courseId);
      catalog.saveData(data);
      const specialtyId = course ? course.specialty : null;
      const backKeyboard = specialtyId ? getSpecialtyCourses(specialtyId) : getCatalogSpecialtiesMenu();
      await ctx.editMessageText(`✅ Курс "${course.name}" удалён!`, { parse_mode: 'HTML', ...backKeyboard });
    }
    else if (action.startsWith('delete_subject:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 <b>Удаление предмета</b>\n\nВыберите предмет:', { parse_mode: 'HTML', ...getDeleteSubjectList(action.split(':')[1]) });
    }
    else if (action.startsWith('delete_subject_confirm:')) {
      const subjectId = action.split(':')[1];
      const subject = catalog.getSubject(subjectId);
      const works = catalog.getWorksBySubject(subjectId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Да, удалить "${subject.name}"`, `admin:delete_subject_execute:${subjectId}`)],
        [Markup.button.callback('❌ Отмена', `admin:catalog_course:${subject.courseId}`)]
      ]);
      await ctx.editMessageText(`⚠️ <b>Подтверждение</b>\n\nПредмет: <b>${subject.name}</b>\nРабот: ${works.length}\nВсе работы будут удалены!`, { parse_mode: 'HTML', ...keyboard });
    }
    else if (action.startsWith('delete_subject_execute:')) {
      const subjectId = action.split(':')[1];
      const subject = catalog.getSubject(subjectId);
      const data = catalog.getData();
      data.works = data.works.filter(w => w.subjectId !== subjectId);
      data.subjects = data.subjects.filter(s => s.id !== subjectId);
      catalog.saveData(data);
      await ctx.editMessageText(`✅ Предмет "${subject.name}" удалён!`, { parse_mode: 'HTML', ...getCourseSubjects(subject.courseId) });
    }
     // 🌟 Удаление общих работ специальности
    else if (action.startsWith('delete_general_work:')) {
      const specialtyId = action.split(':')[1];
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 <b>Удаление общей работы</b>\n\nВыберите работу:', { parse_mode: 'HTML', ...getDeleteGeneralWorkList(specialtyId) });
    }
    // 🌟 Удаление общих работ курса
    else if (action.startsWith('delete_course_general_work:')) {
      const courseId = action.split(':')[1];
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 <b>Удаление общей работы курса</b>\n\nВыберите работу:', { parse_mode: 'HTML', ...getDeleteCourseGeneralWorkList(courseId) });
    }
    // 🌟 Добавление общего индивидуального заказа курса
    else if (action.startsWith('add_course_general_custom_work:')) {
      const courseId = action.split(':')[1];
      ctx.session.tempWorkData = { subjectId: null, courseId: courseId, isCustomOrder: true };
      ctx.session.adminState = `add_course_general_custom_work_title:${courseId}`;
      await ctx.editMessageText('✍️ <b>Шаг 1/7: Введите название общего индивидуального заказа:</b>', { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('delete_work:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 <b>Удаление работы</b>\n\nВыберите работу:', { parse_mode: 'HTML', ...getDeleteWorkList(action.split(':')[1]) });
    }
    else if (action.startsWith('delete_work_confirm:')) {
      const workId = action.split(':')[1];
      const work = catalog.getWork(workId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, удалить', `admin:delete_work_execute:${workId}`)],
        [Markup.button.callback('❌ Отмена', `admin:catalog_subject:${work.subjectId}`)]
      ]);
      await ctx.editMessageText(`⚠️ <b>Подтверждение</b>\n\nРабота: <b>${work.title}</b>\nЦена: ${work.price} ₽`, { parse_mode: 'HTML', ...keyboard });
    }
    else if (action.startsWith('delete_work_execute:')) {
      const workId = action.split(':')[1];
      const work = catalog.getWork(workId);
      const data = catalog.getData();
      data.works = data.works.filter(w => w.id !== workId);
      catalog.saveData(data);
      logger.logAdminAction('catalog_work_deleted', { workId: workId, title: work.title }, ctx);
      
      // 🌟 Определяем, куда возвращаться
      let backKeyboard;
      if (!work.subjectId && work.courseId) {
        // Общая работа курса
        backKeyboard = getCourseGeneralWorks(work.courseId);
      } else if (!work.subjectId && !work.courseId) {
        // Общая работа специальности
        backKeyboard = getGeneralWorks(work.specialty);
      } else {
        // Обычная работа предмета
        backKeyboard = getSubjectWorks(work.subjectId);
      }
      
      await ctx.editMessageText(`✅ Работа удалена!`, { parse_mode: 'HTML', ...backKeyboard });
    }

    // ==========================================
    // 📦 УПРАВЛЕНИЕ ЗАКАЗАМИ
    // ==========================================
    else if (action === 'orders') {
      ctx.session.adminState = null;
      // 🌟 Фильтруем метаданные _meta из массива заказов
      const all = ordersDb.getAllOrders().filter(o => !o._meta);
      const p = all.filter(o => PENDING_STATUSES.includes(o.status)).length;
      const a = all.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
      const c = all.filter(o => COMPLETED_STATUSES.includes(o.status)).length;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`⏳ Ожидают (${p})`, 'admin:orders_list:pending:0')],
        [Markup.button.callback(`🔨 В работе (${a})`, 'admin:orders_list:active:0')],
        [Markup.button.callback(`✅ Выполнены (${c})`, 'admin:orders_list:completed:0')],
        [Markup.button.callback('➕ Добавить заказ', 'admin:add_order_start')],
        [Markup.button.callback('🔍 Поиск по номеру', 'admin:search_order_prompt')],
        [Markup.button.callback('⬅️ Назад', 'admin:main')]
      ]);
      await ctx.editMessageText(`📦 <b>Управление заказами</b>\n\nВсего: <b>${all.length}</b>\n⏳ Ожидают: <b>${p}</b>\n🔨 В работе: <b>${a}</b>\n✅ Выполнены: <b>${c}</b>`, { parse_mode: 'HTML', ...keyboard });
    }
    else if (action === 'add_order_start') {
      ctx.session.adminState = 'add_order:customer_id';
      await ctx.editMessageText(
        '✏️ <b>Добавление нового заказа</b>\n\n📝 <b>Шаг 1: Введите Telegram ID заказчика:</b>',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
    }
    else if (action === 'search_order_prompt') {
      ctx.session.adminState = 'search_order_prompt';
      await ctx.editMessageText('🔍 <b>Поиск заказа по номеру</b>\n\nВведите номер заказа:', { parse_mode: 'HTML', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('orders_list:')) {
      const parts = action.split(':');
      const filter = parts[1];
      const page = parseInt(parts[2]) || 0;
      
      const all = ordersDb.getAllOrders().filter(o => !o._meta);
      let filtered = all;
      let title = '📦 Все заказы';
      if (filter === 'pending') { filtered = all.filter(o => PENDING_STATUSES.includes(o.status)); title = '⏳ Ожидают принятия'; }
      else if (filter === 'active') { filtered = all.filter(o => ACTIVE_STATUSES.includes(o.status)); title = '🔨 В работе'; }
      else if (filter === 'completed') { filtered = all.filter(o => COMPLETED_STATUSES.includes(o.status)); title = '✅ Выполнены'; }
      
      const totalPages = Math.max(1, Math.ceil(filtered.length / ORDERS_PER_PAGE));
      const currentPage = Math.min(page, totalPages - 1);
      const displayOrders = filtered.slice(currentPage * ORDERS_PER_PAGE, (currentPage + 1) * ORDERS_PER_PAGE).reverse();
      
      let text = `${title}\n\nСтраница ${currentPage + 1} из ${totalPages}\nВсего: ${filtered.length}`;
      const buttons = displayOrders.map(o => {
        let dateStr = 'N/A'; 
        if (o.createdAt) { 
          try { 
            const d = new Date(o.createdAt); 
            if (!isNaN(d.getTime())) { 
              dateStr = d.toISOString().split('T')[0]; 
            } 
          } catch(e) { 
            dateStr = 'N/A'; 
          } 
        }
        const workTitle = o.workTitle || 'Без названия';
        const orderNum = o.orderNumber || 'N/A';
        const typeEmoji = o.isCustomOrder ? '🌟' : '📦';
        return [Markup.button.callback(
          `${typeEmoji} №${orderNum} | ${workTitle.substring(0, 15)} | ${dateStr}`, 
          `admin:order_view:${o.id}`
        )];
      });
      if (buttons.length === 0) buttons.push([Markup.button.callback('— пусто —', 'noop')]);
      
      const navRow = [];
      if (currentPage > 0) navRow.push(Markup.button.callback('◀️', `admin:orders_list:${filter}:${currentPage - 1}`));
      navRow.push(Markup.button.callback(`${currentPage + 1}/${totalPages}`, 'noop'));
      if (currentPage < totalPages - 1) navRow.push(Markup.button.callback('▶️', `admin:orders_list:${filter}:${currentPage + 1}`));
      buttons.push(navRow);
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:orders')]);
      
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('order_view:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) { 
        await ctx.answerCbQuery('❌ Заказ не найден'); 
        return; 
      }

      // 🌟 Если админ нажал "Назад"/"Отмена" из режима ввода сообщения — сбрасываем режим
      ctx.session.adminState = null;
      clearAdminReplySession(ctx);

      const text = formatOrderCard(order, 'admin');
      const buttons = [
        [Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${orderId}`)],
        [Markup.button.callback('💬 Написать заказчику', `admin:send_msg_customer:${orderId}`)]
      ];
      // 🌟 Кнопка привязки к чату (если у заказа нет чата)
      if (!order.managerChatId) {
        buttons.push([Markup.button.callback('🏢 Привязать к чату', `admin:order_bind_chat:${orderId}`)]);
      }
      if (order.customerUsername) buttons.push([Markup.button.url('🔗 Профиль заказчика', `https://t.me/${order.customerUsername}`)]);
      // 🌟 Разные кнопки статусов для разных типов заказов
      if (order.isCustomOrder) {
        if (order.status !== 'completed') {
          buttons.push([Markup.button.callback('🔄 Сменить исполнителя', `admin:assign_executor:${orderId}`)]);
        }
        buttons.push([Markup.button.callback('🔄 Сменить статус', `admin:order_status_menu:${orderId}`)]);
      } else {
      if (order.status === 'pending') {
          if (!order.executorId) {
            buttons.push([Markup.button.callback('🔨 Назначить исполнителя', `admin:assign_executor:${orderId}`)]);
          } else {
            buttons.push([Markup.button.callback('🔨 Перевести в работу', `admin:order_status:${orderId}:active`)]);
            buttons.push([Markup.button.callback('🔄 Сменить исполнителя', `admin:assign_executor:${orderId}`)]);
          }
          buttons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
        } else if (order.status === 'active') {
          buttons.push([Markup.button.callback('🔄 Сменить исполнителя', `admin:assign_executor:${orderId}`)]);
          buttons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
          buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `admin:order_status:${orderId}:pending`)]);
        } else {
          buttons.push([Markup.button.callback('🔨 Вернуть в работу', `admin:order_status:${orderId}:active`)]);
          buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `admin:order_status:${orderId}:pending`)]);
        }
      }
      buttons.push([Markup.button.callback('🗑 Удалить заказ', `admin:order_delete:${orderId}`)]);
      buttons.push([Markup.button.callback('⬅️ Назад к списку', 'admin:orders')]);
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('order_edit:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) return;
      const keyboardButtons = [
        [Markup.button.callback('📝 Название работы', `admin:order_field:${orderId}:workTitle`)],
        [Markup.button.callback('📖 Предмет', `admin:order_field:${orderId}:subjectName`)],
        [Markup.button.callback('🎓 Курс', `admin:order_field:${orderId}:courseName`)],
        [Markup.button.callback('💰 Цена', `admin:order_field:${orderId}:price`)],
        [Markup.button.callback('📊 Комиссия', `admin:order_field:${orderId}:commission`)],
        [Markup.button.callback('👤 Username заказчика', `admin:order_field:${orderId}:customerUsername`)],
        [Markup.button.callback('👷 Username исполнителя', `admin:order_field:${orderId}:executorUsername`)]
      ];
      // 🌟 Дополнительные поля для custom orders
      if (order.isCustomOrder) {
        keyboardButtons.push([Markup.button.callback('📝 Описание задания', `admin:order_field:${orderId}:description`)]);
        keyboardButtons.push([Markup.button.callback('🏷 Статус заказа', `admin:order_status_menu:${orderId}`)]);
      }
      keyboardButtons.push([Markup.button.callback('⬅️ Назад к заказу', `admin:order_view:${orderId}`)]);
      const typeLabel = order.isCustomOrder ? '🌟 Индивидуальный' : '📦 Обычный';
      await ctx.editMessageText(
        `✏️ <b>Редактирование заказа №${order.orderNumber}</b>\n${typeLabel}\n\nВыберите поле для изменения:`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboardButtons) }
      );
    }
    // --- ПРИВЯЗКА ЗАКАЗА К ЧАТУ (АДМИН) ---
    else if (action.startsWith('order_bind_chat:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }

      const envVars = getAvailableEnvVars();
      let message = `🏢 <b>Привязка заказа к чату</b>\n\n`;
      message += `📦 <b>Заказ:</b> №${order.orderNumber} | ${order.workTitle}\n\n`;
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной чата:`;

      ctx.session.adminState = `order_bind_chat:${orderId}`;
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `admin:order_view:${orderId}`)]])
      });
    }
    else if (action.startsWith('order_field:')) {
      const parts = action.split(':');
      const orderId = parts[1]; const field = parts[2];
      const order = ordersDb.getOrder(orderId);
      if (!order) return;
      
      let oldValue = order[field];
      if (oldValue === undefined || oldValue === null || oldValue === '') oldValue = 'не указано';
      else if (field === 'price') oldValue = `${oldValue} ₽`;
      else if (field === 'commission') oldValue = `${oldValue}%`;
      
      ctx.session.adminState = `edit_order_input:${orderId}:${field}`;
      await ctx.editMessageText(`✏️ <b>Введите новое значение для поля "${field}":</b>\n\n📌 <b>Текущее:</b> \`${oldValue}\``, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `admin:order_edit:${orderId}`)]]) });
    }
    // ==========================================
    // 🌟 НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ ВРУЧНУЮ
    // ==========================================
    else if (action.startsWith('assign_executor:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }
      
      // 🌟 Получаем список исполнителей, администраторов и управляющих из базы рангов
      const loyaltyData = loyalty.loadData();
      const admins = [];
      const executors = [];
      const managers = []; // 🌟 НОВОЕ: Управляющие (Циклоп)
      for (const [userId, userData] of Object.entries(loyaltyData)) {
        if (userData.rank === 'Посейдон') {
          admins.push({ id: userId, username: userData.username || null });
        } else if (userData.rank === 'Прометей') {
          executors.push({ id: userId, username: userData.username || null });
        } else if (userData.rank === 'Циклоп') { // 🌟 НОВОЕ
          managers.push({ id: userId, username: userData.username || null });
        }
      }
      // 🌟 Формируем текст со списком доступных пользователей
      let availableUsersText = '';
      if (executors.length > 0) {
        availableUsersText += `🔥 <b>Исполнители (Прометей):</b>\n`;
        executors.forEach(e => {
          availableUsersText += `• \`${e.id}\`${e.username ? ` (\`@${e.username}\`)` : ''}\n`;
        });
      } else {
        availableUsersText += `🔥 <b>Исполнители:</b> <i>нет назначенных рангов</i>\n`;
      }
      // 🌟 НОВОЕ: Управляющие (Циклоп)
      if (managers.length > 0) {
        availableUsersText += `\n👁️ <b>Управляющие отделами (Циклоп):</b>\n`;
        managers.forEach(m => {
          availableUsersText += `• \`${m.id}\`${m.username ? ` (\`@${m.username}\`)` : ''}\n`;
        });
      }
      if (admins.length > 0) {
        availableUsersText += `\n👑 <b>Администраторы (Посейдон):</b>\n`;
        admins.forEach(a => {
          availableUsersText += `• \`${a.id}\`${a.username ? ` (\`@${a.username}\`)` : ''}\n`;
        });
      }
      
      ctx.session.adminState = `awaiting_executor_id_for_order:${orderId}`;
      await ctx.editMessageText(
        `👷 <b>Назначение исполнителя</b>\n\n` +
        `📦 <b>Заказ:</b> №${order.orderNumber} | ${order.workTitle}\n\n` +
        `<b>Введите Telegram ID исполнителя (число):</b>\n\n` +
        `${availableUsersText}\n` +
        `<i>Или введите ID любого пользователя вручную</i>`,
        { 
          parse_mode: 'HTML', 
          ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `admin:order_view:${orderId}`)]]) 
        }
      );
    }
    else if (action.startsWith('order_status:')) {
      const parts = action.split(':');
      const orderId = parts[1]; 
      const newStatus = parts[2];
      const order = ordersDb.getOrder(orderId);
      
      // 🌟 Если переводим из active обратно в pending — снимаем исполнителя и уведомляем
      if (newStatus === 'pending' && order.status === 'active' && order.executorId) {
        await unassignExecutorFromOrder(orderId, bot);
      } else {
        const updates = { status: newStatus };
        if (newStatus === 'active' && !order.acceptedAt) updates.acceptedAt = new Date().toLocaleString('ru-RU');
        if (newStatus === 'completed' && !order.completedAt) updates.completedAt = new Date().toLocaleString('ru-RU');
        ordersDb.updateOrder(orderId, updates);

        // 🌟 Логируем смену статуса
        logger.logAdminAction('order_status_change', {
          orderId: orderId,
          orderNumber: order.orderNumber,
          workTitle: order.workTitle,
          oldStatus: order.status,
          newStatus: newStatus
        }, ctx);
        
        // 🌟 Обновляем сообщение в группе исполнителей при смене статуса
        const updatedOrderForGroup = ordersDb.getOrder(orderId);
        if (updatedOrderForGroup && updatedOrderForGroup.managerMessageId && updatedOrderForGroup.managerChatId) {
          let statusForText;
          if (newStatus === 'completed') statusForText = 'completed';
          else if (newStatus === 'active' || newStatus === 'paid') statusForText = 'in_progress';
          else statusForText = 'new';
          
          const updatedGroupText = buildGroupOrderText(updatedOrderForGroup, statusForText);
          try {
            await ctx.telegram.editMessageText(
              updatedOrderForGroup.managerChatId,
              updatedOrderForGroup.managerMessageId,
              null,
              updatedGroupText,
              { parse_mode: 'HTML' }
            );
          } catch (e) {
            console.log('Не удалось обновить сообщение в группе при смене статуса:', e.message);
          }
        }
      }
      
      await ctx.answerCbQuery('✅ Статус изменён');
      
      // Перерисовываем экран просмотра заказа
      const updatedOrder = ordersDb.getOrder(orderId);
      const text = formatOrderCard(updatedOrder, 'admin');
      const buttons = [
        [Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${orderId}`)]
      ];
      if (updatedOrder.customerUsername) buttons.push([Markup.button.url('💬 Профиль заказчика', `https://t.me/${updatedOrder.customerUsername}`)]);
      
      if (updatedOrder.isCustomOrder) {
        buttons.push([Markup.button.callback('🔄 Сменить статус', `admin:order_status_menu:${orderId}`)]);
      } else {
        if (updatedOrder.status === 'pending') {
          if (!updatedOrder.executorId) {
            buttons.push([Markup.button.callback('🔨 Назначить исполнителя', `admin:assign_executor:${orderId}`)]);
          } else {
            buttons.push([Markup.button.callback('🔨 Перевести в работу', `admin:order_status:${orderId}:active`)]);
          }
          buttons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
        } else if (updatedOrder.status === 'active') {
          buttons.push([Markup.button.callback('✅ Отметить выполненным', `admin:order_status:${orderId}:completed`)]);
          buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `admin:order_status:${orderId}:pending`)]);
        } else {
          buttons.push([Markup.button.callback('🔨 Вернуть в работу', `admin:order_status:${orderId}:active`)]);
          buttons.push([Markup.button.callback('⏳ Вернуть в ожидание', `admin:order_status:${orderId}:pending`)]);
        }
      }
      // 💾 Кнопка просмотра сохранённых данных
      if (order.customerDataSaved) {
        buttons.push([Markup.button.callback('💾 Исходные данные', `admin:order_data:${orderId}`)]);
      }
   buttons.push([Markup.button.callback('🗑 Удалить заказ', `admin:order_delete:${orderId}`)]);
      buttons.push([Markup.button.callback('🗑 Удалить заказ', `admin:order_delete:${orderId}`)]);
      buttons.push([Markup.button.callback('⬅️ Назад к списку', 'admin:orders')]);
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    // 💾 Просмотр сохранённых исходных данных заказа
    else if (action.startsWith('order_data:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }

      const data = storage.readOrderData(order.orderNumber);
      const files = storage.getOrderFiles(order.orderNumber);

      let text = `💾 <b>Исходные данные заказа №${order.orderNumber}</b>\n\n`;
      if (data) {
        text += `📝 <b>Текст задания:</b>\n\`${data.detailsText || data.description || '—'}\`\n\n`;
        text += `👤 <b>Заказчик:</b> ${data.customerUsername ? '@' + data.customerUsername : data.customerId}\n`;
        text += `💾 <b>Сохранено:</b> ${data.savedAt ? data.savedAt.substring(0, 10) : '—'}\n\n`;
      } else {
        text += `⚠️ Метаданные не найдены.\n\n`;
      }

      if (files.length > 0) {
        text += `📎 <b>Файлы (${files.length}):</b>\n`;
        files.forEach(f => {
          const sizeKB = (f.size / 1024).toFixed(1);
          text += `• ${f.name} (${sizeKB} КБ)\n`;
        });
      } else {
        text += `📎 <b>Файлы:</b> отсутствуют`;
      }

      // Кнопки для отправки файлов
      const buttons = files.slice(0, 5).map((f, i) => [
        Markup.button.callback(`📤 ${f.name}`, `admin:order_data_send:${orderId}:${i}`)
      ]);
      buttons.push([Markup.button.callback('⬅️ Назад к заказу', `admin:order_view:${orderId}`)]);

      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    // 💾 Отправка сохранённого файла в чат админа
    else if (action.startsWith('order_data_send:')) {
      const parts = action.split(':');
      const orderId = parts[1];
      const fileIdx = parseInt(parts[2]);
      const order = ordersDb.getOrder(orderId);
      if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }

      const files = storage.getOrderFiles(order.orderNumber);
      const file = files[fileIdx];
      if (!file) { await ctx.answerCbQuery('❌ Файл не найден'); return; }

      await ctx.answerCbQuery('⏳ Отправляю файл...');
      await ctx.replyWithDocument({
        source: fs.createReadStream(file.path),
        filename: file.name
      }, { caption: `💾 Файл заказа №${order.orderNumber}` });
    }
    else if (action.startsWith('order_delete:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, удалить', `admin:order_delete_confirm:${orderId}`)],
        [Markup.button.callback('❌ Отмена', `admin:order_view:${orderId}`)]
      ]);
      await ctx.editMessageText(`⚠️ <b>Подтверждение удаления</b>\n\nЗаказ: <b>${order.workTitle}</b>\nЗаказчик: ${order.customerUsername ? `<i>@${order.customerUsername}</i>` : `<i>${order.customerId}</i>`}`, { parse_mode: 'HTML', ...keyboard });
    }
    
    else if (action.startsWith('order_delete_confirm:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      
      // 💾 Удаляем сохранённые данные заказа
      if (order) {
        storage.deleteOrderData(order.orderNumber);
      }

      ordersDb.deleteOrder(orderId);
      
      // 🌟 Логируем удаление заказа
      logger.logAdminAction('order_deleted', {
        orderId: orderId,
        orderNumber: order ? order.orderNumber : null,
        workTitle: order ? order.workTitle : null
      }, ctx);
      
      await ctx.answerCbQuery('✅ Заказ удалён');
      
      const all = ordersDb.getAllOrders().filter(o => !o._meta);
      const p = all.filter(o => PENDING_STATUSES.includes(o.status)).length;
      const a = all.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
      const c = all.filter(o => COMPLETED_STATUSES.includes(o.status)).length;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`⏳ Ожидают (${p})`, 'admin:orders_list:pending:0')],
        [Markup.button.callback(`🔨 В работе (${a})`, 'admin:orders_list:active:0')],
        [Markup.button.callback(`✅ Выполнены (${c})`, 'admin:orders_list:completed:0')],
        [Markup.button.callback('⬅️ Назад', 'admin:main')]
      ]);
      await ctx.editMessageText(`✅ <b>Заказ удалён!</b>\n\n📦 <b>Управление заказами</b>\n\nВсего заказов: <b>${all.length}</b>`, { parse_mode: 'HTML', ...keyboard });
    }

    else if (action.startsWith('order_message_customer:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      
      if (!order) {
        await ctx.answerCbQuery('❌ Заказ не найден');
        return;
      }
      
      ctx.session = ctx.session || {};
      ctx.session.adminReplyToCustomerId = order.customerId;
      ctx.session.adminReplyOrderId = orderId;
      ctx.session.adminReplyOrderNumber = order.orderNumber;
      ctx.session.adminReplyOrderTitle = order.workTitle;
      ctx.session.adminReplyOrderDate = order.createdAt;
      ctx.session.adminReplyAdminId = ctx.from.id;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('↩️ Назад', `admin:order_view:${orderId}`)]
      ]);
      
      await ctx.editMessageText(
        `💬 <b>Режим ответа заказчику</b>\n\n` +
        `📚 <b>Заказ:</b> ${order.workTitle}\n` +
        `📅 <b>Дата:</b> ${order.createdAt}\n\n` +
        `Напишите сообщение или прикрепите файл, которое будет отправлено заказчику.\n\n` +
        `<i>(Для отмены нажмите "Отмена")</i>`,
        { parse_mode: 'HTML', ...keyboard }
      );
      await ctx.answerCbQuery();
    }

    // --- ДОБАВЛЕНИЕ ЗАКАЗА: выбор типа ---
    else if (action.startsWith('add_order_type:')) {
      const type = action.split(':')[1];
      ctx.session.newOrder = ctx.session.newOrder || {};
      ctx.session.newOrder.isCustomOrder = type === 'custom';
      const typeLabel = type === 'custom' ? '🌟 Индивидуальный' : '📦 Обычный';
      ctx.session.adminState = 'add_order:title';
      await ctx.editMessageText(
        `${typeLabel} заказ выбран\n\n📝 <b>Шаг 3: Введите название работы:</b>`,
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
    }
    // --- ДОБАВЛЕНИЕ ЗАКАЗА: подтверждение ---
    else if (action === 'add_order_confirm') {
      const newOrder = ctx.session.newOrder;
      if (!newOrder) { await ctx.answerCbQuery('❌ Данные заказа потеряны'); return; }
      // Определяем статус в зависимости от типа
      const status = newOrder.isCustomOrder
        ? (newOrder.price > 0 ? 'price_negotiating' : 'waiting_acceptance')
        : (newOrder.price > 0 ? 'pending' : 'pending');
      const createdOrder = ordersDb.createOrder({
        customerId: newOrder.customerId,
        customerUsername: null,
        workId: newOrder.isCustomOrder ? `custom_admin_${Date.now()}` : null,
        workTitle: newOrder.workTitle,
        subjectName: newOrder.subjectName,
        courseName: newOrder.courseName,
        price: newOrder.price,
        commission: newOrder.commission || 20,
        description: newOrder.description || null,
        isCustomOrder: newOrder.isCustomOrder || false,
        status: status,
        managerChatId: newOrder.managerChatId || null,
        managerChatEnv: newOrder.managerChatEnv || null
      });
      ctx.session.newOrder = null;
      await ctx.answerCbQuery('✅ Заказ создан');
      // Показываем карточку созданного заказа
      const cardText = formatOrderCard(createdOrder, 'admin');
      const buttons = [
        [Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${createdOrder.id}`)],
        [Markup.button.callback('📦 Все заказы', 'admin:orders')]
      ];
      await ctx.editMessageText(`✅ <b>Заказ №${createdOrder.orderNumber} создан!</b>\n\n${cardText}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }

    // --- МЕНЮ СТАТУСОВ ДЛЯ CUSTOM ORDERS ---
    else if (action.startsWith('order_status_menu:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) return;
      const statusKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🟡 Ожидает принятия', `admin:order_status:${orderId}:waiting_acceptance`)],
        [Markup.button.callback('🟠 Ожидает цену', `admin:order_status:${orderId}:waiting_price`)],
        [Markup.button.callback('🔵 Согласование цены', `admin:order_status:${orderId}:price_negotiating`)],
        [Markup.button.callback('🟢 Оплачен', `admin:order_status:${orderId}:paid`)],
        [Markup.button.callback('✅ Выполнен', `admin:order_status:${orderId}:completed`)],
        [Markup.button.callback('⬅️ Назад', `admin:order_edit:${orderId}`)]
      ]);
      await ctx.editMessageText(
        `🔄 <b>Смена статуса заказа №${order.orderNumber}</b>\n\nТекущий статус: <b>${order.status}</b>`,
        { parse_mode: 'HTML', ...statusKeyboard }
      );
    }

    // ==========================================
    // 📊 ЭКСПОРТ ДАННЫХ В EXCEL
    // ==========================================
    else if (action === 'export_excel') {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Экспорт заказов и скидок', 'admin:export_orders')],
        [Markup.button.callback('📋 Экспорт логов', 'admin:export_logs')],
        [Markup.button.callback('📁 Экспорт файлов БД', 'admin:export_db_files')],
        [Markup.button.callback('🗑 Очистить логи', 'admin:clear_logs_confirm')],
        [Markup.button.callback('⬅️ Назад', 'admin:main')]
      ]);
      await ctx.editMessageText(
        '📊 <b>Экспорт данных</b>\n\nВыберите тип экспорта:\n\n' +
        '• <b>Экспорт заказов и скидок</b> — 2 листа (заказы + лояльность)\n' +
        '• <b>Экспорт логов</b> — 2 листа (взаимодействия + ошибки/события)\n' +
        '• <b>Экспорт файлов БД</b> — полный бэкап архивом (БД + исходные данные + логи + .env)\n' +
        '• <b>Очистить логи</b> — удалить файл логов',
        { parse_mode: 'HTML', ...keyboard }
      );
    }
    else if (action === 'export_orders') {
      try {
        await ctx.answerCbQuery('⏳ Формирую таблицу...');
        await ctx.replyWithChatAction('upload_document');
        const excelBuffer = await generateExcelExport(false);
        logger.logAdminAction('export_orders_and_discounts', {}, ctx);
        const today = new Date().toISOString().split('T')[0];
        await ctx.replyWithDocument(
          { source: excelBuffer, filename: `SD_Bot_Orders_${today}.xlsx` },
          { caption: '📊 <b>Экспорт заказов и скидок</b>\n\n• Лист 1: Все заказы\n• Лист 2: Программа лояльности', parse_mode: 'HTML' }
        );
      } catch (error) {
        console.error('Ошибка при экспорте заказов:', error);
        await ctx.reply('❌ Произошла ошибка при формировании файла.');
      }
    }
    else if (action === 'export_logs') {
      try {
        await ctx.answerCbQuery('⏳ Формирую таблицу с логами...');
        await ctx.replyWithChatAction('upload_document');
        const excelBuffer = await generateLogsExport();
        logger.logAdminAction('export_logs', {}, ctx);
        const today = new Date().toISOString().split('T')[0];
        await ctx.replyWithDocument(
          { source: excelBuffer, filename: `SD_Bot_Logs_${today}.xlsx` },
          { 
            caption: '📋 <b>Экспорт логов</b>\n\n' +
                    '• Лист 1: Взаимодействия пользователей (сообщения, кнопки, чаты)\n' +
                    '• Лист 2: Ошибки и системные события (запуски, остановки)',
            parse_mode: 'HTML' 
          }
        );
      } catch (error) {
        console.error('Ошибка при экспорте логов:', error);
        await ctx.reply('❌ Произошла ошибка при формировании файла.');
      }
    }
    // ==========================================
    // 📁 РУЧНОЙ БЭКАП (АРХИВ) В ГРУППУ БЭКАПОВ
    // ==========================================
    else if (action === 'export_db_files') {
      try {
        await ctx.answerCbQuery('⏳ Создаю архив бэкапа...');
        const backupChatId = process.env.BACKUP_CHAT_ID;
        if (!backupChatId) {
          await ctx.reply('❌ Переменная окружения `BACKUP_CHAT_ID` не настроена в .env файле.');
          return;
        }

        await ctx.replyWithChatAction('upload_document');

        // 🌟 Создаём архив
        const archiveInfo = await backup.createBackupArchive();

        // Проверяем лимит размера (50 МБ для обычных ботов)
        const sizeMB = archiveInfo.size / (1024 * 1024);
        if (sizeMB > 49) {
          fs.unlinkSync(archiveInfo.path);
          await ctx.reply(`⚠️ Архив слишком большой (${sizeMB.toFixed(1)} МБ). Лимит отправки — 50 МБ.`);
          return;
        }

        // Заголовок с информацией, кто запросил бэкап
        const requester = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;
        await ctx.telegram.sendMessage(
          backupChatId,
          `📦 <b>Ручной бэкап данных (архив)</b>\n📅 ${new Date().toLocaleString('ru-RU')}\n👤 <b>Запрошен:</b> ${escapeHtml(requester)}\n💾 <b>Размер:</b> ${sizeMB.toFixed(2)} МБ`,
          { parse_mode: 'HTML' }
        );

        // 🌟 Отправляем архив
        await ctx.telegram.sendDocument(
          backupChatId,
          { source: fs.createReadStream(archiveInfo.path), filename: archiveInfo.name },
          { caption: `📁 ${archiveInfo.name}` }
        );

        // Логируем действие админа
        logger.logAdminAction('manual_backup_archive', {
          fileName: archiveInfo.name,
          sizeMB: sizeMB.toFixed(2),
          requester: requester
        }, ctx);

        // 🌟 Удаляем временный архив после отправки
        fs.unlinkSync(archiveInfo.path);

        await ctx.reply(
          `✅ <b>Бэкап успешно создан и отправлен!</b>\n\n` +
          `📁 <b>Файл:</b> ${escapeHtml(archiveInfo.name)}\n` +
          `💾 <b>Размер:</b> ${sizeMB.toFixed(2)} МБ\n` +
          `📍 <b>Отправлен в:</b> группу бэкапов`,
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        console.error('Ошибка при создании бэкапа:', error);
        logger.logError(error, ctx);
        await ctx.reply(`❌ Произошла ошибка при создании бэкапа: ${error.message}`);
      }
    }
    else if (action === 'clear_logs_confirm') {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, очистить логи', 'admin:clear_logs_execute')],
        [Markup.button.callback('❌ Отмена', 'admin:export_excel')]
      ]);
      await ctx.editMessageText(
        '⚠️ <b>Подтверждение</b>\n\nВы уверены, что хотите очистить все логи?\n\nЭто действие необратимо!',
        { parse_mode: 'HTML', ...keyboard }
      );
    }
    else if (action === 'clear_logs_execute') {
      const success = logger.clearLogs();
      logger.logAdminAction('clear_logs', { success }, ctx);
      if (success) {
        await ctx.answerCbQuery('✅ Логи очищены');
        await ctx.editMessageText('✅ <b>Логи успешно очищены!</b>\n\nФайл логов теперь пуст.', { parse_mode: 'HTML', ...getAdminMainMenu() });
      } else {
        await ctx.answerCbQuery('❌ Ошибка очистки');
        await ctx.editMessageText('❌ <b>Не удалось очистить логи.</b>', { parse_mode: 'HTML', ...getAdminMainMenu() });
      }
    }

    // --- РАНГИ ---
    else if (action === 'set_user_rank') {
      try {
        const loyaltyData = loyalty.loadData();
        // Собираем пользователей по рангам
        const admins = [];
        const executors = [];
        const managers = [];
        for (const [userId, userData] of Object.entries(loyaltyData)) {
          if (userData.rank === 'Посейдон') {
            admins.push({ id: userId, username: userData.username || 'N/A' });
          } else if (userData.rank === 'Прометей') {
            executors.push({ id: userId, username: userData.username || 'N/A' });
          } else if (userData.rank === 'Циклоп') {
            managers.push({ id: userId, username: userData.username || 'N/A' });
          }
        }
        
        let text = `🛠 <b>Управление рангами</b>\n\n`;
        text += `👑 <b>Админы (Посейдон):</b> ${admins.length}\n`;
        if (admins.length === 0) text += `  • нет\n`;
        admins.forEach(a => {
          const usernameDisplay = a.username !== 'N/A' ? '@' + escapeHtml(a.username) : 'без username';
          text += `  • ${a.id} (${usernameDisplay})\n`;
        });
        // 🌟 ИСПРАВЛЕНО: сначала выводим заголовок И список исполнителей
        text += `\n🔥 <b>Исполнители (Прометей):</b> ${executors.length}\n`;
        if (executors.length === 0) text += `  • нет\n`;
        executors.forEach(e => {
          const usernameDisplay = e.username !== 'N/A' ? '@' + escapeHtml(e.username) : 'без username';
          text += `  • ${e.id} (${usernameDisplay})\n`;
        });
        // 🌟 ИСПРАВЛЕНО: затем выводим заголовок И список управляющих
        text += `\n👁️ <b>Управляющие отделами (Циклоп):</b> ${managers.length}\n`;
        if (managers.length === 0) text += `  • нет\n`;
        managers.forEach(m => {
          const usernameDisplay = m.username !== 'N/A' ? '@' + escapeHtml(m.username) : 'без username';
          text += `  • ${m.id} (${usernameDisplay})\n`;
        });
        
        // 🌟 НОВАЯ КЛАВИАТУРА: две отдельные кнопки вместо одной
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('🔥 Назначить исполнителя', 'admin:set_user_rank:new:executor')],
          [Markup.button.callback('👑 Назначить администратора', 'admin:set_user_rank:new:admin')],
          [Markup.button.callback('👁️ Назначить управляющего (Циклоп)', 'admin:set_user_rank:new:manager')],
          [Markup.button.callback('📋 Управление пользователями', 'admin:set_user_rank:manage')],
          [Markup.button.callback('⬅️ Назад', 'admin:main')]
        ]);
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (error) {
        console.error('Ошибка при загрузке меню Управление рангами:', error);
        logger.logError(error, ctx);
        await ctx.answerCbQuery('❌ Произошла ошибка при загрузке меню.');
      }
    }
    // 🌟 Назначить нового исполнителя (Прометей)
    else if (action === 'set_user_rank:new:executor') {
      ctx.session.adminState = 'awaiting_new_executor_id';
      await ctx.editMessageText(
        '🔥 <b>Назначение исполнителя (Прометей)</b>\n\n👤 <b>Шаг 1/2: Введите Telegram ID пользователя:</b>',
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', 'admin:set_user_rank')]]) }
      );
    }

    // 🌟 Назначить нового администратора (Посейдон)
    else if (action === 'set_user_rank:new:admin') {
      ctx.session.adminState = 'awaiting_new_admin_id';
      await ctx.editMessageText(
        '👑 <b>Назначение администратора (Посейдон)</b>\n\n👤 <b>Шаг 1/2: Введите Telegram ID пользователя:</b>',
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', 'admin:set_user_rank')]]) }
      );
    }

    // 🌟 Назначить нового управляющего отделом (Циклоп)
    else if (action === 'set_user_rank:new:manager') {
      ctx.session.adminState = 'awaiting_new_manager_id';
      await ctx.editMessageText(
        '👁️ <b>Назначение управляющего отделом (Циклоп)</b>\n\n👤 <b>Шаг 1/3: Введите Telegram ID пользователя:</b>',
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', 'admin:set_user_rank')]]) }
      );
    }
    
    // Управление пользователями с рангами
    else if (action === 'set_user_rank:manage') {
      const loyaltyData = loyalty.loadData();
      const rankedUsers = [];
      for (const [userId, userData] of Object.entries(loyaltyData)) {
        // 🌟 ИСПРАВЛЕНО: добавлен Циклоп
        if (userData.rank === 'Посейдон' || userData.rank === 'Прометей' || userData.rank === 'Циклоп') {
          rankedUsers.push({ id: userId, username: userData.username || 'N/A', rank: userData.rank });
        }
      }
      let text = `📋 <b>Управление пользователями с рангами</b>\n\nВыберите пользователя:\n`;
      const buttons = rankedUsers.map(u => {
        // 🌟 ИСПРАВЛЕНО: эмодзи для Циклопа
        const rankEmoji = u.rank === 'Посейдон' ? '👑' : (u.rank === 'Циклоп' ? '👁️' : '🔥');
        const display = u.username !== 'N/A' ? `${u.id} (@${u.username})` : u.id;
        return [Markup.button.callback(`${rankEmoji} ${display}`, `admin:set_user_rank:user:${u.id}`)];
      });
      if (rankedUsers.length === 0) {
        text += `<i>Пользователей с рангами не найдено</i>\n`;
      }
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:set_user_rank')]);
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    // Действия над конкретным пользователем
    else if (action.startsWith('set_user_rank:user:')) {
      const userId = action.split(':')[2];
      const loyaltyData = loyalty.loadData();
      const userData = loyaltyData[userId];

      if (!userData || !userData.rank) {
        await ctx.answerCbQuery('❌ Пользователь не найден или не имеет ранга');
        return;
      }

      const rankEmoji = userData.rank === 'Посейдон' ? '👑' : (userData.rank === 'Циклоп' ? '👁️' : '🔥');
      let text = `👤 <b>Пользователь:</b> <code>${userId}</code>\n`;
      text += `📛 <b>Username:</b> <code>${userData.username ? '@' + userData.username : 'не указан'}</code>\n`;
      text += `${rankEmoji} <b>Текущий ранг:</b> <code>${userData.rank}</code>\n\n`;
      text += `Выберите действие:`;

      const buttons = [];

      // 🌟 НОВАЯ КНОПКА: Изменить ранг
      buttons.push([Markup.button.callback('🔄 Изменить ранг', `admin:set_user_rank:change_rank:${userId}`)]);

      // 🌟 НОВАЯ КНОПКА: Изменить данные
      buttons.push([Markup.button.callback('✏️ Изменить данные (ID/username)', `admin:set_user_rank:edit_data:${userId}`)]);

      // 🌟 НОВАЯ КНОПКА: Управление чатами отдела (только для Циклопа)
      if (userData.rank === 'Циклоп') {
        buttons.push([Markup.button.callback('🏢 Управление чатами отдела', `admin:set_user_rank:edit_chats:${userId}`)]);
      }

      // Разжаловать (снять ранг)
      buttons.push([Markup.button.callback('🗑 Разжаловать (снять ранг)', `admin:set_user_rank:demote:${userId}`)]);
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:set_user_rank:manage')]);

      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    // Понизить админа до исполнителя
    else if (action.startsWith('set_user_rank:lower:')) {
      const userId = action.split(':')[2];
      const loyaltyData = loyalty.loadData();
      
      if (!loyaltyData[userId]) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
      }
      
      loyaltyData[userId].rank = 'Прометей';
      loyalty.saveData(loyaltyData);

      await ctx.answerCbQuery('✅ Ранг понижен до Прометей');
      
      let text = `👤 <b>Пользователь:</b> <code>${userId}</code>\n`;
      text += `📛 <b>Username:</b> <code>${loyaltyData[userId].username ? '@' + loyaltyData[userId].username : 'не указан'}</code>\n`;
      text += `🔥 <b>Текущий ранг:</b> <code>Прометей</code>\n\n`;
      text += `✅ Ранг успешно понижен до Прометей`;
      
      const buttons = [
        [Markup.button.callback('🗑 Разжаловать (снять ранг)', `admin:set_user_rank:demote:${userId}`)],
        [Markup.button.callback('⬅️ Назад', 'admin:set_user_rank:manage')]
      ];
      
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    // ==========================================
    // 🌟 ИЗМЕНЕНИЕ РАНГА СУЩЕСТВУЮЩЕГО ПОЛЬЗОВАТЕЛЯ
    // ==========================================
    else if (action.startsWith('set_user_rank:change_rank:')) {
      const userId = action.split(':')[2];
      const loyaltyData = loyalty.loadData();
      const userData = loyaltyData[userId];

      if (!userData) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
      }

      const currentRank = userData.rank;
      const rankEmoji = currentRank === 'Посейдон' ? '👑' : (currentRank === 'Циклоп' ? '👁️' : '🔥');

      let text = `🔄 <b>Изменение ранга</b>\n\n`;
      text += `👤 <b>Пользователь:</b> <code>${userId}</code>\n`;
      text += `📛 <b>Username:</b> <code>${userData.username ? '@' + userData.username : 'не указан'}</code>\n`;
      text += `${rankEmoji} <b>Текущий ранг:</b> <code>${currentRank}</code>\n\n`;
      text += `Выберите новый ранг:`;

      const buttons = [];
      if (currentRank !== 'Прометей') {
        buttons.push([Markup.button.callback('🔥 Прометей (исполнитель)', `admin:set_user_rank:set_rank:executor:${userId}`)]);
      }
      if (currentRank !== 'Посейдон') {
        buttons.push([Markup.button.callback('👑 Посейдон (администратор)', `admin:set_user_rank:set_rank:admin:${userId}`)]);
      }
      // 🌟 НОВОЕ: Циклоп
      if (currentRank !== 'Циклоп') {
        buttons.push([Markup.button.callback('👁️ Циклоп (управляющий отделом)', `admin:set_user_rank:set_rank:manager:${userId}`)]);
      }
      buttons.push([Markup.button.callback('⬅️ Назад', `admin:set_user_rank:user:${userId}`)]);
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }

    // 🌟 Установить ранг Прометей (исполнитель)
    else if (action.startsWith('set_user_rank:set_rank:executor:')) {
      const userId = action.split(':')[2];
      const loyaltyData = loyalty.loadData();

      if (!loyaltyData[userId]) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
      }

      const oldRank = loyaltyData[userId].rank;
      loyaltyData[userId].rank = 'Прометей';
      loyalty.saveData(loyaltyData);

      // 🌟 Логируем изменение ранга
      logger.logAdminAction('rank_changed', {
        targetUserId: userId,
        oldRank: oldRank,
        newRank: 'Прометей'
      }, ctx);

      await ctx.answerCbQuery('✅ Ранг изменён на Прометей');

      let text = `👤 <b>Пользователь:</b> <code>${userId}</code>\n`;
      text += `📛 <b>Username:</b> <code>${loyaltyData[userId].username ? '@' + loyaltyData[userId].username : 'не указан'}</code>\n`;
      text += `🔥 <b>Текущий ранг:</b> <code>Прометей (исполнитель)</code>\n\n`;
      text += `✅ Ранг успешно изменён с "${oldRank}" на "Прометей"`;

      const buttons = [
        [Markup.button.callback('👑 Изменить на Посейдон', `admin:set_user_rank:set_rank:admin:${userId}`)],
        [Markup.button.callback('⬅️ Назад к карточке', `admin:set_user_rank:user:${userId}`)]
      ];
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }

    // 🌟 Установить ранг Посейдон (администратор)
    else if (action.startsWith('set_user_rank:set_rank:admin:')) {
      const userId = action.split(':')[2];
      const loyaltyData = loyalty.loadData();

      if (!loyaltyData[userId]) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
      }

      const oldRank = loyaltyData[userId].rank;
      loyaltyData[userId].rank = 'Посейдон';
      loyalty.saveData(loyaltyData);

      // 🌟 Логируем изменение ранга
      logger.logAdminAction('rank_changed', {
        targetUserId: userId,
        oldRank: oldRank,
        newRank: 'Посейдон'
      }, ctx);

      await ctx.answerCbQuery('✅ Ранг изменён на Посейдон');

      let text = `👤 <b>Пользователь:</b> <code>${userId}</code>\n`;
      text += `📛 <b>Username:</b> <code>${loyaltyData[userId].username ? '@' + loyaltyData[userId].username : 'не указан'}</code>\n`;
      text += `👑 <b>Текущий ранг:</b> <code>Посейдон (администратор)</code>\n\n`;
      text += `✅ Ранг успешно изменён с "${oldRank}" на "Посейдон"`;

      const buttons = [
        [Markup.button.callback('🔥 Изменить на Прометей', `admin:set_user_rank:set_rank:executor:${userId}`)],
        [Markup.button.callback('⬅️ Назад к карточке', `admin:set_user_rank:user:${userId}`)]
      ];
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }

    // 🌟 Установить ранг Циклоп (управляющий отделом)
    else if (action.startsWith('set_user_rank:set_rank:manager:')) {
      const userId = action.split(':')[2];
      const loyaltyData = loyalty.loadData();
      if (!loyaltyData[userId]) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
      }
      const oldRank = loyaltyData[userId].rank;
      loyaltyData[userId].rank = 'Циклоп';
      // Инициализируем пустой массив чатов, если его нет
      if (!loyaltyData[userId].managedChats) {
        loyaltyData[userId].managedChats = [];
      }
      loyalty.saveData(loyaltyData);

      logger.logAdminAction('rank_changed', {
        targetUserId: userId,
        oldRank: oldRank,
        newRank: 'Циклоп'
      }, ctx);

      await ctx.answerCbQuery('✅ Ранг изменён на Циклоп');

      let text = `👤 <b>Пользователь:</b> <code>${userId}</code>\n`;
      text += `📛 <b>Username:</b> <code>${loyaltyData[userId].username ? '@' + loyaltyData[userId].username : 'не указан'}</code>\n`;
      text += `👁️ <b>Текущий ранг:</b> <code>Циклоп (управляющий отделом)</code>\n\n`;
      text += `✅ Ранг успешно изменён с "${oldRank}" на "Циклоп"\n\n`;
      text += `⚠️ Не забудьте назначить чаты отделов через "Управление чатами отдела".`;

      const buttons = [
        [Markup.button.callback('🏢 Управление чатами отдела', `admin:set_user_rank:edit_chats:${userId}`)],
        [Markup.button.callback('⬅️ Назад к карточке', `admin:set_user_rank:user:${userId}`)]
      ];
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }

    // ==========================================
    // 🌟 ИЗМЕНЕНИЕ ДАННЫХ ПОЛЬЗОВАТЕЛЯ (ID / USERNAME)
    // ==========================================
    else if (action.startsWith('set_user_rank:edit_data:')) {
      const userId = action.split(':')[2];
      const loyaltyData = loyalty.loadData();
      const userData = loyaltyData[userId];

      if (!userData) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
      }

      const rankEmoji = userData.rank === 'Посейдон' ? '👑' : (userData.rank === 'Циклоп' ? '👁️' : '🔥');

      let text = `✏️ <b>Изменение данных пользователя</b>\n\n`;
      text += `👤 <b>Текущий ID:</b> <code>${userId}</code>\n`;
      text += `📛 <b>Текущий username:</b> <code>${userData.username ? '@' + userData.username : 'не указан'}</code>\n`;
      text += `${rankEmoji} <b>Ранг:</b> <code>${userData.rank}</code>\n\n`;
      text += `Выберите, что изменить:`;

      const buttons = [
        [Markup.button.callback('🔢 Изменить ID', `admin:set_user_rank:edit_id:${userId}`)],
        [Markup.button.callback('📛 Изменить username', `admin:set_user_rank:edit_username:${userId}`)],
        [Markup.button.callback('⬅️ Назад', `admin:set_user_rank:user:${userId}`)]
      ];

      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }

    // 🌟 Изменить ID пользователя
    else if (action.startsWith('set_user_rank:edit_id:')) {
      const userId = action.split(':')[2];
      ctx.session.adminState = `edit_rank_user_id:${userId}`;
      await ctx.editMessageText(
        `🔢 <b>Изменение ID пользователя</b>\n\n` +
        `👤 <b>Текущий ID:</b> <code>${userId}</code>\n\n` +
        `Введите новый Telegram ID (число):`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `admin:set_user_rank:user:${userId}`)]]) }
      );
    }

    // 🌟 Изменить username пользователя
    else if (action.startsWith('set_user_rank:edit_username:')) {
      const userId = action.split(':')[2];
      ctx.session.adminState = `edit_rank_user_username:${userId}`;
      await ctx.editMessageText(
        `📛 <b>Изменение username пользователя</b>\n\n` +
        `👤 <b>ID:</b> <code>${userId}</code>\n\n` +
        `Введите новый username (без @):`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `admin:set_user_rank:user:${userId}`)]]) }
      );
    }

    // 🌟 Управление чатами отдела (Циклоп)
    else if (action.startsWith('set_user_rank:edit_chats:')) {
      const userId = action.split(':')[2];
      const loyaltyData = loyalty.loadData();
      const userData = loyaltyData[userId];
      if (!userData) { await ctx.answerCbQuery('❌ Пользователь не найден'); return; }

      const envVars = getAvailableEnvVars();
      let message = `🏢 <b>Управление чатами отдела</b>\n\n`;
      message += `👤 <b>Пользователь:</b> <code>${userId}</code>\n`;
      message += `📛 <b>Username:</b> <code>${safeUsername(userData.username)}</code>\n\n`;

      if (userData.managedChats && userData.managedChats.length > 0) {
        message += `🏢 <b>Текущие отделы:</b>\n`;
        userData.managedChats.forEach(c => {
          message += `  • ${escapeHtml(c.name)} (\`${c.chatEnv}\`)\n`;
        });
        message += `\n`;
      } else {
        message += `⚠️ Чаты отделов не назначены.\n\n`;
      }

      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nВведите отделы в формате \`Название=ПЕРЕМЕННАЯ\` через запятую:\n`;
      message += `Пример: \`Математика=EXEC_MATH, Физика=EXEC_PHYS\`\n\n`;
      message += `Или отправьте \`нет\`, чтобы удалить все чаты.`;

      ctx.session.adminState = `edit_rank_user_chats:${userId}`;
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `admin:set_user_rank:user:${userId}`)]])
      });
    }

    // Разжаловать (снять ранг полностью)
    else if (action.startsWith('set_user_rank:demote:')) {
      const userId = action.split(':')[2];
      const loyaltyData = loyalty.loadData();
      
      if (!loyaltyData[userId]) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
      }
      
      const oldRank = loyaltyData[userId].rank;
      delete loyaltyData[userId].rank;
      loyalty.saveData(loyaltyData);
      
      await ctx.answerCbQuery('✅ Ранг снят');
      
      let text = `👤 <b>Пользователь:</b> <code>${userId}</code>\n`;
      text += `📛 <b>Username:</b> <code>${loyaltyData[userId].username ? '@' + loyaltyData[userId].username : 'не указан'}</code>\n\n`;
      text += `✅ <b>Ранг "${oldRank}" успешно снят. Пользователь разжалован.</b>`;
      
      const buttons = [
        [Markup.button.callback('⬅️ Назад к списку', 'admin:set_user_rank:manage')]
      ];
      
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    // --- БАЗА ЗАКАЗЧИКОВ ---
    else if (action === 'customers') {
      ctx.session.adminState = null;
      clearAdminReplySession(ctx);

      const allOrders = ordersDb.getAllOrders().filter(o => !o._meta);
      const loyaltyData = loyalty.loadData();
      const customerMap = new Map();

      // 🌟 1. Сначала добавляем ВСЕХ пользователей из loyalty.json (даже если у них 0 заказов)
      for (const [userId, userData] of Object.entries(loyaltyData)) {
        customerMap.set(String(userId), {
          id: userId,
          username: userData.username || 'N/A',
          totalSpent: userData.totalSpent || 0,
          orderCount: 0,
          orders: []
        });
      }

      // 🌟 2. Затем обогащаем данными из orders.json
      allOrders.forEach(order => {
        const custId = String(order.customerId);
        if (!customerMap.has(custId)) {
          // На всякий случай, если заказ есть, а в loyalty.json пользователя нет
          customerMap.set(custId, {
            id: order.customerId,
            username: order.customerUsername || 'N/A',
            totalSpent: 0,
            orderCount: 0,
            orders: []
          });
        }
        const customer = customerMap.get(custId);
        customer.orderCount++;
        customer.orders.push(order);
        // Обновляем username, если в заказе он есть, а в loyalty его не было
        if (customer.username === 'N/A' && order.customerUsername) {
          customer.username = order.customerUsername;
        }
      });

      const customers = Array.from(customerMap.values());
      ctx.session.customersList = customers;
      ctx.session.customersPage = 0;
      
      const CUSTOMERS_PER_PAGE = 10;
      const totalPages = Math.max(1, Math.ceil(customers.length / CUSTOMERS_PER_PAGE));
      const currentPage = 0;
      const displayCustomers = customers.slice(currentPage * CUSTOMERS_PER_PAGE, (currentPage + 1) * CUSTOMERS_PER_PAGE);
      
      let text = '👥 База заказчиков\n\n';
      text += `Всего заказчиков: ${customers.length}\n`;
      text += `Страница ${currentPage + 1} из ${totalPages}\n\n`;
      
      const buttons = [];
      displayCustomers.forEach(c => {
        const usernameDisplay = c.username !== 'N/A' ? '@' + c.username : 'без username';
        // В callback-кнопках Markdown не парсится, поэтому экранирование не нужно
        buttons.push([Markup.button.callback(`${c.id} | ${usernameDisplay} | ${c.totalSpent}₽`, `admin:customer_view:${c.id}`)]);
      });
      
      if (buttons.length === 0) {
        buttons.push([Markup.button.callback('— пусто —', 'noop')]);
      }
      
      const navRow = [];
      if (currentPage > 0) navRow.push(Markup.button.callback('◀️', `admin:customers_page:${currentPage - 1}`));
      navRow.push(Markup.button.callback(`${currentPage + 1}/${totalPages}`, 'noop'));
      if (currentPage < totalPages - 1) navRow.push(Markup.button.callback('▶️', `admin:customers_page:${currentPage + 1}`));
      buttons.push(navRow);
      buttons.push([Markup.button.callback('➕ Добавить заказчика', 'admin:add_customer_start')]);
      buttons.push([Markup.button.callback('🔍 Поиск по ID/username', 'admin:search_customer_prompt')]);
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
      
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('customers_page:')) {
      const page = parseInt(action.split(':')[1]);
      const customers = ctx.session.customersList || [];
      const CUSTOMERS_PER_PAGE = 10;
      const totalPages = Math.max(1, Math.ceil(customers.length / CUSTOMERS_PER_PAGE));
      const currentPage = Math.min(page, totalPages - 1);
      const displayCustomers = customers.slice(currentPage * CUSTOMERS_PER_PAGE, (currentPage + 1) * CUSTOMERS_PER_PAGE);
      
      let text = '👥 База заказчиков\n\n';
      text += `Всего заказчиков: ${customers.length}\n`;
      text += `Страница ${currentPage + 1} из ${totalPages}\n\n`;
      
      const buttons = [];
      displayCustomers.forEach(c => {
        const usernameDisplay = c.username !== 'N/A' ? '@' + c.username : 'без username';
        // В callback-кнопках Markdown не парсится, поэтому экранирование не нужно
        buttons.push([Markup.button.callback(`${c.id} | ${usernameDisplay} | ${c.totalSpent}₽`, `admin:customer_view:${c.id}`)]);
      });
      
      if (buttons.length === 0) {
        buttons.push([Markup.button.callback('— пусто —', 'noop')]);
      }
      
      const navRow = [];
      if (currentPage > 0) navRow.push(Markup.button.callback('◀️', `admin:customers_page:${currentPage - 1}`));
      navRow.push(Markup.button.callback(`${currentPage + 1}/${totalPages}`, 'noop'));
      if (currentPage < totalPages - 1) navRow.push(Markup.button.callback('▶️', `admin:customers_page:${currentPage + 1}`));
      buttons.push(navRow);
      buttons.push([Markup.button.callback('➕ Добавить заказчика', 'admin:add_customer_start')]);
      buttons.push([Markup.button.callback('🔍 Поиск по ID/username', 'admin:search_customer_prompt')]);
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
      
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('customer_view:')) {
      ctx.session.adminState = null;
      clearAdminReplySession(ctx);
      const customerId = action.split(':')[1];
      const customers = ctx.session.customersList || [];
      const customer = customers.find(c => String(c.id) === String(customerId));
      if (!customer) {
        await ctx.answerCbQuery('❌ Заказчик не найден');
        return;
      }
      const allOrders = ordersDb.getAllOrders();
      const customerOrders = allOrders.filter(o => String(o.customerId) === String(customerId));
      let text = `👤 Информация о заказчике\n\n`;
      text += `ID: <code>${customer.id}</code>\n`;
      text += `Username: ${safeUsername(customer.username)}\n`;
      text += `Сумма выкупа: ${customer.totalSpent} ₽\n`;
      text += `Количество заказов: ${customer.orderCount}\n\n`;
      if (customerOrders.length > 0) {
        text += `📦 Последние заказы:\n`;
        customerOrders.slice(0, 5).forEach((o, i) => {
          text += `${i + 1}. №${o.orderNumber} | ${o.workTitle} | ${o.price} ₽ | ${o.status}\n`;
        });
      }
      // 🌟 Получаем информацию о специальной скидке
      const loyaltyInfo = loyalty.getLoyaltyInfo(customer.id);
      const specialDiscount = loyaltyInfo.specialDiscount;
      // 🌟 Добавляем строку со специальной скидкой в текст карточки
      if (specialDiscount !== null) {
        text += `\n🎯 <b>Специальная скидка:</b> ${specialDiscount}% <i>(переопределяет ранговую)</i>\n`;
      }
      const buttons = [
        [Markup.button.callback('✏️ Изменить сумму выкупа', `admin:customer_edit_spent:${customerId}`)],
        // 🌟 НОВАЯ КНОПКА: Установка/изменение специальной скидки
        [Markup.button.callback(
          specialDiscount !== null ? '🎯 Изменить спец. скидку' : '🎯 Установить спец. скидку',
          `admin:customer_edit_special_discount:${customerId}`
        )],
        [Markup.button.callback('💬 Написать заказчику', `admin:send_msg_customer_by_id:${customerId}`)],
        [Markup.button.callback('⬅️ Назад к списку', 'admin:customers')]
      ];
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('customer_edit_spent:')) {
      const customerId = action.split(':')[1];
      const loyaltyData = loyalty.loadData();
      const userData = loyaltyData[customerId] || { totalSpent: 0 };
      const currentAmount = userData.totalSpent || 0;
      
      ctx.session.adminState = `edit_customer_spent:${customerId}`;
      await ctx.editMessageText(`✏️ Введите новую сумму выкупа для заказчика ${customerId}:\n\nТекущая сумма: ${currentAmount} ₽\n(Введите число в рублях)`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `admin:customer_view:${customerId}`)]]) });
    }
    else if (action === 'search_customer_prompt') {
      ctx.session.adminState = 'search_customer_prompt';
      await ctx.editMessageText('🔍 Поиск заказчика\n\nВведите Telegram ID или @username (без @):', { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin:customers')]]) });
    }
    // 🌟 Установка/изменение специальной скидки
    else if (action.startsWith('customer_edit_special_discount:')) {
      const customerId = action.split(':')[1];
      const loyaltyData = loyalty.loadData();
      const userData = loyaltyData[customerId] || { totalSpent: 0 };
      const currentDiscount = userData.specialDiscount || null;
      const currentLoyalty = loyalty.getLoyaltyInfo(customerId);
      
      let message = `🎯 <b>Установка специальной скидки</b>\n\n`;
      message += `👤 <b>Заказчик:</b> <code>${customerId}</code>\n`;
      message += `📛 <b>Username:</b> ${safeUsername(userData.username)}\n\n`;
      
      if (currentDiscount !== null) {
        message += `🎯 <b>Текущая спец. скидка:</b> ${currentDiscount}%\n`;
      } else {
        message += `🏅 <b>Ранговая скидка:</b> ${currentLoyalty.discountPercent}% (${currentLoyalty.rank.name})\n`;
      }
      
      message += `<i>Введите процент скидки (число от 1 до 100) или <code>0</code> для отмены специальной скидки:</i>\n\n`;
      message += `⚠️ <b>Внимание:</b> Специальная скидка переопределяет скидку по рангу.`;
      
      ctx.session.adminState = `edit_special_discount:${customerId}`;
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Отмена', `admin:customer_view:${customerId}`)]
        ])
      });
    }
    // 🌟 ДОБАВЛЕНИЕ ЗАКАЗЧИКА ВРУЧНУЮ — запуск
    else if (action === 'add_customer_start') {
      ctx.session.adminState = 'add_customer:id';
      await ctx.editMessageText(
        '✏️ <b>Добавление нового заказчика</b>\n\n📝 <b>Шаг 1/4: Введите Telegram ID заказчика (число):</b>',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
    }
    // 🌟 Подтверждение перезаписи существующего заказчика
    else if (action === 'add_customer:overwrite_yes') {
      ctx.session.adminState = 'add_customer:username';
      await ctx.editMessageText(
        '📝 <b>Шаг 2/4: Введите username заказчика (без @):</b>',
        { parse_mode: 'HTML', ...getBackToAdminMenu() }
      );
    }
    else if (action.startsWith('send_msg_customer:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) {
        await ctx.answerCbQuery('❌ Заказ не найден');
        return;
      }
      ctx.session.adminState = `send_message_to_customer:${orderId}`;
      await ctx.editMessageText(
        `💬 Отправка сообщения заказчику\n\n` +
        `Заказ №${order.orderNumber}\n` +
        `Заказчик: ${order.customerUsername ? '@' + order.customerUsername : 'ID: <code>' + order.customerId + '</code>'}\n\n` +
        `Введите текст сообщения:`,
        { 
          parse_mode: 'HTML', 
          ...Markup.inlineKeyboard([
            [Markup.button.callback('↩️ Назад', `admin:order_view:${orderId}`)]
          ])  
        }
      );
    }
    else if (action.startsWith('send_msg_customer_by_id:')) {
      const customerId = action.split(':')[1];
      ctx.session.adminState = `send_message_to_customer_by_id:${customerId}`;
      await ctx.editMessageText(
        `💬 Отправка сообщения заказчику\n\n` +
        `ID заказчика: <code>${customerId}</code>\n\n` +
        `Введите текст сообщения:`,
        { 
          parse_mode: 'HTML', 
          ...Markup.inlineKeyboard([
            [Markup.button.callback('↩️ Назад', 'admin:customers')]
          ]) 
        }
      );
    }

    // ==========================================
    // 💾 ХРАНИЛИЩЕ ИСХОДНЫХ ДАННЫХ
    // ==========================================
    else if (action === 'storage') {
      const stats = storage.getStorageStats();
      let text = `💾 <b>Хранилище исходных данных</b>\n\n`;
      text += `📦 <b>Сохранено заказов:</b> ${stats.ordersCount}\n`;
      text += `📁 <b>Всего файлов:</b> ${stats.filesCount}\n`;
      text += `💾 <b>Занято данными:</b> ${stats.totalSizeMB} МБ\n`;
      text += `💿 <b>Диск:</b> ${stats.totalDiskGB} ГБ\n`;
      text += `🆓 <b>Свободно:</b> ${stats.freeDiskGB} ГБ (${(100 - stats.usedPercent).toFixed(1)}%)\n\n`;

      if (parseFloat(stats.freeDiskGB) < 1) {
        text += `⚠️ <b>ВНИМАНИЕ:</b> Свободного места меньше 1 ГБ! Рекомендуется очистить старые данные.\n`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🧹 Очистить данные старше 180 дней', 'admin:storage_cleanup')],
        [Markup.button.callback('🔄 Обновить статистику', 'admin:storage')],
        [Markup.button.callback('⬅️ Назад', 'admin:main')]
      ]);
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    }
    else if (action === 'storage_cleanup') {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, очистить', 'admin:storage_cleanup_confirm')],
        [Markup.button.callback('❌ Отмена', 'admin:storage')]
      ]);
      await ctx.editMessageText(
        '⚠️ <b>Подтверждение очистки</b>\n\n' +
        'Будут удалены данные заказов, выполненных более 180 дней назад.\n' +
        'Данные активных заказов НЕ будут удалены.\n\nЭто действие необратимо!',
        { parse_mode: 'HTML', ...keyboard }
      );
    }
    else if (action === 'storage_cleanup_confirm') {
      await ctx.answerCbQuery('⏳ Очищаю...');
      const result = await storage.cleanupOldOrders(ordersDb, 180);
      const freedMB = (result.freedBytes / (1024 * 1024)).toFixed(2);
      logger.logAdminAction('storage_cleanup', result, ctx);
      await ctx.answerCbQuery(`✅ Удалено заказов: ${result.deletedCount}`);
      // Возвращаемся к статистике
      const stats = storage.getStorageStats();
      let text = `💾 <b>Очистка завершена!</b>\n\n`;
      text += `🗑 <b>Удалено заказов:</b> ${result.deletedCount}\n`;
      text += `💾 <b>Освобождено:</b> ${freedMB} МБ\n\n`;
      text += `🆓 <b>Свободно сейчас:</b> ${stats.freeDiskGB} ГБ из ${stats.totalDiskGB} ГБ\n`;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Статистика хранилища', 'admin:storage')],
        [Markup.button.callback('⬅️ Назад в меню', 'admin:main')]
      ]);
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    }

    // ==========================================
    // 💰 ФИНАНСЫ
    // ==========================================
    
    // Главное меню финансов
    else if (action === 'finance') {
      ctx.session.adminState = null;
      const expenseConstant = finance.getExpenseConstant();
      const coOwnersCount = finance.getCoOwners().length;
      
      let text = `💰 <b>Финансы</b>\n\n`;
      text += `📊 <b>Выберите раздел для просмотра статистики:</b>\n`;
      
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...getFinanceMenu()
      });
    }
    
    // --- ВЫРУЧКА: выбор периода ---
    else if (action === 'finance_revenue') {
      ctx.session.adminState = null;
      await ctx.editMessageText(
        `📊 <b>Выручка</b>\n\nВыберите период:`,
        { parse_mode: 'HTML', ...getPeriodMenu('finance_revenue') }
      );
    }
    
    // --- ВЫРУЧКА: показ за период ---
    else if (action.startsWith('finance_revenue:')) {
      const period = action.split(':')[1];
      
      if (period === 'from_date') {
        ctx.session.adminState = 'finance_date_start:revenue';
        await ctx.editMessageText(
          `📆 <b>Выручка: выбор периода</b>\n\n📝 <b>Шаг 1/2: Введите НАЧАЛЬНУЮ дату</b>\nФормат: <code>ДД.ММ.ГГГГ</code>\nНапример: <code>01.09.2026</code>`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin:finance_revenue')]]) }
        );
        return;
      }
      
      const stats = calculateFinancialStats(period);
      const periodLabel = getPeriodLabel(period);
      
      let text = `📊 <b>Выручка</b>\n`;
      text += `${periodLabel}\n\n`;
      text += `💰 <b>Выручка:</b> ${stats.revenue.toLocaleString('ru-RU')} ₽\n`;
      text += `📦 <b>Заказов:</b> ${stats.ordersCount}\n`;
      text += `👷 <b>Выплачено исполнителям:</b> ${stats.executorEarnings.toLocaleString('ru-RU')} ₽\n`;
      text += `📈 <b>Валовая комиссия:</b> ${stats.totalCommission.toLocaleString('ru-RU')} ₽\n`;
      
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Другой период', 'admin:finance_revenue')],
          [Markup.button.callback('⬅️ Финансы', 'admin:finance')]
        ])
      });
    }
    
    // --- РАСХОД КОМИССИИ: выбор периода ---
    else if (action === 'finance_expenses') {
      ctx.session.adminState = null;
      await ctx.editMessageText(
        `📉 <b>Расход комиссии</b>\n\nВыберите период:`,
        { parse_mode: 'HTML', ...getPeriodMenu('finance_expenses') }
      );
    }
    
    // --- РАСХОД КОМИССИИ: показ за период ---
    else if (action.startsWith('finance_expenses:')) {
      const period = action.split(':')[1];
      
      if (period === 'from_date') {
        ctx.session.adminState = 'finance_date_start:expenses';
        await ctx.editMessageText(
          `📆 <b>Расход комиссии: выбор периода</b>\n\n📝 <b>Шаг 1/2: Введите НАЧАЛЬНУЮ дату</b>\nФормат: <code>ДД.ММ.ГГГГ</code>\nНапример: <code>01.10.2026</code>`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin:finance_expenses')]]) }
        );
        return;
      }
      
      const stats = calculateFinancialStats(period);
      const periodLabel = getPeriodLabel(period);
      
      let text = `📉 <b>Расход комиссии</b>\n`;
      text += `${periodLabel}\n\n`;
      text += `🎁 <b>Покрытие скидок:</b> ${stats.discountCoverage.toLocaleString('ru-RU')} ₽\n`;
      text += `📊 <b>Комиссия общая:</b> ${stats.totalCommission.toLocaleString('ru-RU')} ₽\n`;
      text += `📊 <b>Комиссия чистая:</b> ${stats.netCommission.toLocaleString('ru-RU')} ₽\n\n`;
      text += `⚙️ <b>Константа расходов:</b> ${stats.expenseConstant}%\n`;
      text += `💸 <b>Сумма константы:</b> ${stats.expenseConstantAmount.toLocaleString('ru-RU')} ₽\n\n`;
      
      const remainingFund = stats.expenseConstantAmount - stats.discountCoverage;
      if (remainingFund >= 0) {
        text += `✅ <b>Остаток фонда:</b> ${remainingFund.toLocaleString('ru-RU')} ₽`;
      } else {
        text += `⚠️ <b>Перерасход фонда:</b> ${Math.abs(remainingFund).toLocaleString('ru-RU')} ₽`;
      }
      
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⚙️ Изменить константу', 'admin:finance_edit_constant')],
          [Markup.button.callback('🔄 Другой период', 'admin:finance_expenses')],
          [Markup.button.callback('⬅️ Финансы', 'admin:finance')]
        ])
      });
    }
    
    // --- ЗАРАБОТОК ИСПОЛНИТЕЛЕЙ: выбор периода ---
    else if (action === 'finance_executors') {
      ctx.session.adminState = null;
      await ctx.editMessageText(
        `👷 <b>Заработок исполнителей</b>\n\nВыберите период:`,
        { parse_mode: 'HTML', ...getPeriodMenu('finance_executors') }
      );
    }
    
    // --- ЗАРАБОТОК ИСПОЛНИТЕЛЕЙ: показ за период ---
    else if (action.startsWith('finance_executors:')) {
      const period = action.split(':')[1];
      
      if (period === 'from_date') {
        ctx.session.adminState = 'finance_date_start:executors';
        await ctx.editMessageText(
          `📆 <b>Заработок исполнителей: выбор периода</b>\n\n📝 <b>Шаг 1/2: Введите НАЧАЛЬНУЮ дату</b>\nФормат: <code>ДД.ММ.ГГГГ</code>\nНапример: <code>01.10.2026</code>`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin:finance_executors')]]) }
        );
        return;
      }
      
      const stats = calculateFinancialStats(period);
      const periodLabel = getPeriodLabel(period);
      
      let text = `👷 <b>Заработок исполнителей</b>\n`;
      text += `${periodLabel}\n\n`;
      text += `💰 <b>Выплачено исполнителям:</b> ${stats.executorEarnings.toLocaleString('ru-RU')} ₽\n`;
      text += `📦 <b>Заказов:</b> ${stats.ordersCount}\n`;
      text += `💵 <b>Выручка:</b> ${stats.revenue.toLocaleString('ru-RU')} ₽\n`;
      
      const avgEarning = stats.ordersCount > 0 ? Math.round(stats.executorEarnings / stats.ordersCount) : 0;
      text += `📊 <b>Средний заработок за заказ:</b> ${avgEarning.toLocaleString('ru-RU')} ₽\n`;
      
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Другой период', 'admin:finance_executors')],
          [Markup.button.callback('⬅️ Финансы', 'admin:finance')]
        ])
      });
    }
    
    // ==========================================
    // 💰 ФИНАНСЫ: ПРИБЫЛЬ + СОВЛАДЕЛЬЦЫ
    // ==========================================
    
    // --- ПРИБЫЛЬ: выбор периода ---
    else if (action === 'finance_profit') {
      ctx.session.adminState = null;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📅 Текущий месяц', 'admin:finance_profit:month')],
        [Markup.button.callback('📆 Выбрать период (с даты по дату)', 'admin:finance_profit:from_date')],
        [Markup.button.callback('♾️ За всё время', 'admin:finance_profit:all')],
        [Markup.button.callback('👥 Указать совладельцев', 'admin:finance_coowners')],
        [Markup.button.callback('⚙️ Константа расходов', 'admin:finance_edit_constant')],
        [Markup.button.callback('⬅️ Назад к финансам', 'admin:finance')]
      ]);
      await ctx.editMessageText(
        `📈 <b>Прибыль</b>\n\nВыберите период или настройте совладельцев:`,
        { parse_mode: 'HTML', ...keyboard }
      );
    }
    
    // --- ПРИБЫЛЬ: показ за период ---
    else if (action.startsWith('finance_profit:')) {
      const period = action.split(':')[1];
      
      if (period === 'from_date') {
        ctx.session.adminState = 'finance_date_start:profit';
        await ctx.editMessageText(
          `📆 <b>Прибыль: выбор периода</b>\n\n📝 <b>Шаг 1/2: Введите НАЧАЛЬНУЮ дату</b>\nФормат: <code>ДД.ММ.ГГГГ</code>\nНапример: <code>01.10.2026</code>`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin:finance_profit')]]) }
        );
        return;
      }
      
      const stats = calculateFinancialStats(period);
      const periodLabel = getPeriodLabel(period);
      
      let text = `📈 <b>Прибыль</b>\n`;
      text += `${periodLabel}\n\n`;
      text += `📊 <b>Комиссия общая:</b> ${stats.totalCommission.toLocaleString('ru-RU')} ₽\n`;
      text += `🎁 <b>Покрытие скидок:</b> -${stats.discountCoverage.toLocaleString('ru-RU')} ₽\n`;
      text += `📊 <b>Комиссия чистая:</b> ${stats.netCommission.toLocaleString('ru-RU')} ₽\n\n`;
      
      // Совладельцы
      if (stats.coOwnersShares.length > 0) {
        text += `👥 <b>Совладельцы:</b>\n`;
        stats.coOwnersShares.forEach(co => {
          const name = co.username ? `@${co.username}` : `ID: ${co.id}`;
          text += `  • ${name}: ${co.percent}% = ${co.share.toLocaleString('ru-RU')} ₽\n`;
        });
        text += `  <b>Итого совладельцам:</b> ${stats.coOwnersTotal.toLocaleString('ru-RU')} ₽\n\n`;
      }
      
      // Константа расходов
      text += `⚙️ <b>Константа расходов (${stats.expenseConstant}%):</b> ${stats.expenseConstantAmount.toLocaleString('ru-RU')} ₽\n\n`;
      
      // Чистая прибыль
      text += `💰 <b>Чистая прибыль:</b> ${stats.netProfit.toLocaleString('ru-RU')} ₽\n`;
      
      if (stats.netProfit < 0) {
        text += `\n⚠️ <b>Внимание: убыток!</b>`;
      }
      
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👥 Совладельцы', 'admin:finance_coowners')],
          [Markup.button.callback('🔄 Другой период', 'admin:finance_profit')],
          [Markup.button.callback('⬅️ Финансы', 'admin:finance')]
        ])
      });
    }
    
    // ==========================================
    // 👥 УПРАВЛЕНИЕ СОВЛАДЕЛЬЦАМИ
    // ==========================================
    
    else if (action === 'finance_coowners') {
      ctx.session.adminState = null;
      const coOwners = finance.getCoOwners();
      const totalPercent = finance.getTotalCoOwnersPercent();
      const expenseConstant = finance.getExpenseConstant();
      
      let text = `👥 <b>Совладельцы</b>\n\n`;
      text += `⚙️ <b>Константа расходов:</b> ${expenseConstant}%\n`;
      text += `👥 <b>Сумма процентов совладельцев:</b> ${totalPercent}%\n`;
      text += `💰 <b>Свободно:</b> ${100 - totalPercent - expenseConstant}%\n\n`;
      
      if (coOwners.length > 0) {
        text += ` <b>Список совладельцев:</b>\n`;
        coOwners.forEach((co, idx) => {
          const name = co.username ? `@${co.username}` : `ID: <code>${co.id}</code>`;
          text += `${idx + 1}. ${name} — ${co.percent}%\n`;
        });
      } else {
        text += `<b>Совладельцы не добавлены</b>\n`;
      }
      
      const buttons = [];
      coOwners.forEach(co => {
        const name = co.username ? `@${co.username}` : `ID: <code>${co.id}</code>`;
        buttons.push([
          Markup.button.callback(`✏️ ${name} (${co.percent}%)`, `admin:finance_edit_coowner:${co.id}`),
          Markup.button.callback('🗑', `admin:finance_delete_coowner:${co.id}`)
        ]);
      });
      
      buttons.push([Markup.button.callback('➕ Добавить совладельца', 'admin:finance_add_coowner')]);
      buttons.push([Markup.button.callback('⬅️ Назад к прибыли', 'admin:finance_profit')]);
      
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    }
    
    // Добавить совладельца: шаг 1 - ID
    else if (action === 'finance_add_coowner') {
      ctx.session.adminState = 'finance_add_coowner_id';
      await ctx.editMessageText(
        `➕ <b>Добавление совладельца</b>\n\n📝 <b>Шаг 1/3: Введите Telegram ID совладельца (число):</b>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', 'admin:finance_coowners')]]) }
      );
    }
    
    // Изменить совладельца
    else if (action.startsWith('finance_edit_coowner:')) {
      const coOwnerId = action.split(':')[1];
      const coOwners = finance.getCoOwners();
      const coOwner = coOwners.find(c => String(c.id) === String(coOwnerId));
      
      if (!coOwner) {
        await ctx.answerCbQuery('❌ Совладелец не найден');
        return;
      }
      
      const name = coOwner.username ? `@${coOwner.username}` : coOwner.id;
      ctx.session.adminState = `finance_edit_coowner_percent:${coOwnerId}`;
      
      await ctx.editMessageText(
        `✏️ <b>Изменение процента совладельца</b>\n\n👤 <b>Совладелец:</b> ${name}\n📊 <b>Текущий процент:</b> ${coOwner.percent}%\n\nВведите новый процент (0-100):`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', 'admin:finance_coowners')]]) }
      );
    }
    
    // Удалить совладельца: подтверждение
    else if (action.startsWith('finance_delete_coowner:')) {
      const coOwnerId = action.split(':')[1];
      const coOwners = finance.getCoOwners();
      const coOwner = coOwners.find(c => String(c.id) === String(coOwnerId));
      
      if (!coOwner) {
        await ctx.answerCbQuery('❌ Совладелец не найден');
        return;
      }
      
      const name = coOwner.username ? `@${coOwner.username}` : coOwner.id;
      
      await ctx.editMessageText(
        `⚠️ <b>Подтверждение удаления</b>\n\nУдалить совладельца ${name} (${coOwner.percent}%)?`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Да, удалить', `admin:finance_delete_coowner_confirm:${coOwnerId}`)],
            [Markup.button.callback('❌ Отмена', 'admin:finance_coowners')]
          ])
        }
      );
    }
    
    // Удалить совладельца: выполнение
    else if (action.startsWith('finance_delete_coowner_confirm:')) {
      const coOwnerId = action.split(':')[1];
      finance.removeCoOwner(coOwnerId);
      
      await ctx.answerCbQuery('✅ Совладелец удалён');
      
      // Возвращаемся к списку совладельцев
      const coOwners = finance.getCoOwners();
      const totalPercent = finance.getTotalCoOwnersPercent();
      const expenseConstant = finance.getExpenseConstant();
      
      let text = `👥 <b>Совладельцы</b>\n\n`;
      text += `⚙️ <b>Константа расходов:</b> ${expenseConstant}%\n`;
      text += `👥 <b>Сумма процентов совладельцев:</b> ${totalPercent}%\n`;
      text += `💰 <b>Свободно:</b> ${100 - totalPercent - expenseConstant}%\n\n`;
      
      if (coOwners.length > 0) {
        text += `<b>Список совладельцев:</b>\n`;
        coOwners.forEach((co, idx) => {
          const name = co.username ? `@${co.username}` : `ID: <code>${co.id}</code>`;
          text += `${idx + 1}. ${name} — ${co.percent}%\n`;
        });
      } else {
        text += `<b>Совладельцы не добавлены</b>\n`;
      }
      
      const buttons = [];
      coOwners.forEach(co => {
        const name = co.username ? `@${co.username}` : `ID: <code>${co.id}</code>`;
        buttons.push([
          Markup.button.callback(`✏️ ${name} (${co.percent}%)`, `admin:finance_edit_coowner:${co.id}`),
          Markup.button.callback('🗑', `admin:finance_delete_coowner:${co.id}`)
        ]);
      });
      
      buttons.push([Markup.button.callback('➕ Добавить совладельца', 'admin:finance_add_coowner')]);
      buttons.push([Markup.button.callback('⬅️ Назад к прибыли', 'admin:finance_profit')]);
      
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    }
    
    // ==========================================
    // ⚙️ КОНСТАНТА РАСХОДОВ
    // ==========================================
    
    else if (action === 'finance_edit_constant') {
      const currentConstant = finance.getExpenseConstant();
      ctx.session.adminState = 'finance_edit_constant';
      
      await ctx.editMessageText(
        `⚙️ <b>Константа расходов</b>\n\n` +
        `📊 <b>Текущее значение:</b> ${currentConstant}%\n\n` +
        `Константа входит в комиссию и используется для:\n` +
        `• Покрытия скидок пользователей\n` +
        `• Оплаты бота\n` +
        `• Прочих расходов\n\n` +
        `Введите новое значение (0-100):`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', 'admin:finance_profit')]]) }
      );
    }

    await ctx.answerCbQuery();
  });

}

module.exports = { register, showAdminMenu };