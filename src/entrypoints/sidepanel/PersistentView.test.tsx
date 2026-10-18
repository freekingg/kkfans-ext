import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PersistentView } from './PersistentView';

describe('标签页保活容器', () => {
  it('隐藏再显示时不会卸载子页面或丢失页面状态', () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();

    function StatefulPage() {
      const [count, setCount] = useState(0);
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <button onClick={() => setCount((value) => value + 1)}>内容 {count}</button>;
    }

    const { container, rerender } = render(
      <PersistentView active><StatefulPage /></PersistentView>,
    );
    fireEvent.click(screen.getByRole('button', { name: '内容 0' }));

    rerender(<PersistentView active={false}><StatefulPage /></PersistentView>);
    expect(container.querySelector('.persistent-view')).toHaveAttribute('hidden');
    expect(container.textContent).toContain('内容 1');
    expect(unmounted).not.toHaveBeenCalled();

    rerender(<PersistentView active><StatefulPage /></PersistentView>);
    expect(screen.getByRole('button', { name: '内容 1' })).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});
