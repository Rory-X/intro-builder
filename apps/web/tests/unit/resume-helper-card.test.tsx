import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResumeHelperCard } from "@/components/agent/resume-helper-card";

describe("ResumeHelperCard", () => {
  it("renders a structured suggestion without an apply button", () => {
    render(
      <ResumeHelperCard
        suggestion={{
          id: "sug_experience_result",
          section: "experience",
          fieldPath: "experience",
          severity: "high",
          title: "为工作经历补充可验证结果",
          rationale: "当前经历描述了动作，但没有说明产出或影响。",
          actionLabel: "补充结果",
          example: "如果原文已有真实数据，可以补充加载速度、转化率或交付周期变化。",
          riskFlags: [
            {
              type: "needs_user_fact",
              message: "结果数据必须由用户提供。",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("为工作经历补充可验证结果")).toBeInTheDocument();
    expect(screen.getByText("当前经历描述了动作，但没有说明产出或影响。")).toBeInTheDocument();
    expect(screen.getByText("结果数据必须由用户提供。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /应用/ })).not.toBeInTheDocument();
  });
});
