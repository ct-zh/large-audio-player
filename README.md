# Large Audio Player

基于 `Tauri + React + Rust` 的桌面音频播放器，面向超大本地音频文件场景，当前重点是 `wav / mp3` 的本地打开、播放、波形展示和基础音频处理。

## Current Status

当前项目已经不是纯脚手架，已具备可编译的前后端闭环：

- React 前端界面已完成基础播放器形态
- Rust 后端已接入真实音频解析
- Rust 播放链路已接入真实本地播放
- 波形生成已改为后台任务
- 波形支持多级精度请求、内存缓存、磁盘缓存和视窗级 detail 请求
- 播放状态已改为事件推送，而不是前端轮询

## Implemented

### Frontend

- 本地音频文件选择与拖拽导入
- 播放器主界面
- 波形画布展示
- 播放 / 暂停 / 重播 / 拖动跳转
- 波形点击跳转
- 波形缩放、振幅高度、配色切换
- 增益与三段 EQ 控件
- Tauri 桌面模式与浏览器 fallback 双路径

### Rust / Tauri backend

- 真实音频元数据解析
- 真实本地播放
- `play / pause / seek / set_gain / set_eq`
- 播放状态事件推送
- 后台波形概览生成
- 打开新文件时取消旧波形任务
- 按点数请求不同精度的波形层
- 高倍缩放时按当前时间窗请求 detail 波形
- 同文件同层级波形内存缓存
- 同文件同层级波形磁盘缓存

### Supported now

- 音频格式：`wav`、`mp3`
- 首版目标环境：桌面端
- 技术路线：
  - 前端：`React + Vite`
  - 桌面宿主：`Tauri`
  - 后端：`Rust`
  - 解析：`symphonia`
  - 播放：`rodio`

## Current Limitations

当前仍然是首版，以下能力还没有完成：

- 更精细的多层级波形瓦片管理
- 更智能的波形分块 / 视窗预取策略
- 更专业的 EQ / DSP 精度与更多效果器
- 播放列表、多轨、导出处理后音频
- 更完整的异常恢复和长期资源监控

## Project Structure

- `src/`
  React 前端界面、桥接层、波形组件
- `src-tauri/src/main.rs`
  Tauri 命令入口、Rust 播放控制、波形后台任务、波形缓存
- `src/lib/tauriBridge.ts`
  前后端调用封装

## Local Development

### Prerequisites

- Node.js / npm
- Rust toolchain
- Tauri CLI

### Install

```bash
npm install
```

Rust 需要确保当前 shell 已加载：

```bash
source "$HOME/.cargo/env"
```

### Checks

前端类型检查：

```bash
npx tsc --noEmit
```

Rust 后端编译检查：

```bash
cd src-tauri
cargo check
```

### Frontend build

```bash
npm run build
```

### Tauri desktop dev

如果本机 Tauri 环境已完整安装，可以直接运行：

```bash
npx tauri dev
```

## Next Recommended Work

按当前项目状态，下一步最值得继续的是：

1. 更细粒度的多级波形缓存淘汰策略
2. 更智能的波形分块 / 视窗预取
3. 将播放状态和波形任务进一步拆为更稳定的后台服务层
4. 更完整的 EQ / DSP 效果链
