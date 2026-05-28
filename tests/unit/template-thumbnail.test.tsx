import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useRef } from "react";
import { TemplateThumbnail } from "@/components/templates/template-thumbnail";
import { useFitThumbnail } from "@/components/templates/use-fit-thumbnail";

// ============================================================================
// jsdom 缺 IntersectionObserver / ResizeObserver。下面两个 mock 让我们能：
// (a) 控制懒挂载何时触发（手动 .trigger(true)），
// (b) 屏蔽 ResizeObserver 的 noop（构造时不报错就够了，本测不验证 RO 路径）。
// 不挂全局 mock 给所有测试 —— 仅本文件用 vi.stubGlobal 限定作用域。
// ============================================================================

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private cb: IntersectionObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
  root = null;
  rootMargin = "";
  thresholds = [];
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    MockIntersectionObserver.instances.push(this);
  }
  trigger(isIntersecting: boolean) {
    this.cb(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: ResizeObserverCallback) {
    void _cb;
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// TemplateThumbnail —— 懒挂载行为
// ============================================================================

describe("TemplateThumbnail", () => {
  it("默认懒挂载：在 IntersectionObserver 触发前只渲染骨架，不渲染内容", () => {
    const { container, queryByText } = render(
      <TemplateThumbnail>
        <div>real-template-content</div>
      </TemplateThumbnail>,
    );
    expect(
      container.querySelector("[data-template-thumbnail-skeleton]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-template-thumbnail-stage]"),
    ).toBeNull();
    expect(queryByText("real-template-content")).toBeNull();
  });

  it("IntersectionObserver 触发后挂载 children，骨架消失", () => {
    const { container, queryByText } = render(
      <TemplateThumbnail>
        <div>real-template-content</div>
      </TemplateThumbnail>,
    );
    const io = MockIntersectionObserver.instances[0];
    expect(io).toBeDefined();
    act(() => io.trigger(true));
    expect(
      container.querySelector("[data-template-thumbnail-skeleton]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-template-thumbnail-stage]"),
    ).not.toBeNull();
    expect(queryByText("real-template-content")).not.toBeNull();
  });

  it("挂载后 disconnect IntersectionObserver（避免后续滚动重复触发）", () => {
    render(
      <TemplateThumbnail>
        <div>x</div>
      </TemplateThumbnail>,
    );
    const io = MockIntersectionObserver.instances[0];
    act(() => io.trigger(true));
    expect(io.disconnect).toHaveBeenCalled();
  });

  it("forceMount=true 跳过懒挂载、立即渲染内容", () => {
    const { container, queryByText } = render(
      <TemplateThumbnail forceMount>
        <div>real-template-content</div>
      </TemplateThumbnail>,
    );
    expect(
      container.querySelector("[data-template-thumbnail-stage]"),
    ).not.toBeNull();
    expect(queryByText("real-template-content")).not.toBeNull();
  });

  it("lazy=false 跳过懒挂载、立即渲染内容", () => {
    const { container } = render(
      <TemplateThumbnail lazy={false}>
        <div>x</div>
      </TemplateThumbnail>,
    );
    expect(
      container.querySelector("[data-template-thumbnail-stage]"),
    ).not.toBeNull();
  });

  it("外层容器永远是 A4 比例（aspect-[210/297]）+ overflow-hidden", () => {
    const { container } = render(
      <TemplateThumbnail forceMount>
        <div>x</div>
      </TemplateThumbnail>,
    );
    const thumb = container.querySelector(
      "[data-template-thumbnail]",
    ) as HTMLElement;
    expect(thumb).not.toBeNull();
    expect(thumb.className).toContain("aspect-[210/297]");
    expect(thumb.className).toContain("overflow-hidden");
  });

  // ============================================================
  // SSR / hydration —— 必须保证 server 与 client 首次 render 输出一致，
  // 否则 React 19 直接抛 "Hydration failed because the server rendered HTML
  // didn't match the client"。canonical 修法：useState(false) 强制起始
  // 一致，翻牌挪到 useEffect（client-only）。
  // ============================================================

  it("renderToString（SSR 路径）输出 skeleton，不输出 stage", () => {
    // renderToString 不跑 useEffect，模拟真实 server render：
    // 任何 stage / 真实 children DOM 出现都会触发 hydration mismatch。
    const html = renderToString(
      <TemplateThumbnail>
        <div>real-content-must-not-leak-to-ssr</div>
      </TemplateThumbnail>,
    );
    expect(html).toContain("data-template-thumbnail-skeleton");
    expect(html).not.toContain("data-template-thumbnail-stage");
    expect(html).not.toContain("real-content-must-not-leak-to-ssr");
  });

  it("renderToString 即使 forceMount=true 也允许 stage（强制路径明确放弃懒挂载）", () => {
    // forceMount 是测试 / 立即预览（如抽屉）的逃生口，调用方明确表达
    // "不要懒"。SSR 与 CSR 首次都直接渲染 stage —— 两边都 true 仍然
    // hydration-safe（不存在 server skeleton vs client stage 的 mismatch）。
    // 这条同时确保抽屉打开时不会先闪一帧 skeleton 再翻 stage。
    const html = renderToString(
      <TemplateThumbnail forceMount>
        <div>force-mounted-content</div>
      </TemplateThumbnail>,
    );
    expect(html).toContain("data-template-thumbnail-stage");
    expect(html).toContain("force-mounted-content");
    expect(html).not.toContain("data-template-thumbnail-skeleton");
  });
});

// ============================================================================
// useFitThumbnail —— scale 计算契约
//
// jsdom 不计算布局，clientWidth / clientHeight / scrollHeight 默认全是 0。
// 通过 Object.defineProperty 在 prototype 上 mock 三个 getter，按
// dataset 区分 container vs stage 返回不同尺寸。
// ============================================================================

type DimensionMocks = {
  thumbW: number;
  thumbH: number;
  tplH: number;
};

function mockDimensions({ thumbW, thumbH, tplH }: DimensionMocks) {
  const origCW = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  const origCH = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  const origSH = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.role === "container" ? thumbW : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.role === "container" ? thumbH : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.role === "stage" ? tplH : 0;
    },
  });
  return () => {
    if (origCW)
      Object.defineProperty(HTMLElement.prototype, "clientWidth", origCW);
    if (origCH)
      Object.defineProperty(HTMLElement.prototype, "clientHeight", origCH);
    if (origSH)
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", origSH);
  };
}

