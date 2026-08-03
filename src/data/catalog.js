module.exports = {
  // ==========================================
  // 1. КУРСЫ
  // ==========================================
  courses: [
    { id: 'course1', name: '1 курс ⭐' },
    { id: 'course2', name: '2 курс ⭐⭐' },
    { id: 'course3', name: '3 курс ⭐⭐⭐' },
    { id: 'course4', name: '4 курс ⭐⭐⭐⭐' }
  ],

  // ==========================================
  // 2. ПРЕДМЕТЫ (привязаны к курсам через courseId)
  // ==========================================
  subjects: [
    // 1 курс
    { id: 'math1', courseId: 'course1', name: 'Вышмат 📐' },
    
    // 2 курс
    { id: 'nachert', courseId: 'course2', name: 'Начерталка 📒' },
    { id: 'injgraf', courseId: 'course2', name: 'Инженерная графика 🗜️' },
    { id: 'mech', courseId: 'course2', name: 'Механика ⚙' },
    { id: 'math2', courseId: 'course2', name: 'Вышмат 📐' },

    // 3 курс
    { id: 'mss', courseId: 'course3', name: 'МСС 📏' },
    { id: 'tus', courseId: 'course3', name: 'ТУС 🚢' },
    { id: 'mos', courseId: 'course3', name: 'МОС 🧮' },
    { id: 'bs_vvp', courseId: 'course3', name: 'Безопасность судоходства на ВВП 🛟' },
    { id: 'ol_vvp', courseId: 'course3', name: 'Общая лоция ВВП 🌉' },
    { id: 'gmos', courseId: 'course3', name: 'ГМОС 🌦️' },
    { id: 'astro3', courseId: 'course3', name: 'Астрономия 🌌' },
    { id: 'nil3', courseId: 'course3', name: 'НиЛ 🧭' },
    { id: 'tss3', courseId: 'course3', name: 'ТСС 📺' },

    // 4 курс
    { id: 'nil4', courseId: 'course4', name: 'НиЛ 🧭' },
    { id: 'mius', courseId: 'course4', name: 'МиУС 🚢' },
    { id: 'tss4', courseId: 'course4', name: 'ТСС 📺' },
    { id: 'astro4', courseId: 'course4', name: 'Астрономия 🌌' },
    { id: 'pss', courseId: 'course4', name: 'ПСС 🛟' },
    { id: 'radio_vvp', courseId: 'course4', name: 'Радиосвязь на ВВП 📻' },
    { id: 'tiompg', courseId: 'course4', name: 'ТиОМПГ 🏗' }
  ],

  // ==========================================
  // 3. РАБОТЫ (Единая база данных)
  // ==========================================
  works: [
    // --- 2 КУРС ---
    {
      id: 'nach1_9', courseId: 'course2', subjectId: 'nachert',
      title: 'Начертательная геометрия 📒\n1–9 задачи (каждая отдельно) 📎',
      price: 520, commission: 20,
      chatEnv: 'CHERCHENIE_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографию(и) вашего задания (1–9) 📸'
    },
    {
      id: 'nach10_12', courseId: 'course2', subjectId: 'nachert',
      title: 'Начертательная геометрия 📒\n10–12 задачи (каждая отдельно) 🖼️',
      price: 590, commission: 20,
      chatEnv: 'CHERCHENIE_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографию вашего задания (10–12) 📸'
    },
    {
      id: 'nachall1_9', courseId: 'course2', subjectId: 'nachert',
      title: 'Начертательная геометрия 📒\n1–9 задачи вместе 🪢',
      price: 3890, commission: 20,
      chatEnv: 'CHERCHENIE_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографии всех заданий 1–9 📸'
    },
    {
      id: 'nachall10_12', courseId: 'course2', subjectId: 'nachert',
      title: 'Начертательная геометрия 📒\n10–12 задачи вместе 🧺',
      price: 1680, commission: 20,
      chatEnv: 'CHERCHENIE_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографии всех заданий 10–12 📸'
    },
    {
      id: 'inj146', courseId: 'course2', subjectId: 'injgraf',
      title: 'Инженерная графика 🗜️\n1–4 и 6 работа (каждая отдельно) 🕋',
      price: 1190, commission: 20,
      chatEnv: 'CHERCHENIE_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографию(и) задания (1–4 и 6) 📸\n(если каких-то заданий у Вас ещё нет, Вы можете отправить их позже менеджеру) 🤝'
    },
    {
      id: 'inj5', courseId: 'course2', subjectId: 'injgraf',
      title: 'Инженерная графика 🗜️\n5 работа (эскизирование) 🖼️',
      price: 890, commission: 20,
      chatEnv: 'CHERCHENIE_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографию(и) задания (Эскизирование) 📸'
    },
    {
      id: 'injALL', courseId: 'course2', subjectId: 'injgraf',
      title: 'Инженерная графика 🗜️\n🦁 Весь комплект 🦁',
      price: 6690, commission: 20,
      chatEnv: 'CHERCHENIE_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографии всех заданий по Инженерной графике 📸\n(если каких-то заданий у Вас ещё нет, Вы можете отправить их позже менеджеру)'
    },
    {
      id: 'nachANDinjgraf', courseId: 'course2', subjectId: 'injgraf', // Относим к инжграфу для простоты меню
      title: 'Начертательная геометрия 📒 + Инженерная графика 🗜️\n👑 Царский набор 👑',
      price: 10190, commission: 20,
      chatEnv: 'CHERCHENIE_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографии всех заданий по Начерту и Инжграфу 📸\n(если каких-то заданий у Вас ещё нет, Вы можете отправить их позже менеджеру)'
    },
    {
      id: 'mech_beam', courseId: 'course2', subjectId: 'mech',
      title: 'Механика ⚙\nРасчёт Балки 🧮',
      price: 1290, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер по журналу группы\n2. Номер группы\n3. Вашу фамилию и инициалы'
    },
    {
      id: 'mech_val', courseId: 'course2', subjectId: 'mech',
      title: 'Механика ⚙\nРасчёт Вала 📏',
      price: 1290, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер по журналу группы\n2. Номер группы\n3. Вашу фамилию и инициалы'
    },
    {
      id: 'mech_val_beam', courseId: 'course2', subjectId: 'mech',
      title: 'Механика ⚙\nРасчёт Вала и Балки (вместе) 👑',
      price: 1990, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер по журналу группы\n2. Номер группы\n3. Вашу фамилию и инициалы'
    },

    // --- 3 КУРС ---
    {
      id: 'mss_pz1', courseId: 'course3', subjectId: 'mss',
      title: 'МСС 📏 — ПЗ №1 🗒️',
      price: 490, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте последнюю цифру Вашего номера по журналу группы'
    },
    {
      id: 'mss_pz2', courseId: 'course3', subjectId: 'mss',
      title: 'МСС 📏 — ПЗ №2 📓',
      price: 990, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографию Ваших измерений 📸'
    },
    {
      id: 'mss_pz3', courseId: 'course3', subjectId: 'mss',
      title: 'МСС 📏 — ПЗ №3 📒',
      price: 490, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте последнюю цифру Вашего номера по журналу группы'
    },
    {
      id: 'mss_pz4', courseId: 'course3', subjectId: 'mss',
      title: 'МСС 📏 — ПЗ №4 📔',
      price: 1190, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте Ваш номер по журналу группы'
    },
    {
      id: 'GMOS_PZ1', courseId: 'course3', subjectId: 'gmos',
      title: 'ГМОС 🌦️ — Практическая работа №1 🌡️',
      price: 490, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте Ваш вариант (Если Ваш номер по списку ≤ 25, то вариант = номеру по списку, иначе вариант = (номер по списку - 25) :-)'
    },
    {
      id: 'GMOS_PZ2', courseId: 'course3', subjectId: 'gmos',
      title: 'ГМОС 🌦️ — Практическая работа №2 🪁',
      price: 590, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте Ваш вариант (Если Ваш номер по списку ≤ 12, то вариант = номеру по списку, иначе вариант = (номер по списку - (12 или 24)) :-)'
    },
    {
      id: 'GMOS_PZ3', courseId: 'course3', subjectId: 'gmos',
      title: 'ГМОС 🌦️ — Практическая работа №3 💦',
      price: 490, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте Ваш вариант (Если Ваш номер по списку ≤ 20, то вариант = номеру по списку, иначе вариант = (номер по списку - 20) :-)'
    },
    {
      id: 'GMOS_PZ4', courseId: 'course3', subjectId: 'gmos',
      title: 'ГМОС 🌦️ — Практическая работа №4 ⛈️',
      price: 790, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте Ваш вариант (Если Ваш номер по списку ≤ 16, то вариант = номеру по списку, иначе вариант = (номер по списку - 16) :-)'
    },
    {
      id: 'GMOS_laba', courseId: 'course3', subjectId: 'gmos',
      title: 'ГМОС 🌦️ — БОЛЬШАЯ ЛАБА (Бояринов) 💎',
      price: 8990, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n(Если каких-то данных не хватает или Вы их не знаете - не пишите их, позже наш менеджер уточнит всё)\n1. Порт отхода\n2. Порт прихода\n3. Дату и время выхода\n4. Скорость хода на тихой воде\n5. Водоизмещение\n6. Период собственного колебания судна\n7. Осадку судна в порту выхода\n8. Фамилию и инициалы всех в команде'
    },
    {
      id: 'tus_kurs', courseId: 'course3', subjectId: 'tus',
      title: 'ТУС 🚢\nКурсовая работа 🎯',
      price: 2190, commission: 20,
      chatEnv: 'KURS_MOS_TUS_CHAT_ID', paymentEnv: 'VICTOR_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер по журналу группы\n2. Номер группы\n3. Вашу фамилию и инициалы'
    },
    {
      id: 'mos_kurs', courseId: 'course3', subjectId: 'mos',
      title: 'МОС 🧮\nКурсовая работа 🚢',
      price: 1790, commission: 20,
      chatEnv: 'KURS_MOS_TUS_CHAT_ID', paymentEnv: 'VICTOR_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер варианта\n2. Номер группы\n3. Вашу фамилию и инициалы'
    },
    {
      id: 'mos_river_pz2', courseId: 'course3', subjectId: 'mos',
      title: 'МОС 🧮\nПоток: Река-море 🌉🌊\nПЗ №2. Сферические треугольники',
      price: 690, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте номер своего варианта'
    },
    {
      id: 'mos_river_pz4', courseId: 'course3', subjectId: 'mos',
      title: 'МОС 🧮\nПоток: Река-море 🌉🌊\nПЗ №4. ОМС по 2 линиям положения',
      price: 690, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте номер своего варианта'
    },
    {
      id: 'bs_high', courseId: 'course3', subjectId: 'bs_vvp',
      title: 'Безопасность судоходства на ВВП 🛟\nОпределение высоты подмостового габарита',
      price: 890, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер по журналу группы\n2. Номер группы\n3. Вашу фамилию и инициалы\n4. День и месяц рождения'
    },
    {
      id: 'VVP_Tug', courseId: 'course3', subjectId: 'bs_vvp',
      title: 'Безопасность судоходства на ВВП 🛟\nРГР План безопасной буксировки ⛴️',
      price: 4190, commission: 20,
      chatEnv: 'OTHER_ORDERS_CHAT_ID', paymentEnv: 'IVAN_CARD_NUMBER',
      needs: ['photo'],
      prompt: '📸 Прикрепите фотографию задания 📸'
    },
    {
      id: 'olvvp_stvor', courseId: 'course3', subjectId: 'ol_vvp',
      title: 'Общая лоция ВВП 🌉\nПЗ «Расчёт линейного навигационного створа»',
      price: 790, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте номер варианта (две последние цифры номера зачётки)'
    },
    {
      id: 'NIL_VertAngl_RGR', courseId: 'course3', subjectId: 'nil3',
      title: 'НиЛ 🧭\nРГР «вертикальный угол» (4 задачи) 📐',
      price: 1290, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер варианта\n2. Номер группы\n3. Вашу фамилию и инициалы'
    },
    {
      id: 'nil_river_rgr9', courseId: 'course3', subjectId: 'nil3',
      title: 'НиЛ 🧭\nРГР «9 задач по 6 сборникам» 📚',
      price: 2790, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте номер своего варианта'
    },
    {
      id: 'nil_Chart_RGR', courseId: 'course3', subjectId: 'nil3',
      title: 'НиЛ 🧭\nРасчёт Сетки и рамки карты 🗺️',
      price: 990, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['variant'],
      prompt: 'Отправьте номер своего варианта'
    },
    {
      id: 'tss_test', courseId: 'course3', subjectId: 'tss3',
      title: 'ТСС 📺\n10 тестов (РЛС, РНС, АИС и др.) 🖥️',
      price: 3990, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'IVAN_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением логин и пароль от фарватера.'
    },
    {
      id: 'tss_test_pract', courseId: 'course3', subjectId: 'tss3',
      title: 'ТСС 📺\n5 тестов на фарватере (практика) 🖥️',
      price: 2990, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'IVAN_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением логин и пароль от фарватера.'
    },
    {
      id: 'Astro_kr1', courseId: 'course3', subjectId: 'astro3',
      title: 'Астрономия 🌌\nПомощь на контрольной по ТВА (Килнас) 🔭',
      price: 1390, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением дату проведения контрольной работы.'
    },

    // --- 4 КУРС ---
    {
      id: 'nil_1tide', courseId: 'course4', subjectId: 'nil4',
      title: 'НиЛ 🧭\nПриливы 1 задача 🏄',
      price: 1490, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте номер своего варианта (101 - 170)'
    },
    {
      id: 'nil_2tide', courseId: 'course4', subjectId: 'nil4',
      title: 'НиЛ 🧭\nПриливы 2 задача 🦞',
      price: 390, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте номер своего варианта (201 - 270)'
    },
    {
      id: 'nil_3tide', courseId: 'course4', subjectId: 'nil4',
      title: 'НиЛ 🧭\nПриливы 3 задача 🚤',
      price: 390, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте номер своего варианта (301 - 370)'
    },
    {
      id: 'nil_4tide', courseId: 'course4', subjectId: 'nil4',
      title: 'НиЛ 🧭\nПриливы 4 задача 🚣',
      price: 450, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте номер своего варианта (401 - 470)'
    },
    {
      id: 'nil_5tide', courseId: 'course4', subjectId: 'nil4',
      title: 'НиЛ 🧭\nПриливы 5 задача 🪸',
      price: 450, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте номер своего варианта (501 - 570)'
    },
    {
      id: 'nil_ALLtide', courseId: 'course4', subjectId: 'nil4',
      title: 'НиЛ 🧭\n👑 Все задачи на приливы 👑',
      price: 2990, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте номер своего варианта (01 - 70)'
    },
    {
      id: 'MiUS_tasks', courseId: 'course4', subjectId: 'mius',
      title: 'МиУС 🚢\n7 задач по пособию 🚤',
      price: 2390, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер вашего варианта\n2. Номер группы\n3. Вашу фамилию и инициалы'
    },
    {
      id: 'MiUS_tasks_break', courseId: 'course4', subjectId: 'mius',
      title: 'МиУС 🚢\nЗадачи на торможение 🐌',
      price: 1590, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер вашего варианта\n2. Номер группы\n3. Вашу фамилию и инициалы'
    },
    {
      id: 'MiUS_tasks_tasksbreak', courseId: 'course4', subjectId: 'mius',
      title: 'МиУС 🚤\nВсе задачи по пособию и торможению 👑',
      price: 3383, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер вашего варианта\n2. Номер группы\n3. Вашу фамилию и инициалы'
    },
    {
      id: 'tss_test2', courseId: 'course4', subjectId: 'tss4',
      title: 'ТСС 📺\n10 тестов (РЛС, РНС, АИС и др.) 🖥️',
      price: 3990, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением логин и пароль от фарватера.'
    },
    {
      id: 'tss_test_pract2', courseId: 'course4', subjectId: 'tss4',
      title: 'ТСС 📺\n5 тестов на фарватере (практика) 🖥️',
      price: 2990, commission: 20,
      chatEnv: 'OTHER_ORDERS_CHAT_ID', paymentEnv: 'IVAN_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением логин и пароль от фарватера.'
    },
    {
      id: 'Astro_kr2', courseId: 'course4', subjectId: 'astro4',
      title: 'Астрономия 🌌\nПомощь на контрольной по МАЕ (Килнас) 🔭',
      price: 1690, commission: 20,
      chatEnv: 'OTHER_ORDERS_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением дату проведения контрольной работы.'
    },
    {
      id: 'VVPRadio_kurs', courseId: 'course4', subjectId: 'radio_vvp',
      title: 'Радиосвязь на ВВП 📻\nКурсовая работа 🎛️',
      price: 3470, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте свой номер по журналу группы.'
    },
    {
      id: 'PSS_test', courseId: 'course4', subjectId: 'pss',
      title: 'ПСС 🛟\nВесь фарватер 🖥️',
      price: 8490, commission: 20,
      chatEnv: 'OTHER_ORDERS_CHAT_ID', paymentEnv: 'IVAN_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением логин и пароль от фарватера.'
    },
    {
      id: 'PSS_Test_Preamble', courseId: 'course4', subjectId: 'pss',
      title: 'ПСС 🛟\nФарватер. Вводная часть 💡',
      price: 569, commission: 20,
      chatEnv: 'OTHER_ORDERS_CHAT_ID', paymentEnv: 'IVAN_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением логин и пароль от фарватера.'
    },
    {
      id: 'PSS_Test_P1', courseId: 'course4', subjectId: 'pss',
      title: 'ПСС 🛟\nФарватер. 1 Раздел 🥇',
      price: 3250, commission: 20,
      chatEnv: 'OTHER_ORDERS_CHAT_ID', paymentEnv: 'IVAN_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением логин и пароль от фарватера.'
    },
    {
      id: 'PSS_Test_P2', courseId: 'course4', subjectId: 'pss',
      title: 'ПСС 🛟\nФарватер. 2 Раздел 🥈',
      price: 2650, commission: 20,
      chatEnv: 'OTHER_ORDERS_CHAT_ID', paymentEnv: 'IVAN_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением логин и пароль от фарватера.'
    },
    {
      id: 'PSS_Test_P3', courseId: 'course4', subjectId: 'pss',
      title: 'ПСС 🛟\nФарватер. 3 Раздел 🥉',
      price: 2865, commission: 20,
      chatEnv: 'OTHER_ORDERS_CHAT_ID', paymentEnv: 'IVAN_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением логин и пароль от фарватера.'
    },
    {
      id: 'TiOMPG_kurs', courseId: 'course4', subjectId: 'tiompg',
      title: 'ТиОМПГ 🏗\nКурсовая работа 🧮',
      price: 2390, commission: 20,
      chatEnv: 'MY_CHAT_ID', paymentEnv: 'MY_CARD_NUMBER',
      needs: ['details'],
      prompt: 'Отправьте одним сообщением:\n1. Номер вашего варианта\n2. Номер группы\n3. Вашу фамилию и инициалы'
    }
  ],

  // ==========================================
  // 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОИСКА
  // ==========================================
  getCourse(id) { return this.courses.find(c => c.id === id); },
  getSubject(id) { return this.subjects.find(s => s.id === id); },
  getSubjectsByCourse(courseId) { return this.subjects.filter(s => s.courseId === courseId); },
  getWork(id) { return this.works.find(w => w.id === id); },
  getWorksBySubject(subjectId) { return this.works.filter(w => w.subjectId === subjectId); }
};