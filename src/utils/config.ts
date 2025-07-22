/**
 * @file src/utils/config.ts
 * @description 该文件负责管理应用程序的配置，包括全局配置和项目级配置。
 * 它定义了配置的数据结构，并提供了读取、写入和操作配置的函数。
 *
 * 主要功能包括：
 * - 定义 `GlobalConfig` 和 `ProjectConfig` 的类型。
 * - 提供获取和保存全局及项目配置的函数。
 * - 处理 API 密钥的管理和验证。
 * - 提供用于命令行界面的配置操作函数。
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { cloneDeep, memoize, pick } from 'lodash-es'
import { homedir } from 'os'
import { GLOBAL_CLAUDE_FILE } from './env'
import { getCwd } from './state'
import { randomBytes } from 'crypto'
import { safeParseJSON } from './json'
import { checkGate, logEvent } from '../services/statsig'
import { GATE_USE_EXTERNAL_UPDATER } from '../constants/betas'
import { ConfigParseError } from './errors'
import type { ThemeNames } from './theme'
import { getSessionState, setSessionState } from './sessionState'

/**
 * @typedef {object} McpStdioServerConfig
 * @description 定义了基于 stdio 的 MCP 服务器的配置。
 */
export type McpStdioServerConfig = {
  type?: 'stdio' // Optional for backwards compatibility
  command: string
  args: string[]
  env?: Record<string, string>
}
/**
 * @typedef {object} McpSSEServerConfig
 * @description 定义了基于 SSE 的 MCP 服务器的配置。
 */
export type McpSSEServerConfig = {
  type: 'sse'
  url: string
}
/**
 * @typedef {McpStdioServerConfig | McpSSEServerConfig} McpServerConfig
 * @description MCP 服务器配置的联合类型。
 */
export type McpServerConfig = McpStdioServerConfig | McpSSEServerConfig
/**
 * @typedef {object} ProjectConfig
 * @description 定义了项目级别的配置。
 * 这包括允许的工具、上下文、历史记录等。
 */
export type ProjectConfig = {
  allowedTools: string[]
  context: Record<string, string>
  contextFiles?: string[]
  history: string[]
  dontCrawlDirectory?: boolean
  enableArchitectTool?: boolean
  mcpContextUris: string[]
  mcpServers?: Record<string, McpServerConfig>
  approvedMcprcServers?: string[]
  rejectedMcprcServers?: string[]
  lastAPIDuration?: number
  lastCost?: number
  lastDuration?: number
  lastSessionId?: string
  exampleFiles?: string[]
  exampleFilesGeneratedAt?: number
  hasTrustDialogAccepted?: boolean
  hasCompletedProjectOnboarding?: boolean
}

/**
 * @constant {ProjectConfig} DEFAULT_PROJECT_CONFIG
 * @description 默认的项目配置。
 */
const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  allowedTools: [],
  context: {},
  history: [],
  dontCrawlDirectory: false,
  enableArchitectTool: false,
  mcpContextUris: [],
  mcpServers: {},
  approvedMcprcServers: [],
  rejectedMcprcServers: [],
  hasTrustDialogAccepted: false,
}
/**
 * @function defaultConfigForProject
 * @description 为给定的项目路径生成默认的项目配置。
 * 如果项目路径是用户的主目录，则默认禁用目录爬取。
 *
 * @param {string} projectPath - 项目的路径。
 * @returns {ProjectConfig} 生成的默认项目配置。
 */
function defaultConfigForProject(projectPath: string): ProjectConfig {
  const config = { ...DEFAULT_PROJECT_CONFIG }
  if (projectPath === homedir()) {
    config.dontCrawlDirectory = true
  }
  return config
}

/**
 * @typedef {'disabled' | 'enabled' | 'no_permissions' | 'not_configured'} AutoUpdaterStatus
 * @description 自动更新器的状态。
 */
export type AutoUpdaterStatus =
  | 'disabled'
  | 'enabled'
  | 'no_permissions'
  | 'not_configured'
/**
 * @function isAutoUpdaterStatus
 * @description 检查一个值是否是有效的 `AutoUpdaterStatus`。
 *
 * @param {string} value - 要检查的值。
 * @returns {value is AutoUpdaterStatus} 如果是有效的状态，则返回 `true`。
 */
