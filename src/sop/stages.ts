export const SOP_STAGES = [
  ['01', '新联系人'],
  ['02', '等待主页'],
  ['03', '审核主页'],
  ['04', '介绍合作'],
  ['05', '报价&介绍'],
  ['06', '价格沟通'],
  ['07', '合作确认'],
  ['08', '发送拍摄要求'],
  ['09', '提供链接/测试环境'],
  ['10', '等待视频'],
  ['11', '视频审核'],
  ['12', '修改'],
  ['13', '审核通过'],
  ['14', '支付'],
  ['15', '等待发布'],
  ['16', '已发布'],
  ['17', '数据跟踪'],
  ['18', '二次合作'],
  ['19', '日常沟通'],
] as const;

export type SopStageId = (typeof SOP_STAGES)[number][0];

const SOP_STAGE_TITLES = new Map<string, string>(SOP_STAGES);

export function isSopStageId(value: unknown): value is SopStageId {
  return typeof value === 'string' && SOP_STAGE_TITLES.has(value);
}

export function getSopStageTitle(stageId: string | null): string {
  if (!stageId) return '尚未确认';
  return `${stageId} · ${SOP_STAGE_TITLES.get(stageId) ?? '未知阶段'}`;
}

export function getSopStageBadge(stageId: string): string {
  return `${stageId} ${SOP_STAGE_TITLES.get(stageId) ?? '未知阶段'}`;
}
