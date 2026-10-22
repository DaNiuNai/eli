import type { PiResponsePhase, PiSessionSnapshot } from '../../../shared/pi'

export function getResponseDisplay(
  snapshot: Pick<
    PiSessionSnapshot,
    'response' | 'activity' | 'hideThinkingBlock' | 'toolApprovals'
  > | null,
  sendingId: number | undefined,
  stopping: boolean
): { phase: PiResponsePhase; active: boolean; status: string | null } {
  // 本地占位只持续到主进程开始这次请求，晚到的接收确认不能让界面倒退。
  const phase =
    sendingId !== undefined && sendingId === snapshot?.response.id
      ? 'sending'
      : (snapshot?.response.phase ?? 'idle')
  const isStopping = stopping || snapshot?.activity === '正在停止'
  const compacting = snapshot?.activity === '正在整理上下文'
  const status = isStopping
    ? '正在停止'
    : snapshot?.toolApprovals.length
      ? '等待工具审批'
      : compacting
        ? null
        : phase === 'sending'
          ? '正在发送消息'
          : phase === 'waiting'
            ? '正在等待回复'
            : phase === 'thinking' && snapshot?.hideThinkingBlock
              ? '正在思考'
              : null
  return { phase, active: phase !== 'idle' && !isStopping && !compacting, status }
}
