const https = require('https');
const http = require('http');
const config = require('../../config.json');

async function callAI(prompt) {
  const ai = config.ai;
  const provider = ai.providers[ai.provider] || ai.providers.openai;
  const url = new URL(provider.apiUrl || ai.apiUrl);
  const isHttps = url.protocol === 'https:';
  const mod = isHttps ? https : http;

  let body, headers = { 'Content-Type': 'application/json' };

  if (ai.provider === 'claude') {
    headers['x-api-key'] = ai.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = JSON.stringify({
      model: provider.model, max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });
  } else if (ai.provider === 'ollama') {
    body = JSON.stringify({
      model: provider.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false
    });
  } else {
    headers['Authorization'] = `Bearer ${ai.apiKey}`;
    body = JSON.stringify({
      model: provider.model || ai.model,
      messages: [{ role: 'system', content: '你是一个作息管理助手，帮助用户分析和改善作息习惯。' },
                 { role: 'user', content: prompt }],
      max_tokens: 2048
    });
  }

  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (ai.provider === 'claude') resolve(json.content?.[0]?.text || data);
          else if (ai.provider === 'ollama') resolve(json.message?.content || data);
          else resolve(json.choices?.[0]?.message?.content || data);
        } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function generateDailySummary(db, date) {
  const record = db.prepare('SELECT * FROM daily_records WHERE date = ?').get(date);
  if (!record) return null;
  const prompt = `请根据以下作息数据写一份简短的日总结（200字以内），分析作息质量并给出建议：\n日期：${date}\n真实起床时间：${minutesToTime(record.actual_wake)}\n真实睡觉时间：${minutesToTime(record.actual_sleep)}\n表显起床时间：${minutesToTime(record.display_wake)}\n表显睡觉时间：${minutesToTime(record.display_sleep)}\n娱乐时长：${Math.round(record.entertainment_minutes)}分钟\n学习时长：${Math.round(record.study_minutes)}分钟\n娱乐倍速：${record.entertainment_x?.toFixed(2)}\n番茄钟次数：${record.pomodoro_count}`;
  try {
    const content = await callAI(prompt);
    db.prepare('INSERT INTO ai_summaries (type, period, content) VALUES (?, ?, ?)').run('daily', date, content);
    return content;
  } catch (e) {
    return `AI总结生成失败: ${e.message}`;
  }
}

async function generatePeriodSummary(db, type, period) {
  let summaries;
  if (type === 'weekly') {
    summaries = db.prepare("SELECT * FROM ai_summaries WHERE type='daily' ORDER BY period DESC LIMIT 7").all();
  } else if (type === 'monthly') {
    summaries = db.prepare("SELECT * FROM ai_summaries WHERE type='weekly' ORDER BY period DESC LIMIT 4").all();
  } else if (type === 'yearly') {
    summaries = db.prepare("SELECT * FROM ai_summaries WHERE type='monthly' ORDER BY period DESC LIMIT 12").all();
  }
  if (!summaries || summaries.length === 0) return null;
  const subType = type === 'weekly' ? '日' : type === 'monthly' ? '周' : '月';
  const prompt = `请根据以下${subType}总结，写一份${type === 'weekly' ? '周' : type === 'monthly' ? '月' : '年'}总结（300字以内），分析趋势并给出改善建议：\n\n${summaries.map(s => `[${s.period}]\n${s.content}`).join('\n\n')}`;
  try {
    const content = await callAI(prompt);
    db.prepare('INSERT INTO ai_summaries (type, period, content) VALUES (?, ?, ?)').run(type, period, content);
    return content;
  } catch (e) {
    return `AI总结生成失败: ${e.message}`;
  }
}

function minutesToTime(mins) {
  if (mins == null) return '--:--';
  mins = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;
}

module.exports = { callAI, generateDailySummary, generatePeriodSummary };
