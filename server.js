import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_secret_change_me';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin12345';

// Optional translation service (LibreTranslate-compatible)
const TRANSLATE_ENDPOINT = process.env.TRANSLATE_ENDPOINT || '';
const TRANSLATE_API_KEY = process.env.TRANSLATE_API_KEY || '';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/i18n', express.static(path.join(__dirname, 'i18n'), { fallthrough: false }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const checkLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ message: 'rate_limited' })
});

const DATA_DIR = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'data.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  message_ru TEXT,
  message_en TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

function nowISO(){ return new Date().toISOString(); }

function formatDate(iso){
  try{
    const d = new Date(iso);
    const pad = (n)=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }catch{ return iso; }
}

function loadJSON(p){
  return JSON.parse(fs.readFileSync(path.join(__dirname, p), 'utf-8'));
}

const statusesMap = loadJSON('i18n/statuses.json');
const VALID_STATUSES = Object.keys(statusesMap);

function statusDisplay(status, lang){
  const obj = statusesMap[status];
  if(!obj) return status;
  return obj[lang] || status;
}

function getLang(req){
  const q = String(req.query.lang || '').toLowerCase();
  if(q === 'ru' || q === 'en') return q;
  const cookie = String(req.signedCookies.lang || '').toLowerCase();
  if(cookie === 'ru' || cookie === 'en') return cookie;
  return 'en';
}

function renderPublic(req, res, view, extra = {}){
  const lang = getLang(req);
  res.cookie('lang', lang, { signed: true, httpOnly: false, sameSite: 'lax' });
  const t = loadJSON(`i18n/${lang}.json`);
  res.render(view, { lang, t, ...extra });
}

function makeCode(){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = (len)=>Array.from({length:len}, ()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');
  return `${block(4)}-${block(4)}-${block(4)}`;
}

// Very small cookie-based session (signed)
function setSession(res, obj){
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  res.cookie('session', payload, { signed: true, httpOnly: true, sameSite: 'lax' });
}
function getSession(req){
  try{
    const raw = req.signedCookies.session;
    if(!raw) return null;
    const json = Buffer.from(raw, 'base64url').toString('utf-8');
    return JSON.parse(json);
  }catch{ return null; }
}
function clearSession(res){ res.clearCookie('session'); }

function requireAdmin(req, res, next){
  const s = getSession(req);
  if(s?.admin === true) return next();
  return res.redirect('/admin/login');
}

function ensureDefaultAdmin(){
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(ADMIN_USER);
  if(row) return;
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  db.prepare('INSERT INTO admins (username, pass_hash, created_at) VALUES (?,?,?)')
    .run(ADMIN_USER, hash, nowISO());
  console.log(`[init] admin created: ${ADMIN_USER}`);
}
ensureDefaultAdmin();

// Public
app.get('/', (req,res)=> renderPublic(req, res, 'index'));
app.get('/check', (req,res)=>{
  const prefill = String(req.query.prefill || '');
  renderPublic(req, res, 'check', { prefill });
});

app.post('/api/check', checkLimiter, (req,res)=>{
  const code = String(req.body.code || '').trim().toUpperCase();
  const lang = (String(req.body.lang || '').toLowerCase() === 'ru') ? 'ru' : 'en';

  if(!code) return res.status(400).json({ message: 'bad_request' });

  const row = db.prepare('SELECT * FROM applications WHERE code = ?').get(code);
  if(!row){
    const t = loadJSON(`i18n/${lang}.json`);
    return res.status(404).json({ message: t.not_found });
  }

  const status_display = statusDisplay(row.status, lang);
  const message_display = (lang === 'ru')
    ? (row.message_ru || row.message_en || '')
    : (row.message_en || row.message_ru || '');

  return res.json({
    code: row.code,
    status: row.status,
    status_display,
    message_display,
    updated_at: row.updated_at,
    updated_at_display: formatDate(row.updated_at)
  });
});

// Admin (RU UI)
app.get('/admin', requireAdmin, (req,res)=>{
  const edit = String(req.query.edit || '').trim().toUpperCase();
  const flash = String(req.query.flash || '');

  let form = { code:'', status: VALID_STATUSES[0], message_ru:'', message_en:'' };
  if(edit){
    const row = db.prepare('SELECT * FROM applications WHERE code = ?').get(edit);
    if(row){
      form = { code: row.code, status: row.status, message_ru: row.message_ru || '', message_en: row.message_en || '' };
    }else{
      // If code not found, prefill form with that code (useful after generate)
      form.code = edit;
    }
  }

  const rows = db.prepare('SELECT * FROM applications ORDER BY updated_at DESC LIMIT 200').all()
    .map(r => ({...r, updated_at_display: formatDate(r.updated_at)}));

  res.render('admin', { rows, statuses: VALID_STATUSES, form, flash });
});

app.get('/admin/login', (req,res)=> res.render('admin_login', { error: '' }));

app.post('/admin/login', (req,res)=>{
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');

  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if(!row) return res.status(401).render('admin_login', { error: 'Неверный логин или пароль.' });

  const ok = bcrypt.compareSync(password, row.pass_hash);
  if(!ok) return res.status(401).render('admin_login', { error: 'Неверный логин или пароль.' });

  setSession(res, { admin: true, u: username, iat: Date.now() });
  return res.redirect('/admin');
});

app.post('/admin/logout', (req,res)=>{ clearSession(res); res.redirect('/admin/login'); });

async function autoTranslateRUtoEN(text){
  if(!text) return '';
  if(!TRANSLATE_ENDPOINT) return '';
  try{
    const r = await fetch(TRANSLATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TRANSLATE_API_KEY ? {'Authorization': `Bearer ${TRANSLATE_API_KEY}`} : {})
      },
      body: JSON.stringify({
        q: text,
        source: 'ru',
        target: 'en',
        format: 'text',
        api_key: TRANSLATE_API_KEY || undefined
      })
    });
    const data = await r.json().catch(()=>null);
    const out = data?.translatedText || data?.translation || '';
    return String(out || '').trim();
  }catch{ return ''; }
}

