const fs = require('fs');
const path = require('path');
const catalogPath = path.join(__dirname, 'catalog.json');

// Чтение данных
function getData() {
  try {
    const rawData = fs.readFileSync(catalogPath, 'utf8');
    return JSON.parse(rawData);
  } catch (error) {
    console.error('Ошибка чтения catalog.json:', error);
    return { courses: [], subjects: [], works: [] };
  }
}

// Сохранение данных
function saveData(newData) {
  try {
    fs.writeFileSync(catalogPath, JSON.stringify(newData, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Ошибка записи catalog.json:', error);
    return false;
  }
}

// Миграция: добавляем поле specialty всем старым элементам, у которых его нет
// По умолчанию присваиваем 'navigation' (судовождение), т.к. раньше был только этот каталог
function migrateData() {
  const data = getData();
  let changed = false;
  
  const arrays = ['courses', 'subjects', 'works'];
  arrays.forEach(arr => {
    if (!Array.isArray(data[arr])) data[arr] = [];
    data[arr].forEach(item => {
      if (!item.specialty) {
        item.specialty = 'navigation';
        changed = true;
      }
    });
  });
  
  if (changed) {
    saveData(data);
    console.log('✅ Миграция catalog.json: добавлено поле specialty ко всем элементам');
  }
}

// Запускаем миграцию при загрузке модуля
migrateData();

// Получить все курсы (опционально с фильтрацией по специальности)
function getCourses(specialty = null) {
  const courses = getData().courses;
  if (!specialty) return courses;
  return courses.filter(c => c.specialty === specialty);
}

// Получить курс по ID
function getCourse(id) {
  return getData().courses.find(c => c.id === id);
}

// Получить предмет по ID
function getSubject(id) {
  return getData().subjects.find(s => s.id === id);
}

// Получить предметы курса
function getSubjectsByCourse(courseId) {
  return getData().subjects.filter(s => s.courseId === courseId);
}

// Получить работу по ID
function getWork(id) {
  return getData().works.find(w => w.id === id);
}

// Получить работы предмета
function getWorksBySubject(subjectId) {
  return getData().works.filter(w => w.subjectId === subjectId);
}

module.exports = {
  // Совместимость со старым кодом (геттеры для всех данных)
  get courses() { return getData().courses; },
  get subjects() { return getData().subjects; },
  get works() { return getData().works; },
  
  // Методы для получения данных
  getCourses,
  getCourse,
  getSubject,
  getSubjectsByCourse,
  getWork,
  getWorksBySubject,
  
  // Сохранение/чтение
  saveData,
  getData,
  migrateData
};