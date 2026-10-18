import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CooperationProfileView } from './CooperationProfileView';

describe('合作资料', () => {
  afterEach(cleanup);
  it('shows message-based dates and clearly marks incomplete history', () => {
    render(<CooperationProfileView conversationId="chat-1" conversationTitle="Creator"
      createdAt={null} lastMessageAt={null} operatorName="king" ownWhatsapp="+521234567890"
      note="" profile={null} suggestions={{}} onSave={vi.fn()} />);
    expect(screen.getByText('创建时间（首条消息）')).toBeInTheDocument();
    expect(screen.getByText('更新时间（最新消息）')).toBeInTheDocument();
    expect(screen.getAllByText('未知')).toHaveLength(2);
    expect(screen.getByText(/首聊待确认/)).toBeInTheDocument();
    expect(screen.queryByText('系统创建时间')).not.toBeInTheDocument();
  });
  it('支持选择、保存和清空添加来源', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CooperationProfileView conversationId="chat-1" conversationTitle="Creator"
      createdAt={null} operatorName="king" ownWhatsapp="+521234567890" note=""
      profile={null} suggestions={{}} onSave={onSave} />);

    const select = screen.getByRole('combobox', { name: '添加来源' });
    expect(select).toHaveValue('');
    expect(screen.getAllByRole('option').map((option) => option.textContent))
      .toEqual(['未选择', '评论', '私信', '邮件', '转介绍']);
    fireEvent.change(select, { target: { value: 'referral' } });
    fireEvent.click(screen.getByRole('button', { name: '保存合作资料' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ additionSource: 'referral' })));
    await screen.findByText('合作资料已保存并进入云端同步队列');
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存合作资料' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ additionSource: '' })));
  });

  it('keeps final price and publishing link without follow-up date fields', () => {
    render(
      <CooperationProfileView
        conversationId="chat-1"
        conversationTitle="Creator"
        createdAt={null}
        operatorName="king"
        ownWhatsapp="+521234567890"
        note="等待审核"
        profile={null}
        suggestions={{ finalPrice: '400 MXN' }}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getAllByText('最终价格')).toHaveLength(2);
    expect(screen.getByText('平台账号')).toBeInTheDocument();
    expect(screen.getByText('粉丝数据')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制表格行' })).toBeInTheDocument();
    expect(screen.queryByText('IG 用户名')).not.toBeInTheDocument();
    expect(screen.getByText('发布链接')).toBeInTheDocument();
    expect(screen.getByText('400 MXN')).toBeInTheDocument();
    expect(screen.queryByText('下次跟进时间')).not.toBeInTheDocument();
    expect(screen.queryByText('业务登记日期')).not.toBeInTheDocument();
    expect(screen.queryByText('发布日期')).not.toBeInTheDocument();
    expect(screen.queryByText('跟进与发布')).not.toBeInTheDocument();
  });
});
