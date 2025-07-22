/**
 * @file src/history.ts
 * @description 该文件负责管理命令历史记录。
 * 它提供了获取历史记录和向历史记录中添加新命令的功能。
 * 历史记录被存储在项目配置中，并且有最大数量限制。
 */
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from './utils/config.js'
/**
 * @constant {number} MAX_HISTORY_ITEMS
 * @description 历史记录中可以存储的最大命令数量。
 */
const MAX_HISTORY_ITEMS = 100
/**
 * @function getHistory
 * @description 获取当前项目的命令历史记录。
 *
 * @returns {string[]} 一个包含命令历史记录的字符串数组。
 */
export function getHistory(): string[] {
  return getCurrentProjectConfig().history ?? []
}
/**
 * @function addToHistory
 * @description 将一个新命令添加到历史记录的开头。
 * 如果新命令与最近的命令相同，则不会被添加。
 *
 * @param {string} command - 要添加到历史记录的命令。
 */
export function addToHistory(command: string): void {
  const projectConfig = getCurrentProjectConfig()
  const history = projectConfig.history ?? []

  if (history[0] === command) {
    return
  }

  history.unshift(command)
  saveCurrentProjectConfig({
    ...projectConfig,
    history: history.slice(0, MAX_HISTORY_ITEMS),
  })
}
