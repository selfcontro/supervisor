# Agent Team Visualizer - 测试指南

## 1. 环境准备

### 1.1 启动后端服务
```bash
cd /Users/wly/Desktop/项目1/supervisor/backend
npm start
# 后端服务运行在 http://localhost:3001
# WebSocket 运行在 ws://localhost:3001/ws
```

### 1.2 启动前端服务
```bash
cd /Users/wly/Desktop/项目1/supervisor/frontend
npm run dev
# 前端服务运行在 http://localhost:3000
```

### 1.3 环境变量配置

**Backend (.env)**
```
CODEX_API_KEY=your_api_key_here
PORT=3001
```

**Frontend (.env.local)**
```
NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3001
```

---

## 2. WebSocket 测试

### 2.1 连接测试

使用 `wscat` 或浏览器开发者工具连接:
```bash
npm install -g wscat
wscat -c ws://localhost:3001/ws
```

### 2.2 订阅消息

连接到后，发送订阅消息:
```json
{
  "type": "subscribe",
  "payload": {
    "events": ["agent_status", "task_update", "log_entry"]
  }
}
```

预期响应:
```json
{
  "type": "subscribed",
  "payload": { "events": ["agent_status", "task_update", "log_entry"] },
  "timestamp": "2026-04-03T12:00:00.000Z"
}
```

### 2.3 心跳测试

发送:
```json
{ "type": "ping" }
```

预期响应:
```json
{ "type": "pong" }
```

### 2.4 WebSocket 消息格式

**服务端 → 客户端:**

| 消息类型 | 说明 | 示例 |
|----------|------|------|
| `agent_status` | Agent 状态变化 | `{"type": "agent_status", "payload": {"agentId": "planner", "data": {"status": "working", "currentTask": "..."}}}`
| `task_update` | 任务状态变化 | `{"type": "task_update", "payload": {"taskId": "task_xxx", "data": {"status": "completed"}}}`
| `log_entry` | 日志条目 | `{"type": "log_entry", "payload": {"logId": "log_xxx", "data": {"agentId": "planner", "level": "info", "message": "..."}}}`
| `task:new` | 新任务创建 | `{"type": "task:new", "task": {"id": "task_xxx", "description": "..."}}`

**客户端 → 服务端:**

| 消息类型 | 说明 | 示例 |
|----------|------|------|
| `subscribe` | 订阅事件 | `{"type": "subscribe", "payload": {"events": [...]}}` |
| `unsubscribe` | 取消订阅 | `{"type": "unsubscribe", "payload": {"events": [...]}}` |
| `ping` | 心跳 | `{"type": "ping"}` |
| `task_create` | 创建任务 | `{"type": "task_create", "payload": {"description": "..."}}` |

---

## 3. API 端点测试

### 3.1 健康检查
```bash
curl http://localhost:3001/health
```

预期响应:
```json
{
  "status": "ok",
  "timestamp": "2026-04-03T12:00:00.000Z",
  "agents": 3,
  "uptime": 123.45
}
```

### 3.2 获取所有任务
```bash
curl http://localhost:3001/api/tasks
```

预期响应:
```json
{
  "tasks": [
    {
      "id": "task_1_1234567890",
      "description": "帮我写一个排序算法",
      "status": "completed",
      "createdAt": "2026-04-03T12:00:00.000Z"
    }
  ]
}
```

### 3.3 创建新任务
```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"description": "帮我写一个快速排序算法"}'
```

预期响应:
```json
{
  "id": "task_2_1234567890",
  "description": "帮我写一个快速排序算法",
  "status": "pending",
  "createdAt": "2026-04-03T12:00:00.000Z",
  "logs": [],
  "subTasks": [],
  "result": null
}
```

### 3.4 获取单个任务
```bash
curl http://localhost:3001/api/tasks/task_1_1234567890
```

### 3.5 更新任务状态
```bash
curl -X PUT http://localhost:3001/api/tasks/task_1_1234567890/status \
  -H "Content-Type: application/json" \
  -d '{"status": "completed", "result": "排序算法实现完成"}'
```

**有效状态转换:**
```
pending → planning → executing → reviewing → completed
                                      ↓
                                  executing (review failed, retry)
completed → pending (retry)
rejected → pending (retry)
```

### 3.6 获取任务统计
```bash
curl http://localhost:3001/api/tasks/stats/summary
```

预期响应:
```json
{
  "total": 10,
  "byStatus": {
    "pending": 2,
    "planning": 1,
    "executing": 1,
    "reviewing": 1,
    "completed": 4,
    "rejected": 1
  },
  "active": 5,
  "completed": 4,
  "rejected": 1
}
```

