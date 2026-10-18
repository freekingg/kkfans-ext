import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FollowerDataSummary, summarizeFollowerData } from './FollowerDataSummary';

afterEach(() => cleanup());

describe('粉丝数据摘要', () => {
  it('把常见 Instagram 数据转换成固定顺序的中文指标', () => {
    expect(summarizeFollowerData('4,240 posts\n21.8K followers\n747 following')).toEqual({
      kind: 'metrics',
      metrics: [
        { key: 'posts', label: '帖子', value: '4,240' },
        { key: 'followers', label: '粉丝', value: '21.8K' },
        { key: 'following', label: '关注', value: '747' },
      ],
    });
  });

  it('兼容西班牙语指标名称', () => {
    render(<FollowerDataSummary value={'120 publicaciones\n20K seguidores\n354 seguidos'} />);
    expect(screen.getByLabelText('粉丝数据摘要')).toHaveTextContent('帖子120粉丝20K关注354');
  });

  it('非标准内容只展示前两行并保留完整悬停内容', () => {
    const value = '重点博主\n互动率较高\n第三行不直接展示';
    render(<FollowerDataSummary value={value} />);
    const summary = screen.getByLabelText('粉丝数据摘要');
    expect(summary).toHaveTextContent('重点博主 互动率较高');
    expect(summary).not.toHaveTextContent('第三行不直接展示');
    expect(summary).toHaveAttribute('title', value);
  });

  it('空内容不占用页面空间', () => {
    const { container } = render(<FollowerDataSummary value={'  \n '} />);
    expect(container).toBeEmptyDOMElement();
  });
});
