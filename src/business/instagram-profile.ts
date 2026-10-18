const RESERVED_PATHS = new Set([
  'accounts', 'direct', 'explore', 'p', 'reel', 'reels', 'stories', 'tv',
]);

function normalizedUsername(value: unknown): string {
  const username = (typeof value === 'string' ? value.trim() : '').replace(/^@+/, '');
  return /^[a-zA-Z0-9._]{1,64}$/.test(username) ? username : '';
}

export function normalizeInstagramProfile(
  profileUrlValue: unknown,
  usernameValue: unknown,
): { profileUrl: string; username: string } {
  const profileUrl = typeof profileUrlValue === 'string' ? profileUrlValue.trim() : '';
  let username = normalizedUsername(usernameValue);

  if (profileUrl) {
    try {
      const url = new URL(profileUrl);
      const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      const candidate = normalizedUsername(decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? ''));
      if (hostname === 'instagram.com' && candidate && !RESERVED_PATHS.has(candidate.toLowerCase())) {
        username = candidate;
        return {
          username,
          profileUrl: `https://www.instagram.com/${username}/`,
        };
      }
    } catch {
      // 非法链接保留原值，让用户可以继续编辑修正。
    }
    return { profileUrl, username };
  }

  return {
    username,
    profileUrl: username ? `https://www.instagram.com/${username}/` : '',
  };
}
