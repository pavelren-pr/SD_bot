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

module.exports = {
  get courses() { return getData().courses; },
  get subjects() { return getData().subjects; },
  get works() { return getData().works; },
  
  getCourse(id) { return getData().courses.find(c => c.id === id); },
  getSubject(id) { return getData().subjects.find(s => s.id === id); },
  getSubjectsByCourse(courseId) { return getData().subjects.filter(s => s.courseId === courseId); },
  getWork(id) { return getData().works.find(w => w.id === id); },
  getWorksBySubject(subjectId) { return getData().works.filter(w => w.subjectId === subjectId); },
  
  saveData,
  getData
};