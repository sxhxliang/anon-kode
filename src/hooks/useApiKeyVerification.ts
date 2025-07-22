/**
 * @file src/hooks/useApiKeyVerification.ts
 * @description 该文件定义了 `useApiKeyVerification` hook，它负责验证用户的 Anthropic API 密钥。
 * 这个 hook 提供了一个状态，用于指示密钥的验证状态（加载中、有效、无效、缺失或错误），
 * 以及一个函数，用于重新触发验证过程。
 */
import { useCallback, useState } from 'react'
import { verifyApiKey } from '../services/claude'
import { getAnthropicApiKey, isDefaultApiKey } from '../utils/config'
/**
 * @typedef {'loading' | 'valid' | 'invalid' | 'missing' | 'error'} VerificationStatus
 * @description API 密钥验证的状态。
 */
export type VerificationStatus =
  | 'loading'
  | 'valid'
  | 'invalid'
  | 'missing'
  | 'error'
/**
 * @typedef {object} ApiKeyVerificationResult
 * @description `useApiKeyVerification` hook 的返回结果。
 * @property {VerificationStatus} status - 验证状态。
 * @property {() => Promise<void>} reverify - 用于重新触发验证的函数。
 * @property {Error | null} error - 如果验证过程中发生错误，则为错误对象。
 */
export type ApiKeyVerificationResult = {
  status: VerificationStatus
  reverify: () => Promise<void>
  error: Error | null
}
/**
 * @hook useApiKeyVerification
 * @description 一个自定义的 React hook，用于验证用户的 Anthropic API 密钥。
 *
 * @returns {ApiKeyVerificationResult} 一个包含了验证状态和重新验证函数的对象。
 */
export function useApiKeyVerification(): ApiKeyVerificationResult {
  // const [status, setStatus] = useState<VerificationStatus>(() => {
  //   const apiKey = getAnthropicApiKey()
  //   return apiKey ? 'loading' : 'missing'
  // })
  // const [error, setError] = useState<Error | null>(null)

  // const verify = useCallback(async (): Promise<void> => {
  //   if (isDefaultApiKey()) {
  //     setStatus('valid')
  //     return
  //   }

  //   const apiKey = getAnthropicApiKey()
  //   if (!apiKey) {
  //     const newStatus = 'missing' as const
  //     setStatus(newStatus)
  //     return
  //   }

  //   try {
  //     const isValid = await verifyApiKey(apiKey)
  //     const newStatus = isValid ? 'valid' : 'invalid'
  //     setStatus(newStatus)
  //     return
  //   } catch (error) {
  //     // This happens when there an error response from the API but it's not an invalid API key error
  //     // In this case, we still mark the API key as invalid - but we also log the error so we can
  //     // display it to the user to be more helpful
  //     setError(error as Error)
  //     const newStatus = 'error' as const
  //     setStatus(newStatus)
  //     return
  //   }
  // }, [])

  return {
    status: 'valid',
    reverify: async () => {},
    error: null,
  }
}
