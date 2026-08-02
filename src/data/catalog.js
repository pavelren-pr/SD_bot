module.exports = {
  courses: [
    { id: 'math', name: '📐 Математика' },
    { id: 'physics', name: '⚛️ Физика' },
    { id: 'programming', name: '💻 Программирование' }
  ],

  subjects: [
    { id: 'algebra', courseId: 'math', name: 'Алгебра' },
    { id: 'geometry', courseId: 'math', name: 'Геометрия' },
    { id: 'mechanics', courseId: 'physics', name: 'Механика' }
  ],

  works: [
    {
      id: 'math_alg_eq',
      subjectId: 'algebra',
      title: 'Решение линейных уравнений',
      description: 'Подробное решение с пошаговыми пояснениями и проверкой.',
      price: 520,
      askForFile: true, // Просить ли фото/файл задания
    },
    {
      id: 'math_geom_tasks',
      subjectId: 'geometry',
      title: 'Решение задач по планиметрии',
      description: 'Решение 5 задач с чертежами и объяснениями.',
      price: 800,
      askForFile: true,
    },
    {
      id: 'prog_js_basics',
      subjectId: 'programming', // Предположим, что такой subject есть
      title: 'Консультация по JavaScript',
      description: 'Часовая консультация по основам JS.',
      price: 1500,
      askForFile: false, // Тут файл не нужен, только текст
    }
  ],

  // Вспомогательные функции для поиска данных
  getCourse(id) { return this.courses.find(c => c.id === id); },
  getSubjectsByCourse(courseId) { return this.subjects.filter(s => s.courseId === courseId); },
  getWork(id) { return this.works.find(w => w.id === id); },
  getWorksBySubject(subjectId) { return this.works.filter(w => w.subjectId === subjectId); }
};