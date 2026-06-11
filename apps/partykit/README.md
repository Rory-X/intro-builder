# PartyKit WebSocket 协同服务

## 职责

本应用提供基于 WebSocket 的实时协同编辑服务，为 intro-builder 简历编辑器提供多用户协作能力。

### 核心功能

- **Y.js 文档同步**：使用 y-partykit 实现 CRDT 文档协同
- **用户在线状态**：广播用户连接/断开事件
- **WebRTC 语音信令**：中继语音通话的 SDP 和 ICE 候选
- **JWT 认证**（待修复）：验证用户身份和角色

### 技术栈

- PartyKit：WebSocket 服务器框架
- y-partykit：Y.js CRDT 协同库
- jose：JWT 验证（计划）

## 开发

```bash
# 安装依赖
pnpm install

# 本地开发（启动 PartyKit dev server）
pnpm dev

# 类型检查
pnpm typecheck

# 部署到 PartyKit 云
pnpm deploy
```

## 架构

- `src/server.ts`：主服务器类，实现 Party.Server 接口
- 每个简历编辑会话对应一个独立的 room
- 连接时接收 JWT token 参数（URL query）
- 维护连接元数据（userId、displayName、role、color）

## 注意事项

- 当前 JWT 验证已临时禁用（环境变量配置问题待解决）
- 仅解码 payload 用于显示名称，不验证签名
- 生产环境需重新启用完整的 JWT 验证流程
