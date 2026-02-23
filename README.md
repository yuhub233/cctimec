# CCTimeC - Custom Clock Time Controller

不常规时间显示系统，通过时间流速变化调整作息习惯。

## 组件
- **server/** - Node.js 服务端 (Express + WebSocket + sql.js)
- **server/web/** - HTML Web 客户端
- **android/** - Android 原生客户端 (Kotlin)

## 快速开始

### 服务端
```bash
cd server
npm install
npm start
```
访问 http://localhost:3001

### Android
用 Android Studio 打开 `android/` 目录构建。

## 功能
- 不常规时间显示与时间流速变化
- 番茄钟学习计时（曲线变速）
- 前台应用自动识别（娱乐/学习）
- 悬浮窗时间显示
- AI 日/周/月/年总结
- AES-256 加密通信
- 多客户端数据同步
