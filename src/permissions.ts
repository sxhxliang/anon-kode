/**
 * @file src/permissions.ts
 * @description 该文件负责处理与工具使用相关的权限。
 * 它定义了检查、授予和保存工具权限的逻辑。
 *
 * 主要功能包括：
 * - 检查一个命令是否是安全的，不需要权限。
 * - 检查一个工具（特别是 BashTool）是否有权限执行给定的命令。
 * - 提供一个 `hasPermissionsToUseTool` 函数，用于在工具被调用之前检查权限。
 * - 保存用户授予的权限，以便在将来的会话中使用。
 */
import type { CanUseToolFn } from './hooks/useCanUseTool'
import { Tool, ToolUseContext } from './Tool'
import { BashTool, inputSchema } from './tools/BashTool/BashTool'
import { FileEditTool } from './tools/FileEditTool/FileEditTool'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool'
import { NotebookEditTool } from './tools/NotebookEditTool/NotebookEditTool'
import { getCommandSubcommandPrefix, splitCommand } from './utils/commands'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from './utils/config.js'
import { AbortError } from './utils/errors'
import { logError } from './utils/log'
import { grantWritePermissionForOriginalDir } from './utils/permissions/filesystem'
import { getCwd } from './utils/state'
import { PRODUCT_NAME } from './constants/product'

/**
 * @constant {Set<string>} SAFE_COMMANDS
 * @description 一个已知可以安全执行的命令的集合。
 * 这些命令是只读的，不会对用户的文件系统或状态进行任何修改。
 */
// Commands that are known to be safe for execution
const SAFE_COMMANDS = new Set([
  'git status',
  'git diff',
  'git log',
  'git branch',
  'pwd',
  'tree',
  'date',
  'which',
])
/**
 * @function bashToolCommandHasExactMatchPermission
 * @description 检查一个 `BashTool` 命令是否有精确匹配的权限。
 * 这包括检查命令是否在安全命令列表中，或者是否在允许的工具列表中有精确的匹配。
 *
 * @param {Tool} tool - 要检查的工具（应该是 `BashTool`）。
 * @param {string} command - 要检查的命令。
 * @param {string[]} allowedTools - 允许的工具列表。
 * @returns {boolean} 如果有精确匹配的权限，则返回 `true`；否则返回 `false`。
 */
export const bashToolCommandHasExactMatchPermission = (
  tool: Tool,
  command: string,
  allowedTools: string[],
): boolean => {
  if (SAFE_COMMANDS.has(command)) {
    return true
  }
  // Check exact match first
  if (allowedTools.includes(getPermissionKey(tool, { command }, null))) {
    return true
  }
  // Check if command is an exact match with an approved prefix
  if (allowedTools.includes(getPermissionKey(tool, { command }, command))) {
    return true
  }
  return false
}

/**
 * @function bashToolCommandHasPermission
 * @description 检查一个 `BashTool` 命令是否有权限执行，包括前缀匹配。
 *
 * @param {Tool} tool - 要检查的工具。
 * @param {string} command - 要检查的命令。
 * @param {string | null} prefix - 命令的前缀。
 * @param {string[]} allowedTools - 允许的工具列表。
 * @returns {boolean} 如果有权限，则返回 `true`；否则返回 `false`。
 */
export const bashToolCommandHasPermission = (
  tool: Tool,
  command: string,
  prefix: string | null,
  allowedTools: string[],
): boolean => {
  // Check exact match first
  if (bashToolCommandHasExactMatchPermission(tool, command, allowedTools)) {
    return true
  }
  return allowedTools.includes(getPermissionKey(tool, { command }, prefix))
}
/**
 * @async
 * @function bashToolHasPermission
 * @description 检查 `BashTool` 是否有权限执行一个完整的命令，包括其所有子命令。
 *
 * @param {Tool} tool - 要检查的工具。
 * @param {string} command - 要检查的命令。
 * @param {ToolUseContext} context - 工具使用的上下文。
 * @param {string[]} allowedTools - 允许的工具列表。
 * @param {typeof getCommandSubcommandPrefix} [getCommandSubcommandPrefixFn] - 用于获取命令前缀的函数。
 * @returns {Promise<PermissionResult>} 一个 `PermissionResult` 对象，指示是否有权限。
 */
export const bashToolHasPermission = async (
  tool: Tool,
  command: string,
  context: ToolUseContext,
  allowedTools: string[],
  getCommandSubcommandPrefixFn = getCommandSubcommandPrefix,
): Promise<PermissionResult> => {
  if (bashToolCommandHasExactMatchPermission(tool, command, allowedTools)) {
    // This is an exact match for a command that is allowed, so we can skip the prefix check
    return { result: true }
  }

  const subCommands = splitCommand(command).filter(_ => {
    // Denim likes to add this, we strip it out so we don't need to prompt the user each time
    if (_ === `cd ${getCwd()}`) {
      return false
    }
    return true
  })
  const commandSubcommandPrefix = await getCommandSubcommandPrefixFn(
    command,
    context.abortController.signal,
  )
  if (context.abortController.signal.aborted) {
    throw new AbortError()
  }

  if (commandSubcommandPrefix === null) {
    // Fail closed and ask for user approval if the command prefix query failed (e.g. due to network error)
    // This is NOT the same as `fullCommandPrefix.commandPrefix === null`, which means no prefix was detected
    return {
      result: false,
      message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
    }
  }

  if (commandSubcommandPrefix.commandInjectionDetected) {
    // Only allow exact matches for potential command injections
    if (bashToolCommandHasExactMatchPermission(tool, command, allowedTools)) {
      return { result: true }
    } else {
      return {
        result: false,
        message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
      }
    }
  }

  // If there is only one command, no need to process subCommands
  if (subCommands.length < 2) {
    if (
      bashToolCommandHasPermission(
        tool,
        command,
        commandSubcommandPrefix.commandPrefix,
        allowedTools,
      )
    ) {
      return { result: true }
    } else {
      return {
        result: false,
        message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
      }
    }
  }
  if (
    subCommands.every(subCommand => {
      const prefixResult =
        commandSubcommandPrefix.subcommandPrefixes.get(subCommand)
      if (prefixResult === undefined || prefixResult.commandInjectionDetected) {
        // If prefix result is missing or command injection is detected, always ask for permission
        return false
      }
      const hasPermission = bashToolCommandHasPermission(
        tool,
        subCommand,
        prefixResult ? prefixResult.commandPrefix : null,
        allowedTools,
      )
      return hasPermission
    })
  ) {
    return { result: true }
  }
  return {
    result: false,
    message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
  }
}

