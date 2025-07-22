/**
 * @file src/context.ts
 * @description 该文件负责管理和提供与当前项目相关的上下文信息。
 * 这些信息将被预置到每个对话中，以帮助 AI 模型更好地理解项目环境。
 *
 * 它包括获取 `KODING.md` 文件、Git 状态、目录结构、代码风格等功能。
 * 所有这些信息都被缓存，以避免在对话期间重复计算。
 */
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from './utils/config.js'
import { logError } from './utils/log'
import { getCodeStyle } from './utils/style'
import { getCwd } from './utils/state'
import { memoize, omit } from 'lodash-es'
import { LSTool } from './tools/lsTool/lsTool'
import { getIsGit } from './utils/git'
import { ripGrep } from './utils/ripgrep'
import * as path from 'path'
import { execFileNoThrow } from './utils/execFileNoThrow'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { getSlowAndCapableModel } from './utils/model'
import { lastX } from './utils/generators'
import { getGitEmail } from './utils/user'
import { PROJECT_FILE } from './constants/product'
/**
 * @async
 * @function getClaudeFiles
 * @description 在当前工作目录中查找所有 `KODING.md` 文件。
 * 这些文件包含了关于如何与项目交互的说明，为 AI 模型提供了重要的指导。
 *
 * @returns {Promise<string | null>} 如果找到文件，则返回一个包含文件列表的字符串；否则返回 `null`。
 */
/**
 * Find all KODING.md files in the current working directory
 */
