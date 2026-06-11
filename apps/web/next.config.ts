import path from "node:path";
import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const assistantUiReactCompatPath = path.join(
  process.cwd(),
  "lib/agent/assistant-ui-react-compat.ts",
);
const assistantUiTapCorePathPattern =
  /[\\/]@assistant-ui[\\/]tap[\\/]dist[\\/]core$/;
const assistantUiTapDispatcherPattern =
  /[\\/]@assistant-ui[\\/]tap[\\/]dist[\\/]core[\\/]react-dispatcher\.js$/;

type NormalModuleReplacementResource = {
  context?: string;
  contextInfo?: {
    issuer?: string;
  };
  request: string;
};

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  serverExternalPackages: ["unpdf"],
  // Next.js 16 默认拒绝 dev 路由 / 资源的 cross-origin 请求 —— 从 LAN IP
  // 访问 dev server (比如手机调试 / iPhone 热点 172.20.10.x / 公司 wifi
  // 10.x.x.x) 时 RSC payload + HMR 被拦，hydration 半挂、motion 动画
  // 永远 stuck 在 initial state（hero 标题 opacity=0 看着就是黑屏）。
  // 这里只列开发常用的本机 IP；只 dev 模式生效，prod build 不受影响。
  allowedDevOrigins: [
    "172.20.10.3",
    "10.5.223.33",
  ],
  webpack(config, { webpack }) {
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^react$/, (
        resource: NormalModuleReplacementResource,
      ) => {
        const context = resource.context ?? "";
        const issuer = resource.contextInfo?.issuer ?? "";
        if (
          assistantUiTapCorePathPattern.test(context) ||
          assistantUiTapDispatcherPattern.test(issuer)
        ) {
          resource.request = assistantUiReactCompatPath;
        }
      }),
    );

    return config;
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
