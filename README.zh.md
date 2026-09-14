# 📦 @goodandready/dsh-agent-orchestrator

<div align="center">

<h3>面向 DeepSeek Harness 的多智能体任务分解、DAG 工作流编排与提示词缓存优化引擎</h3>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/作者所有项目-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="作者所有项目"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a>
</p>

</div>

---

## ⚡ 概述与解决的问题

在执行复杂的多阶段工程任务时，单一智能体架构往往面临上下文过载：单一请求中混合了系统架构、界面设计、前端编码、后端逻辑、单元测试与文档编写，容易导致幻觉与契约不一致。

此外，独立调用多个子智能体会导致每次推理重新建立 KV 缓存，无法重用提示词前缀缓存（Prompt Caching），造成严重的延迟与计算开销。

**`@goodandready/dsh-agent-orchestrator`** 为 DeepSeek Harness 带来了自主的多智能体编排框架：

1. **智能分流与分解**：分析聊天或看板卡片的目标，将其分解并分发给 **12 个专用智能体角色**。
2. **有向无环图 (DAG) 引擎**：基于依赖关系并行调度无阻塞任务，严格控制前置阶段。
3. **提示词缓存优化 (KV Cache Optimizer)**：确保相同模型的智能体在字节级上共享规范前缀，实现 80–90% 的缓存命中率。
4. **职责严格分离**：后端逻辑、界面设计与前端实现彼此独立，严禁单一智能体混同处理。
5. **双重使用场景**：支持通过 DSH 聊天斜杠命令 `/orchestrate` 触发，或无缝嵌入 `@goodandready/dsh-kanban` 任务看板。

---

## 💻 使用方法

### 1. 在 DSH 聊天中通过斜杠命令触发
```text
/orchestrate 为财务插件设计并开发设置卡片
```

指定复杂度模式：
```text
/orchestrate complex 开发带有后端和前端界面的任务排队系统
/orchestrate hotfix 修复 store.js 中的空指针异常
```

简短别名：
```text
/orc 重构状态管理模块
```

---

## 🧪 单元测试

```bash
node --test test/*.test.mjs
```

许可证：MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)