function FitHarness({ baseWidth = 595 }: { baseWidth?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fit = useFitThumbnail({
    containerRef,
    stageRef,
    enabled: true,
    baseWidth,
  });
  return (
    <>
      <div ref={containerRef} data-role="container" />
      <div ref={stageRef} data-role="stage" />
      <div data-testid="result">
        scale={fit.scale.toFixed(4)};offsetX={fit.offsetX.toFixed(2)}
      </div>
    </>
  );
}

describe("useFitThumbnail", () => {
  it("内容短：scale 由宽度收敛（thumbW / baseWidth）", () => {
    // baseWidth=595, thumbW=200 → width-scale = 200/595 ≈ 0.3361
    // thumbH=283, tplH=500 → height-scale = 283/500 = 0.566
    // min = 0.3361 (width-bound)
    const restore = mockDimensions({ thumbW: 200, thumbH: 283, tplH: 500 });
    try {
      const { getByTestId } = render(<FitHarness />);
      const text = getByTestId("result").textContent ?? "";
      expect(text).toContain("scale=0.3361");
    } finally {
      restore();
    }
  });

  it("内容长：scale 由高度收敛（thumbH / tplH）", () => {
    // baseWidth=595, thumbW=200 → width-scale ≈ 0.3361
    // thumbH=283, tplH=1500 → height-scale ≈ 0.1887
    // min = 0.1887 (height-bound)
    const restore = mockDimensions({ thumbW: 200, thumbH: 283, tplH: 1500 });
    try {
      const { getByTestId } = render(<FitHarness />);
      const text = getByTestId("result").textContent ?? "";
      expect(text).toContain("scale=0.1887");
    } finally {
      restore();
    }
  });

  it("宽度收敛时 offsetX≈0（stage 撑满 thumb 宽度）", () => {
    // width-bound: 595 * (200/595) ≈ 200 → (200-200)/2 ≈ 0（浮点误差可能渲为 -0.00）
    const restore = mockDimensions({ thumbW: 200, thumbH: 283, tplH: 500 });
    try {
      const { getByTestId } = render(<FitHarness />);
      const text = getByTestId("result").textContent ?? "";
      expect(text).toMatch(/offsetX=-?0\.00/);
    } finally {
      restore();
    }
  });

  it("高度收敛时 offsetX 居中 stage", () => {
    // height-bound: 595*0.1887 ≈ 112.27 → (200-112.27)/2 ≈ 43.87
    const restore = mockDimensions({ thumbW: 200, thumbH: 283, tplH: 1500 });
    try {
      const { getByTestId } = render(<FitHarness />);
      const text = getByTestId("result").textContent ?? "";
      // 容差到 0.1px：jsdom 的浮点精度不变，但写死到 4 位会随 baseWidth 变化时易碎
      expect(text).toMatch(/offsetX=43\.\d/);
    } finally {
      restore();
    }
  });

  it("自定义 baseWidth 影响 scale", () => {
    // baseWidth=1000, thumbW=200 → width-scale = 0.2
    // thumbH=283, tplH=500 → height-scale = 0.566
    // min = 0.2
    const restore = mockDimensions({ thumbW: 200, thumbH: 283, tplH: 500 });
    try {
      const { getByTestId } = render(<FitHarness baseWidth={1000} />);
      const text = getByTestId("result").textContent ?? "";
      expect(text).toContain("scale=0.2000");
    } finally {
      restore();
    }
  });

  it("尺寸为 0 时返回初始 scale=0（避免 NaN / Infinity）", () => {
    const restore = mockDimensions({ thumbW: 0, thumbH: 0, tplH: 0 });
    try {
      const { getByTestId } = render(<FitHarness />);
      const text = getByTestId("result").textContent ?? "";
      // 初始 state 是 {scale:0, offsetX:0}，零尺寸下 measure() 提前 return
      expect(text).toContain("scale=0.0000");
      expect(text).toContain("offsetX=0.00");
    } finally {
      restore();
    }
  });
});