export function isAutoUpdaterStatus(value: string): value is AutoUpdaterStatus {
  return ['disabled', 'enabled', 'no_permissions', 'not_configured'].includes(
    value as AutoUpdaterStatus,
  )
}
/**
 * @typedef {'iterm2' | 'terminal_bell' | 'iterm2_with_bell' | 'notifications_disabled'} NotificationChannel
 * @description 通知的渠道。
 */
export type NotificationChannel =
  | 'iterm2'
  | 'terminal_bell'
  | 'iterm2_with_bell'
  | 'notifications_disabled'
/**
 * @typedef {'anthropic' | 'openai' | 'mistral' | ...} ProviderType
 * @description AI 模型的提供商类型。
 */
export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'mistral'
  | 'deepseek'
  | 'xai'
  | 'groq'
  | 'gemini'
  | 'ollama'
  | 'azure'
  | 'custom'
/**
 * @typedef {object} AccountInfo
 * @description 用户的账户信息。
 */
export type AccountInfo = {
  accountUuid: string
  emailAddress: string
  organizationUuid?: string
}
/**
 * @typedef {object} GlobalConfig
 * @description 定义了全局配置。
 * 这包括所有项目的配置、用户 ID、主题等。
 */
export type GlobalConfig = {
  projects?: Record<string, ProjectConfig>
  numStartups: number
  autoUpdaterStatus?: AutoUpdaterStatus
  userID?: string
  theme: ThemeNames
  hasCompletedOnboarding?: boolean
  // Tracks the last version that reset onboarding, used with MIN_VERSION_REQUIRING_ONBOARDING_RESET
  lastOnboardingVersion?: string
  // Tracks the last version for which release notes were seen, used for managing release notes
  lastReleaseNotesSeen?: string
  mcpServers?: Record<string, McpServerConfig>
  preferredNotifChannel: NotificationChannel
  verbose: boolean
  customApiKeyResponses?: {
    approved?: string[]
    rejected?: string[]
  }
  primaryApiKey?: string
  primaryProvider?: ProviderType
  largeModelBaseURL?: string
  largeModelName?: string
  largeModelApiKeyRequired?: boolean
  largeModelApiKeys?: string[]
  largeModelApiKey?: string // Deprecated
  largeModelReasoningEffort?: 'low' | 'medium' | 'high' | undefined
  smallModelBaseURL?: string
  smallModelName?: string
  smallModelApiKeyRequired?: boolean
  smallModelApiKeys?: string[]
  smallModelApiKey?: string // Deprecated
  smallModelReasoningEffort?: 'low' | 'medium' | 'high' | undefined
  smallModelMaxTokens?: number
  largeModelMaxTokens?: number
  maxTokens?: number
  hasAcknowledgedCostThreshold?: boolean
  oauthAccount?: AccountInfo
  iterm2KeyBindingInstalled?: boolean // Legacy - keeping for backward compatibility
  shiftEnterKeyBindingInstalled?: boolean
  proxy?: string
  stream?: boolean
}

/**
 * @constant {GlobalConfig} DEFAULT_GLOBAL_CONFIG
 * @description 默认的全局配置。
 */
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  numStartups: 0,
  autoUpdaterStatus: 'not_configured',
  theme: 'dark' as ThemeNames,
  preferredNotifChannel: 'iterm2',
  verbose: false,
  primaryProvider: 'anthropic' as ProviderType,
  customApiKeyResponses: {
    approved: [],
    rejected: [],
  },
  stream: true,
}
/**
 * @constant {readonly string[]} GLOBAL_CONFIG_KEYS
 * @description 一个包含了所有可配置的全局配置键的数组。
 */
export const GLOBAL_CONFIG_KEYS = [
  'autoUpdaterStatus',
  'theme',
  'hasCompletedOnboarding',
  'lastOnboardingVersion',
  'lastReleaseNotesSeen',
  'verbose',
  'customApiKeyResponses',
  'primaryApiKey',
  'primaryProvider',
  'preferredNotifChannel',
  'shiftEnterKeyBindingInstalled',
  'maxTokens',
] as const
/**
 * @typedef {typeof GLOBAL_CONFIG_KEYS[number]} GlobalConfigKey
 * @description 全局配置键的类型。
 */
export type GlobalConfigKey = (typeof GLOBAL_CONFIG_KEYS)[number]
/**
 * @function isGlobalConfigKey
 * @description 检查一个字符串是否是有效的全局配置键。
 *
 * @param {string} key - 要检查的键。
 * @returns {key is GlobalConfigKey} 如果是有效的键，则返回 `true`。
 */