### 3.7 获取所有 Agent
```bash
curl http://localhost:3001/api/agents
```

预期响应:
```json
{
  "agents": [
    {"id": "planner", "name": "Planner", "status": "idle"},
    {"id": "executor", "name": "Executor", "status": "working", "currentTask": "..."},
    {"id": "reviewer", "name": "Reviewer", "status": "idle"}
  ]
}
```

---

## 4. 任务流程测试

### 4.1 完整任务流程验证清单

- [ ] **步骤 1**: POST /api/tasks 创建新任务
  - 验证返回状态为 `pending`
  - 验证 WebSocket 收到 `task:new` 消息

- [ ] **步骤 2**: 观察 Planner 自动接收任务
  - Agent 状态变为 `working`
  - 任务状态变为 `planning`
  - WebSocket 收到 `agent_status` 和 `task_update` 消息

- [ ] **步骤 3**: Planner 分解任务
  - subTasks 字段被填充
  - 任务状态变为 `executing`
  - Executor 开始工作

- [ ] **步骤 4**: Executor 调用 Codex API
  - 观察日志中的 API 调用
  - 任务状态变为 `reviewing`
  - Reviewer 开始审查

- [ ] **步骤 5**: Reviewer 验证结果
  - 审查通过: 状态变为 `completed`
  - 审查失败: 状态变为 `executing` (重试)

- [ ] **步骤 6**: 验证最终状态
  - completed 或 rejected
  - result 或 error 字段填充

### 4.2 超时检测测试

等待 5 分钟，观察:
```
[WARN] Task xxx has been in executing for over 5 minutes
```

WebSocket 应收到:
```json
{
  "type": "task_warning",
  "payload": {
    "taskId": "task_xxx",
    "message": "任务执行时间过长",
    "details": {
      "status": "executing",
      "elapsed": 300000
    }
  }
}
```

### 4.3 重试机制测试

1. 创建任务并等待完成或失败
2. 发送任务重试请求:
```bash
curl -X POST http://localhost:3001/ws \
  -d '{"type": "task_retry", "payload": {"taskId": "task_xxx"}}'
```
3. 验证任务重新进入 `pending` 状态

---

## 5. 错误场景测试

### 5.1 无效状态转换
```bash
curl -X PUT http://localhost:3001/api/tasks/task_xxx/status \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

当任务处于 `pending` 状态时，应返回:
```json
{
  "error": "Invalid state transition",
  "currentStatus": "pending",
  "requestedStatus": "completed",
  "validTransitions": ["planning"]
}
```

### 5.2 任务不存在
```bash
curl http://localhost:3001/api/tasks/nonexistent
```
响应: `404 Not Found`

### 5.3 描述为空
```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"description": ""}'
```
响应: `400 Bad Request`

---

## 6. 前端集成测试

### 6.1 WebSocket 连接验证
1. 打开浏览器开发者工具 → Network
2. 访问 http://localhost:3000
3. 观察 WebSocket 连接建立
4. 确认 "Connected" 状态显示

### 6.2 任务提交测试
1. 在任务输入框输入: "测试任务"
2. 点击提交
3. 验证:
   - 任务出现在任务列表
   - Planner Agent 状态变为 "工作中"
   - 流程图显示任务流动

### 6.3 Agent 详情面板测试
1. 点击左侧 Agent 卡片
2. 验证详情面板滑入
3. 检查日志显示正确
4. 检查状态显示正确

---

## 7. 测试命令速查

```bash
# 启动服务
cd backend && npm start &
cd frontend && npm run dev &

# WebSocket 连接
wscat -c ws://localhost:3001/ws

# API 测试
curl http://localhost:3001/health
curl http://localhost:3001/api/tasks
curl http://localhost:3001/api/agents
curl -X POST http://localhost:3001/api/tasks -H "Content-Type: application/json" -d '{"description": "测试"}'

# 清理测试数据
# 重启后端服务即可 (内存存储)
```

---

## 8. 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| WebSocket 连接失败 | 后端未启动 | 启动后端: `cd backend && npm start` |
| 任务不自动执行 | Agent 繁忙 | 等待当前任务完成 |
| API 返回 404 | 路由错误 | 检查 URL 路径是否正确 |
| 前端无法连接 | CORS 问题 | 检查后端 CORS 配置 |
| 状态不更新 | WebSocket 断开 | 检查网络连接，刷新页面 |
