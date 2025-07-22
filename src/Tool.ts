/**
 * @file src/Tool.ts
 * @description 该文件定义了 `Tool` 接口，它是所有工具的基础。
 * 每个工具都必须实现这个接口，它定义了工具的名称、描述、输入模式以及用于生成
 * AI 模型 `prompt` 的函数。
 *
 * 这个接口是应用程序工具系统的核心，它确保了所有工具都有一致的结构和行为。
 */
import { z } from 'zod'
/**
 * @interface Tool
 * @description 代表一个 AI 模型可以使用的工具。
 *
 * @property {string} name - 工具的唯一名称。
 * @property {string} [description] - 工具功能的简要描述。
 * @property {z.ZodObject<any>} inputSchema - 使用 Zod 定义的工具输入参数的模式。
 * @property {Record<string, unknown>} [inputJSONSchema] - 可选的，用于描述工具输入参数的 JSON Schema。
 * @property {(options: { dangerouslySkipPermissions: boolean }) => Promise<string>} prompt - 一个异步函数，用于生成在 AI 模型 `prompt` 中描述该工具的文本。
 */
export interface Tool {
  name: string
  description?: string
  inputSchema: z.ZodObject<any>
  inputJSONSchema?: Record<string, unknown>
  prompt: (options: { dangerouslySkipPermissions: boolean }) => Promise<string>
}
