# WebSocket 通信设计文档

## 1. 概述
本文档定义前后端之间的 WebSocket 通信协议和机制。

## 2. 连接管理

### 2.1 连接配置
```javascript
const WS_CONFIG = {
  url: 'ws://localhost:3001/ws',
  reconnect: {
    maxAttempts: 5,
    interval: [2000, 4000, 8000, 16000, 32000] // 指数退避
  },
  heartbeat: {
    interval: 30000,  // 30秒
    timeout: 5000      // 5秒超时
  }
};
```

### 2.2 连接状态
```typescript
type ConnectionStatus =
  | 'connecting'    // 连接中
  | 'connected'     // 已连接
  | 'disconnected'  // 断开
  | 'reconnecting'; // 重连中
```

### 2.3 连接状态机
```
                      连接成功
   ┌─────────┐ ──────────────────► ┌──────────┐
   │connecting│                     │ connected│
   └─────────┘ ◄──────────────────── └──────────┘
      ▲      │      连接失败           │
      │      │                         │
      │      │                         │ 检测到断开
      │      │                         ▼
      │      │                   ┌─────────────┐
      │      └──────────────────►│disconnected │
      │          主动关闭         └─────────────┘
      │                               │
      │                               │ 自动重连
      │                               ▼
      │                         ┌────────────┐
      └─────────────────────────│reconnecting│
            重连成功             └────────────┘
```

## 3. 消息格式

### 3.1 客户端 → 服务端

#### 订阅消息
```json
{
  "type": "subscribe",
  "payload": {
    "events": ["agent_status", "task_update", "log_entry"]
  }
}
```

#### 取消订阅
```json
{
  "type": "unsubscribe",
  "payload": {
    "events": ["log_entry"]
  }
}
```

#### 心跳
```json
{
  "type": "ping"
}
```

### 3.2 服务端 → 客户端

#### Agent 状态更新
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

#### 任务更新
```json
{
  "type": "task_update",
  "payload": {
    "taskId": "task_001",
    "data": {
      "status": "completed",
      "result": "排序算法实现完成"
    },
    "timestamp": "2026-04-03T10:01:30Z"
  }
}
```

#### 日志条目
```json
{
  "type": "log_entry",
  "payload": {
    "logId": "log_001",
    "data": {
      "agentId": "executor",
      "taskId": "task_001",
      "level": "info",
      "message": "开始执行任务",
      "metadata": {
        "step": 1,
        "totalSteps": 3
      }
    },
    "timestamp": "2026-04-03T10:01:00Z"
  }
}
```

#### 错误消息
```json
{
  "type": "error",
  "payload": {
    "code": "AGENT_EXECUTION_ERROR",
    "message": "Executor 执行失败",
    "details": {
      "agentId": "executor",
      "taskId": "task_001",
      "error": "Codex API 调用超时"
    },
    "timestamp": "2026-04-03T10:01:00Z"
  }
}
```

#### 心跳响应
```json
{
  "type": "pong"
}
```

## 4. 事件类型

### 4.1 事件列表
| 事件 | 说明 | 频率 |
|------|------|------|
| agent_status | Agent 状态变化 | 变化时 |
| task_update | 任务状态变化 | 变化时 |
| log_entry | 新日志条目 | 实时 |
| connection | 连接状态变化 | 变化时 |

### 4.2 事件过滤
客户端可以订阅特定事件，减少不必要的数据传输：
```javascript
// 只订阅 agent_status 和 task_update
ws.send(JSON.stringify({
  type: 'subscribe',
  payload: { events: ['agent_status', 'task_update'] }
}));
```

## 5. 重连机制

### 5.1 重连策略
```
首次断开
    │
    ▼
等待 2 秒 ────────────────────► 重试 (1/5)
    │                              │
    │                              ▼
    │                         连接成功 ──► 恢复连接
    │                              │
    │ (1/5)                        ▼
    ▼                         连接失败
等待 4 秒
    │
    │ (2/5)
    ▼
等待 8 秒
    │
    │ (3/5)
    ▼
等待 16 秒
    │
    │ (4/5)
    ▼
等待 32 秒
    │
    │ (5/5)
    ▼
  重连失败 ──► 提示用户手动重连
```

### 5.2 重连标识
```javascript
{
  type: 'reconnecting',
  payload: {
    attempt: 3,
    maxAttempts: 5,
    nextRetryIn: 8000
  }
}
```

## 6. 离线处理

### 6.1 消息队列
当 WebSocket 断开时，客户端缓存用户操作：
```javascript
const messageQueue = [
  { type: 'task_submit', payload: {...} },
  { type: 'agent_action', payload: {...} }
];
// 重连后按顺序发送
```

### 6.2 状态同步
重连后请求完整状态同步：
```json
{
  "type": "sync_request",
  "payload": {
    "lastEventId": "log_099"
  }
}
```

## 7. 安全考虑

### 7.1 认证
- WebSocket 连接使用 HTTP Cookie 进行身份验证
- 首次连接时验证用户 session

### 7.2 限流
- 客户端发送消息频率限制: 10条/秒
- 服务端广播频率限制: 100条/秒/客户端

## 8. 监控指标
- 连接成功率
- 平均消息延迟
- 重连次数
- 断连时长