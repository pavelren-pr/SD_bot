const catalog = require('../data/catalog');
const loyalty = require('../data/loyalty');
const ordersDb = require('../data/orders');
const { formatOrderCard } = require('./menu');
const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { generateExcelExport, generateLogsExport } = require('../utils/export');
const logger = require('../utils/logger');
const { assignExecutorToOrder, unassignExecutorFromOrder } = require('./order');

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
    return `_⚠️ Переменные не найдены в .env_\n\n`;
  }
  
  let text = type === 'chat' 
    ? `💬 *Доступные переменные чатов:*\n` 
    : `💳 *Доступные переменные оплаты:*\n`;
  
  vars.forEach(v => {
    if (type === 'chat') {
      // Для чатов показываем имя и значение (чтобы понимать, какая группа)
      text += `• \`${v.name}\` — ID: ${v.value}\n`;
    } else {
      // Для оплаты показываем только имя (без номера карты!)
      text += `• \`${v.name}\`\n`;
    }
  });
  
  return text;
}

// 🌟 Экранирование спецсимволов Markdown
function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
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
    [Markup.button.callback('🏅 Назначить исполнителя/админа', 'admin:set_user_rank')],
    [Markup.button.callback('📊 Экспорт данных', 'admin:export_excel')],
    [Markup.button.callback('🔙 Назад', 'profile:back')]
  ]);
}

function getBackToAdminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Назад в меню', 'admin:main')]
  ]);
}