export function isGlobalConfigKey(key: string): key is GlobalConfigKey {
  return GLOBAL_CONFIG_KEYS.includes(key as GlobalConfigKey)
}
/**
 * @constant {readonly string[]} PROJECT_CONFIG_KEYS
 * @description 一个包含了所有可配置的项目配置键的数组。
 */
export const PROJECT_CONFIG_KEYS = [
  'dontCrawlDirectory',
  'enableArchitectTool',
  'hasTrustDialogAccepted',
  'hasCompletedProjectOnboarding',
] as const
/**
 * @typedef {typeof PROJECT_CONFIG_KEYS[number]} ProjectConfigKey
 * @description 项目配置键的类型。
 */
export type ProjectConfigKey = (typeof PROJECT_CONFIG_KEYS)[number]

/**
 * @function checkHasTrustDialogAccepted
 * @description 检查用户是否已经接受了信任对话框。
 * 它会从当前目录开始，向上遍历父目录，检查任何一级目录的配置中是否包含了接受标志。
 *
 * @returns {boolean} 如果用户已接受，则返回 `true`；否则返回 `false`。
 */
export function checkHasTrustDialogAccepted(): boolean {
  let currentPath = getCwd()
  const config = getConfig(GLOBAL_CLAUDE_FILE, DEFAULT_GLOBAL_CONFIG)

  while (true) {
    const projectConfig = config.projects?.[currentPath]
    if (projectConfig?.hasTrustDialogAccepted) {
      return true
    }
    const parentPath = resolve(currentPath, '..')
    // Stop if we've reached the root (when parent is same as current)
    if (parentPath === currentPath) {
      break
    }
    currentPath = parentPath
  }

  return false
}
/**
 * @description 用于测试的全局和项目配置对象。
 * 由于 Jest 不支持模拟 ES 模块，因此需要这些对象。
 */
// We have to put this test code here because Jest doesn't support mocking ES modules :O
const TEST_GLOBAL_CONFIG_FOR_TESTING: GlobalConfig = {
  ...DEFAULT_GLOBAL_CONFIG,
  autoUpdaterStatus: 'disabled',
}
const TEST_PROJECT_CONFIG_FOR_TESTING: ProjectConfig = {
  ...DEFAULT_PROJECT_CONFIG,
}
/**
 * @function isProjectConfigKey
 * @description 检查一个字符串是否是有效的项目配置键。
 *
 * @param {string} key - 要检查的键。
 * @returns {key is ProjectConfigKey} 如果是有效的键，则返回 `true`。
 */
export function isProjectConfigKey(key: string): key is ProjectConfigKey {
  return PROJECT_CONFIG_KEYS.includes(key as ProjectConfigKey)
}

/**
 * @function saveGlobalConfig
 * @description 保存全局配置。
 * 它会处理一些向后兼容的逻辑，例如将旧的 API 密钥格式转换为新的格式。
 *
 * @param {GlobalConfig} config - 要保存的全局配置。
 */
export function saveGlobalConfig(config: GlobalConfig): void {
  if (config.largeModelApiKey && !config.largeModelApiKeys) {
    config.largeModelApiKeys = [config.largeModelApiKey]
    delete config.largeModelApiKey
  }
  if (config.smallModelApiKey && !config.smallModelApiKeys) {
    config.smallModelApiKeys = [config.smallModelApiKey]
    delete config.smallModelApiKey
  }

  if (process.env.NODE_ENV === 'test') {
    for (const key in config) {
      TEST_GLOBAL_CONFIG_FOR_TESTING[key] = config[key]
    }
    return
  }
  saveConfig(
    GLOBAL_CLAUDE_FILE,
    {
      ...config,
      projects: getConfig(GLOBAL_CLAUDE_FILE, DEFAULT_GLOBAL_CONFIG).projects,
    },
    DEFAULT_GLOBAL_CONFIG,
  )
}
/**
 * @function getGlobalConfig
 * @description 获取全局配置。
 *
 * @returns {GlobalConfig} 全局配置对象。
 */
export function getGlobalConfig(): GlobalConfig {
  if (process.env.NODE_ENV === 'test') {
    return TEST_GLOBAL_CONFIG_FOR_TESTING
  }
  return getConfig(GLOBAL_CLAUDE_FILE, DEFAULT_GLOBAL_CONFIG)
}

