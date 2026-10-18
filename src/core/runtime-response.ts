/** Keep native Chromium's callback channel open; do not return a Promise from onMessage. */
export function respondToRuntimeMessage<Response>(
  work: () => Response | Promise<Response>,
  sendResponse: (response: Response | { ok: false; error: string }) => void,
): true {
  const respond = (value: Response | { ok: false; error: string }) => {
    try { sendResponse(value); }
    catch { /* The panel/tab may have closed while the operation was running. */ }
  };
  void Promise.resolve().then(work).then(respond, (cause: unknown) => {
    respond({ ok: false, error: cause instanceof Error ? cause.message : '插件消息处理失败' });
  });
  return true;
}