export async function getClaudeFiles(): Promise<string | null> {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 3000)
  try {
    const files = await ripGrep(
      ['--files', '--glob', join('**', '*', PROJECT_FILE)],
      getCwd(),
      abortController.signal,
    )
    if (!files.length) {
      return null
    }

    // Add instructions for additional KODING.md files
    return `NOTE: Additional ${PROJECT_FILE} files were found. When working in these directories, make sure to read and follow the instructions in the corresponding ${PROJECT_FILE} file:\n${files
      .map(_ => path.join(getCwd(), _))
      .map(_ => `- ${_}`)
      .join('\n')}`
  } catch (error) {
    logError(error)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * @function setContext
 * @description 在项目配置中设置一个上下文键值对。
 * 这允许用户自定义 AI 模型可以访问的上下文信息。
 *
 * @param {string} key - 上下文的键。
 * @param {string} value - 上下文的值。
 */
export function setContext(key: string, value: string): void {
  const projectConfig = getCurrentProjectConfig()
  const context = omit(
    { ...projectConfig.context, [key]: value },
    'codeStyle',
    'directoryStructure',
  )
  saveCurrentProjectConfig({ ...projectConfig, context })
}
/**
 * @function removeContext
 * @description 从项目配置中移除一个上下文键。
 *
 * @param {string} key - 要移除的上下文的键。
 */
export function removeContext(key: string): void {
  const projectConfig = getCurrentProjectConfig()
  const context = omit(
    projectConfig.context,
    key,
    'codeStyle',
    'directoryStructure',
  )
  saveCurrentProjectConfig({ ...projectConfig, context })
}

/**
 * @async
 * @function getReadme
 * @description 异步读取并返回项目根目录下的 `README.md` 文件的内容。
 * 如果文件不存在或读取时发生错误，则返回 `null`。
 *
 * @returns {Promise<string | null>} `README.md` 文件的内容，或在出错时返回 `null`。
 */
export const getReadme = memoize(async (): Promise<string | null> => {
  try {
    const readmePath = join(getCwd(), 'README.md')
    if (!existsSync(readmePath)) {
      return null
    }
    const content = await readFile(readmePath, 'utf-8')
    return content
  } catch (e) {
    logError(e)
    return null
  }
})
/**
 * @async
 * @function getGitStatus
 * @description 获取当前项目的 Git 状态，包括当前分支、主分支、文件状态和最近的提交记录。
 * 如果项目不是一个 Git 仓库，则返回 `null`。
 *
 * @returns {Promise<string | null>} 一个包含 Git 状态信息的字符串，或在出错时返回 `null`。
 */
export const getGitStatus = memoize(async (): Promise<string | null> => {
  if (process.env.NODE_ENV === 'test') {
    // Avoid cycles in tests
    return null
  }
  if (!(await getIsGit())) {
    return null
  }

  try {
    const [branch, mainBranch, status, log, authorLog] = await Promise.all([
      execFileNoThrow(
        'git',
        ['branch', '--show-current'],
        undefined,
        undefined,
        false,
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        'git',
        ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
        undefined,
        undefined,
        false,
      ).then(({ stdout }) => stdout.replace('origin/', '').trim()),
      execFileNoThrow(
        'git',
        ['status', '--short'],
        undefined,
        undefined,
        false,
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        'git',
        ['log', '--oneline', '-n', '5'],
        undefined,
        undefined,
        false,
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        'git',
        [
          'log',
          '--oneline',
          '-n',
          '5',
          '--author',
          (await getGitEmail()) || '',
        ],
        undefined,
        undefined,
        false,
      ).then(({ stdout }) => stdout.trim()),
    ])
    // Check if status has more than 200 lines
    const statusLines = status.split('\n').length
    const truncatedStatus =
      statusLines > 200
        ? status.split('\n').slice(0, 200).join('\n') +
          '\n... (truncated because there are more than 200 lines. If you need more information, run "git status" using BashTool)'
        : status

    return `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.\nCurrent branch: ${branch}\n\nMain branch (you will usually use this for PRs): ${mainBranch}\n\nStatus:\n${truncatedStatus || '(clean)'}\n\nRecent commits:\n${log}\n\nYour recent commits:\n${authorLog || '(no recent commits)'}`
  } catch (error) {
    logError(error)
    return null
  }
})

/**
 * @async
 * @function getContext
 * @description 获取并整合所有相关的上下文信息，形成一个单一的对象。
 * 这个函数是 memoized 的，以确保在同一次会话中只计算一次上下文。
 *
 * @returns {Promise<{[k: string]: string}>} 一个包含所有上下文信息的对象。
 */
/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const codeStyle = getCodeStyle()
    const projectConfig = getCurrentProjectConfig()
    const dontCrawl = projectConfig.dontCrawlDirectory
    const [gitStatus, directoryStructure, claudeFiles, readme] =
      await Promise.all([
        getGitStatus(),
        dontCrawl ? Promise.resolve('') : getDirectoryStructure(),
        dontCrawl ? Promise.resolve('') : getClaudeFiles(),
        getReadme(),
      ])
    return {
      ...projectConfig.context,
      ...(directoryStructure ? { directoryStructure } : {}),
      ...(gitStatus ? { gitStatus } : {}),
      ...(codeStyle ? { codeStyle } : {}),
      ...(claudeFiles ? { claudeFiles } : {}),
      ...(readme ? { readme } : {}),
    }
  },
)

/**
 * @async
 * @function getDirectoryStructure
 * @description 获取当前项目的大致目录结构。
 * 这个函数使用 `LSTool` 来生成目录列表，为 AI 模型提供关于项目文件组织的初步信息。
 *
 * @returns {Promise<string>} 一个包含目录结构快照的字符串。
 */
/**
 * Approximate directory structure, to orient Claude. Claude will start with this, then use
 * tools like LS and View to get more information.
 */
export const getDirectoryStructure = memoize(
  async function (): Promise<string> {
    let lines: string
    try {
      const abortController = new AbortController()
      setTimeout(() => {
        abortController.abort()
      }, 1_000)
      const model = await getSlowAndCapableModel()
      const resultsGen = LSTool.call(
        {
          path: '.',
        },
        {
          abortController,
          options: {
            commands: [],
            tools: [],
            slowAndCapableModel: model,
            forkNumber: 0,
            messageLogName: 'unused',
            maxThinkingTokens: 0,
          },
          messageId: undefined,
          readFileTimestamps: {},
        },
      )
      const result = await lastX(resultsGen)
      lines = result.data
    } catch (error) {
      logError(error)
      return ''
    }

    return `Below is a snapshot of this project's file structure at the start of the conversation. This snapshot will NOT update during the conversation.

${lines}`
  },
)
