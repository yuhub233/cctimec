class TimeEngine {
  constructor(db) {
    this.db = db;
    this.state = null;
    this.pomodoroState = null;
    this.load();
  }

  load() {
    const today = this.todayStr();
    let row = this.db.prepare('SELECT * FROM daily_state WHERE date = ?').get(today);
    if (!row) {
      const yesterday = this.dateStr(new Date(Date.now() - 86400000));
      const yRow = this.db.prepare('SELECT * FROM daily_state WHERE date = ? ORDER BY date DESC').get(yesterday);
      const settings = this.getSettings();
      const config = require('../../config.json');
      const prevSleepTime = yRow ? yRow.actual_sleep_time : this.timeToMinutes(config.initialSleepTime);
      const prevDisplaySleepTime = yRow ? yRow.display_sleep_time : this.timeToMinutes(config.initialSleepTime);
      this.db.prepare(`INSERT INTO daily_state (date, status, actual_wake_time, display_wake_time,
        actual_sleep_time, display_sleep_time, prev_actual_sleep_time, prev_display_sleep_time,
        entertainment_x, accumulated_display_offset, study_sessions_json)
        VALUES (?, 'sleeping', NULL, NULL, NULL, NULL, ?, ?, 1, 0, '[]')`).run(
        today, prevSleepTime, prevDisplaySleepTime
      );
      row = this.db.prepare('SELECT * FROM daily_state WHERE date = ?').get(today);
    }
    this.state = row;
    const pRow = this.db.prepare('SELECT * FROM pomodoro_sessions WHERE date = ? AND end_time IS NULL').get(today);
    this.pomodoroState = pRow || null;
  }

  todayStr() { return this.dateStr(new Date()); }
  dateStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  timeToMinutes(str) {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
  }

  minutesToTime(mins) {
    mins = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(mins / 60)).padStart(2,'0')}:${String(Math.floor(mins % 60)).padStart(2,'0')}`;
  }

  nowMinutes() {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
  }

  getSettings() {
    const row = this.db.prepare('SELECT * FROM settings WHERE id = 1').get();
    return row || {
      target_wake_time: 480, target_sleep_time: 1440,
      target_study_minutes: 240, target_entertainment_minutes: 180,
      wake_approach_rate: 0.3, sleep_approach_rate: 0.3,
      pomodoro_work_minutes: 45, pomodoro_break_minutes: 10,
      study_speed_start: 5, study_speed_end: 0.3,
      idle_speed: 0.5, entertainment_warning_threshold: 0.9,
      overlay_size: 16, overlay_bg_color: '#000000', overlay_text_color: '#00FF00',
      fullscreen_orientation: 'landscape'
    };
  }

  wakeUp() {
    this.load();
    const s = this.state;
    if (s.status !== 'sleeping') return s;
    const settings = this.getSettings();
    const realWake = this.nowMinutes();
    const targetWake = settings.target_wake_time;
    const rate = settings.wake_approach_rate;
    const displayWake = realWake + (targetWake - realWake) * rate;
    const prevDisplaySleep = s.prev_display_sleep_time;
    const targetSleep = settings.target_sleep_time;
    const prevActualSleep = s.prev_actual_sleep_time;
    const expectedTodaySleep = prevActualSleep + (targetSleep - prevActualSleep) * settings.sleep_approach_rate;
    let realAwakeMinutes = expectedTodaySleep > realWake
      ? (1440 - expectedTodaySleep) + realWake
      : expectedTodaySleep < realWake ? realWake - expectedTodaySleep : 960;
    let displayAwakeMinutes;
    if (prevDisplaySleep > displayWake) {
      displayAwakeMinutes = (1440 - prevDisplaySleep) + displayWake;
    } else {
      displayAwakeMinutes = displayWake > prevDisplaySleep ? (1440 - prevDisplaySleep + displayWake) : displayWake - prevDisplaySleep;
    }
    if (displayAwakeMinutes <= 0 || displayAwakeMinutes > 1440) displayAwakeMinutes = realAwakeMinutes;
    const tgtEnt = settings.target_entertainment_minutes;
    const tgtStudy = settings.target_study_minutes;
    const displayRest = displayAwakeMinutes - tgtStudy;
    const realRest = realAwakeMinutes - tgtEnt - tgtStudy;
    let x = 1;
    if (tgtEnt > 0 && realRest > 0) {
      x = (displayRest - realRest * 2) / tgtEnt;
      if (x < 0.5) x = 0.5;
      if (x > 5) x = 5;
    }
    this.db.prepare(`UPDATE daily_state SET status='idle', actual_wake_time=?, display_wake_time=?,
      expected_sleep_time=?, display_awake_minutes=?, real_awake_minutes=?, entertainment_x=?
      WHERE date=?`).run(realWake, displayWake, expectedTodaySleep, displayAwakeMinutes, realAwakeMinutes, x, s.date);
    this.load();
    return this.getFullState();
  }

  goSleep() {
    this.load();
    const realSleep = this.nowMinutes();
    const displayTime = this.getCurrentDisplayTime();
    const displaySleep = displayTime.displayMinutes;
    this.db.prepare(`UPDATE daily_state SET status='sleeping', actual_sleep_time=?, display_sleep_time=? WHERE date=?`)
      .run(realSleep, displaySleep, this.state.date);
    this.saveDailyRecord();
    this.load();
    return this.getFullState();
  }

  setActivity(activity) {
    this.load();
    if (this.state.status === 'sleeping') return this.getFullState();
    const validActivities = ['idle', 'entertainment', 'studying'];
    if (!validActivities.includes(activity)) return this.getFullState();
    this.db.prepare('UPDATE daily_state SET status=? WHERE date=?').run(activity, this.state.date);
    if (activity === 'entertainment') {
      this.db.prepare(`INSERT OR IGNORE INTO activity_log (date, activity, start_real_time, start_display_time)
        VALUES (?, 'entertainment', ?, ?)`).run(this.state.date, this.nowMinutes(), this.getCurrentDisplayTime().displayMinutes);
    }
    this.load();
    return this.getFullState();
  }

  reportForegroundApp(appPackage, deviceId) {
    this.load();
    if (this.state.status === 'sleeping') return;
    const entApps = this.db.prepare('SELECT package_name FROM entertainment_apps').all().map(r => r.package_name);
    const isEnt = entApps.some(pkg => appPackage.includes(pkg));
    const studyDeclared = this.db.prepare('SELECT * FROM study_declarations WHERE device_id=? AND active=1').get(deviceId);
    if (isEnt && !studyDeclared && this.state.status !== 'studying') {
      if (this.state.status !== 'entertainment') this.setActivity('entertainment');
    } else if (!isEnt && this.state.status === 'entertainment') {
      this.setActivity('idle');
    }
  }

  getCurrentDisplayTime() {
    this.load();
    const s = this.state;
    const settings = this.getSettings();
    const now = this.nowMinutes();
    if (s.status === 'sleeping' || !s.actual_wake_time) {
      const targetWake = settings.target_wake_time;
      const rate = settings.wake_approach_rate;
      const hypotheticalDisplay = now + (targetWake - now) * rate;
      return { displayMinutes: hypotheticalDisplay, displayTime: this.minutesToTime(hypotheticalDisplay), speed: 0, status: 'sleeping', realMinutes: now };
    }
    const realElapsed = now >= s.actual_wake_time ? now - s.actual_wake_time : (1440 - s.actual_wake_time + now);
    let speed = this.getCurrentSpeed();
    let displayElapsed = this.computeDisplayElapsed(realElapsed);
    const displayNow = (s.display_wake_time + displayElapsed) % 1440;
    return {
      displayMinutes: displayNow,
      displayTime: this.minutesToTime(displayNow),
      speed: speed,
      status: s.status,
      realMinutes: now,
      realTime: this.minutesToTime(now),
      realElapsedSinceWake: realElapsed,
      displayElapsedSinceWake: displayElapsed
    };
  }

  getCurrentSpeed() {
    const s = this.state;
    const settings = this.getSettings();
    if (s.status === 'sleeping') return 0;
    if (s.status === 'idle') return settings.idle_speed || 0.5;
    if (s.status === 'entertainment') return s.entertainment_x || 1;
    if (s.status === 'studying' && this.pomodoroState) return this.getStudySpeed();
    return 1;
  }

  getStudySpeed() {
    const settings = this.getSettings();
    const pomo = this.pomodoroState;
    if (!pomo) return 1;
    const now = this.nowMinutes();
    const elapsed = now >= pomo.start_real_time ? now - pomo.start_real_time : (1440 - pomo.start_real_time + now);
    const workMins = settings.pomodoro_work_minutes;
    const breakMins = settings.pomodoro_break_minutes;
    const cycleLen = workMins + breakMins;
    const inCycle = elapsed % cycleLen;
    if (inCycle >= workMins) return 1.0;
    const totalTargetStudy = pomo.target_minutes || settings.target_study_minutes;
    if (elapsed >= totalTargetStudy) return settings.study_speed_end;
    const progress = Math.min(inCycle / workMins, 1);
    const startSpeed = settings.study_speed_start;
    const endSpeed = settings.study_speed_end;
    return startSpeed + (endSpeed - startSpeed) * Math.pow(progress, 1.5);
  }

  computeDisplayElapsed(realElapsed) {
    const s = this.state;
    const settings = this.getSettings();
    const logs = this.db.prepare('SELECT * FROM activity_log WHERE date=? ORDER BY start_real_time').all(s.date);
    if (logs.length === 0) {
      return realElapsed * this.getCurrentSpeed();
    }
    let displayTotal = 0;
    let lastEnd = 0;
    for (const log of logs) {
      const segStart = log.start_real_time - s.actual_wake_time;
      const segEnd = log.end_real_time ? log.end_real_time - s.actual_wake_time : realElapsed;
      if (segStart > lastEnd) {
        const idleDur = segStart - lastEnd;
        displayTotal += idleDur * (settings.idle_speed || 0.5);
      }
      const dur = segEnd - segStart;
      if (log.activity === 'entertainment') {
        displayTotal += dur * (s.entertainment_x || 1);
      } else if (log.activity === 'studying') {
        displayTotal += dur * 1.0;
      } else {
        displayTotal += dur * (settings.idle_speed || 0.5);
      }
      lastEnd = segEnd;
    }
    if (lastEnd < realElapsed) {
      displayTotal += (realElapsed - lastEnd) * this.getCurrentSpeed();
    }
    return displayTotal;
  }

  startPomodoro(targetMinutes) {
    this.load();
    const settings = this.getSettings();
    const now = this.nowMinutes();
    const displayNow = this.getCurrentDisplayTime().displayMinutes;
    const target = targetMinutes || settings.target_study_minutes;
    this.db.prepare(`INSERT INTO pomodoro_sessions (date, start_real_time, start_display_time, target_minutes, status)
      VALUES (?, ?, ?, ?, 'active')`).run(this.state.date, now, displayNow, target);
    this.setActivity('studying');
    this.load();
    return this.getPomodoroState();
  }

  stopPomodoro() {
    this.load();
    if (!this.pomodoroState) return null;
    const now = this.nowMinutes();
    const displayNow = this.getCurrentDisplayTime().displayMinutes;
    this.db.prepare(`UPDATE pomodoro_sessions SET end_time=?, end_display_time=?, status='completed' WHERE id=?`)
      .run(now, displayNow, this.pomodoroState.id);
    this.setActivity('idle');
    this.load();
    return this.getFullState();
  }

  getPomodoroState() {
    this.load();
    if (!this.pomodoroState) return { active: false };
    const settings = this.getSettings();
    const now = this.nowMinutes();
    const elapsed = now >= this.pomodoroState.start_real_time
      ? now - this.pomodoroState.start_real_time
      : 1440 - this.pomodoroState.start_real_time + now;
    const workMins = settings.pomodoro_work_minutes;
    const breakMins = settings.pomodoro_break_minutes;
    const cycleLen = workMins + breakMins;
    const inCycle = elapsed % cycleLen;
    const cycleNum = Math.floor(elapsed / cycleLen) + 1;
    const isBreak = inCycle >= workMins;
    const remaining = isBreak ? (cycleLen - inCycle) : (workMins - inCycle);
    const target = this.pomodoroState.target_minutes;
    const overtime = elapsed > target;
    return {
      active: true, elapsed, cycleNum, isBreak, remaining,
      target, overtime, speed: this.getStudySpeed(),
      displayElapsed: this.getCurrentDisplayTime().displayElapsedSinceWake
    };
  }

  getEntertainmentStatus() {
    this.load();
    const settings = this.getSettings();
    const logs = this.db.prepare("SELECT * FROM activity_log WHERE date=? AND activity='entertainment'").all(this.state.date);
    let totalReal = 0;
    const now = this.nowMinutes();
    for (const log of logs) {
      const end = log.end_real_time || now;
      totalReal += end - log.start_real_time;
    }
    const target = settings.target_entertainment_minutes;
    const threshold = settings.entertainment_warning_threshold || 0.9;
    return {
      totalMinutes: totalReal,
      targetMinutes: target,
      ratio: totalReal / target,
      warning: totalReal >= target * threshold,
      exceeded: totalReal >= target
    };
  }

  getFullState() {
    this.load();
    const dt = this.getCurrentDisplayTime();
    const ent = this.getEntertainmentStatus();
    const pomo = this.getPomodoroState();
    const settings = this.getSettings();
    return { time: dt, entertainment: ent, pomodoro: pomo, dailyState: this.state, settings };
  }

  getPreviewWakeTime() {
    const settings = this.getSettings();
    const now = this.nowMinutes();
    const targetWake = settings.target_wake_time;
    const rate = settings.wake_approach_rate;
    return this.minutesToTime(now + (targetWake - now) * rate);
  }

  saveDailyRecord() {
    const s = this.state;
    const logs = this.db.prepare('SELECT * FROM activity_log WHERE date=?').all(s.date);
    const pomos = this.db.prepare('SELECT * FROM pomodoro_sessions WHERE date=?').all(s.date);
    const now = this.nowMinutes();
    let entTotal = 0, studyTotal = 0;
    for (const log of logs) {
      const dur = (log.end_real_time || now) - log.start_real_time;
      if (log.activity === 'entertainment') entTotal += dur;
      if (log.activity === 'studying') studyTotal += dur;
    }
    this.db.prepare(`INSERT OR REPLACE INTO daily_records (date, actual_wake, actual_sleep, display_wake, display_sleep,
      entertainment_minutes, study_minutes, entertainment_x, pomodoro_count, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      s.date, s.actual_wake_time, s.actual_sleep_time, s.display_wake_time, s.display_sleep_time,
      entTotal, studyTotal, s.entertainment_x, pomos.length, JSON.stringify({ logs, pomos })
    );
  }
}

module.exports = TimeEngine;
