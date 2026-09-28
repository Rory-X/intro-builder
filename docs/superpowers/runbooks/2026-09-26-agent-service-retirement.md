# Agent 微服务退役手册

日期：2026-09-26。**当前状态：2026-09-28 生产已切到合并提交，但停容器、删网络、删卷、停 workflow 都没有执行。**
执行前置：[P07 切流归档](../plans/2026-09-26-nextjs-agent-07-cutover-archive.md)完成且新 Next.js 生产能力验证通过。
生产 deployment 已是合并提交 `0ad45bb6517b`（PR #155）。还没满足的是第 2 节里的登录态生产冒烟，以及可观察的旧请求排空。Caddy 标准输出没有 HTTP 访问日志，不能把「没有访问记录」当成已排空。

## 1. 已核实的资源与范围

| 项 | 2026-09-26 只读结果 |
| --- | --- |
| 本机 SSH alias | `ucloud-memos`，已有本机密钥配置，可 BatchMode 连接 |
| Compose project / directory | `agent` / `/opt/intro-agent/apps/agent` |
| 主服务容器 | `agent-agent-1`，镜像 `ghcr.io/rory-x/intro-builder/agent:github-d85720b040bf` |
| Redis 容器 | `agent-redis-1`，`redis:8-alpine`，挂载 `agent_redis_data` |
| 反代容器 | `agent-caddy-1`，`caddy:2-alpine`，绑定主机 80/443 |
| 反代文件 | `/opt/intro-agent/apps/agent/Caddyfile`，当次文件仅代理 Agent 路径 |
| 保留卷 | `agent_redis_data`、`agent_caddy_data`、`agent_caddy_config` |
| 网络 | `agent_default`，**实际有多个无关业务连接**，必须保留 |
| GitHub | `Rory-X/intro-builder`，Deploy Agent ID `290746404`，当次 active |
| 旧公开路径 | `https://api.rory-x.me/intro-builder/agent` |

当次同网络还出现 deeix、metapi、sub2api、memos、liveagent、mewmo 等容器。容器名中有 agent 或 redis 并不能说明属于本项目。

## 1.1 2026-09-28 只读复核

下面的容器 ID 只属于这一次记录。下一次真要停之前必须重新 `docker inspect`，不能拿这些 ID 直接 `stop`/`rm`。

| 项 | 结果 |
| --- | --- |
| `agent-agent-1` | `f9fb41a44299`，`ghcr.io/rory-x/intro-builder/agent:github-8859bfc56a34`，running，`unless-stopped`，project `agent`，workdir `/opt/intro-agent/apps/agent`，无挂载 |
| `agent-redis-1` | `b154ffee0ff1`，`redis:8-alpine`，running，卷 `agent_redis_data` → `/data` |
| `agent-caddy-1` | `131f9f570b4c`，`caddy:2-alpine`，running，主机发布 80/443；挂载本地 `Caddyfile` 与卷 `agent_caddy_data`、`agent_caddy_config` |
| 已加载的 HTTP 路由 | 只有一条：`api.rory-x.me` 的 `/intro-builder/agent` 与 `/intro-builder/agent/*` → `agent:8787`，监听 `:443` |
| 公开探测 | `HEAD https://api.rory-x.me/intro-builder/agent` 返回 HTTP 404，响应头 `via: 1.1 Caddy`，服务仍在 |
| `agent_default` | 仍在。上面还接着 metapi、sub2api、deeix-chat-app、liveagent-gateway、mewmo-agent-agent-1、memos-memos-1 等，不能删 |
| 三个命名卷 | `agent_redis_data`、`agent_caddy_data`、`agent_caddy_config` 都还在 |
| Deploy Agent workflow `290746404` | GitHub 返回 `state: deleted`（源码已移出 `.github/workflows`）。没有再执行 disable，也没有取消其他 workflow |
| 生产 Web | GitHub Production deployment `6682074846`，sha `199928ec39cb`，与 `origin/main` 一致。该提交的 `direct-runs` 仍 `signAgentToken` 并返回 `streamUrl` |

上面这一次不停，是因为当时生产 Web 还在走旧桥。

## 1.2 2026-09-28 合并之后

PR #155 已合并。GitHub Production deployment `6704188483`，sha `0ad45bb6517b`，状态 success，时间 `2026-09-28T06:57:11Z`。`https://intro-builder.rory-x.me` 与 `https://intro-builder.vercel.app` 都返回 Next.js，`x-vercel-cache: MISS`。未登录 `POST /api/agent/direct-runs` 在 `intro-builder.vercel.app` 返回 401 `{error:未登录}`，响应里没有 `streamUrl`。旧路由在签发 JWT 之前也是这个 401，所以这一下不能证明线上进程已经是新代码；能证明的是 GitHub 把该 sha 标成了 Production success。

合并后再次 `docker inspect`，三个容器 ID 与 1.1 相同，仍是 running。`agent_default` 上的其他业务还在。近 24 小时 `agent-caddy-1` 标准输出 13 行，全是证书续期和本次只读的 admin API `GET /config`，没有 HTTP 访问日志。`agent-agent-1` 标准输出 24 小时为 0 行，说明它本来就不把请求打到标准输出。因此**不能**据此声称旧请求已排空。

