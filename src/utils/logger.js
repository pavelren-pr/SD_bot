const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'bot_events.jsonl');

// Создаём папку logs, если её нет
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Базовая функция записи события в лог (формат JSONL)
 */
function logEvent(entry) {
  try {
    const record = {
      timestamp: new Date().toISOString(),
      ...entry
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.error('❌ Ошибка записи в лог:', err.message);
  }
}

/**
 * Логирует входящее сообщение (текст/фото/документ)
 */
function logMessage(ctx) {
  if (!ctx.from) return;

  const entry = {
    type: 'message',
    userId: ctx.from.id,
    username: ctx.from.username ? `@${ctx.from.username}` : null,
    firstName: ctx.from.first_name || null,
    chatId: ctx.chat ? ctx.chat.id : null,
    chatType: ctx.chat ? ctx.chat.type : null
  };

  if (ctx.message) {
    if (ctx.message.text) {
      entry.contentType = 'text';
      entry.content = ctx.message.text.substring(0, 500); // ограничиваем длину
    } else if (ctx.message.photo) {
      entry.contentType = 'photo';
      entry.content = '[Фото]';
      if (ctx.message.caption) entry.caption = ctx.message.caption.substring(0, 200);
    } else if (ctx.message.document) {
      entry.contentType = 'document';
      entry.fileName = ctx.message.document.file_name || 'Без имени';
      entry.content = `[Файл: ${entry.fileName}]`;
      if (ctx.message.caption) entry.caption = ctx.message.caption.substring(0, 200);
    } else if (ctx.message.audio) {
      entry.contentType = 'audio';
      entry.content = '[Аудио]';
    } else if (ctx.message.video) {
      entry.contentType = 'video';
      entry.content = '[Видео]';
    } else if (ctx.message.sticker) {
      entry.contentType = 'sticker';
      entry.content = '[Стикер]';
    } else {
      entry.contentType = 'other';
      entry.content = '[Другой тип сообщения]';
    }
  }

  logEvent(entry);
}

/**
 * Логирует нажатие inline-кнопки
 */
function logButton(ctx) {
  if (!ctx.from) return;

  logEvent({
    type: 'button',
    userId: ctx.from.id,
    username: ctx.from.username ? `@${ctx.from.username}` : null,
    firstName: ctx.from.first_name || null,
    chatId: ctx.chat ? ctx.chat.id : null,
    callbackData: ctx.callbackQuery ? ctx.callbackQuery.data : null,
    messageId: ctx.callbackQuery && ctx.callbackQuery.message ? ctx.callbackQuery.message.message_id : null
  });
}

/**
 * Логирует ошибку
 */
function logError(err, ctx) {
  const entry = {
    type: 'error',
    errorMessage: err.message,
    errorStack: err.stack ? err.stack.split('\n').slice(0, 5).join('\n') : null,
    errorCode: err.code || null
  };

  if (err.response) {
    try {
      entry.errorResponse = JSON.stringify(err.response).substring(0, 300);
    } catch (e) { /* ignore */ }
  }

  if (ctx && ctx.from) {
    entry.userId = ctx.from.id;
    entry.username = ctx.from.username ? `@${ctx.from.username}` : null;
  }
  if (ctx && ctx.chat) {
    entry.chatId = ctx.chat.id;
  }
  if (ctx && ctx.callbackQuery) {
    entry.callbackData = ctx.callbackQuery.data;
  }
  if (ctx && ctx.message && ctx.message.text) {
    entry.messageText = ctx.message.text.substring(0, 200);
  }

  logEvent(entry);
}

/**
 * Логирует события заказов
 */
function logOrderEvent(action, orderData, userId, username) {
  logEvent({
    type: 'order_event',
    action: action,
    userId: userId || null,
    username: username ? `@${username}` : null,
    orderNumber: orderData.orderNumber || null,
    orderId: orderData.id || null,
    workTitle: orderData.workTitle || null,
    price: orderData.price || null,
    status: orderData.status || null,
    executorId: orderData.executorId || null,
    customerId: orderData.customerId || null
  });
}

/**
 * Логирует сообщения в чатах заказчик↔исполнитель
 */
function logChatMessage(chatData, fromRole, ctx) {
  if (!ctx.from) return;

  const entry = {
    type: 'chat_message',
    chatId: chatData.chatId,
    orderNumber: chatData.orderNumber || null,
    orderId: chatData.orderId || null,
    workTitle: chatData.workTitle || null,
    fromRole: fromRole, // 'executor' или 'customer'
    userId: ctx.from.id,
    username: ctx.from.username ? `@${ctx.from.username}` : null
  };

  if (ctx.message) {
    if (ctx.message.text) {
      entry.contentType = 'text';
      entry.content = ctx.message.text.substring(0, 500);
    } else if (ctx.message.photo) {
      entry.contentType = 'photo';
      entry.content = '[Фото]';
    } else if (ctx.message.document) {
      entry.contentType = 'document';
      entry.fileName = ctx.message.document.file_name || 'Без имени';
      entry.content = `[Файл: ${entry.fileName}]`;
    }
  }

  logEvent(entry);
}

/**
 * Логирует действия администратора
 */
function logAdminAction(action, details, ctx) {
  logEvent({
    type: 'admin_action',
    action: action,
    userId: ctx.from ? ctx.from.id : null,
    username: ctx.from && ctx.from.username ? `@${ctx.from.username}` : null,
    details: details
  });
}

/**
 * Логирует системные события (запуск, остановка)
 */
function logSystemEvent(action, details) {
  logEvent({
    type: 'system',
    action: action,
    details: details || null
  });
}

module.exports = {
  logEvent,
  logMessage,
  logButton,
  logError,
  logOrderEvent,
  logChatMessage,
  logAdminAction,
  logSystemEvent,
  LOG_FILE
};