/**
 * 测试旧语法 data-bind 是否正常工作
 */
import { SlotRenderer } from '@/lib/templates/uploaded/html-slot-renderer';
import { render } from '@testing-library/react';
import type { ResumeContent } from '@/lib/resume-schema';

const mockContent: ResumeContent = {
  basics: {
    name: '张三',
    title: '软件工程师',
    email: 'zhangsan@example.com',
    phone: '138-0000-0000',
    location: '北京',
    photo: '',
    website: '',
    status: '在职',
  },
  sectionOrder: [],
};

const mockStyleSettings = {
  fontFamily: 'sans' as const,
  fontSize: 13,
  bodyLineHeight: 1.6,
  lineHeight: 1.6,
  headingGap: 8,
  pagePadding: 40,
  sectionGap: 16,
  itemGap: 12,
  photoScale: 1,
};

describe('旧语法 data-bind 兼容性', () => {
  it('应该渲染 <h1 data-bind="basics.name">', () => {
    const html = '<h1 data-bind="basics.name" class="pro-name"></h1>';

    const { container } = render(
      <SlotRenderer
        html={html}
        css={null}
        content={mockContent}
        styleSettings={mockStyleSettings}
        templateId="test"
      />
    );

    const h1 = container.querySelector('h1.pro-name');
    expect(h1).toBeTruthy();
    expect(h1?.textContent).toBe('张三');
  });

  it('应该保留元素的 class 属性', () => {
    const html = '<h1 data-bind="basics.name" class="my-custom-class"></h1>';

    const { container } = render(
      <SlotRenderer
        html={html}
        css={null}
        content={mockContent}
        styleSettings={mockStyleSettings}
        templateId="test"
      />
    );

    const h1 = container.querySelector('h1.my-custom-class');
    expect(h1).toBeTruthy();
  });

  it('新旧语法应该产生相同的结果', () => {
    const oldSyntax = '<h1 data-bind="basics.name"></h1>';
    const newSyntax = '<h1><slot data-bind="basics.name"></slot></h1>';

    const { container: oldContainer } = render(
      <SlotRenderer
        html={oldSyntax}
        css={null}
        content={mockContent}
        styleSettings={mockStyleSettings}
        templateId="test-old"
      />
    );

    const { container: newContainer } = render(
      <SlotRenderer
        html={newSyntax}
        css={null}
        content={mockContent}
        styleSettings={mockStyleSettings}
        templateId="test-new"
      />
    );

    const oldH1 = oldContainer.querySelector('h1');
    const newH1 = newContainer.querySelector('h1');

    expect(oldH1?.textContent).toBe(newH1?.textContent);
    expect(oldH1?.textContent).toBe('张三');
  });
});