/**
 * @typedef {object} PermissionResult
 * @description 表示权限检查的结果。
 * @property {boolean} result - `true` 表示有权限，`false` 表示没有权限。
 * @property {string} [message] - 如果没有权限，则包含一条消息，解释原因。
 */
type PermissionResult = { result: true } | { result: false; message: string }
/**
 * @async
 * @function hasPermissionsToUseTool
 * @description 这是一个 `CanUseToolFn` 的实现，用于在工具被调用之前检查权限。
 * 它处理不同工具的特定权限逻辑。
 *
 * @param {Tool} tool - 要检查的工具。
 * @param {unknown} input - 工具的输入。
 * @param {ToolUseContext} context - 工具使用的上下文。
 * @param {AssistantMessage} _assistantMessage - 触发工具使用的助手消息。
 * @returns {Promise<PermissionResult>} 一个 `PermissionResult` 对象，指示是否有权限。
 */
export const hasPermissionsToUseTool: CanUseToolFn = async (
  tool,
  input,
  context,
  _assistantMessage,
): Promise<PermissionResult> => {
  // If permissions are being skipped, allow all tools
  if (context.options.dangerouslySkipPermissions) {
    return { result: true }
  }

  if (context.abortController.signal.aborted) {
    throw new AbortError()
  }

  // Check if the tool needs permissions
  try {
    if (!tool.needsPermissions(input as never)) {
      return { result: true }
    }
  } catch (e) {
    logError(`Error checking permissions: ${e}`)
    return { result: false, message: 'Error checking permissions' }
  }

  const projectConfig = getCurrentProjectConfig()
  const allowedTools = projectConfig.allowedTools ?? []
  // Special case for BashTool to allow blanket commands without exposing them in the UI
  if (tool === BashTool && allowedTools.includes(BashTool.name)) {
    return { result: true }
  }

  // TODO: Move this into tool definitions (done for read tools!)
  switch (tool) {
    // For bash tool, check each sub-command's permissions separately
    case BashTool: {
      // The types have already been validated by the tool,
      // so we can safely parse the input (as opposed to safeParse).
      const { command } = inputSchema.parse(input)
      return await bashToolHasPermission(tool, command, context, allowedTools)
    }
    // For file editing tools, check session-only permissions
    case FileEditTool:
    case FileWriteTool:
    case NotebookEditTool: {
      // The types have already been validated by the tool,
      // so we can safely pass this in
      if (!tool.needsPermissions(input)) {
        return { result: true }
      }
      return {
        result: false,
        message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
      }
    }
    // For other tools, check persistent permissions
    default: {
      const permissionKey = getPermissionKey(tool, input, null)
      if (allowedTools.includes(permissionKey)) {
        return { result: true }
      }

      return {
        result: false,
        message: `${PRODUCT_NAME} requested permissions to use ${tool.name}, but you haven't granted it yet.`,
      }
    }
  }
}

/**
 * @async
 * @function savePermission
 * @description 保存用户授予的工具使用权限。
 * 对于文件编辑工具，权限仅在内存中保存（会话期间有效）。
 * 对于其他工具，权限被保存在项目配置文件中，以便持久化。
 *
 * @param {Tool} tool - 要保存权限的工具。
 * @param {{ [k: string]: unknown }} input - 工具的输入。
 * @param {string | null} prefix - 命令的前缀（仅适用于 `BashTool`）。
 * @returns {Promise<void>}
 */
export async function savePermission(
  tool: Tool,
  input: { [k: string]: unknown },
  prefix: string | null,
): Promise<void> {
  const key = getPermissionKey(tool, input, prefix)

  // For file editing tools, store write permissions only in memory
  if (
    tool === FileEditTool ||
    tool === FileWriteTool ||
    tool === NotebookEditTool
  ) {
    grantWritePermissionForOriginalDir()
    return
  }

  // For other tools, store permissions on disk
  const projectConfig = getCurrentProjectConfig()
  if (projectConfig.allowedTools.includes(key)) {
    return
  }

  projectConfig.allowedTools.push(key)
  projectConfig.allowedTools.sort()

  saveCurrentProjectConfig(projectConfig)
}
/**
 * @function getPermissionKey
 * @description 为给定的工具和输入生成一个唯一的权限键。
 * 这个键用于在配置中存储和检索权限。
 *
 * @param {Tool} tool - 工具。
 * @param {{ [k: string]: unknown }} input - 工具的输入。
 * @param {string | null} prefix - 命令的前缀。
 * @returns {string} 生成的权限键。
 */
function getPermissionKey(
  tool: Tool,
  input: { [k: string]: unknown },
  prefix: string | null,
): string {
  switch (tool) {
    case BashTool:
      if (prefix) {
        return `${BashTool.name}(${prefix}:*)`
      }
      return `${BashTool.name}(${BashTool.renderToolUseMessage(input as never)})`
    default:
      return tool.name
  }
}