这次仍然不停容器。缺的是登录态下的聊天、润色、诊断、模块建议、模型连接和留痕，以及一份看得见的排空记录。

本授权范围：退役本项目微服务线上入口、部署路线和以上经实时重核的专属容器。明确不包含：删除服务器、清空 Docker、删除共享网络、删除 Redis/Caddy 卷、删除数据库、撤销其他项目共用的 SSH 凭证或域名。

## 2. 执行前证据清单

- [x] P07 新 production deployment/commit 已确认；预览成功不能替代生产。2026-09-28：deployment `6704188483`，sha `0ad45bb6517b`，Production success。其余未勾选项仍然挡住停容器。
- [ ] 在不配置旧服务地址的环境验证聊天、润色、诊断、模块建议、模型连接、留痕。
- [ ] 生产关键路径同样通过；无微服务 fallback。
- [ ] 新文档提交可以幂等重试、拦截冲突，旧标签页无法继续无 revision 写入。
- [ ] 新模型配置已在 Web 生效；若旧服务持有唯一默认 key，先迁移，禁止先删。
- [x] 原始代码和退役前版本归档清单/hash 已验证。2026-09-28 `archive:agent:verify --check`：清单 76 条，与基线 `050d5bb5e` 一致。
- [x] 明确旧 Redis 会话的保留策略：默认保留专属卷，不删除数据；需要转储时在受控目录加密存放，不回传到聊天或 Git。2026-09-28 三卷仍在，没有转储，也没有删除。
- [x] 检查 Caddy **实际加载配置**和共享依赖，不仅看挂载文件；若其他业务经过它，先拆分该依赖。2026-09-28 已加载配置只有 `api.rory-x.me` 的 `/intro-builder/agent` → `agent:8787`。共享的是 Docker 网络 `agent_default`，不是这条反代。网络不删。
- [ ] 没有进行中的旧请求；无法核实就先停新流量、观察并排空，不直接称已排空。

这些是已有用户清理授权的执行条件，不要求每项再次征求许可。遇到归属不明或超出这三容器的资源，再说明具体证据和扩大范围的原因。

## 3. 只读盘点命令

以下命令可在退役前再次执行；不输出完整 env 或 docker inspect 原始 JSON。

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ConnectTimeout=10 ucloud-memos \
  'docker ps -a --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Label \"com.docker.compose.service\"}}"'

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no ucloud-memos \
  'docker inspect agent-agent-1 agent-redis-1 agent-caddy-1 --format "name={{.Name}} workdir={{index .Config.Labels \"com.docker.compose.project.working_dir\"}} config={{index .Config.Labels \"com.docker.compose.project.config_files\"}} mounts={{range .Mounts}}{{.Type}}:{{.Source}}=>{{.Destination}};{{end}} ports={{json .NetworkSettings.Ports}}"'

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no ucloud-memos \
  'docker network inspect agent_default --format "{{range .Containers}}{{.Name}} {{end}}"'

gh workflow list --repo Rory-X/intro-builder --all
gh run list --repo Rory-X/intro-builder --workflow deploy-agent.yml --limit 20 \
  --json databaseId,status,conclusion,headSha
```

容器 ID 只作本次记录，不能沿用九月盘点 ID。不要使用 `docker compose config` 直接打印可能展开的 env；不要 `cat .env`、读取私钥或将 key 加在命令参数里。

当前 Caddyfile 已只读核实为 Agent-only，但实际运行可被管理 API 动态修改，所以退役前还需检查实际 host/path/upstream 的脱敏摘要。只有该实例确实不服务其他业务，才能停止 caddy。

## 4. 阻断自动重新部署

以下为变更命令，只有前置条件齐全才执行：

```bash
gh workflow disable 290746404 --repo Rory-X/intro-builder
```

若 ID 已变，以 `gh workflow list` 核实出的 Deploy Agent 为准。对前节查询到该 workflow 的 queued/in_progress 任务逐个核对后执行 `gh run cancel <已核实的运行ID> --repo Rory-X/intro-builder`，不按所有 workflow 批量取消。

随后确认 main 中 `.github/workflows/deploy-agent.yml` 已移到归档；仅停用 workflow 不等于代码入口已移除。保留 PartyKit、CI、CodeQL、Verify Agent Notes。

## 5. 精确停止和移除容器

禁止：`docker compose down`、`down -v`、`docker system prune`、`docker volume prune`、`docker network rm agent_default`、以 `grep agent` 匹配后批量删除。

下列脚本**不是当前已执行记录**。前置条件全部确认后才运行。它先核验全部目标，再按捕获的精确 ID 操作，避免名称重用竞争。标签、镜像或目录不符即停止，不改成宽松匹配。

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no ucloud-memos 'bash -s' <<'REMOTE'
set -euo pipefail
declare -A target_ids
for service in agent redis caddy; do
  container_name="agent-${service}-1"
  target_id=$(docker inspect --format '{{.Id}}' "$container_name")
  project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$target_id")
  actual_service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$target_id")
  workdir=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$target_id")
  image_name=$(docker inspect --format '{{.Config.Image}}' "$target_id")
  test "$project" = agent
  test "$actual_service" = "$service"
  test "$workdir" = /opt/intro-agent/apps/agent
  case "$service:$image_name" in
    agent:ghcr.io/rory-x/intro-builder/agent:*|redis:redis:8-alpine|caddy:caddy:2-alpine) ;;
    *) echo "Unexpected image for $container_name; stop for inspection" >&2; exit 1 ;;
  esac
  target_ids[$service]="$target_id"
done

# 新流量已切走、旧任务已排空，先停止执行器，再停止专属缓存与反代。
for service in agent redis caddy; do
  target_id=${target_ids[$service]}
  docker stop --time 30 "$target_id"
  docker rm "$target_id"
done

docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Status}}'
docker network inspect agent_default --format '{{range .Containers}}{{.Name}} {{end}}'
docker volume inspect agent_redis_data agent_caddy_data agent_caddy_config --format '{{.Name}}'
REMOTE
```

