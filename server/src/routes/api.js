const express = require('express');

function createApiRoutes(engine, db) {
  const router = express.Router();

  router.get('/time', (req, res) => {
    res.json(engine.getCurrentDisplayTime());
  });

  router.get('/state', (req, res) => {
    res.json(engine.getFullState());
  });

  router.post('/wake', (req, res) => {
    res.json(engine.wakeUp());
  });

  router.post('/sleep', (req, res) => {
    res.json(engine.goSleep());
  });

  router.post('/activity', (req, res) => {
    const { activity } = req.body;
    res.json(engine.setActivity(activity));
  });

  router.post('/foreground', (req, res) => {
    const { packageName, deviceId } = req.body;
    engine.reportForegroundApp(packageName || '', deviceId || 'unknown');
    res.json({ ok: true });
  });

  router.post('/pomodoro/start', (req, res) => {
    const { targetMinutes } = req.body;
    res.json(engine.startPomodoro(targetMinutes));
  });

  router.post('/pomodoro/stop', (req, res) => {
    res.json(engine.stopPomodoro());
  });

  router.get('/pomodoro', (req, res) => {
    res.json(engine.getPomodoroState());
  });

  router.get('/entertainment', (req, res) => {
    res.json(engine.getEntertainmentStatus());
  });

  router.get('/settings', (req, res) => {
    res.json(engine.getSettings());
  });

  router.post('/settings', (req, res) => {
    const fields = req.body;
    const allowed = ['target_wake_time','target_sleep_time','target_study_minutes','target_entertainment_minutes',
      'wake_approach_rate','sleep_approach_rate','pomodoro_work_minutes','pomodoro_break_minutes',
      'study_speed_start','study_speed_end','idle_speed','entertainment_warning_threshold',
      'overlay_size','overlay_bg_color','overlay_text_color','fullscreen_orientation'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(fields[k]);
      }
    }
    if (sets.length > 0) {
      db.prepare(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`).run(...vals);
    }
    res.json(engine.getSettings());
  });

  router.get('/records', (req, res) => {
    const { limit = 30, offset = 0 } = req.query;
    const rows = db.prepare('SELECT * FROM daily_records ORDER BY date DESC LIMIT ? OFFSET ?').all(Number(limit), Number(offset));
    res.json(rows);
  });

  router.get('/records/:date', (req, res) => {
    const row = db.prepare('SELECT * FROM daily_records WHERE date = ?').get(req.params.date);
    res.json(row || {});
  });

  router.get('/summaries', (req, res) => {
    const { type, limit = 20 } = req.query;
    let rows;
    if (type) {
      rows = db.prepare('SELECT * FROM ai_summaries WHERE type = ? ORDER BY created_at DESC LIMIT ?').all(type, Number(limit));
    } else {
      rows = db.prepare('SELECT * FROM ai_summaries ORDER BY created_at DESC LIMIT ?').all(Number(limit));
    }
    res.json(rows);
  });

  router.post('/summaries/generate', async (req, res) => {
    const { type = 'daily', period } = req.body;
    const { generateDailySummary, generatePeriodSummary } = require('../services/aiSummary');
    try {
      let result;
      if (type === 'daily') {
        result = await generateDailySummary(db, period || engine.todayStr());
      } else {
        result = await generatePeriodSummary(db, type, period || engine.todayStr());
      }
      res.json({ content: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/entertainment-apps', (req, res) => {
    res.json(db.prepare('SELECT * FROM entertainment_apps').all());
  });

  router.post('/entertainment-apps', (req, res) => {
    const { packageName, appName } = req.body;
    db.prepare('INSERT OR IGNORE INTO entertainment_apps (package_name, app_name) VALUES (?, ?)').run(packageName, appName || packageName);
    res.json(db.prepare('SELECT * FROM entertainment_apps').all());
  });

  router.delete('/entertainment-apps/:id', (req, res) => {
    db.prepare('DELETE FROM entertainment_apps WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.post('/study-declare', (req, res) => {
    const { deviceId, active } = req.body;
    if (active) {
      db.prepare('INSERT INTO study_declarations (device_id, active) VALUES (?, 1)').run(deviceId);
    } else {
      db.prepare('UPDATE study_declarations SET active = 0 WHERE device_id = ?').run(deviceId);
    }
    res.json({ ok: true });
  });

  router.get('/preview-wake', (req, res) => {
    res.json({ previewWakeTime: engine.getPreviewWakeTime() });
  });

  return router;
}

module.exports = createApiRoutes;
