# P08：Agent 线上服务与部署路线退役

状态：未开始。依赖 P07 的生产完成证据；详细命令见[退役手册](../runbooks/2026-09-26-agent-service-retirement.md)。

2026-09-28：panel 的 `/api/agent/direct-runs` 在分支 `codex/panel-uses-nextjs-run`（`23ac628c5`）里不再签发 JWT、不再把流指向独立服务。这只去掉了代码依赖。生产部署仍是 `199928ec39cb`，该提交仍会签 JWT。同日只读复核见[退役手册](../runbooks/2026-09-26-agent-service-retirement.md)：三个专属容器仍在跑，`agent_default` 仍挂着其他业务，三个命名卷仍在。**没有停容器，没有删网络，没有删卷。**

用户已经明确要求后续通过本机 SSH 清理相关服务容器。此计划记录授权范围和执行条件，不把清理扩大为删除服务器、Docker、共享网络、数据库或数据卷。

## 任务

1. **核验切流证据。** production commit 与 P07 合并结果一致；所有 AI 入口不依赖旧服务；版本/批准/取消/恢复通过。生产权限或证据缺失时不执行 teardown。
2. **阻断重新部署。** 核查 GitHub `Deploy Agent` workflow 的当前 ID/状态，停用并取消仅该 workflow 的待执行任务；新 main 已无活跃 deploy-agent YAML。不要取消 PartyKit 或其他部署。
3. **重新盘点与备份。** 通过本机 `ucloud-memos` 只读核对容器标签、工作目录、镜像 digest、mounts、网络、当前反代；记录基线。按手册保留 Redis/Caddy 卷和服务器配置的受控副本，不把 .env 内容带回 Git。
4. **排空旧任务。** 不再接受新的微服务流量，检查活跃请求/日志仅输出统计；完成或明确中断剩余任务并记录。不能把运行中的聊天直接当作可以无痕丢弃的数据。
5. **逐个停止并移除目标容器。** 仅对重新核验后的 agent-agent-1、agent-redis-1、agent-caddy-1 执行精确 stop/rm；不删 network/volumes，不运行 compose down/prune。若配置显示 Caddy 被其他业务复用，先拆分路由再退役，不能强删。
6. **处理专属配置。** 清除仍可触发旧服务的 Web URL/JWT 开关、GitHub 专属 secrets/vars 引用与部署计划；provider key 若迁移使用先确认 Web 配置成功。AGENT_DATABASE_URL 只移除专属变量，不删除所指数据库；共享 SSH key/域名需保留。
7. **核查结果并记录。** 三个目标容器不存在，其他基线容器仍在、共享网络/卷仍在；新聊天/润色/Helpers/保存可用；旧路径无旧 Agent handler；自动部署不会复活。归档目录追加退役记录，记录保留数据与恢复条件，不记录密钥。

## 本轮未做的操作

这份文档创建时仅执行只读 `docker ps/inspect/network inspect`、读取已知 Caddyfile、GitHub workflow/变量名清单。没有停容器或 workflow。执行者必须以实时盘点重核，不能按文档中曾出现的容器 ID 直接删除。

## 验收交付

一份脱敏退役记录：时间、操作者、主机 alias、production commit、workflow 状态、三容器操作前后状态、其他容器差异、保留 volumes/network、旧路径响应、新能力冒烟、回滚条件。需要恢复时只做受控临时恢复，不能重启永久 Agent 部署路线。
