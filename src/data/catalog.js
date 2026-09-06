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
    return { specialties: [], courses: [], subjects: [], works: [] };
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

// Миграция: добавляем специальности и поле specialty всем элементам
function migrateData() {
  const data = getData();
  let changed = false;

  // 1. Создаём массив специальностей, если его нет
  if (!Array.isArray(data.specialties)) {
    data.specialties = DEFAULT_SPECIALTIES;
    changed = true;
    console.log('✅ Миграция: добавлены специальности в catalog.json');
  }

  // 2. Добавляем поле specialty курсам, предметам и работам
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
    console.log('✅ Миграция catalog.json завершена');
  }
}

// Запускаем миграцию при загрузке модуля
migrateData();

// ==========================================
// СПЕЦИАЛЬНОСТИ
// ==========================================
function getSpecialties() {
  return getData().specialties || [];
}

function getSpecialtyById(specialtyId) {
  return (getData().specialties || []).find(s => s.id === specialtyId) || null;
}

function addSpecialty(name, emoji) {
  const data = getData();
  if (!Array.isArray(data.specialties)) data.specialties = [];
  const newSpecialty = {
    id: `specialty_${Date.now()}`,
    name: name,
    emoji: emoji || '📚'
  };
  data.specialties.push(newSpecialty);
  saveData(data);
  return newSpecialty;
}

function updateSpecialty(specialtyId, updates) {
  const data = getData();
  const index = (data.specialties || []).findIndex(s => s.id === specialtyId);
  if (index === -1) return null;
  data.specialties[index] = { ...data.specialties[index], ...updates };
  saveData(data);
  return data.specialties[index];
}

function deleteSpecialty(specialtyId) {
  const data = getData();
  // Проверка: нельзя удалить специальность, если к ней привязаны курсы
  const linkedCourses = (data.courses || []).filter(c => c.specialty === specialtyId);
  if (linkedCourses.length > 0) {
    return { success: false, reason: `К специальности привязано курсов: ${linkedCourses.length}` };
  }
  const filtered = (data.specialties || []).filter(s => s.id !== specialtyId);
  if (filtered.length === (data.specialties || []).length) return { success: false, reason: 'Специальность не найдена' };
  data.specialties = filtered;
  saveData(data);
  return { success: true };
}

// ==========================================
// КУРСЫ / ПРЕДМЕТЫ / РАБОТЫ
// ==========================================
function getCourses(specialty = null) {
  const courses = getData().courses;
  if (!specialty) return courses;
  return courses.filter(c => c.specialty === specialty);
}

function getCourse(id) {
  return getData().courses.find(c => c.id === id);
}

function getSubject(id) {
  return getData().subjects.find(s => s.id === id);
}

function getSubjectsByCourse(courseId) {
  return getData().subjects.filter(s => s.courseId === courseId);
}

function getWork(id) {
  return getData().works.find(w => w.id === id);
}

function getWorksBySubject(subjectId) {
  return getData().works.filter(w => w.subjectId === subjectId);
}

// ==========================================
// СПЕЦИАЛЬНОСТИ
// ==========================================

// Дефолтные специальности (для миграции)
const DEFAULT_SPECIALTIES = [
  { id: 'navigation', name: '⚓ Судоводитель', emoji: '⚓' },
  { id: 'electromechanic', name: '⚡ Электромеханик', emoji: '⚡' },
  { id: 'other', name: '📚 Другое', emoji: '📚' }
];

function getSpecialties() {
  const data = getData();
  return data.specialties || [];
}

function getSpecialtyById(specialtyId) {
  return (getData().specialties || []).find(s => s.id === specialtyId) || null;
}

function addSpecialty(name, emoji) {
  const data = getData();
  if (!Array.isArray(data.specialties)) data.specialties = [];
  const newSpecialty = {
    id: `specialty_${Date.now()}`,
    name: name,
    emoji: emoji || '📚'
  };
  data.specialties.push(newSpecialty);
  saveData(data);
  return newSpecialty;
}

function updateSpecialty(specialtyId, updates) {
  const data = getData();
  const index = (data.specialties || []).findIndex(s => s.id === specialtyId);
  if (index === -1) return null;
  data.specialties[index] = { ...data.specialties[index], ...updates };
  saveData(data);
  return data.specialties[index];
}

function deleteSpecialty(specialtyId) {
  const data = getData();
  const linkedCourses = (data.courses || []).filter(c => c.specialty === specialtyId);
  if (linkedCourses.length > 0) {
    return { success: false, reason: `К специальности привязано курсов: ${linkedCourses.length}` };
  }
  const filtered = (data.specialties || []).filter(s => s.id !== specialtyId);
  if (filtered.length === (data.specialties || []).length) {
    return { success: false, reason: 'Специальность не найдена' };
  }
  data.specialties = filtered;
  saveData(data);
  return { success: true };
}

module.exports = {
  get courses() { return getData().courses; },
  get subjects() { return getData().subjects; },
  get works() { return getData().works; },
  getCourses,
  getCourse,
  getSubject,
  getSubjectsByCourse,
  getWork,
  getWorksBySubject,
  saveData,
  getData,
  migrateData,
  // Специальности
  getSpecialties,
  getSpecialtyById,
  addSpecialty,
  updateSpecialty,
  deleteSpecialty,
  DEFAULT_SPECIALTIES
};