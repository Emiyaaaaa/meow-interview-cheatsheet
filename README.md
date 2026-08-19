# 神奇面试小抄

一款基于 Electron 的 AI 面试辅助桌面应用。本阶段完成了面试准备、权限检测、计时状态、手机号验证码登录和时长充值页面。

## 技术栈

- Electron
- React 19 + TypeScript
- HeroUI React v3
- Tailwind CSS v4
- electron-vite

## 本地开发

项目要求 Node.js 22.12 或更高版本。

```bash
npm install
npm run dev
```

构建生产版本：

```bash
npm run build
```

## 当前功能

- 黑白主题桌面端布局
- “开始面试”与“时长充值”侧边导航
- 麦克风、屏幕录制、系统音频权限检测
- 面试开始、暂停和用时统计
- 手机号验证码登录
- 登录后展示用户手机号
- Mock 时长充值套餐

## Mock 说明

当前后端接口与系统授权接口均使用本地 Mock：

- 验证码固定为 `123456`
- 点击“去授权”后模拟授权成功
- 登录、计时和充值数据只保存在当前应用会话中
