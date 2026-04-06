# Agent Team Visualizer - PRD

## 1. 项目概述
- **项目名称**: Agent Team Visualizer
- **项目类型**: 前后端分离全栈应用
- **核心功能**: 可视化展示 + 交互式控制 Agent Team（流程图形式）
- **目标用户**: 开发者/产品经理，监控和调度 AI Agent 团队

## 2. 系统架构

### 前端 (Next.js + React)
- 端口: 3000
- 技术栈: Next.js 14, React 18, TypeScript, TailwindCSS, React Flow
- 功能: 流程图可视化、Agent状态监控、任务输入

### 后端 (Node.js + Express)
- 端口: 3001
- 功能: Codex API代理、任务调度、WebSocket实时通信

### Agent Team (3个固定Agent)
- **Planner**: 任务规划分解
- **Executor**: 任务执行
- **Reviewer**: 结果审查

## 3. 功能需求

### 3.1 流程图可视化
- 展示Agent层级关系和任务流向
- 节点状态颜色: 空闲(绿)、工作中(黄)、完成(蓝)、错误(红)
- 点击节点查看详情

### 3.2 任务管理
- 输入任务指令
- 自动分解任务给Agent
- 支持手动分配任务

### 3.3 实时监控
- Agent状态实时更新
- 任务日志输出
- WebSocket推送

## 4. API设计
- `POST /api/tasks` - 创建任务
- `GET /api/agents` - 获取Agent状态
- `WS /ws` - WebSocket实时通信
- `POST /api/codex/*` - Codex代理

## 5. 成功标准
- [ ] 前端dev server启动，页面可访问
- [ ] 流程图正确渲染Agent关系
- [ ] 可输入任务触发Agent执行
- [ ] 后端正确代理Codex请求
- [ ] 实时状态更新正常

---

## 6. 详细功能规格说明

### 6.1 用户交互流程

#### 6.1.1 任务输入流程
1. 用户在任务输入框输入任务指令（自然语言描述）
2. 点击"提交任务"按钮或按 Enter 键
3. 系统验证输入非空后将任务发送到后端
4. Planner Agent 自动接收任务并进行分解
5. 系统显示任务分解结果（子任务列表）
6. Executor Agent 按顺序执行子任务
7. Reviewer Agent 对执行结果进行审查
8. 最终结果展示给用户

#### 6.1.2 节点交互流程
1. 用户点击流程图中的任意 Agent 节点
2. 右侧面板显示该 Agent 的详细信息：
   - Agent 名称和角色描述
   - 当前状态（空闲/工作中/完成/错误）
   - 当前任务内容（如有）
   - 最近 10 条执行日志
3. 用户可手动触发以下操作：
   - 重试任务（如 Agent 处于错误状态）
   - 暂停任务
   - 查看历史任务

#### 6.1.3 手动任务分配流程
1. 用户点击"手动分配"按钮
2. 弹出任务分配对话框
3. 用户选择目标 Agent
4. 输入任务内容
5. 点击确认后任务直接发送给指定 Agent

### 6.2 数据模型

#### 6.2.1 Agent 数据结构
```typescript
interface Agent {
  id: string;                    // 唯一标识符 (planner/executor/reviewer)
  name: string;                   // 显示名称
  role: string;                   // 角色描述
  status: AgentStatus;            // 当前状态
  currentTask: Task | null;       // 当前执行的任务
  taskHistory: Task[];            // 历史任务列表
  logs: LogEntry[];               // 最近日志
  createdAt: Date;               // 创建时间
}

type AgentStatus = 'idle' | 'working' | 'completed' | 'error';
```

#### 6.2.2 Task 数据结构
```typescript
interface Task {
  id: string;                     // 唯一标识符
  description: string;           // 任务描述
  parentTaskId: string | null;    // 父任务ID（用于分解的子任务）
  assignedAgent: string;          // 分配的 Agent ID
  status: TaskStatus;             // 任务状态
  result: string | null;          // 执行结果
  createdAt: Date;               // 创建时间
  startedAt: Date | null;        // 开始时间
  completedAt: Date | null;      // 完成时间
  errorMessage: string | null;   // 错误信息
}

type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
```

#### 6.2.3 LogEntry 数据结构
```typescript
interface LogEntry {
  id: string;                     // 唯一标识符
  agentId: string;                // 关联的 Agent ID
  taskId: string;                 // 关联的任务 ID
  level: 'info' | 'warning' | 'error';  // 日志级别
  message: string;               // 日志消息
  timestamp: Date;               // 时间戳
  metadata?: Record<string, any>; // 额外元数据
}
```

#### 6.2.4 WebSocket 消息结构
```typescript
// 客户端 -> 服务端
interface WSClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  payload?: any;
}

// 服务端 -> 客户端
interface WSServerMessage {
  type: 'agent_status' | 'task_update' | 'log_entry' | 'error';
  payload: {
    agentId?: string;
    taskId?: string;
    data: any;
    timestamp: string;
  };
}
```

### 6.3 错误处理场景

#### 6.3.1 任务提交错误
| 场景 | 用户反馈 | 系统处理 |
|------|----------|----------|
| 输入为空 | 显示"请输入任务描述" | 禁用提交按钮 |
| 后端连接失败 | Toast提示"服务暂不可用，请稍后重试" | 自动重试3次，间隔2秒 |
| 任务创建失败 | Toast提示"任务创建失败: {error}" | 记录错误日志 |
| 网络超时 | Toast提示"请求超时，请检查网络连接" | 显示重试按钮 |