app.post('/admin/upsert', requireAdmin, async (req,res)=>{
  const action = String(req.body.action || 'save');
  let code = String(req.body.code || '').trim().toUpperCase();

  if(action === 'generate'){
    if(!code) code = makeCode();
    return res.redirect(`/admin?edit=${encodeURIComponent(code)}&flash=${encodeURIComponent('Код сгенерирован. Заполни статус и текст, затем нажми «Сохранить».')}`);
  }

  if(!code) code = makeCode();

  let status = String(req.body.status || '').trim();
  if(!VALID_STATUSES.includes(status)) status = VALID_STATUSES[0];

  let message_ru = String(req.body.message_ru || '').trim();
  let message_en = String(req.body.message_en || '').trim();

  if(action === 'auto_translate'){
    if(!message_en && message_ru){
      const translated = await autoTranslateRUtoEN(message_ru);
      if(translated) message_en = translated;
    }
  }

  const exists = db.prepare('SELECT code FROM applications WHERE code = ?').get(code);

  const t = nowISO();
  if(exists){
    db.prepare('UPDATE applications SET status=?, message_ru=?, message_en=?, updated_at=? WHERE code=?')
      .run(status, message_ru, message_en, t, code);
  }else{
    db.prepare('INSERT INTO applications (code, status, message_ru, message_en, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(code, status, message_ru, message_en, t, t);
  }

  const msg = exists ? `Обновлено: ${code}` : `Создано: ${code}`;
  return res.redirect(`/admin?edit=${encodeURIComponent(code)}&flash=${encodeURIComponent(msg)}`);
});

app.post('/admin/delete', requireAdmin, (req,res)=>{
  const code = String(req.body.code || '').trim().toUpperCase();
  if(code) db.prepare('DELETE FROM applications WHERE code = ?').run(code);
  res.redirect('/admin?flash=' + encodeURIComponent('Удалено.'));
});

app.listen(PORT, ()=> console.log(`Server running on http://localhost:${PORT}`));
