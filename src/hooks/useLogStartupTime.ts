/**
 * @file src/hooks/useLogStartupTime.ts
 * @description 该文件定义了 `useLogStartupTime` hook，它负责在应用程序启动时记录启动时间。
 * 这个 hook 使用 `useEffect` 来确保日志记录只在组件首次挂载时执行一次。
 */
import { useEffect } from 'react'
import { logEvent } from '../services/statsig'
/**
 * @hook useLogStartupTime
 * @description 一个自定义的 React hook，用于记录应用程序的启动时间。
 * 它会在组件挂载时，将启动时间（从进程启动到 hook 被调用的时间）作为一个事件记录下来。
 */
export function useLogStartupTime(): void {
  useEffect(() => {
    const startupTimeMs = Math.round(process.uptime() * 1000)
    logEvent('tengu_timer', {
      event: 'startup',
      durationMs: String(startupTimeMs),
    })
  }, [])
}
