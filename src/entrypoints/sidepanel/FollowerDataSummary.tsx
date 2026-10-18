interface FollowerMetric {
  key: 'posts' | 'followers' | 'following';
  label: string;
  value: string;
}

export type FollowerSummary =
  | { kind: 'metrics'; metrics: FollowerMetric[] }
  | { kind: 'text'; lines: string[] };

const METRIC_DEFINITIONS: Array<{
  key: FollowerMetric['key'];
  label: string;
  pattern: RegExp;
}> = [
  { key: 'posts', label: '帖子', pattern: /(?:\bposts?\b|publicaciones|帖子)/i },
  { key: 'followers', label: '粉丝', pattern: /(?:\bfollowers?\b|seguidores|粉丝)/i },
  { key: 'following', label: '关注', pattern: /(?:\bfollowing\b|seguidos|关注)/i },
];

export function summarizeFollowerData(value?: string | null): FollowerSummary | null {
  const lines = (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const found = new Map<FollowerMetric['key'], FollowerMetric>();
  for (const line of lines) {
    const definition = METRIC_DEFINITIONS.find((item) => item.pattern.test(line));
    const number = line.match(/\d[\d.,]*\s*[KMB]?/i)?.[0]?.replace(/\s+/g, '');
    if (!definition || !number || found.has(definition.key)) continue;
    found.set(definition.key, {
      key: definition.key,
      label: definition.label,
      value: number,
    });
  }

  const metrics = METRIC_DEFINITIONS
    .map((definition) => found.get(definition.key))
    .filter((metric): metric is FollowerMetric => Boolean(metric));
  return metrics.length ? { kind: 'metrics', metrics } : { kind: 'text', lines: lines.slice(0, 2) };
}

export function FollowerDataSummary({ value }: { value: string | null | undefined }) {
  const summary = summarizeFollowerData(value);
  if (!summary) return null;

  if (summary.kind === 'metrics') {
    return (
      <span className="profile-follower-metrics" title={value ?? ''} aria-label="粉丝数据摘要">
        {summary.metrics.map((metric) => (
          <span key={metric.key} className={metric.key === 'followers' ? 'primary' : ''}>
            <small>{metric.label}</small>
            <b>{metric.value}</b>
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className="profile-follower-preview" title={value ?? ''} aria-label="粉丝数据摘要">
      {summary.lines.join('\n')}
    </span>
  );
}
