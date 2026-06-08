// db.js — KNU Exchange | Telegram as Database
// ═══════════════════════════════════════════════════════
// НАСТРОЙКА: замените значения ниже
// ═══════════════════════════════════════════════════════

const TG_TOKEN   = '8691106054:AAG0ztIcjR_Z6ZdwJL5vYx4IuWcJ6kSQRnE';        // ← от @BotFather
const TG_CHAT_ID = '-5289652430';          // ← ID канала, напр. -1001234567890
const TG_API     = `https://api.telegram.org/bot${TG_TOKEN}`;
const PINNED_KEY = 'knu_pinned_msg_id';    // ключ в localStorage

// ═══════════════════════════════════════════════════════
// Структура БД (хранится в закреплённом сообщении)
// ═══════════════════════════════════════════════════════
// {
//   "u": [ {id,n,e,s,f,c,r,t} ],      // users
//   "a": [ {id,ui,p,st,t} ],           // applications
//   "tr": [ {id,ui,l,sc,t} ]           // testResults
// }
// Поля сокращены максимально для экономии символов (лимит 4096)

// ═══════════════════════════════════════════════════════
// Telegram API helpers
// ═══════════════════════════════════════════════════════

async function tgRequest(method, body) {
  try {
    const r = await fetch(`${TG_API}/${method}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    return await r.json();
  } catch { return { ok: false }; }
}

// Читаем закреплённое сообщение → парсим JSON из скрытого блока
async function tgReadDB() {
  const msgId = localStorage.getItem(PINNED_KEY);
  if (!msgId) return emptyDB();

  const r = await tgRequest('getMessages', {
    chat_id:     TG_CHAT_ID,
    message_ids: [Number(msgId)]
  });

  // getMessages не работает без MTProto — используем getChatHistory trick:
  // Сохраняем данные через editMessage и читаем через forwarded pin
  // Альтернатива: храним данные в localStorage + дублируем в TG для отображения
  return readLocalDB();
}

// Записываем БД → обновляем закреплённое сообщение
async function tgWriteDB(db) {
  saveLocalDB(db);   // локально — мгновенно
  await syncPinnedMessage(db); // в TG — для отображения
}

// ═══════════════════════════════════════════════════════
// Локальное хранилище (основная БД для чтения)
// ═══════════════════════════════════════════════════════

function emptyDB() {
  return { u: [], a: [], tr: [] };
}

function readLocalDB() {
  try {
    const raw = localStorage.getItem('knu_db');
    return raw ? JSON.parse(raw) : emptyDB();
  } catch { return emptyDB(); }
}

function saveLocalDB(db) {
  localStorage.setItem('knu_db', JSON.stringify(db));
}

// ═══════════════════════════════════════════════════════
// Синхронизация с Telegram (закреплённое сообщение)
// ═══════════════════════════════════════════════════════

async function syncPinnedMessage(db) {
  const text = buildPinnedText(db);
  const msgId = localStorage.getItem(PINNED_KEY);

  if (msgId) {
    // Редактируем существующее
    const r = await tgRequest('editMessageText', {
      chat_id:    TG_CHAT_ID,
      message_id: Number(msgId),
      text,
      parse_mode: 'HTML'
    });
    // Если сообщение удалено — создаём новое
    if (!r.ok) await createPinnedMessage(text);
  } else {
    await createPinnedMessage(text);
  }
}

async function createPinnedMessage(text) {
  const r = await tgRequest('sendMessage', {
    chat_id:    TG_CHAT_ID,
    text,
    parse_mode: 'HTML'
  });
  if (r.ok) {
    const msgId = r.result.message_id;
    localStorage.setItem(PINNED_KEY, msgId);
    await tgRequest('pinChatMessage', {
      chat_id:              TG_CHAT_ID,
      message_id:           msgId,
      disable_notification: true
    });
  }
}

function buildPinnedText(db) {
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' });

  // Статистика
  const total    = db.u.length;
  const pending  = db.a.filter(a => a.st === 0).length;
  const approved = db.a.filter(a => a.st === 1).length;
  const rejected = db.a.filter(a => a.st === 2).length;

  // Последние 5 студентов (сжато)
  const lastUsers = db.u.slice(-5).reverse()
    .map(u => `• ${u.n} | ${u.s} | ${u.f} | курс ${u.c}`)
    .join('\n') || '—';

  // Последние 5 тестов
  const lastTests = db.tr.slice(-5).reverse()
    .map(t => `• ${t.un} → ${t.l} (${t.sc}%)`)
    .join('\n') || '—';

  // Последние 5 заявок
  const stMap = { 0:'⏳', 1:'✅', 2:'❌' };
  const lastApps = db.a.slice(-5).reverse()
    .map(a => `• ${a.un} → ${a.p} ${stMap[a.st]}`)
    .join('\n') || '—';

  return `<b>🎓 KNU Exchange — База данных</b>
━━━━━━━━━━━━━━━━━━━━
📊 <b>Статистика</b>
👥 Студентов: <b>${total}</b>
📋 Заявок: <b>${db.a.length}</b>  ⏳${pending} ✅${approved} ❌${rejected}
📝 Тестов: <b>${db.tr.length}</b>

👤 <b>Последние студенты</b>
${lastUsers}

📝 <b>Последние тесты</b>
${lastTests}

📋 <b>Последние заявки</b>
${lastApps}
━━━━━━━━━━━━━━━━━━━━
🕐 <i>Обновлено: ${now}</i>`;
}

// Уведомление о событии (отдельным сообщением)
async function tgNotify(type, data) {
  let text = '';

  if (type === 'reg') {
    text = `🎓 <b>Новый студент</b>\n👤 ${data.n}\n🆔 ${data.s}\n📧 ${data.e}\n🏛 ${data.f} | ${data.c} курс`;
  } else if (type === 'test') {
    text = `📝 <b>Результат теста</b>\n👤 ${data.un}\n🏆 Уровень: <b>${data.l}</b>\n✅ Результат: ${data.sc}%`;
  } else if (type === 'app') {
    const st = { 0:'⏳ Подана', 1:'✅ Одобрена', 2:'❌ Отклонена' };
    text = `📋 <b>Заявка</b> ${st[data.st]}\n👤 ${data.un}\n🌍 ${data.p}`;
  }

  if (text) await tgRequest('sendMessage', { chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' });
}

// ═══════════════════════════════════════════════════════
// Утилиты
// ═══════════════════════════════════════════════════════

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

async function hashPassword(password) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ═══════════════════════════════════════════════════════
// Пользователи
// ═══════════════════════════════════════════════════════

async function registerUser(userData) {
  const db = readLocalDB();

  if (db.u.find(u => u.e === userData.email))
    throw new Error('Пользователь с таким email уже существует');
  if (db.u.find(u => u.s === userData.studentId))
    throw new Error('Студент с таким ID уже зарегистрирован');

  const hashed = await hashPassword(userData.password);
  const id     = genId();

  const user = {
    id,
    n:  userData.fullName,
    e:  userData.email,
    s:  userData.studentId,
    f:  userData.faculty,
    c:  userData.course,
    r:  'student',
    t:  new Date().toISOString()
  };

  db.u.push(user);
  await tgWriteDB(db);
  await tgNotify('reg', user);

  // Сохраняем пароль отдельно (не в TG)
  const passwords = JSON.parse(localStorage.getItem('knu_pw') || '{}');
  passwords[id] = hashed;
  localStorage.setItem('knu_pw', JSON.stringify(passwords));

  return id;
}

async function loginUser(email, password) {
  const db   = readLocalDB();
  const user = db.u.find(u => u.e === email);
  if (!user) throw new Error('Пользователь не найден');

  const passwords = JSON.parse(localStorage.getItem('knu_pw') || '{}');
  const hashed    = await hashPassword(password);
  if (passwords[user.id] !== hashed) throw new Error('Неверный пароль');

  const session = {
    id:        user.id,
    fullName:  user.n,
    email:     user.e,
    studentId: user.s,
    faculty:   user.f,
    course:    user.c,
    role:      user.r
  };
  sessionStorage.setItem('currentUser', JSON.stringify(session));
  return session;
}

function getCurrentUser() {
  const s = sessionStorage.getItem('currentUser');
  return s ? JSON.parse(s) : null;
}

function logoutUser() {
  sessionStorage.removeItem('currentUser');
  window.location.href = 'index.html';
}

// ═══════════════════════════════════════════════════════
// Заявки
// ═══════════════════════════════════════════════════════

async function saveApplication(applicationData) {
    const user = getCurrentUser();
    if (!user) throw new Error('Пользователь не авторизован');
    const db = readLocalDB();
    const id = genId();
    const app = {
        id,
        ui: user.id,
        un: user.fullName,
        ue: user.email,
        p: applicationData.program,
        gpa: applicationData.gpa || 0,
        lang: applicationData.languageLevel || '',
        motivation: applicationData.motivationText || '',
        docs: applicationData.documents || {},
        st: 0,
        t: new Date().toISOString()
    };
    db.a.push(app);
    await tgWriteDB(db);
    await tgNotify('app', app);
    await addNotification(user.id, '📋 Заявка отправлена', `Заявка на программу "${applicationData.program}" успешно отправлена. Документы приложены.`);
    return id;
}

async function getUserApplications() {
  const user = getCurrentUser();
  if (!user) return [];
  const db = readLocalDB();
  return db.a
    .filter(a => a.ui === user.id)
    .sort((a, b) => new Date(b.t) - new Date(a.t))
    .map(a => ({
      id:        a.id,
      program:   a.p,
      status:    ['pending','approved','rejected'][a.st],
      createdAt: a.t,
      userEmail: a.ue,
      userName:  a.un
    }));
}

async function updateApplicationStatus(applicationId, status, comment = '') {
  const user = getCurrentUser();
  if (!user || user.role !== 'admin') throw new Error('Недостаточно прав');

  const db  = readLocalDB();
  const app = db.a.find(a => a.id === applicationId);
  if (!app) throw new Error('Заявка не найдена');

  const stNum = { pending: 0, approved: 1, rejected: 2 };
  app.st = stNum[status] ?? 0;
  if (comment) app.cm = comment;
  app.ut = new Date().toISOString();

  await tgWriteDB(db);
  await tgNotify('app', app);

  const labels = ['обновлена','одобрена 🎉','отклонена ❌'];
  await addNotification(app.ui, '📋 Статус заявки изменён',
    `Ваша заявка на "${app.p}" ${labels[app.st]}.` + (comment ? ' Причина: ' + comment : ''));
}

// ═══════════════════════════════════════════════════════
// Тесты
// ═══════════════════════════════════════════════════════

async function saveTestResult(testData) {
  const user = getCurrentUser();
  if (!user) return null;

  const db = readLocalDB();
  const id = genId();

  const result = {
    id,
    ui:  user.id,
    un:  user.fullName,
    l:   testData.level,
    sc:  testData.score ?? 0,
    lg:  testData.language,
    t:   new Date().toISOString()
  };

  db.tr.push(result);
  await tgWriteDB(db);
  await tgNotify('test', result);

  sessionStorage.setItem('languageLevel', testData.level);
  await addNotification(user.id, '📊 Результат теста', `Ваш уровень: ${testData.level}. Используйте при подаче заявки.`);
  return id;
}

async function getLatestTestResult() {
  const user = getCurrentUser();
  if (!user) return null;
  const db = readLocalDB();
  const results = db.tr.filter(t => t.ui === user.id)
    .sort((a, b) => new Date(b.t) - new Date(a.t));
  if (!results.length) return null;
  const r = results[0];
  return { id: r.id, level: r.l, score: r.sc, language: r.lg, createdAt: r.t };
}

// ═══════════════════════════════════════════════════════
// Уведомления (только локально)
// ═══════════════════════════════════════════════════════

async function addNotification(userId, title, message) {
  const key   = 'knu_notif';
  const notifs = JSON.parse(localStorage.getItem(key) || '[]');
  notifs.push({ id: genId(), userId, title, message, read: false, t: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(notifs));
}

async function getUserNotifications() {
  const user = getCurrentUser();
  if (!user) return [];
  const notifs = JSON.parse(localStorage.getItem('knu_notif') || '[]');
  return notifs
    .filter(n => n.userId === user.id)
    .sort((a, b) => new Date(b.t) - new Date(a.t))
    .map(n => ({ ...n, createdAt: n.t }));
}

async function markNotificationRead(notificationId) {
  const key    = 'knu_notif';
  const notifs = JSON.parse(localStorage.getItem(key) || '[]');
  const n      = notifs.find(n => n.id === notificationId);
  if (n) { n.read = true; localStorage.setItem(key, JSON.stringify(notifs)); }
}

// ═══════════════════════════════════════════════════════
// Программы (статические данные)
// ═══════════════════════════════════════════════════════

const PROGRAMS = [
  { id:1, name:'Erasmus+',           country:'Германия',    city:'Берлин/Гейдельберг', university:'Universität Heidelberg',       duration:'1 семестр', language:'Английский/Немецкий', requirement:'B2', gpa:'3.5', description:'Обменная программа Erasmus+ с ведущими университетами Германии', icon:'🇩🇪', image:'germany.jpeg' },
  { id:2, name:'Academic Mobility',  country:'Турция',      city:'Анкара',             university:'Middle East Technical University', duration:'1 семестр', language:'Английский',         requirement:'B1', gpa:'3.2', description:'Академическая мобильность в Турции',                           icon:'🇹🇷', image:'turkey.jpeg'  },
  { id:3, name:'Летняя стажировка',  country:'Южная Корея', city:'Сеул',               university:'Seoul National University',      duration:'2 месяца',  language:'Английский',         requirement:'B1', gpa:'3.0', description:'Летняя стажировка в топовом университете Кореи',              icon:'🇰🇷', image:'korea.jpeg'   },
  { id:4, name:'Study in Japan',     country:'Япония',      city:'Токио',              university:'University of Tokyo',            duration:'1 семестр', language:'Английский/Японский', requirement:'B2', gpa:'3.5', description:'Обучение в Японии по обмену',                                 icon:'🇯🇵', image:'japan.jpeg'   }
];

function getAllPrograms()    { return PROGRAMS; }
function getProgramById(id) { return PROGRAMS.find(p => p.id === Number(id)); }

// ═══════════════════════════════════════════════════════
// Инициализация — создаём тестового пользователя если БД пуста
// ═══════════════════════════════════════════════════════

async function initDB() {
  const db = readLocalDB();
  if (db.u.length === 0) {
    const hashed = await hashPassword('123456');
    const id     = 'admin0';
    db.u.push({ id, n:'Айназик Тестова', e:'test@knu.kg', s:'KNU2024001', f:'Факультет информационных технологий', c:3, r:'student', t: new Date().toISOString() });
    saveLocalDB(db);
    const pw = JSON.parse(localStorage.getItem('knu_pw') || '{}');
    pw[id] = hashed;
    localStorage.setItem('knu_pw', JSON.stringify(pw));
  }
  // Синхронизируем начальное состояние с Telegram
  await syncPinnedMessage(db);
}

// ═══════════════════════════════════════════════════════
// Экспорт
// ═══════════════════════════════════════════════════════

window.db = {
  initDB,
  registerUser,
  loginUser,
  getCurrentUser,
  logoutUser,
  saveApplication,
  getUserApplications,
  updateApplicationStatus,
  saveTestResult,
  getLatestTestResult,
  getUserNotifications,
  markNotificationRead,
  addNotification,
  getAllPrograms,
  getProgramById
};

// Инициализируем при загрузке
initDB().catch(console.warn);

console.log('✅ KNU Exchange DB готова к работе');