// TODO: Decide what to do with this code
// export function getAnthropicApiKey(): null | string {
//   const config = getGlobalConfig()
//   return process.env.ANTHROPIC_API_KEY;
//   if (process.env.USER_TYPE === 'SWE_BENCH') {
//     return process.env.ANTHROPIC_API_KEY_OVERRIDE ?? null
//   }

//   if (process.env.USER_TYPE === 'external') {
//     return config.primaryApiKey ?? null
//   }

//   if (process.env.USER_TYPE === 'ant') {
//     if (
//       process.env.ANTHROPIC_API_KEY &&
//       config.customApiKeyResponses?.approved?.includes(
//         normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY),
//       )
//     ) {
//       return process.env.ANTHROPIC_API_KEY
//     }
//     return config.primaryApiKey ?? null
//   }

//   return null
// }

/**
 * @function getAnthropicApiKey
 * @description 获取当前的 Anthropic API 密钥。
 *
 * @returns {null | string} API 密钥，或在未设置时返回 `null`。
 */
export function getAnthropicApiKey(): null | string {
  const config = getGlobalConfig()
  return process.env.SMALL_MODEL_API_KEY
}
/**
 * @function normalizeApiKeyForConfig
 * @description 规范化 API 密钥，以便在配置中存储。
 * 它只保留密钥的最后 20 个字符，以增强安全性。
 *
 * @param {string} apiKey - 要规范化的 API 密钥。
 * @returns {string} 规范化后的 API 密钥。
 */
export function normalizeApiKeyForConfig(apiKey: string): string {
  return apiKey?.slice(-20) ?? ''
}
/**
 * @function isDefaultApiKey
 * @description 检查当前使用的 API 密钥是否是默认密钥。
 *
 * @returns {boolean} 如果是默认密钥，则返回 `true`。
 */
export function isDefaultApiKey(): boolean {
  const config = getGlobalConfig()
  const apiKey = getAnthropicApiKey()
  return apiKey === config.primaryApiKey
}
/**
 * @function getCustomApiKeyStatus
 * @description 获取自定义 API 密钥的状态（已批准、已拒绝或新的）。
 *
 * @param {string} truncatedApiKey - 截断后的 API 密钥。
 * @returns {'approved' | 'rejected' | 'new'} 密钥的状态。
 */
export function getCustomApiKeyStatus(
  truncatedApiKey: string,
): 'approved' | 'rejected' | 'new' {
  const config = getGlobalConfig()
  if (config.customApiKeyResponses?.approved?.includes(truncatedApiKey)) {
    return 'approved'
  }
  if (config.customApiKeyResponses?.rejected?.includes(truncatedApiKey)) {
    return 'rejected'
  }
  return 'new'
}

/**
 * @function saveConfig
 * @description 将配置对象保存到文件中。
 * 在保存之前，它会过滤掉与默认配置相同的值，以保持配置文件的简洁。
 *
 * @template A
 * @param {string} file - 要保存到的文件名。
 * @param {A} config - 要保存的配置对象。
 * @param {A} defaultConfig - 默认配置对象，用于过滤。
 */
function saveConfig<A extends object>(
  file: string,
  config: A,
  defaultConfig: A,
): void {
  // Filter out any values that match the defaults
  const filteredConfig = Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(defaultConfig[key as keyof A]),
    ),
  )
  writeFileSync(file, JSON.stringify(filteredConfig, null, 2), 'utf-8')
}
/**
 * @description 一个标志，用于跟踪是否允许读取配置。
 * @type {boolean}
 */
// Flag to track if config reading is allowed
let configReadingAllowed = false
/**
 * @function enableConfigs
 * @description 启用配置读取。
 * 在调用此函数之前，任何读取配置的尝试都会导致错误，以防止在模块初始化期间读取配置。
 */
export function enableConfigs(): void {
  // Any reads to configuration before this flag is set show an console warning
  // to prevent us from adding config reading during module initialization
  configReadingAllowed = true
  // We only check the global config because currently all the configs share a file
  getConfig(
    GLOBAL_CLAUDE_FILE,
    DEFAULT_GLOBAL_CONFIG,
    true /* throw on invalid */,
  )
}

/**
 * @function getConfig
 * @description 从文件中读取配置对象。
 * 如果文件不存在，则返回默认配置。如果文件无效，则可以根据 `throwOnInvalid` 参数决定是抛出错误还是返回默认配置。
 *
 * @template A
 * @param {string} file - 要读取的文件名。
 * @param {A} defaultConfig - 默认配置对象。
 * @param {boolean} [throwOnInvalid] - 如果为 `true`，则在配置无效时抛出错误。
 * @returns {A} 读取到的配置对象或默认配置。
 */