#### 6.3.2 Agent 执行错误
| 场景 | 用户反馈 | 系统处理 |
|------|----------|----------|
| Planner 分解失败 | 节点显示红色错误状态 | 自动重试2次，标记任务失败 |
| Executor 执行失败 | 节点显示红色错误状态 | 记录错误日志，等待人工处理 |
| Reviewer 审查失败 | 节点显示红色错误状态 | 自动重试1次，失败则标记需要复核 |
| Codex API 调用失败 | Toast提示"AI 服务暂时不可用" | 自动重试3次，指数退避 |

#### 6.3.3 WebSocket 错误
| 场景 | 用户反馈 | 系统处理 |
|------|----------|----------|
| 连接断开 | 页面顶部显示重连提示条 | 自动重连，最多重试5次 |
| 消息发送失败 | 控制台输出错误 | 缓存消息，断线重连后重发 |
| 心跳检测失败 | - | 立即尝试重连 |

#### 6.3.4 任务状态错误
| 场景 | 用户反馈 | 系统处理 |
|------|----------|----------|
| 任务卡住（超过5分钟无响应） | 节点显示黄色警告状态 | 自动提示用户，可手动取消 |
| 任务死锁（循环依赖） | Toast提示检测到循环依赖 | 自动终止相关任务 |
| 子任务全部失败 | 父任务标记为失败 | 通知用户并提供重试选项 |

### 6.4 前端组件规格

#### 6.4.1 FlowDiagram 组件
- **功能**: 渲染 Agent 流程图
- **状态**: 节点位置、连线、选中状态
- **Props**: `agents: Agent[]`, `onNodeClick: (agentId) => void`, `highlightPath?: string[]`
- **交互**: 拖拽节点、缩放画布、点击节点

#### 6.4.2 AgentDetailPanel 组件
- **功能**: 显示选中 Agent 详情
- **状态**: 展开/收起、当前显示的日志条数
- **Props**: `agent: Agent | null`, `onClose: () => void`
- **交互**: 查看日志、滚动加载更多、重试操作

#### 6.4.3 TaskInput 组件
- **功能**: 任务输入框
- **状态**: 输入内容、验证状态、提交状态
- **Props**: `onSubmit: (task: string) => void`, `disabled?: boolean`
- **交互**: 输入、回车提交、点击提交

#### 6.4.4 TaskList 组件
- **功能**: 显示任务列表
- **状态**: 任务列表、筛选条件、排序方式
- **Props**: `tasks: Task[]`, `onTaskClick: (taskId) => void`, `filter?: TaskStatus`
- **交互**: 点击任务、筛选、排序

#### 6.4.5 LogViewer 组件
- **功能**: 显示实时日志
- **状态**: 日志列表、自动滚动、筛选级别
- **Props**: `logs: LogEntry[]`, `autoScroll?: boolean`, `filterLevel?: LogEntry['level']`
- **交互**: 滚动、筛选、点击查看详情

### 6.5 后端 API 规格

#### 6.5.1 POST /api/tasks
**请求**:
```json
{
  "description": "帮我写一个排序算法",
  "priority": "normal"
}
```
**响应** (201):
```json
{
  "id": "task_001",
  "description": "帮我写一个排序算法",
  "status": "pending",
  "createdAt": "2026-04-03T10:00:00Z"
}
```

#### 6.5.2 GET /api/agents
**响应** (200):
```json
{
  "agents": [
    {
      "id": "planner",
      "name": "Planner",
      "role": "任务规划分解",
      "status": "idle",
      "currentTask": null
    },
    {
      "id": "executor",
      "name": "Executor",
      "role": "任务执行",
      "status": "idle",
      "currentTask": null
    },
    {
      "id": "reviewer",
      "name": "Reviewer",
      "role": "结果审查",
      "status": "idle",
      "currentTask": null
    }
  ]
}
```

#### 6.5.3 GET /api/tasks/:id
**响应** (200):
```json
{
  "id": "task_001",
  "description": "帮我写一个排序算法",
  "status": "completed",
  "assignedAgent": "executor",
  "result": "排序算法已实现，使用快速排序...",
  "subTasks": [
    {
      "id": "subtask_001",
      "description": "分析需求并设计算法",
      "status": "completed"
    }
  ]
}
```

#### 6.5.4 WebSocket /ws
**连接**: `ws://localhost:3001/ws`

**订阅消息**:
```json
{
  "type": "subscribe",
  "payload": {
    "events": ["agent_status", "task_update", "log_entry"]
  }
}
```

**服务端推送示例**:
```json
{
  "type": "agent_status",
  "payload": {
    "agentId": "executor",
    "data": {
      "status": "working",
      "currentTask": {
        "id": "task_001",
        "description": "执行排序算法"
      }
    },
    "timestamp": "2026-04-03T10:01:00Z"
  }
}
```

### 6.6 性能要求
- 页面首次加载时间 < 3秒
- WebSocket 消息延迟 < 500ms
- 任务状态更新响应时间 < 1秒
- 支持同时处理 10 个并发任务
- 日志历史保留最近 1000 条

### 6.7 监控与日志
- 前端控制台输出关键操作日志
- 后端记录所有 API 调用和 Agent 操作
- 错误日志包含完整的堆栈跟踪
- 支持导出日志用于调试