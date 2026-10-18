/** Observed Meta Business Suite DOM. Keep Meta details out of the Web adapter. */
export const metaSelectors = {
  app: 'body',
  chatList: '[data-surface$="/bizweb_inbox:thread_list"]',
  chatRows: '[data-surface$="/bizweb_inbox:thread_list"] [data-surface*="/thread_row"]:not([data-surface$="/lib:thread_title"])',
  chatRowTitle: '[data-surface$="/lib:thread_title"]',
  // The preview and title use the same line-clamp element; placement is resolved
  // explicitly below so we never insert tags inside the fixed-height title.
  chatRowPreview: '._4ik4',
  main: '[data-surface$="/lib:inbox:detail_column"]:has([data-surface$="/lib:inbox:detail_view_header"])',
  conversationHeader: '[data-surface$="/lib:inbox:detail_view_header"]',
  conversationTitle: '[data-surface$="/lib:inbox:detail_view_header"] ._4ik4',
  messageScroller: '[role="region"][aria-label][tabindex="0"]',
  messageContainers: '[data-message-id]',
  messageWrapper: '[data-message-id]',
  composer: '[role="textbox"][contenteditable="true"]',
};

export function metaTagPlacement(row: HTMLElement, title: HTMLElement) {
  // First ancestor containing a separate preview line is the text column.
  let column = title.parentElement;
  while (column && column !== row) {
    const preview = [...column.querySelectorAll<HTMLElement>('._4ik4')]
      .find(line => !line.contains(title) && !title.contains(line));
    if (preview) {
      let branch: HTMLElement = preview;
      while (branch.parentElement && branch.parentElement !== column) branch = branch.parentElement;
      return { container: column, after: branch };
    }
    column = column.parentElement;
  }
  return null;
}