function getConfig<A>(
  file: string,
  defaultConfig: A,
  throwOnInvalid?: boolean,
): A {
  // Log a warning if config is accessed before it's allowed
  if (!configReadingAllowed && process.env.NODE_ENV !== 'test') {
    throw new Error('Config accessed before allowed.')
  }

  if (!existsSync(file)) {
    return cloneDeep(defaultConfig)
  }
  try {
    const fileContent = readFileSync(file, 'utf-8')
    try {
      const parsedConfig = JSON.parse(fileContent)

      // Handle backward compatibility for API keys
      if (
        'smallModelApiKey' in parsedConfig &&
        !parsedConfig.smallModelApiKeys
      ) {
        parsedConfig.smallModelApiKeys = parsedConfig.smallModelApiKey
          ? [parsedConfig.smallModelApiKey]
          : []
        delete parsedConfig.smallModelApiKey
      }
      if (
        'largeModelApiKey' in parsedConfig &&
        !parsedConfig.largeModelApiKeys
      ) {
        parsedConfig.largeModelApiKeys = parsedConfig.largeModelApiKey
          ? [parsedConfig.largeModelApiKey]
          : []
        delete parsedConfig.largeModelApiKey
      }

      parsedConfig.smallModelApiKeys =
        parsedConfig.smallModelApiKeys?.filter(key => key !== '') || []
      parsedConfig.largeModelApiKeys =
        parsedConfig.largeModelApiKeys?.filter(key => key !== '') || []

      return {
        ...cloneDeep(defaultConfig),
        ...parsedConfig,
      }
    } catch (error) {
      // Throw a ConfigParseError with the file path and default config
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new ConfigParseError(errorMessage, file, defaultConfig)
    }
  } catch (error: unknown) {
    // Re-throw ConfigParseError if throwOnInvalid is true
    if (error instanceof ConfigParseError && throwOnInvalid) {
      throw error
    }
    return cloneDeep(defaultConfig)
  }
}

/**
 * @function getCurrentProjectConfig
 * @description 获取当前项目的配置。
 *
 * @returns {ProjectConfig} 当前项目的配置对象。
 */
export function getCurrentProjectConfig(): ProjectConfig {
  if (process.env.NODE_ENV === 'test') {
    return TEST_PROJECT_CONFIG_FOR_TESTING
  }

  const absolutePath = resolve(getCwd())
  const config = getConfig(GLOBAL_CLAUDE_FILE, DEFAULT_GLOBAL_CONFIG)

  if (!config.projects) {
    return defaultConfigForProject(absolutePath)
  }

  const projectConfig =
    config.projects[absolutePath] ?? defaultConfigForProject(absolutePath)
  // Not sure how this became a string
  // TODO: Fix upstream
  if (typeof projectConfig.allowedTools === 'string') {
    projectConfig.allowedTools =
      (safeParseJSON(projectConfig.allowedTools) as string[]) ?? []
  }
  return projectConfig
}
/**
 * @function saveCurrentProjectConfig
 * @description 保存当前项目的配置。
 *
 * @param {ProjectConfig} projectConfig - 要保存的项目配置。
 */
export function saveCurrentProjectConfig(projectConfig: ProjectConfig): void {
  if (process.env.NODE_ENV === 'test') {
    for (const key in projectConfig) {
      TEST_PROJECT_CONFIG_FOR_TESTING[key] = projectConfig[key]
    }
    return
  }
  const config = getConfig(GLOBAL_CLAUDE_FILE, DEFAULT_GLOBAL_CONFIG)
  saveConfig(
    GLOBAL_CLAUDE_FILE,
    {
      ...config,
      projects: {
        ...config.projects,
        [resolve(getCwd())]: projectConfig,
      },
    },
    DEFAULT_GLOBAL_CONFIG,
  )
}

/**
 * @async
 * @function isAutoUpdaterDisabled
 * @description 检查自动更新器是否被禁用。
 *
 * @returns {Promise<boolean>} 如果自动更新器被禁用，则返回 `true`。
 */
