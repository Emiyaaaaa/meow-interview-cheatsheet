# <img src="assets/logo.png" alt="喵喵面试助手" width="32" height="32"> 喵喵面试助手

面试时把提问转成文字，再结合简历给出回答要点。支持 macOS 与 Windows。

https://interviewcheat.cn

## 下载

[下载安装包](https://github.com/Emiyaaaaa/meow-interview-cheatsheet/releases/latest)

### macOS 提示「已损坏，无法打开」

当前安装包未经过 Apple 签名。系统可能拦截并提示将应用移到废纸篓。把 `喵喵面试助手.app` 拖到「应用程序」后，在「终端」执行：

```bash
xattr -cr /Applications/喵喵面试助手.app
```

然后再打开即可。

## 功能

- 采集系统音频或麦克风，实时转写面试官的话。
- 上传简历、选择岗位方向，生成可对着说的回答。
- 规避屏幕共享检测。
- 可改应用名称，面试更隐蔽。

## 技术栈

Electron / React / HeroUI / FunASR

## License

本项目仅供学习使用，禁止商业使用。详见 [LICENSE](LICENSE)。