脚本不含 force、不移除网络或卷。中途失败时记录哪个 ID 已移除；重试前先只读盘点剩余目标，不用 rm -f 或广泛 down「清残局」。不卸载主机 Docker。

## 6. 配置与凭据引用的退役

GitHub 当次查询到的专属变量名称：AGENT_CORS_ORIGINS、AGENT_DEPLOY_PATH、AGENT_DOMAIN、AGENT_LOOP_ENABLED、AGENT_MODEL_NAME、AGENT_MODEL_TIMEOUT_MS、AGENT_PUBLIC_BASE_PATH。

当次专属候选 secret 名称：AGENT_DATABASE_URL、AGENT_JWT_SECRET、AGENT_MODEL_API_KEY、AGENT_MODEL_BASE_URL、AGENT_SSH_HOST、AGENT_SSH_KEY、AGENT_SSH_KNOWN_HOSTS、AGENT_SSH_PORT、AGENT_SSH_USER。**只读取了名称，未读取值。** PARTYKIT_LOGIN、PARTYKIT_TOKEN 必须保留。

处理顺序：

1. 用 repo 引用搜索和实际平台配置确认每个键只供旧路线使用。
2. provider 设置若仍被新 Web 使用，先安全配置新的 Web-only 名称并验证；不从本地输出复制密钥到文档。
3. 移除确认专属的 GitHub 变量/secret 名称及 Vercel 上旧 Agent URL/JWT 配置；逐个记录名称和结果。删除变量不等于撤销 provider 账号或销毁数据库。
4. `AGENT_DATABASE_URL` 可能来自历史实现，查清归属后只处理这个 secret，不删除实际数据库。
5. SSH key 若多项目共用，不撤销本机凭证或服务器 authorized_keys；只移除本项目 GitHub 引用。
6. 旧域名是共享域名时只撤销 Agent 路径，不删整个 DNS record。实际管理权限未核实；无法操作控制面时记录剩余项，不冒充完成。

移除已核实专属键的命令形式：

```bash
gh variable delete AGENT_PUBLIC_BASE_PATH --repo Rory-X/intro-builder
# 其他名称逐项核对后执行，不用 wildcard 批量删除。
```

Vercel 侧当前未核查到可用 CLI/项目权限，执行时可使用已登录平台界面或既有官方 API；不新建项目、不安装插件绕过权限。只查看名称与配置用途，不把 secret 值写入终端。

## 7. 完成证据与保留数据

- [ ] 精确三个容器不存在；旧服务无法因 restart policy 再次启动。
- [ ] GitHub workflow disabled/不存在活跃部署入口，没有待执行任务。
- [ ] 无关容器的 ID 与运行状态跟退役前一致，必要服务独立 health 通过。
- [ ] agent_default 仍存在，其无关连接完整。
- [ ] 三个命名卷仍存在，服务器受控配置与恢复所需镜像 digest 已保留。
- [ ] 新生产聊天、润色、Helpers、保存/历史/撤销都通过。
- [ ] 旧路径不再返回旧 Agent 业务结果；仅网络请求失败不足以证明全部入口已移除，还要核对引用与路由。
- [ ] 归档 manifest 校验和退役记录都已落地。
- [ ] 旧专属配置已处理，或逐项列出缺少控制面权限导致的剩余项。

数据卷与镜像清理不自动追加到本次操作。保留意味着未释放全部磁盘空间，这是有意边界；需要删除卷/旧数据时另定保留期与授权。

## 8. 恢复条件

遇到新系统故障优先关闭 AI 写入并维持手动编辑。恢复旧微服务必须先确认其 writer 不会破坏稳定 ID/revision；禁止把旧前端整个回滚覆盖新契约。

确需临时恢复时使用退役前镜像 digest、保留卷和受控环境配置，仅启动目标容器；不恢复 GitHub 自动部署，不重新创建共享网络。恢复路径不能从源码归档直接执行未经审阅的历史 workflow。

退役记录建议位置：归档根 `RETIREMENT.md`，写实际时间、生产 commit、验证结果、保留资源和操作失败项。不要预先填写 succeeded。