export async function isAutoUpdaterDisabled(): Promise<boolean> {
  const useExternalUpdater = await checkGate(GATE_USE_EXTERNAL_UPDATER)
  return (
    useExternalUpdater || getGlobalConfig().autoUpdaterStatus === 'disabled'
  )
}
/**
 * @description 用于测试的 MCPRC 配置。
 */
export const TEST_MCPRC_CONFIG_FOR_TESTING: Record<string, McpServerConfig> = {}
/**
 * @function clearMcprcConfigForTesting
 * @description 清除用于测试的 MCPRC 配置。
 */
export function clearMcprcConfigForTesting(): void {
  if (process.env.NODE_ENV === 'test') {
    Object.keys(TEST_MCPRC_CONFIG_FOR_TESTING).forEach(key => {
      delete TEST_MCPRC_CONFIG_FOR_TESTING[key]
    })
  }
}
/**
 * @function addMcprcServerForTesting
 * @description 为测试添加一个 MCPRC 服务器。
 *
 * @param {string} name - 服务器的名称。
 * @param {McpServerConfig} server - 服务器的配置。
 */
export function addMcprcServerForTesting(
  name: string,
  server: McpServerConfig,
): void {
  if (process.env.NODE_ENV === 'test') {
    TEST_MCPRC_CONFIG_FOR_TESTING[name] = server
  }
}
/**
 * @function removeMcprcServerForTesting
 * @description 为测试移除一个 MCPRC 服务器。
 *
 * @param {string} name - 要移除的服务器的名称。
 */
export function removeMcprcServerForTesting(name: string): void {
  if (process.env.NODE_ENV === 'test') {
    if (!TEST_MCPRC_CONFIG_FOR_TESTING[name]) {
      throw new Error(`No MCP server found with name: ${name} in .mcprc`)
    }
    delete TEST_MCPRC_CONFIG_FOR_TESTING[name]
  }
}

/**
 * @function getMcprcConfig
 * @description 获取 `.mcprc` 文件的配置。
 * 这是一个 memoized 函数，它会根据当前工作目录和 `.mcprc` 文件的内容来缓存结果。
 *
 * @returns {Record<string, McpServerConfig>} `.mcprc` 文件的配置。
 */
export const getMcprcConfig = memoize(
  (): Record<string, McpServerConfig> => {
    if (process.env.NODE_ENV === 'test') {
      return TEST_MCPRC_CONFIG_FOR_TESTING
    }

    const mcprcPath = join(getCwd(), '.mcprc')
    if (!existsSync(mcprcPath)) {
      return {}
    }

    try {
      const mcprcContent = readFileSync(mcprcPath, 'utf-8')
      const config = safeParseJSON(mcprcContent)
      if (config && typeof config === 'object') {
        logEvent('tengu_mcprc_found', {
          numServers: Object.keys(config).length.toString(),
        })
        return config as Record<string, McpServerConfig>
      }
    } catch {
      // Ignore errors reading/parsing .mcprc (they're logged in safeParseJSON)
    }
    return {}
  },
  // This function returns the same value as long as the cwd and mcprc file content remain the same
  () => {
    const cwd = getCwd()
    const mcprcPath = join(cwd, '.mcprc')
    if (existsSync(mcprcPath)) {
      try {
        const stat = readFileSync(mcprcPath, 'utf-8')
        return `${cwd}:${stat}`
      } catch {
        return cwd
      }
    }
    return cwd
  },
)

/**
 * @function getOrCreateUserID
 * @description 获取或创建一个唯一的用户 ID。
 * 如果全局配置中已存在用户 ID，则返回该 ID；否则，创建一个新的随机 ID，保存到配置中，然后返回。
 *
 * @returns {string} 用户 ID。
 */
export function getOrCreateUserID(): string {
  const config = getGlobalConfig()
  if (config.userID) {
    return config.userID
  }

  const userID = randomBytes(32).toString('hex')
  saveGlobalConfig({ ...config, userID })
  return userID
}
/**
 * @function getConfigForCLI
 * @description 为命令行界面获取一个配置值。
 *
 * @param {string} key - 要获取的配置的键。
 * @param {boolean} global - 如果为 `true`，则从全局配置中获取；否则从项目配置中获取。
 * @returns {unknown} 配置的值。
 */
