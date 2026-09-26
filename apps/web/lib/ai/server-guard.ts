/**
 * 服务端运行时守卫。
 *
 * 判据刻意用 `process.versions.node` 而**不**用 `window`：jsdom 也提供 `window`，
 * 用它会误杀所有跑在 jsdom 里的单测（那些测试是合法的服务端调用）。
 * jsdom 运行在 Node 上因此通过；真实浏览器没有 `process.versions.node`。
 *
 * 这是弱于打包器的一层防线：主要拦截仍由 Next.js 负责（本目录依赖 `@/db`，
 * 被客户端组件引用时 `next build` 会直接失败）。守卫的价值是让误用在一个明确的
 * 位置炸掉，而不是等到某次写入才暴露。
 */
export function assertServerRuntime(moduleName = "lib/ai"): void {
  const nodeVersion = (globalThis as { process?: { versions?: { node?: string } } }).process
    ?.versions?.node;
  if (!nodeVersion) {
    throw new Error(
      `${moduleName} 只能在服务端使用：它持有数据库写入路径，不得进入客户端 bundle。`,
    );
  }
}