function getCatalogMainMenu() {
  const buttons = catalog.courses.map(c => [Markup.button.callback(c.name, `admin:catalog_course:${c.id}`)]);
  buttons.push([Markup.button.callback('➕ Добавить курс', 'admin:add_course')]);
  buttons.push([Markup.button.callback('✏️ Изменить курс', 'admin:edit_course')]);
  buttons.push([Markup.button.callback('🗑 Удалить курс', 'admin:delete_course')]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
  return Markup.inlineKeyboard(buttons);
}

function getCourseSubjects(courseId) {
  const subjects = catalog.getSubjectsByCourse(courseId);
  const buttons = subjects.map(s => [Markup.button.callback(s.name, `admin:catalog_subject:${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Добавить предмет', `admin:add_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('✏️ Изменить предмет', `admin:edit_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('🗑 Удалить предмет', `admin:delete_subject:${courseId}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin:catalog')]);
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
  const subject = catalog.getSubject(work.subjectId);
  const course = catalog.getCourse(subject.courseId);
  let text = `✏️ *Редактирование работы*\n\n`;
  text += `📚 *Курс:* ${escapeMarkdown(course.name)}\n`;
  text += `📖 *Предмет:* ${escapeMarkdown(subject.name)}\n\n`;
  text += `📝 *Название:* ${escapeMarkdown(work.title)}\n`;
  if (work.description && work.description.trim() !== '') text += `📄 *Описание:* ${escapeMarkdown(work.description)}\n`;
    text += `💰 *Цена:* ${work.price} ₽\n`;
    text += `📊 *Комиссия:* ${work.commission}%\n`;
    text += `💳 *Оплата:* \`${work.paymentEnv}\`\n`;
    text += `💬 *Чат:* \`${work.chatEnv}\`\n`;
    text += `📋 *Требования:* ${Array.isArray(work.needs) && work.needs.length > 0 ? work.needs.join(', ') : 'нет'}\n`;
    text += `🌟 *Индивидуальный заказ:* ${work.isCustomOrder ? 'Да' : 'Нет'}\n`;
    if (work.exampleUrl && work.exampleUrl.trim() !== '') text += `🔗 *Примеры:* ${escapeMarkdown(work.exampleUrl)}\n`;
    text += `\n📌 *Подсказка:*\n${escapeMarkdown(work.prompt)}`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Изменить информацию', `admin:edit_work:${workId}`)],
    [Markup.button.callback('⬅️ Назад', `admin:catalog_subject:${work.subjectId}`)]
  ]);
  return { text, keyboard };
}

function getDeleteCourseList() {
  const buttons = catalog.courses.map(c => [Markup.button.callback(`🗑 ${c.name}`, `admin:delete_course_confirm:${c.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Отмена', 'admin:catalog')]);
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

function getEditCourseList() {
  const buttons = catalog.courses.map(c => [Markup.button.callback(`✏️ ${c.name}`, `admin:edit_course_select:${c.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Отмена', 'admin:catalog')]);
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
  await ctx.reply('🛠 *Панель управления*', {
    parse_mode: 'Markdown',
    ...getAdminMainMenu()
  });
}

// ==========================================
// Регистрация обработчиков
// ==========================================
function register(bot) {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ У вас нет прав для доступа к этой панели.');
    ctx.session = ctx.session || {};
    ctx.session.adminState = null;
    await ctx.reply('🛠 *Панель управления*', { parse_mode: 'Markdown', ...getAdminMainMenu() });
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

    // --- КАТАЛОГ: Добавление/Изменение ---
    if (state === 'awaiting_course_name') {
      const courses = catalog.getData().courses;
      const newId = `course${Date.now()}`;
      courses.push({ id: newId, name: text });
      catalog.saveData({ ...catalog.getData(), courses });
      await ctx.reply(`✅ Курс добавлен!\n\n*Название:* ${text}\n*ID:* \`${newId}\``, { parse_mode: 'Markdown', ...getCatalogMainMenu() });
      ctx.session.adminState = null; return;
    }
    if (state.startsWith('awaiting_subject_name:')) {
      const courseId = state.split(':')[1];
      const subjects = catalog.getData().subjects;
      subjects.push({ id: `subj${Date.now()}`, courseId, name: text });
      catalog.saveData({ ...catalog.getData(), subjects });
      await ctx.reply(`✅ Предмет добавлен!\n\n*Название:* ${text}`, { parse_mode: 'Markdown', ...getCourseSubjects(courseId) });
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
        await ctx.reply(`✅ Название курса изменено!\n\n📝 *Было:* ${oldName}\n📝 *Стало:* ${text}`, { parse_mode: 'Markdown', ...getCatalogMainMenu() });
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
        await ctx.reply(`✅ Название предмета изменено!\n\n📝 *Было:* ${oldName}\n📝 *Стало:* ${text}`, { parse_mode: 'Markdown', ...getCourseSubjects(courseId) });
      }
      ctx.session.adminState = null; return;
    }

    // --- КАТАЛОГ: Добавление работы ---
    if (state.startsWith('add_work_title:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData = { subjectId, title: text };
      ctx.session.adminState = `add_work_description:${subjectId}`;
      await ctx.reply('📄 *Шаг 2/9: Введите описание работы (или "нет"):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
     if (state.startsWith('add_work_description:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.description = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.adminState = `add_work_price:${subjectId}`;
      await ctx.reply('💵 *Шаг 3/9: Введите цену (только число):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_title:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData = { subjectId, title: text, isCustomOrder: true };
      ctx.session.adminState = `add_custom_work_description:${subjectId}`;
      await ctx.reply('📄 *Шаг 2/7: Введите описание индивидуального заказа (или "нет"):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
     if (state.startsWith('add_custom_work_description:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.description = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.adminState = `add_custom_work_commission:${subjectId}`;
      await ctx.reply('📊 *Шаг 3/7: Введите комиссию в %:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_commission:')) {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_custom_work_chatEnv:${state.split(':')[1]}`;
      
      // 🌟 Показываем доступные переменные чатов
      const envVars = getAvailableEnvVars();
      let message = '💬 *Шаг 4/7: Имя переменной окружения для чата исполнителей*\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      
      await ctx.reply(message, { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_chatEnv:')) {
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_custom_work_paymentEnv:${state.split(':')[1]}`;
      
      // 🌟 Показываем доступные переменные оплаты
      const envVars = getAvailableEnvVars();
      let message = '💳 *Шаг 5/7: Имя переменной окружения для оплаты*\n\n';
      message += formatEnvVarsList(envVars.paymentVars, 'payment');
      message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      
      await ctx.reply(message, { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_paymentEnv:')) {
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_custom_work_prompt:${state.split(':')[1]}`;
      await ctx.reply('📌 *Шаг 6/7: Введите подсказку для заказчика (prompt):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_custom_work_prompt:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      ctx.session.adminState = `add_custom_work_exampleUrl:${subjectId}`;
      await ctx.reply('🔗 *Шаг 7/7: Ссылка на примеры работ (или "нет", если нет):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    // 🌟 НОВЫЙ ШАГ: exampleUrl для индивидуального заказа
    if (state.startsWith('add_custom_work_exampleUrl:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.exampleUrl = text.toLowerCase() === 'нет' ? '' : text;
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.tempWorkData.price = 0;
      ctx.session.tempWorkData.needs = [];
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });
      await ctx.reply(`✅ *Индивидуальный заказ добавлен!*\n\n🌟 *${escapeMarkdown(ctx.session.tempWorkData.title)}*\n📊 Комиссия: ${ctx.session.tempWorkData.commission}%`, { parse_mode: 'Markdown', ...getSubjectWorks(subjectId) });
      ctx.session.adminState = null; ctx.session.tempWorkData = null; return;
    }
    if (state.startsWith('add_work_price:')) {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом.');
      ctx.session.tempWorkData.price = parseInt(text);
      ctx.session.adminState = `add_work_commission:${state.split(':')[1]}`;
      await ctx.reply('📊 *Шаг 4/9: Введите комиссию в %:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_commission:')) {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      ctx.session.tempWorkData.commission = parseInt(text);
      ctx.session.adminState = `add_work_chatEnv:${state.split(':')[1]}`;
      
      // 🌟 Показываем доступные переменные чатов
      const envVars = getAvailableEnvVars();
      let message = '💬 *Шаг 5/9: Имя переменной окружения для чата*\n\n';
      message += formatEnvVarsList(envVars.chatVars, 'chat');
      message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      
      await ctx.reply(message, { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_chatEnv:')) {
      ctx.session.tempWorkData.chatEnv = text;
      ctx.session.adminState = `add_work_paymentEnv:${state.split(':')[1]}`;
      
      // 🌟 Показываем доступные переменные оплаты
      const envVars = getAvailableEnvVars();
      let message = '💳 *Шаг 6/9: Имя переменной окружения для оплаты*\n\n';
      message += formatEnvVarsList(envVars.paymentVars, 'payment');
      message += `\nОтправьте имя переменной (можно скопировать из списка выше):`;
      
      await ctx.reply(message, { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_paymentEnv:')) {
      ctx.session.tempWorkData.paymentEnv = text;
      ctx.session.adminState = `add_work_needs:${state.split(':')[1]}`;
      await ctx.reply(
        '📎 *Шаг 7/9: Требования к заказу*\n\n' +
        'Отправьте через запятую или напишите "нет":\n\n' +
        '• `photo`\n' +
        '• `details`\n' +
        '• `variant`\n' +
        '• `details, photo`\n\n' +
        'Введите требования:',
        { parse_mode: 'Markdown', ...getBackToAdminMenu() }
      ); return;
    }
    if (state.startsWith('add_work_needs:')) {
      ctx.session.tempWorkData.needs = text.toLowerCase() === 'нет' ? [] : text.split(',').map(s => s.trim());
      ctx.session.tempWorkData.id = `work_${Date.now()}`;
      ctx.session.adminState = `add_work_prompt:${state.split(':')[1]}`;
      await ctx.reply('📌 *Шаг 8/9: Введите подсказку для заказчика (prompt):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state.startsWith('add_work_prompt:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.prompt = text;
      ctx.session.adminState = `add_work_exampleUrl:${subjectId}`;
      await ctx.reply('🔗 *Шаг 9/9: Ссылка на примеры работ (или "нет", если нет):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    // 🌟 НОВЫЙ ШАГ: exampleUrl для обычной работы
    if (state.startsWith('add_work_exampleUrl:')) {
      const subjectId = state.split(':')[1];
      ctx.session.tempWorkData.exampleUrl = text.toLowerCase() === 'нет' ? '' : text;
      const works = catalog.getData().works;
      works.push(ctx.session.tempWorkData);
      catalog.saveData({ ...catalog.getData(), works });

      // 🌟 Логируем добавление работы
      logger.logAdminAction('catalog_work_added', {
        workId: ctx.session.tempWorkData.id,
        title: ctx.session.tempWorkData.title,
        price: ctx.session.tempWorkData.price
      }, ctx);

      await ctx.reply(`✅ *Работа добавлена!*\n\n📝 *${ctx.session.tempWorkData.title}*\n💰 ${ctx.session.tempWorkData.price} ₽`, { parse_mode: 'Markdown', ...getSubjectWorks(subjectId) });
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

      ordersDb.updateOrder(orderId, { [field]: value });
      const order = ordersDb.getOrder(orderId);

      // 🌟 Логика уведомлений при изменении цены индивидуального заказа
      if (field === 'price' && order.isCustomOrder && order.customerId) {
        const orderNumber = order.orderNumber || orderId;

        if (order.status !== 'paid' && value > 0) {
          // Цена назначена/изменена и заказ НЕ оплачен → уведомляем заказчика
          const isNewPrice = (!oldPrice || oldPrice <= 0);
          const title = isNewPrice
            ? '💰 *Назначена цена за ваш заказ*'
            : '💰 *Цена за ваш заказ изменена*';

          const customerMessage =
            `${title}\n\n` +
            `🆔 *Номер заказа:* №${orderNumber}\n` +
            `📚 *Предмет:* ${order.subjectName || order.workTitle}\n` +
            `💵 *Цена:* ${value} ₽\n\n` +
            `Вы можете обсудить цену с исполнителем или перейти к оплате:`;

          const customerKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('✉️ Обсудить цену с исполнителем', `custom_write_executor:${orderNumber}`)],
            [Markup.button.callback('💳 Перейти к оплате', `custom_pay:${orderNumber}`)]
          ]);

          try {
            await ctx.telegram.sendMessage(order.customerId, customerMessage, {
              parse_mode: 'Markdown',
              reply_markup: customerKeyboard.reply_markup
            });
          } catch (e) {
            console.log('Не удалось уведомить заказчика о цене:', e.message);
          }
        }
        // Если status === 'paid' — просто обновляем поле, без уведомления
      }

      await ctx.reply(
        `✅ Поле "${field}" обновлено!\n\nНовое значение: \`${value}\``,
        {
          parse_mode: 'Markdown',
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
        { parse_mode: 'Markdown', ...getAdminMainMenu() }
      );
      ctx.session.adminState = null; return;
    }

    // --- РАНГИ ---
    if (state === 'awaiting_user_id_for_rank') {
      if (isNaN(text)) return ctx.reply('❌ ID пользователя должен быть числом.');
      ctx.session.tempRankUserId = text;
      ctx.session.adminState = 'awaiting_rank_name';
      await ctx.reply('🏅 *Введите название ранга:*\n\n• Прометей\n• Посейдон', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state === 'awaiting_rank_name') {
      const userId = ctx.session.tempRankUserId;
      const rankName = text.trim();
      const validRank = loyalty.RANKS.find(r => r.name === rankName);
      if (!validRank) return ctx.reply(`❌ Ранг не найден.\n\nДоступные:\n${loyalty.RANKS.map(r => `• ${r.name}`).join('\n')}`, { ...getBackToAdminMenu() });
      const loyaltyData = loyalty.loadData();
      if (!loyaltyData[userId]) loyaltyData[userId] = { username: '', totalSpent: 0 };
      loyaltyData[userId].rank = rankName;
      loyalty.saveData(loyaltyData);

      // 🌟 Логируем назначение ранга
      logger.logAdminAction('rank_assigned', {
        targetUserId: userId,
        rankName: rankName
      }, ctx);

      const rankEmoji = rankName === 'Посейдон' ? '👑' : '🔥';
      await ctx.reply(`${rankEmoji} Ранг пользователя \`${userId}\` изменён на "${rankName}"`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К управлению рангами', 'admin:set_user_rank')]]) });
      ctx.session.adminState = null; ctx.session.tempRankUserId = null; return;
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
      await ctx.reply('📋 *Шаг 2: Выберите тип заказа:*', { parse_mode: 'Markdown', ...typeKeyboard });
      ctx.session.adminState = null; return;
    }
    if (state === 'add_order:title') {
      ctx.session.newOrder.workTitle = text;
      ctx.session.adminState = 'add_order:subject';
      await ctx.reply('📖 *Шаг 4: Введите название предмета:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state === 'add_order:subject') {
      ctx.session.newOrder.subjectName = text;
      ctx.session.adminState = 'add_order:course';
      await ctx.reply('🎓 *Шаг 5: Введите название курса:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state === 'add_order:course') {
      ctx.session.newOrder.courseName = text;
      // 🌟 Для обоих типов запрашиваем описание
      ctx.session.adminState = 'add_order:description';
      await ctx.reply('📝 *Шаг 6: Введите описание задания (или "нет", если не требуется):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
      return;
    }
    if (state === 'add_order:price') {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом.');
      ctx.session.newOrder.price = parseInt(text);
      ctx.session.adminState = 'add_order:commission';
       await ctx.reply('📊 *Шаг 8: Введите комиссию в %:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state === 'add_order:description') {
      // 🌟 Если пользователь ввёл "нет", сохраняем null
      ctx.session.newOrder.description = text.toLowerCase() === 'нет' ? null : text;
      if (ctx.session.newOrder.isCustomOrder) {
        ctx.session.adminState = 'add_order:price_custom';
        await ctx.reply('💰 *Шаг 7: Введите цену заказа (0 если ещё не назначена):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
      } else {
        ctx.session.adminState = 'add_order:price';
        await ctx.reply('💰 *Шаг 7: Введите цену заказа (число в рублях):*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
      }
      return;
    }
    if (state === 'add_order:price_custom') {
      if (isNaN(text)) return ctx.reply('❌ Цена должна быть числом.');
      ctx.session.newOrder.price = parseInt(text);
      ctx.session.adminState = 'add_order:commission';
      await ctx.reply('📊 *Шаг 8: Введите комиссию в %:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() }); return;
    }
    if (state === 'add_order:commission') {
      if (isNaN(text)) return ctx.reply('❌ Комиссия должна быть числом.');
      ctx.session.newOrder.commission = parseInt(text);
      const newOrder = ctx.session.newOrder;
      let confirmText = `📋 *Подтверждение нового заказа*\n\n`;
      confirmText += `👤 *Заказчик ID:* ${newOrder.customerId}\n`;
      confirmText += `${newOrder.isCustomOrder ? '🌟' : '📦'} *Тип:* ${newOrder.isCustomOrder ? 'Индивидуальный' : 'Обычный'}\n`;
      confirmText += `📚 *Работа:* ${newOrder.workTitle}\n`;
      confirmText += `📖 *Предмет:* ${newOrder.subjectName}\n`;
      confirmText += `🎓 *Курс:* ${newOrder.courseName}\n`;
      confirmText += `💰 *Цена:* ${newOrder.price} ₽\n`;
      confirmText += `📊 *Комиссия:* ${newOrder.commission}%\n`;
      if (newOrder.description) confirmText += `📝 *Описание:* ${newOrder.description.substring(0, 100)}...\n`;
      confirmText += `\nСоздать заказ?`;
      const confirmKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Создать заказ', 'admin:add_order_confirm')],
        [Markup.button.callback('❌ Отмена', 'admin:orders')]
      ]);
      await ctx.reply(confirmText, { parse_mode: 'Markdown', ...confirmKeyboard });
      ctx.session.adminState = null; return;
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
        await ctx.reply(cardText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
      
      let textMsg = `👤 *Информация о заказчике*\n\n`;
      textMsg += `ID: \`${foundCustomer.id}\`\n`;
      textMsg += `Username: ${foundCustomer.username !== 'N/A' ? '@' + foundCustomer.username : 'не указан'}\n`;
      textMsg += `Сумма выкупа: ${loyaltyInfo.totalSpent} ₽\n`;
      textMsg += `Количество заказов: ${foundCustomer.orderCount}\n\n`;
      
      if (customerOrders.length > 0) {
        textMsg += `📦 *Последние заказы:*\n`;
        customerOrders.slice(0, 5).forEach((o, i) => {
          textMsg += `${i + 1}. №${o.orderNumber} | ${o.workTitle} | ${o.price} ₽ | ${o.status}\n`;
        });
      }
      
      const buttons = [
        [Markup.button.callback('✏️ Изменить сумму выкупа', `admin:customer_edit_spent:${foundCustomer.id}`)],
        [Markup.button.callback('💬 Написать заказчику', `admin:send_msg_customer_by_id:${foundCustomer.id}`)],
        [Markup.button.callback('⬅️ Назад к списку', 'admin:customers')]
      ];
      
      await ctx.reply(textMsg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
            `📬 *Сообщение от администрации по заказу №${order.orderNumber}*\n\n${messageText}`,
            { parse_mode: 'Markdown', reply_markup: replyKeyboard.reply_markup }
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
                `📬 *Сообщение от администрации*\n\n${messageText}`,
                { parse_mode: 'Markdown' }
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

              // 🌟 Обновляем заказ в БД
              ordersDb.updateOrder(orderId, {
                executorId: executorId,
                executorUsername: executorUsername,
                status: order.isCustomOrder ? 'waiting_price' : 'active',
                acceptedAt: new Date().toLocaleString('ru-RU')
              });

              // ==========================================
              // 🌟 ИНДИВИДУАЛЬНЫЙ ЗАКАЗ — отдельная логика
              // ==========================================
              if (order.isCustomOrder) {
                // 1. Уведомляем НОВОГО исполнителя с кнопками управления
                if (order.status !== 'completed') {
                  const privateText =
                    `✅ *Вам назначен индивидуальный заказ!*\n\n` +
                    `🆔 *Номер заказа:* №${orderNumber}\n` +
                    `📚 *Предмет:* ${order.subjectName || order.workTitle}\n` +
                    `👤 *Заказчик:* ${order.customerUsername ? '@' + order.customerUsername : 'ID: ' + order.customerId}\n\n` +
                    `Назначьте цену или свяжитесь с заказчиком:`;

                  const privateKeyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('💰 Назначить цену', `custom_set_price:${orderNumber}`)],
                    [Markup.button.callback('✉️ Написать сообщение заказчику', `custom_write_customer:${orderNumber}`)]
                  ]);

                  try {
                    await bot.telegram.sendMessage(executorId, privateText, {
                      parse_mode: 'Markdown',
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
                    `👷 *По вашему заказу ${actionWord} исполнитель*\n\n` +
                    `🆔 *Номер заказа:* №${orderNumber}\n` +
                    `📚 *Предмет:* ${order.subjectName || order.workTitle}\n\n` +
                    `Вы можете связаться с исполнителем для обсуждения деталей:`;

                  const customerKeyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('✏️ Написать исполнителю', `custom_write_executor:${orderNumber}`)]
                  ]);

                  try {
                    await bot.telegram.sendMessage(order.customerId, customerMessage, {
                      parse_mode: 'Markdown',
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
                      `⚠️ *Заказ передан другому исполнителю*\n\n` +
                      `🆔 *Номер заказа:* №${orderNumber}\n` +
                      `📚 *Предмет:* ${order.subjectName || order.workTitle}\n\n` +
                      `Администратор назначил нового исполнителя. Вы больше не являетесь исполнителем по этому заказу.`,
                      { parse_mode: 'Markdown' }
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
                const result = await assignExecutorToOrder(orderId, executorId, bot, true);

                // При переназначении обычного заказа тоже уведомляем старого исполнителя
                if (isReassignment && oldExecutorId) {
                  try {
                    await bot.telegram.sendMessage(oldExecutorId,
                      `⚠️ *Заказ передан другому исполнителю*\n\n` +
                      `🆔 *Номер заказа:* №${orderNumber}\n` +
                      `📚 *Работа:* ${order.workTitle}\n\n` +
                      `Администратор назначил нового исполнителя. Вы больше не являетесь исполнителем по этому заказу.`,
                      { parse_mode: 'Markdown' }
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
                `✅ *Исполнитель успешно ${actionLabel}!*\n\n` +
                `👷 *Исполнитель:* ${executorName}\n` +
                `📦 *Заказ:* №${orderNumber}\n\n` +
                `Уведомления отправлены ${notifyDetails}.`,
                { parse_mode: 'Markdown' }
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
              await ctx.reply(cardText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(newButtons) });

            } catch (err) {
              await ctx.reply(
                `❌ *Ошибка назначения:*\n\n${err.message}`,
                {
                  parse_mode: 'Markdown',
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

      await ctx.reply(
        `💬 *Режим ответа заказчику*\n\n` +
        `🆔 *Номер заказа:* №${orderNumber}\n` +
        `📚 *Заказ:* ${escapeMarkdown(orderTitle)}\n\n` +
        `Напишите сообщение или прикрепите файл, которое будет отправлено заказчику.`,
        { parse_mode: 'Markdown' }
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
      await ctx.editMessageText('🛠 *Панель управления*', { parse_mode: 'Markdown', ...getAdminMainMenu() });
    }

    // --- КАТАЛОГ: Навигация ---
    else if (action === 'catalog') {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗂 *Управление каталогом*\n\nВыберите курс:', { parse_mode: 'Markdown', ...getCatalogMainMenu() });
    }
    else if (action.startsWith('catalog_course:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('📖 *Предметы курса*\n\nВыберите предмет:', { parse_mode: 'Markdown', ...getCourseSubjects(action.split(':')[1]) });
    }
    else if (action.startsWith('catalog_subject:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('📝 *Работы предмета*\n\nВыберите работу:', { parse_mode: 'Markdown', ...getSubjectWorks(action.split(':')[1]) });
    }
    else if (action.startsWith('catalog_work:')) {
      ctx.session.adminState = null;
      const card = getWorkCard(action.split(':')[1]);
      await ctx.editMessageText(card.text, { parse_mode: 'Markdown', ...card.keyboard });
    }

    // --- КАТАЛОГ: Добавление ---
    else if (action === 'add_course') {
      ctx.session.adminState = 'awaiting_course_name';
      await ctx.editMessageText('✏️ *Введите название нового курса:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('add_subject:')) {
      ctx.session.adminState = `awaiting_subject_name:${action.split(':')[1]}`;
      await ctx.editMessageText('✏️ *Введите название нового предмета:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('add_work:')) {
      ctx.session.adminState = `add_work_title:${action.split(':')[1]}`;
      await ctx.editMessageText('✍️ *Шаг 1/9: Введите название работы:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('add_custom_work:')) {
      const subjectId = action.split(':')[1];
      ctx.session.adminState = `add_custom_work_title:${subjectId}`;
      await ctx.editMessageText('✍️ *Шаг 1/6: Введите название индивидуального заказа:*', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }

    // --- КАТАЛОГ: Изменение ---
    else if (action === 'edit_course') {
      ctx.session.adminState = null;
      await ctx.editMessageText('✏️ *Изменение курса*\n\nВыберите курс:', { parse_mode: 'Markdown', ...getEditCourseList() });
    }
    else if (action.startsWith('edit_course_select:')) {
      const courseId = action.split(':')[1];
      ctx.session.adminState = `edit_course_name:${courseId}`;
      await ctx.editMessageText(`✏️ *Текущее название:* ${catalog.getCourse(courseId).name}\n\nВведите новое:`, { parse_mode: 'Markdown', ...getBackToAdminMenu() });
    }
    else if (action.startsWith('edit_subject:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('✏️ *Изменение предмета*\n\nВыберите предмет:', { parse_mode: 'Markdown', ...getEditSubjectList(action.split(':')[1]) });
    }
    else if (action.startsWith('edit_subject_select:')) {
      const subjectId = action.split(':')[1];
      ctx.session.adminState = `edit_subject_name:${subjectId}`;
      await ctx.editMessageText(`✏️ *Текущее название:* ${catalog.getSubject(subjectId).name}\n\nВведите новое:`, { parse_mode: 'Markdown', ...getBackToAdminMenu() });
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
      await ctx.editMessageText('✏️ *Выберите поле для изменения:*', { parse_mode: 'Markdown', ...keyboard });
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
      let message = `✏️ *Введите новое значение для поля "${field}":*\n\n📌 *Текущее:* \`${oldValue}\`\n\n`;
      
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
      
      await ctx.editMessageText(message, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `admin:edit_work:${workId}`)]]) });
    }

    // --- КАТАЛОГ: Удаление ---
    else if (action === 'delete_course') {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 *Удаление курса*\n\nВыберите курс:', { parse_mode: 'Markdown', ...getDeleteCourseList() });
    }
    else if (action.startsWith('delete_course_confirm:')) {
      const courseId = action.split(':')[1];
      const course = catalog.getCourse(courseId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Да, удалить "${course.name}"`, `admin:delete_course_execute:${courseId}`)],
        [Markup.button.callback('❌ Отмена', 'admin:catalog')]
      ]);
      await ctx.editMessageText(`⚠️ *Подтверждение*\n\nКурс: *${course.name}*\nВсе предметы и работы будут удалены!`, { parse_mode: 'Markdown', ...keyboard });
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
      await ctx.editMessageText(`✅ Курс "${course.name}" удалён!`, { parse_mode: 'Markdown', ...getCatalogMainMenu() });
    }
    else if (action.startsWith('delete_subject:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 *Удаление предмета*\n\nВыберите предмет:', { parse_mode: 'Markdown', ...getDeleteSubjectList(action.split(':')[1]) });
    }
    else if (action.startsWith('delete_subject_confirm:')) {
      const subjectId = action.split(':')[1];
      const subject = catalog.getSubject(subjectId);
      const works = catalog.getWorksBySubject(subjectId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Да, удалить "${subject.name}"`, `admin:delete_subject_execute:${subjectId}`)],
        [Markup.button.callback('❌ Отмена', `admin:catalog_course:${subject.courseId}`)]
      ]);
      await ctx.editMessageText(`⚠️ *Подтверждение*\n\nПредмет: *${subject.name}*\nРабот: ${works.length}\nВсе работы будут удалены!`, { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action.startsWith('delete_subject_execute:')) {
      const subjectId = action.split(':')[1];
      const subject = catalog.getSubject(subjectId);
      const data = catalog.getData();
      data.works = data.works.filter(w => w.subjectId !== subjectId);
      data.subjects = data.subjects.filter(s => s.id !== subjectId);
      catalog.saveData(data);
      await ctx.editMessageText(`✅ Предмет "${subject.name}" удалён!`, { parse_mode: 'Markdown', ...getCourseSubjects(subject.courseId) });
    }
    else if (action.startsWith('delete_work:')) {
      ctx.session.adminState = null;
      await ctx.editMessageText('🗑 *Удаление работы*\n\nВыберите работу:', { parse_mode: 'Markdown', ...getDeleteWorkList(action.split(':')[1]) });
    }
    else if (action.startsWith('delete_work_confirm:')) {
      const workId = action.split(':')[1];
      const work = catalog.getWork(workId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, удалить', `admin:delete_work_execute:${workId}`)],
        [Markup.button.callback('❌ Отмена', `admin:catalog_subject:${work.subjectId}`)]
      ]);
      await ctx.editMessageText(`⚠️ *Подтверждение*\n\nРабота: *${work.title}*\nЦена: ${work.price} ₽`, { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action.startsWith('delete_work_execute:')) {
      const workId = action.split(':')[1];
      const work = catalog.getWork(workId);
      const data = catalog.getData();
      data.works = data.works.filter(w => w.id !== workId);
      catalog.saveData(data);

      // 🌟 Логируем удаление работы
      logger.logAdminAction('catalog_work_deleted', {
        workId: workId,
        title: work.title
      }, ctx);

      await ctx.editMessageText(`✅ Работа удалена!`, { parse_mode: 'Markdown', ...getSubjectWorks(work.subjectId) });
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
      await ctx.editMessageText(`📦 *Управление заказами*\n\nВсего: *${all.length}*\n⏳ Ожидают: *${p}*\n🔨 В работе: *${a}*\n✅ Выполнены: *${c}*`, { parse_mode: 'Markdown', ...keyboard });
    }
    else if (action === 'add_order_start') {
      ctx.session.adminState = 'add_order:customer_id';
      await ctx.editMessageText(
        '✏️ *Добавление нового заказа*\n\n📝 *Шаг 1: Введите Telegram ID заказчика:*',
        { parse_mode: 'Markdown', ...getBackToAdminMenu() }
      );
    }
    else if (action === 'search_order_prompt') {
      ctx.session.adminState = 'search_order_prompt';
      await ctx.editMessageText('🔍 *Поиск заказа по номеру*\n\nВведите номер заказа:', { parse_mode: 'Markdown', ...getBackToAdminMenu() });
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
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('order_view:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }
      const text = formatOrderCard(order, 'admin');
      const buttons = [
        [Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${orderId}`)],
        [Markup.button.callback('💬 Написать заказчику', `admin:send_msg_customer:${orderId}`)]
      ];
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
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
        `✏️ *Редактирование заказа №${order.orderNumber}*\n${typeLabel}\n\nВыберите поле для изменения:`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboardButtons) }
      );
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
      await ctx.editMessageText(`✏️ *Введите новое значение для поля "${field}":*\n\n📌 *Текущее:* \`${oldValue}\``, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `admin:order_edit:${orderId}`)]]) });
    }
    // ==========================================
    // 🌟 НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ ВРУЧНУЮ
    // ==========================================
    else if (action.startsWith('assign_executor:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) { await ctx.answerCbQuery('❌ Заказ не найден'); return; }
      
      // 🌟 Получаем список исполнителей и администраторов из базы рангов
      const loyaltyData = loyalty.loadData();
      const admins = [];
      const executors = [];
      for (const [userId, userData] of Object.entries(loyaltyData)) {
        if (userData.rank === 'Посейдон') {
          admins.push({ id: userId, username: userData.username || null });
        } else if (userData.rank === 'Прометей') {
          executors.push({ id: userId, username: userData.username || null });
        }
      }
      
      // 🌟 Формируем текст со списком доступных пользователей
      let availableUsersText = '';
      
      if (executors.length > 0) {
        availableUsersText += `🔥 *Исполнители (Прометей):*\n`;
        executors.forEach(e => {
          availableUsersText += `• \`${e.id}\`${e.username ? ` (\`@${e.username}\`)` : ''}\n`;
        });
      } else {
        availableUsersText += `🔥 *Исполнители:* _нет назначенных рангов_\n`;
      }
      
      if (admins.length > 0) {
        availableUsersText += `\n👑 *Администраторы (Посейдон):*\n`;
        admins.forEach(a => {
          availableUsersText += `• \`${a.id}\`${a.username ? ` (\`@${a.username}\`)` : ''}\n`;
        });
      }
      
      ctx.session.adminState = `awaiting_executor_id_for_order:${orderId}`;
      await ctx.editMessageText(
        `👷 *Назначение исполнителя*\n\n` +
        `📦 *Заказ:* №${order.orderNumber} | ${order.workTitle}\n\n` +
        `Введите Telegram ID исполнителя (число):\n\n` +
        `${availableUsersText}\n` +
        `_Или введите ID любого пользователя вручную_`,
        { 
          parse_mode: 'Markdown', 
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
      buttons.push([Markup.button.callback('🗑 Удалить заказ', `admin:order_delete:${orderId}`)]);
      buttons.push([Markup.button.callback('⬅️ Назад к списку', 'admin:orders')]);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('order_delete:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, удалить', `admin:order_delete_confirm:${orderId}`)],
        [Markup.button.callback('❌ Отмена', `admin:order_view:${orderId}`)]
      ]);
      await ctx.editMessageText(`⚠️ *Подтверждение удаления*\n\nЗаказ: *${order.workTitle}*\nЗаказчик: ${order.customerUsername ? `@${order.customerUsername}` : order.customerId}`, { parse_mode: 'Markdown', ...keyboard });
    }
    
    else if (action.startsWith('order_delete_confirm:')) {
      const orderId = action.split(':')[1];
      
      // 🌟 Получаем данные заказа ПЕРЕД удалением
      const order = ordersDb.getOrder(orderId);
      
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
      await ctx.editMessageText(`✅ *Заказ удалён!*\n\n📦 *Управление заказами*\n\nВсего заказов: *${all.length}*`, { parse_mode: 'Markdown', ...keyboard });
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
        [Markup.button.callback('❌ Отмена', `admin:order_view:${orderId}`)]
      ]);
      
      await ctx.editMessageText(
        `💬 *Режим ответа заказчику*\n\n` +
        `📚 *Заказ:* ${order.workTitle}\n` +
        `📅 *Дата:* ${order.createdAt}\n\n` +
        `Напишите сообщение или прикрепите файл, которое будет отправлено заказчику.\n\n` +
        `_(Для отмены нажмите "Отмена")_`,
        { parse_mode: 'Markdown', ...keyboard }
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
        `${typeLabel} заказ выбран\n\n📝 *Шаг 3: Введите название работы:*`,
        { parse_mode: 'Markdown', ...getBackToAdminMenu() }
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
        status: status
      });
      ctx.session.newOrder = null;
      await ctx.answerCbQuery('✅ Заказ создан');
      // Показываем карточку созданного заказа
      const cardText = formatOrderCard(createdOrder, 'admin');
      const buttons = [
        [Markup.button.callback('✏️ Изменить заказ', `admin:order_edit:${createdOrder.id}`)],
        [Markup.button.callback('📦 Все заказы', 'admin:orders')]
      ];
      await ctx.editMessageText(`✅ *Заказ №${createdOrder.orderNumber} создан!*\n\n${cardText}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
        `🔄 *Смена статуса заказа №${order.orderNumber}*\n\nТекущий статус: *${order.status}*`,
        { parse_mode: 'Markdown', ...statusKeyboard }
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
        '📊 *Экспорт данных*\n\nВыберите тип экспорта:\n\n' +
        '• **Экспорт заказов и скидок** — 2 листа (заказы + лояльность)\n' +
        '• **Экспорт логов** — 2 листа (взаимодействия + ошибки/события)\n' +
        '• **Экспорт файлов БД** — отправка orders.json, loyalty.json и catalog.json в группу бэкапов',
        { parse_mode: 'Markdown', ...keyboard }
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
          { caption: '📊 *Экспорт заказов и скидок*\n\n• Лист 1: Все заказы\n• Лист 2: Программа лояльности', parse_mode: 'Markdown' }
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
            caption: '📋 *Экспорт логов*\n\n' +
                    '• Лист 1: Взаимодействия пользователей (сообщения, кнопки, чаты)\n' +
                    '• Лист 2: Ошибки и системные события (запуски, остановки)',
            parse_mode: 'Markdown' 
          }
        );
      } catch (error) {
        console.error('Ошибка при экспорте логов:', error);
        await ctx.reply('❌ Произошла ошибка при формировании файла.');
      }
    }
    // ==========================================
    // 📁 РУЧНОЙ ЭКСПОРТ ФАЙЛОВ БД В ГРУППУ БЭКАПОВ
    // ==========================================
    else if (action === 'export_db_files') {
      try {
        await ctx.answerCbQuery('⏳ Отправляю файлы БД...');

        const backupChatId = process.env.BACKUP_CHAT_ID;
        if (!backupChatId) {
          await ctx.reply('❌ Переменная окружения `BACKUP_CHAT_ID` не настроена в .env файле.');
          return;
        }

        await ctx.replyWithChatAction('upload_document');

        const dataDir = path.join(__dirname, '../data');
        const files = [
          { name: 'orders.json', path: path.join(dataDir, 'orders.json') },
          { name: 'loyalty.json', path: path.join(dataDir, 'loyalty.json') },
          { name: 'catalog.json', path: path.join(dataDir, 'catalog.json') },
        ];

        // Заголовок с информацией, кто запросил бэкап
        const requester = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;
        await ctx.telegram.sendMessage(
          backupChatId,
          `📦 *Ручной экспорт файлов БД*\n📅 ${new Date().toLocaleString('ru-RU')}\n👤 *Запрошен:* ${requester}`,
          { parse_mode: 'Markdown' }
        );

        let sentCount = 0;
        const missingFiles = [];

        for (const file of files) {
          if (fs.existsSync(file.path)) {
            const stats = fs.statSync(file.path);
            const sizeKB = (stats.size / 1024).toFixed(1);

            await ctx.telegram.sendDocument(backupChatId, {
              source: fs.createReadStream(file.path),
              filename: file.name
            }, {
              caption: `📄 ${file.name} (${sizeKB} КБ)`
            });
            sentCount++;
          } else {
            missingFiles.push(file.name);
          }
        }

        // Логируем действие админа
        logger.logAdminAction('export_db_files', { 
          sentCount, 
          totalFiles: files.length,
          missingFiles 
        }, ctx);

        let resultMessage = `✅ *Экспорт файлов БД завершён!*\n\n`;
        resultMessage += `📁 Отправлено файлов: *${sentCount}* из ${files.length}\n`;
        resultMessage += `📍 Файлы отправлены в группу бэкапов.`;
        if (missingFiles.length > 0) {
          resultMessage += `\n\n⚠️ Не найдены файлы: ${missingFiles.join(', ')}`;
        }

        await ctx.reply(resultMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Ошибка при экспорте файлов БД:', error);
        logger.logError(error, ctx);
        await ctx.reply(`❌ Произошла ошибка при экспорте файлов БД: ${error.message}`);
      }
    }
    else if (action === 'clear_logs_confirm') {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, очистить логи', 'admin:clear_logs_execute')],
        [Markup.button.callback('❌ Отмена', 'admin:export_excel')]
      ]);
      await ctx.editMessageText(
        '⚠️ *Подтверждение*\n\nВы уверены, что хотите очистить все логи?\n\nЭто действие необратимо!',
        { parse_mode: 'Markdown', ...keyboard }
      );
    }
    else if (action === 'clear_logs_execute') {
      const success = logger.clearLogs();
      logger.logAdminAction('clear_logs', { success }, ctx);
      if (success) {
        await ctx.answerCbQuery('✅ Логи очищены');
        await ctx.editMessageText('✅ *Логи успешно очищены!*\n\nФайл логов теперь пуст.', { parse_mode: 'Markdown', ...getAdminMainMenu() });
      } else {
        await ctx.answerCbQuery('❌ Ошибка очистки');
        await ctx.editMessageText('❌ Не удалось очистить логи.', { parse_mode: 'Markdown', ...getAdminMainMenu() });
      }
    }

    // --- РАНГИ ---
    else if (action === 'set_user_rank') {
      const loyaltyData = loyalty.loadData();
      
      // Собираем пользователей по рангам
      const admins = [];
      const executors = [];
      
      for (const [userId, userData] of Object.entries(loyaltyData)) {
        if (userData.rank === 'Посейдон') {
          admins.push({ id: userId, username: userData.username || 'N/A' });
        } else if (userData.rank === 'Прометей') {
          executors.push({ id: userId, username: userData.username || 'N/A' });
        }
      }
      
      let text = `🛠 *Управление рангами*\n\n`;
      text += `👑 *Админы (Посейдон):* ${admins.length}\n`;
      if (admins.length === 0) text += `  • нет\n`;
      admins.forEach(a => {
        text += `  • ${a.id} (${a.username !== 'N/A' ? '@' + a.username : 'без username'})\n`;
      });
      text += `\n🔥 *Исполнители (Прометей):* ${executors.length}\n`;
      if (executors.length === 0) text += `  • нет\n`;
      executors.forEach(e => {
        text += `  • ${e.id} (${e.username !== 'N/A' ? '@' + e.username : 'без username'})\n`;
      });
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Назначить ранг', 'admin:set_user_rank:new')],
        [Markup.button.callback('📋 Управление пользователями', 'admin:set_user_rank:manage')],
        [Markup.button.callback('⬅️ Назад', 'admin:main')]
      ]);
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    }
    // Назначить новый ранг
    else if (action === 'set_user_rank:new') {
      ctx.session.adminState = 'awaiting_user_id_for_rank';
      await ctx.editMessageText('👤 *Введите ID пользователя:*\n\n(Например: 1012758149)', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin:set_user_rank')]]) });
    }
    // Управление пользователями с рангами
    else if (action === 'set_user_rank:manage') {
      const loyaltyData = loyalty.loadData();
      
      const rankedUsers = [];
      for (const [userId, userData] of Object.entries(loyaltyData)) {
        if (userData.rank === 'Посейдон' || userData.rank === 'Прометей') {
          rankedUsers.push({ id: userId, username: userData.username || 'N/A', rank: userData.rank });
        }
      }
      
      let text = `📋 *Управление пользователями с рангами*\n\nВыберите пользователя:\n`;
      
      const buttons = rankedUsers.map(u => {
        const rankEmoji = u.rank === 'Посейдон' ? '👑' : '🔥';
        const display = u.username !== 'N/A' ? `${u.id} (@${u.username})` : u.id;
        return [Markup.button.callback(`${rankEmoji} ${display}`, `admin:set_user_rank:user:${u.id}`)];
      });
      
      if (rankedUsers.length === 0) {
        text += `_Пользователей с рангами не найдено_\n`;
      }
      
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:set_user_rank')]);
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
      
      const rankEmoji = userData.rank === 'Посейдон' ? '👑' : '🔥';
      let text = `👤 *Пользователь:* \`${userId}\`\n`;
      text += `📛 *Username:* ${userData.username ? '@' + userData.username : 'не указан'}\n`;
      text += `${rankEmoji} *Текущий ранг:* ${userData.rank}\n\n`;
      text += `Выберите действие:`;
      
      const buttons = [];
      
      // Если админ — можно понизить до исполнителя
      if (userData.rank === 'Посейдон') {
        buttons.push([Markup.button.callback('⬇️ Понизить до Прометей', `admin:set_user_rank:lower:${userId}`)]);
      }
      
      // Разжаловать (снять ранг)
      buttons.push([Markup.button.callback('🗑 Разжаловать (снять ранг)', `admin:set_user_rank:demote:${userId}`)]);
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:set_user_rank:manage')]);
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
      
      let text = `👤 *Пользователь:* \`${userId}\`\n`;
      text += `📛 *Username:* ${loyaltyData[userId].username ? '@' + loyaltyData[userId].username : 'не указан'}\n`;
      text += `🔥 *Текущий ранг:* Прометей\n\n`;
      text += `✅ Ранг успешно понижен до Прометей`;
      
      const buttons = [
        [Markup.button.callback('🗑 Разжаловать (снять ранг)', `admin:set_user_rank:demote:${userId}`)],
        [Markup.button.callback('⬅️ Назад', 'admin:set_user_rank:manage')]
      ];
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
      
      let text = `👤 *Пользователь:* \`${userId}\`\n`;
      text += `📛 *Username:* ${loyaltyData[userId].username ? '@' + loyaltyData[userId].username : 'не указан'}\n\n`;
      text += `✅ Ранг "${oldRank}" успешно снят. Пользователь разжалован.`;
      
      const buttons = [
        [Markup.button.callback('⬅️ Назад к списку', 'admin:set_user_rank:manage')]
      ];
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    // --- БАЗА ЗАКАЗЧИКОВ ---
    else if (action === 'customers') {
      ctx.session.adminState = null;
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
      
      buttons.push([Markup.button.callback('🔍 Поиск по ID/username', 'admin:search_customer_prompt')]);
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
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
      
      buttons.push([Markup.button.callback('🔍 Поиск по ID/username', 'admin:search_customer_prompt')]);
      buttons.push([Markup.button.callback('⬅️ Назад', 'admin:main')]);
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('customer_view:')) {
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
      text += `ID: \`${customer.id}\`\n`;
      text += `Username: ${customer.username !== 'N/A' ? '@' + customer.username : 'не указан'}\n`;
      text += `Сумма выкупа: ${customer.totalSpent} ₽\n`;
      text += `Количество заказов: ${customer.orderCount}\n\n`;
      
      if (customerOrders.length > 0) {
        text += `📦 Последние заказы:\n`;
        customerOrders.slice(0, 5).forEach((o, i) => {
          text += `${i + 1}. №${o.orderNumber} | ${o.workTitle} | ${o.price} ₽ | ${o.status}\n`;
        });
      }
      
      const buttons = [
        [Markup.button.callback('✏️ Изменить сумму выкупа', `admin:customer_edit_spent:${customerId}`)],
        [Markup.button.callback('💬 Написать заказчику', `admin:send_msg_customer_by_id:${customerId}`)],
        [Markup.button.callback('⬅️ Назад к списку', 'admin:customers')]
      ];
      
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    else if (action.startsWith('customer_edit_spent:')) {
      const customerId = action.split(':')[1];
      const loyaltyData = loyalty.loadData();
      const userData = loyaltyData[customerId] || { totalSpent: 0 };
      const currentAmount = userData.totalSpent || 0;
      
      ctx.session.adminState = `edit_customer_spent:${customerId}`;
      await ctx.editMessageText(`✏️ Введите новую сумму выкупа для заказчика ${customerId}:\n\nТекущая сумма: ${currentAmount} ₽\n(Введите число в рублях)`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `admin:customer_view:${customerId}`)]]) });
    }
    else if (action === 'search_customer_prompt') {
      ctx.session.adminState = 'search_customer_prompt';
      await ctx.editMessageText('🔍 Поиск заказчика\n\nВведите Telegram ID или @username (без @):', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin:customers')]]) });
    }
    else if (action.startsWith('send_msg_customer:')) {
      const orderId = action.split(':')[1];
      const order = ordersDb.getOrder(orderId);
      if (!order) {
        await ctx.answerCbQuery('❌ Заказ не найден');
        return;
      }
      ctx.session.adminState = `send_message_to_customer:${orderId}`;
      await ctx.editMessageText(`💬 Отправка сообщения заказчику\n\nЗаказ №${order.orderNumber}\nЗаказчик: ${order.customerUsername ? '@' + order.customerUsername : 'ID: ' + order.customerId}\n\nВведите текст сообщения:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `admin:order_view:${orderId}`)]]) });
    }
    else if (action.startsWith('send_msg_customer_by_id:')) {
      const customerId = action.split(':')[1];
      ctx.session.adminState = `send_message_to_customer_by_id:${customerId}`;
      await ctx.editMessageText(`💬 Отправка сообщения заказчику\n\nID заказчика: \`${customerId}\`\n\nВведите текст сообщения:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin:customers')]]) });
    }

    await ctx.answerCbQuery();
  });

}

module.exports = { register, showAdminMenu };