export function getConfigForCLI(key: string, global: boolean): unknown {
  logEvent('tengu_config_get', {
    key,
    global: global?.toString() ?? 'false',
  })
  if (global) {
    if (!isGlobalConfigKey(key)) {
      console.error(
        `Error: '${key}' is not a valid config key. Valid keys are: ${GLOBAL_CONFIG_KEYS.join(', ')}`,
      )
      process.exit(1)
    }
    return getGlobalConfig()[key]
  } else {
    if (!isProjectConfigKey(key)) {
      console.error(
        `Error: '${key}' is not a valid config key. Valid keys are: ${PROJECT_CONFIG_KEYS.join(', ')}`,
      )
      process.exit(1)
    }
    return getCurrentProjectConfig()[key]
  }
}

/**
 * @function setConfigForCLI
 * @description 为命令行界面设置一个配置值。
 *
 * @param {string} key - 要设置的配置的键。
 * @param {unknown} value - 要设置的值。
 * @param {boolean} global - 如果为 `true`，则设置全局配置；否则设置项目配置。
 */
export function setConfigForCLI(
  key: string,
  value: unknown,
  global: boolean,
): void {
  logEvent('tengu_config_set', {
    key,
    global: global?.toString() ?? 'false',
  })
  if (global) {
    if (!isGlobalConfigKey(key)) {
      console.error(
        `Error: Cannot set '${key}'. Only these keys can be modified: ${GLOBAL_CONFIG_KEYS.join(', ')}`,
      )
      process.exit(1)
    }

    if (key === 'autoUpdaterStatus' && !isAutoUpdaterStatus(value as string)) {
      console.error(
        `Error: Invalid value for autoUpdaterStatus. Must be one of: disabled, enabled, no_permissions, not_configured`,
      )
      process.exit(1)
    }

    const currentConfig = getGlobalConfig()
    saveGlobalConfig({
      ...currentConfig,
      [key]: value,
    })
  } else {
    if (!isProjectConfigKey(key)) {
      console.error(
        `Error: Cannot set '${key}'. Only these keys can be modified: ${PROJECT_CONFIG_KEYS.join(', ')}. Did you mean --global?`,
      )
      process.exit(1)
    }
    const currentConfig = getCurrentProjectConfig()
    saveCurrentProjectConfig({
      ...currentConfig,
      [key]: value,
    })
  }
  // Wait for the output to be flushed, to avoid clearing the screen.
  setTimeout(() => {
    // Without this we hang indefinitely.
    process.exit(0)
  }, 100)
}

/**
 * @function deleteConfigForCLI
 * @description 为命令行界面删除一个配置值。
 *
 * @param {string} key - 要删除的配置的键。
 * @param {boolean} global - 如果为 `true`，则从全局配置中删除；否则从项目配置中删除。
 */
export function deleteConfigForCLI(key: string, global: boolean): void {
  logEvent('tengu_config_delete', {
    key,
    global: global?.toString() ?? 'false',
  })
  if (global) {
    if (!isGlobalConfigKey(key)) {
      console.error(
        `Error: Cannot delete '${key}'. Only these keys can be modified: ${GLOBAL_CONFIG_KEYS.join(', ')}`,
      )
      process.exit(1)
    }
    const currentConfig = getGlobalConfig()
    delete currentConfig[key]
    saveGlobalConfig(currentConfig)
  } else {
    if (!isProjectConfigKey(key)) {
      console.error(
        `Error: Cannot delete '${key}'. Only these keys can be modified: ${PROJECT_CONFIG_KEYS.join(', ')}. Did you mean --global?`,
      )
      process.exit(1)
    }
    const currentConfig = getCurrentProjectConfig()
    delete currentConfig[key]
    saveCurrentProjectConfig(currentConfig)
  }
}
/**
 * @function listConfigForCLI
 * @description 为命令行界面列出配置值。
 *
 * @param {boolean} global - 如果为 `true`，则列出全局配置；否则列出项目配置。
 * @returns {object} 包含配置值的对象。
 */
export function listConfigForCLI(global: true): GlobalConfig
export function listConfigForCLI(global: false): ProjectConfig
export function listConfigForCLI(global: boolean): object {
  logEvent('tengu_config_list', {
    global: global?.toString() ?? 'false',
  })
  if (global) {
    const currentConfig = pick(getGlobalConfig(), GLOBAL_CONFIG_KEYS)
    return currentConfig
  } else {
    return pick(getCurrentProjectConfig(), PROJECT_CONFIG_KEYS)
  }
}

/**
 * @function getOpenAIApiKey
 * @description 获取 OpenAI API 密钥。
 *
 * @returns {string | undefined} OpenAI API 密钥，或在未设置时返回 `undefined`。
 */
