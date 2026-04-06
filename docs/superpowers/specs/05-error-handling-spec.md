# 错误处理设计文档

## 1. 概述
本文档定义系统各层次的错误处理策略、用户反馈机制和恢复流程。

## 2. 错误分类

### 2.1 错误层级
```
┌─────────────────────────────────────────────┐
│              用户层错误                      │
│  (输入验证、用户操作、UI状态)                │
├─────────────────────────────────────────────┤
│              应用层错误                      │
│  (任务管理、Agent调度、业务逻辑)             │
├─────────────────────────────────────────────┤
│              服务层错误                      │
│  (API调用、WebSocket、外部服务)              │
├─────────────────────────────────────────────┤
│              系统层错误                      │
│  (网络、内存、进程崩溃)                      │
└─────────────────────────────────────────────┘
```

### 2.2 错误代码体系
```typescript
const ERROR_CODES = {
  // 用户层 (1xxx)
  USER_INPUT_EMPTY: 1001,
  USER_INPUT_TOO_LONG: 1002,

  // 应用层 (2xxx)
  TASK_CREATE_FAILED: 2001,
  TASK_NOT_FOUND: 2002,
  AGENT_NOT_FOUND: 2003,
  TASK_CANCEL_FAILED: 2004,

  // 服务层 (3xxx)
  CODEX_API_ERROR: 3001,
  CODEX_API_TIMEOUT: 3002,
  WS_CONNECTION_FAILED: 3003,
  WS_MESSAGE_SEND_FAILED: 3004,

  // 系统层 (5xxx)
  NETWORK_UNAVAILABLE: 5001,
  MEMORY_OVERFLOW: 5002,
  PROCESS_CRASH: 5003
};
```

## 3. 错误处理策略

### 3.1 用户层错误处理
| 错误 | 处理方式 | 用户反馈 |
|------|----------|----------|
| 输入为空 | 禁用提交按钮 | 输入框下方红色提示 |
| 输入过长 | 字符计数警告 | 实时显示剩余字数 |
| 重复提交 | 防抖处理 | 按钮显示 loading |

### 3.2 应用层错误处理
| 错误 | 处理方式 | 用户反馈 |
|------|----------|----------|
| 任务创建失败 | 重试 2 次 | Toast "创建任务失败，请重试" |
| 任务未找到 | 显示空状态 | 弹窗 "任务不存在或已删除" |
| Agent 无响应 | 5分钟超时检测 | 节点显示警告状态 |

### 3.3 服务层错误处理
| 错误 | 处理方式 | 用户反馈 |
|------|----------|----------|
| Codex API 错误 | 指数退避重试 (3次) | Toast "AI 服务繁忙，请稍后" |
| API 超时 | 显示超时提示 | Toast "请求超时，请检查网络" |
| WS 断开 | 自动重连 | 顶部横幅 "连接断开，正在重连..." |
| WS 重连失败 | 提示手动刷新 | 横幅显示 "无法连接，点击刷新" |

### 3.4 系统层错误处理
| 错误 | 处理方式 | 用户反馈 |
|------|----------|----------|
| 网络断开 | 离线检测 | 全屏提示 "无网络连接" |
| 内存不足 | 清理缓存 | Toast "内存不足，已清理" |
| 页面崩溃 | 错误边界恢复 | 局部刷新提示 |

## 4. 重试机制

### 4.1 重试策略配置
```typescript
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000,      // 1秒
  maxDelay: 10000,      // 10秒
  backoffMultiplier: 2, // 指数退避
  jitter: true           // 添加随机抖动
};

// 重试间隔: 1s, 2s, 4s (有抖动)
```

### 4.2 重试决策树
```
任务失败
    │
    ▼
还有重试次数?
    │
    ├── 否 → 标记失败，通知用户
    │
    └── 是
        │
        ▼
    符合重试条件?
    (网络错误 / 超时 / 服务端错误)
        │
        ├── 否 → 标记失败，通知用户
        │
        └── 是
            │
            ▼
        执行重试
            │
            ▼
        重试成功? ──► 继续执行
            │
            └── 否 → 返回 "还有重试次数?" 循环
```

## 5. 用户反馈机制

### 5.1 Toast 通知
- **位置**: 页面右下角
- **持续时间**: 3秒（成功）/ 5秒（警告）/ 不关闭（错误）
- **最大数量**: 3个（超出时队列）

### 5.2 错误提示样式
```typescript
const errorStyles = {
  critical: {
    background: '#ef4444',
    icon: '🚨',
    action: '刷新页面'
  },
  warning: {
    background: '#eab308',
    icon: '⚠️',
    action: '重试'
  },
  info: {
    background: '#3b82f6',
    icon: 'ℹ️',
    action: null
  }
};
```

### 5.3 全局错误边界
```typescript
// React Error Boundary
class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

## 6. 日志记录

### 6.1 日志级别
| 级别 | 使用场景 | 颜色 |
|------|----------|------|
| debug | 开发调试 | 灰色 |
| info | 正常流程 | 蓝色 |
| warning | 异常但不阻断 | 黄色 |
| error | 错误需处理 | 红色 |

### 6.2 日志格式
```typescript
interface LogEntry {
  id: string;
  timestamp: string;        // ISO 8601
  level: 'debug' | 'info' | 'warning' | 'error';
  source: 'frontend' | 'backend';
  category: string;         // 'api' | 'ws' | 'agent' | 'task'
  message: string;
  context?: {
    userId?: string;
    taskId?: string;
    agentId?: string;
    errorCode?: number;
    stack?: string;
    metadata?: Record<string, any>;
  };
}
```

### 6.3 日志存储
- **前端**: console + localStorage (最多 500 条)
- **后端**: 文件 + 内存 (最多 1000 条)
- **导出**: 支持 JSON 格式导出

## 7. 监控告警

### 7.1 告警条件
| 指标 | 阈值 | 告警级别 |
|------|------|----------|
| 错误率 | > 5% / 5分钟 | 警告 |
| API 响应时间 | > 3秒 | 警告 |
| WS 断开次数 | > 3次 / 分钟 | 警告 |
| Agent 错误数 | > 5次 / 10分钟 | 严重 |

### 7.2 告警通知
- 开发者控制台日志
- 页面顶部横幅（用户可见）
- 可选：WebHook 通知

## 8. 恢复流程

### 8.1 Agent 错误恢复
```
Agent 处于错误状态
        │
        ▼
检查错误类型
        │
        ├── 可重试错误 ──► 自动重试 (最多2次)
        │                      │
        │                      ├── 成功 ──► 恢复正常
        │                      └── 失败 ──► 进入待手动处理
        │
        └── 不可重试错误 ──► 通知用户，等待手动处理
```

### 8.2 连接恢复
```
WebSocket 断开
        │
        ▼
自动重连 (指数退避)
        │
        ├── 成功 ──► 同步最新状态 ──► 继续
        │
        └── 失败 (5次) ──► 显示重连按钮
                              │
                              ├── 用户点击 ──► 立即重连
                              │
                              └── 超时 (5分钟) ──► 提示刷新页面
```

## 9. 错误恢复状态展示
当 Agent 从错误状态恢复时，界面上显示恢复提示：
```
🟢 Agent 已恢复正常
   └─ 任务 "排序算法" 已自动重试成功
   [ 查看结果 ]
```