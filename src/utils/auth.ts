/**
 * @file src/utils/auth.ts
 * @description 该文件提供了与身份验证相关的工具函数。
 * 它包括检查 Anthropic 身份验证是否已启用，以及用户是否已登录。
 */
import { USE_BEDROCK, USE_VERTEX } from './model'
import { getGlobalConfig } from './config'
/**
 * @function isAnthropicAuthEnabled
 * @description 检查 Anthropic 身份验证是否已启用。
 *
 * @returns {boolean} 如果启用了 Anthropic 身份验证，则返回 `true`。
 */
export function isAnthropicAuthEnabled(): boolean {
  return false
  // return !(USE_BEDROCK || USE_VERTEX)
}
/**
 * @function isLoggedInToAnthropic
 * @description 检查用户是否已登录到 Anthropic。
 *
 * @returns {boolean} 如果用户已登录，则返回 `true`。
 */
export function isLoggedInToAnthropic(): boolean {
  return false
  // const config = getGlobalConfig()
  // return !!config.primaryApiKey
}