export function getOpenAIApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY
}
/**
 * @function addApiKey
 * @description 向配置中添加一个 API 密钥。
 *
 * @param {GlobalConfig} config - 全局配置。
 * @param {string} key - 要添加的 API 密钥。
 * @param {('small' | 'large')} type - 密钥的类型（'small' 或 'large'）。
 */
export function addApiKey(
  config: GlobalConfig,
  key: string,
  type: 'small' | 'large',
): void {
  const keyArray = type === 'small' ? 'smallModelApiKeys' : 'largeModelApiKeys'
  if (!config[keyArray]) {
    config[keyArray] = []
  }
  if (!config[keyArray]!.includes(key)) {
    config[keyArray]!.push(key)
  }
}
/**
 * @function removeApiKey
 * @description 从配置中移除一个 API 密钥。
 *
 * @param {GlobalConfig} config - 全局配置。
 * @param {string} key - 要移除的 API 密钥。
 * @param {('small' | 'large')} type - 密钥的类型。
 */
export function removeApiKey(
  config: GlobalConfig,
  key: string,
  type: 'small' | 'large',
): void {
  const keyArray = type === 'small' ? 'smallModelApiKeys' : 'largeModelApiKeys'
  if (config[keyArray]) {
    config[keyArray] = config[keyArray]!.filter(k => k !== key)
  }
}
/**
 * @function getApiKeys
 * @description 获取指定类型的所有 API 密钥。
 *
 * @param {GlobalConfig} config - 全局配置。
 * @param {('small' | 'large')} type - 密钥的类型。
 * @returns {string[]} API 密钥的数组。
 */
export function getApiKeys(
  config: GlobalConfig,
  type: 'small' | 'large',
): string[] {
  const keyArray = type === 'small' ? 'smallModelApiKeys' : 'largeModelApiKeys'
  return config[keyArray] || []
}

/**
 * @description 用于轮询密钥选择的计数器。
 */
// Add counter for round-robin key selection
let currentKeyIndex = 0
/**
 * @function getActiveApiKey
 * @description 获取一个活跃的 API 密钥。
 * 它支持轮询机制，以在多个密钥之间进行负载均衡。
 *
 * @param {GlobalConfig} config - 全局配置。
 * @param {('small' | 'large')} type - 密钥的类型。
 * @param {boolean} [roundRobin=true] - 是否使用轮询。
 * @returns {string | undefined} 活跃的 API 密钥，或在没有可用密钥时返回 `undefined`。
 */
export function getActiveApiKey(
  config: GlobalConfig,
  type: 'small' | 'large',
  roundRobin: boolean = true,
): string | undefined {
  let keyArray =
    type === 'small' ? config.smallModelApiKeys : config.largeModelApiKeys
  if (!keyArray) {
    keyArray = []
  }
  const failedKeys = getSessionState('failedApiKeys')[type]
  keyArray = keyArray
    .filter(key => !failedKeys.includes(key))
    .filter(key => key && key !== '')
  if (!keyArray || keyArray.length === 0) {
    return undefined
  }

  // Get the current index from session state or start at 0
  const currentIndex = getSessionState('currentApiKeyIndex')[type]
  if (!roundRobin) {
    return keyArray[currentIndex]
  }

  const nextIndex = (currentIndex + 1) % keyArray.length
  // Store the next index for next time
  setSessionState('currentApiKeyIndex', {
    ...getSessionState('currentApiKeyIndex'),
    [type]: nextIndex,
  })
  return keyArray[nextIndex]
}
/**
 * @function markApiKeyAsFailed
 * @description 将一个 API 密钥标记为失败。
 * 这会将其从活跃密钥池中移除，以避免在当前会话中再次使用。
 *
 * @param {string} key - 要标记为失败的 API 密钥。
 * @param {('small' | 'large')} type - 密钥的类型。
 */
// Add a function to mark an API key as failed
export function markApiKeyAsFailed(key: string, type: 'small' | 'large'): void {
  const failedKeys = getSessionState('failedApiKeys')[type]
  if (!failedKeys.includes(key)) {
    setSessionState('failedApiKeys', {
      ...getSessionState('failedApiKeys'),
      [type]: [...failedKeys, key],
    })
    setSessionState('currentApiKeyIndex', {
      ...getSessionState('currentApiKeyIndex'),
      [type]: getSessionState('currentApiKeyIndex')[type] - 1,
    })
  }
}
