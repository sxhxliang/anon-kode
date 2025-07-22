/**
 * @file src/cost-tracker.ts
 * @description 该文件负责跟踪和管理与 API 调用相关的成本和持续时间。
 * 它提供了一个全局状态来累积总成本和 API 持续时间，并提供了格式化和显示这些信息的功能。
 *
 * `useCostSummary` hook 会在程序退出时自动保存会话的成本和持续时间。
 */
import chalk from 'chalk'
import { useEffect } from 'react'
import { formatDuration } from './utils/format'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from './utils/config.js'
import { SESSION_ID } from './utils/log'

/**
 * @description 一个全局状态对象，用于存储总成本、总 API 持续时间和会话开始时间。
 * @type {{totalCost: number, totalAPIDuration: number, startTime: number}}
 */
// DO NOT ADD MORE STATE HERE OR BORIS WILL CURSE YOU
const STATE: {
  totalCost: number
  totalAPIDuration: number
  startTime: number
} = {
  totalCost: 0,
  totalAPIDuration: 0,
  startTime: Date.now(),
}
/**
 * @function addToTotalCost
 * @description 将指定的成本和持续时间添加到全局状态中。
 *
 * @param {number} cost - 要添加的成本。
 * @param {number} duration - 要添加的持续时间。
 */
export function addToTotalCost(cost: number, duration: number): void {
  STATE.totalCost += cost
  STATE.totalAPIDuration += duration
}
/**
 * @function getTotalCost
 * @description 获取当前会话的总成本。
 *
 * @returns {number} 总成本。
 */
export function getTotalCost(): number {
  return STATE.totalCost
}
/**
 * @function getTotalDuration
 * @description 获取当前会话的总持续时间（挂钟时间）。
 *
 * @returns {number} 总持续时间。
 */
export function getTotalDuration(): number {
  return Date.now() - STATE.startTime
}
/**
 * @function getTotalAPIDuration
 * @description 获取当前会话的总 API 持续时间。
 *
 * @returns {number} 总 API 持续时间。
 */
export function getTotalAPIDuration(): number {
  return STATE.totalAPIDuration
}
/**
 * @function formatCost
 * @description 将数字成本格式化为美元字符串。
 *
 * @param {number} cost - 要格式化的成本。
 * @returns {string} 格式化后的成本字符串。
 */
function formatCost(cost: number): string {
  return `$${cost > 0.5 ? round(cost, 100).toFixed(2) : cost.toFixed(4)}`
}
/**
 * @function formatTotalCost
 * @description 格式化并返回一个包含总成本和持续时间摘要的字符串。
 *
 * @returns {string} 格式化后的摘要字符串。
 */
export function formatTotalCost(): string {
  return chalk.grey(
    `Total cost: ${formatCost(STATE.totalCost)}
Total duration (API): ${formatDuration(STATE.totalAPIDuration)}
Total duration (wall): ${formatDuration(getTotalDuration())}`,
  )
}

/**
 * @hook useCostSummary
 * @description 一个 React hook，用于在组件卸载时（即程序退出时）打印成本摘要，
 * 并将会话的成本和持续时间保存到项目配置中。
 */
export function useCostSummary(): void {
  useEffect(() => {
    const f = () => {
      process.stdout.write('\n' + formatTotalCost() + '\n')

      // Save last cost and duration to project config
      const projectConfig = getCurrentProjectConfig()
      saveCurrentProjectConfig({
        ...projectConfig,
        lastCost: STATE.totalCost,
        lastAPIDuration: STATE.totalAPIDuration,
        lastDuration: getTotalDuration(),
        lastSessionId: SESSION_ID,
      })
    }
    process.on('exit', f)
    return () => {
      process.off('exit', f)
    }
  }, [])
}
/**
 * @function round
 * @description 将一个数字四舍五入到指定的精度。
 *
 * @param {number} number - 要四舍五入的数字。
 * @param {number} precision - 精度。
 * @returns {number} 四舍五入后的数字。
 */
function round(number: number, precision: number): number {
  return Math.round(number * precision) / precision
}
/**
 * @function resetStateForTests
 * @description 重置成本跟踪器的状态，仅用于测试环境。
 * @throws {Error} 如果不在测试环境中调用，则抛出错误。
 */
// Only used in tests
export function resetStateForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetStateForTests can only be called in tests')
  }
  STATE.startTime = Date.now()
  STATE.totalCost = 0
  STATE.totalAPIDuration = 0
}
