const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class DbWrapper {
  constructor(sqlDb, filePath) {
    this._db = sqlDb;
    this._filePath = filePath;
  }

  _save() {
    const data = this._db.export();
    fs.writeFileSync(this._filePath, Buffer.from(data));
  }

  exec(sql) {
    this._db.run(sql);
    this._save();
  }

  prepare(sql) {
    const db = this._db;
    const wrapper = this;
    return {
      run(...params) {
        db.run(sql, params);
        wrapper._save();
        return { changes: db.getRowsModified() };
      },
      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      }
    };
  }
}

async function initDatabase(dbPath) {
  const filePath = dbPath || path.join(__dirname, '..', '..', 'data.db');
  const SQL = await initSqlJs();
  let sqlDb;
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    sqlDb = new SQL.Database(buf);
  } else {
    sqlDb = new SQL.Database();
  }
  const db = new DbWrapper(sqlDb, filePath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      target_wake_time REAL DEFAULT 480,
      target_sleep_time REAL DEFAULT 1440,
      target_study_minutes REAL DEFAULT 240,
      target_entertainment_minutes REAL DEFAULT 180,
      wake_approach_rate REAL DEFAULT 0.3,
      sleep_approach_rate REAL DEFAULT 0.3,
      pomodoro_work_minutes REAL DEFAULT 45,
      pomodoro_break_minutes REAL DEFAULT 10,
      study_speed_start REAL DEFAULT 5,
      study_speed_end REAL DEFAULT 0.3,
      idle_speed REAL DEFAULT 0.5,
      entertainment_warning_threshold REAL DEFAULT 0.9,
      overlay_size INTEGER DEFAULT 16,
      overlay_bg_color TEXT DEFAULT '#000000',
      overlay_text_color TEXT DEFAULT '#00FF00',
      fullscreen_orientation TEXT DEFAULT 'landscape'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_state (
      date TEXT PRIMARY KEY,
      status TEXT DEFAULT 'sleeping',
      actual_wake_time REAL,
      display_wake_time REAL,
      actual_sleep_time REAL,
      display_sleep_time REAL,
      prev_actual_sleep_time REAL,
      prev_display_sleep_time REAL,
      expected_sleep_time REAL,
      display_awake_minutes REAL,
      real_awake_minutes REAL,
      entertainment_x REAL DEFAULT 1,
      accumulated_display_offset REAL DEFAULT 0,
      study_sessions_json TEXT DEFAULT '[]'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      activity TEXT,
      start_real_time REAL,
      end_real_time REAL,
      start_display_time REAL,
      end_display_time REAL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS pomodoro_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      start_real_time REAL,
      start_display_time REAL,
      end_time REAL,
      end_display_time REAL,
      target_minutes REAL,
      status TEXT DEFAULT 'active'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_records (
      date TEXT PRIMARY KEY,
      actual_wake REAL,
      actual_sleep REAL,
      display_wake REAL,
      display_sleep REAL,
      entertainment_minutes REAL,
      study_minutes REAL,
      entertainment_x REAL,
      pomodoro_count INTEGER,
      data_json TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      period TEXT,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS entertainment_apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_name TEXT UNIQUE,
      app_name TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS study_declarations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`INSERT OR IGNORE INTO settings (id) VALUES (1)`);

  const defaultApps = [
    ['com.tencent.mm', 'WeChat'], ['com.tencent.mobileqq', 'QQ'],
    ['com.ss.android.ugc.aweme', 'Douyin'], ['com.sina.weibo', 'Weibo'],
    ['tv.danmaku.bili', 'Bilibili'], ['com.netease.cloudmusic', 'NetEase Music'],
    ['com.tencent.qqlive', 'Tencent Video'], ['com.youku.phone', 'Youku'],
    ['com.ss.android.article.news', 'Toutiao'], ['com.zhihu.android', 'Zhihu']
  ];
  for (const [pkg, name] of defaultApps) {
    db.prepare('INSERT OR IGNORE INTO entertainment_apps (package_name, app_name) VALUES (?, ?)').run(pkg, name);
  }

  return db;
}

module.exports = { initDatabase };
