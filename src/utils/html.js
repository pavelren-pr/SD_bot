/**
 * Утилиты для работы с HTML в Telegram
 */

/**
 * Экранирует специальные символы HTML для безопасного отображения в Telegram
 * Telegram использует HTML-разметку, поэтому нужно экранировать &, <, >
 * 
 * @param {string} text - Текст для экранирования
 * @returns {string} - Экранированный текст
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Удаляет HTML-теги из текста (для fallback-сообщений)
 * 
 * @param {string} text - Текст с HTML-тегами
 * @returns {string} - Текст без тегов
 */
function stripHtml(text) {
  if (!text) return '';
  return String(text).replace(/<[^>]*>/g, '');
}

/**
 * Проверяет, содержит ли текст неэкранированные HTML-символы
 * 
 * @param {string} text - Текст для проверки
 * @returns {boolean} - true если есть неэкранированные символы
 */
function hasUnescapedHtml(text) {
  if (!text) return false;
  const str = String(text);
  return str.includes('&') || str.includes('<') || str.includes('>');
}

module.exports = {
  escapeHtml,
  stripHtml,
  hasUnescapedHtml
};