/**
 * @file src/utils/messages.tsx
 * @description 该文件提供了一系列用于创建、处理和规范化对话消息的工具函数。
 * 它定义了不同类型的消息（用户、助手、进度），并提供了创建这些消息的工厂函数。
 *
 * 主要功能包括：
 * - 定义消息中使用的常量，如中断消息、取消消息等。
 * - 创建不同类型的消息对象的函数。
 * - 处理用户输入的函数，将其转换为适当的消息格式。
 * - 从消息中提取特定标签内容的函数。
 * - 规范化和重新排序消息列表的函数，以便在 UI 中正确显示和发送到 API。
 */
import { randomUUID, UUID } from 'crypto'
import { Box } from 'ink'
import {
  AssistantMessage,
  Message,
  ProgressMessage,
  UserMessage,
} from '../query.js'
import { getCommand, hasCommand } from '../commands'
import { MalformedCommandError } from './errors'
import { logError } from './log'
import { resolve } from 'path'
import { last, memoize } from 'lodash-es'
import { logEvent } from '../services/statsig'
import type { SetToolJSXFn, Tool, ToolUseContext } from '../Tool'
import { lastX } from '../utils/generators'
import { NO_CONTENT_MESSAGE } from '../services/claude'
import {
  ImageBlockParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
  Message as APIMessage,
  ContentBlockParam,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { setCwd } from './state'
import { getCwd } from './state'
import chalk from 'chalk'
import * as React from 'react'
import { UserBashInputMessage } from '../components/messages/UserBashInputMessage'
import { Spinner } from '../components/Spinner'
import { BashTool } from '../tools/BashTool/BashTool'
import { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'

/**
 * @description 定义了在对话中使用的各种常量消息。
 * 这些消息用于表示用户中断、取消操作、拒绝工具使用等特殊情况。
 */
export const INTERRUPT_MESSAGE = '[Request interrupted by user]'
export const INTERRUPT_MESSAGE_FOR_TOOL_USE =
  '[Request interrupted by user for tool use]'
export const CANCEL_MESSAGE =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."
export const REJECT_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
export const NO_RESPONSE_REQUESTED = 'No response requested.'
/**
 * @constant {Set<string>} SYNTHETIC_ASSISTANT_MESSAGES
 * @description 一个包含了所有合成（非 AI 生成）的助手消息的集合。
 */
export const SYNTHETIC_ASSISTANT_MESSAGES = new Set([
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  CANCEL_MESSAGE,
  REJECT_MESSAGE,
  NO_RESPONSE_REQUESTED,
])

/**
 * @function baseCreateAssistantMessage
 * @description 创建一个基础的助手消息对象。
 *
 * @param {ContentBlock[]} content - 消息的内容块。
 * @param {Partial<AssistantMessage>} [extra] - 额外的助手消息属性。
 * @returns {AssistantMessage} 创建的助手消息。
 */
function baseCreateAssistantMessage(
  content: ContentBlock[],
  extra?: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    type: 'assistant',
    costUSD: 0,
    durationMs: 0,
    uuid: randomUUID(),
    message: {
      id: randomUUID(),
      model: '<synthetic>',
      role: 'assistant',
      stop_reason: 'stop_sequence',
      stop_sequence: '',
      type: 'message',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content,
    },
    ...extra,
  }
}
/**
 * @function createAssistantMessage
 * @description 创建一个标准的助手消息。
 *
 * @param {string} content - 消息的文本内容。
 * @returns {AssistantMessage} 创建的助手消息。
 */
export function createAssistantMessage(content: string): AssistantMessage {
  return baseCreateAssistantMessage([
    {
      type: 'text' as const,
      text: content === '' ? NO_CONTENT_MESSAGE : content,
      citations: [],
    },
  ])
}
/**
 * @function createAssistantAPIErrorMessage
 * @description 创建一个表示 API 错误的助手消息。
 *
 * @param {string} content - 错误的文本内容。
 * @returns {AssistantMessage} 创建的错误消息。
 */
export function createAssistantAPIErrorMessage(
  content: string,
): AssistantMessage {
  return baseCreateAssistantMessage(
    [
      {
        type: 'text' as const,
        text: content === '' ? NO_CONTENT_MESSAGE : content,
        citations: [],
      },
    ],
    { isApiErrorMessage: true },
  )
}

/**
 * @typedef {object} FullToolUseResult
 * @description 表示工具使用的完整结果。
 * @property {unknown} data - 工具的输出数据。
 * @property {ToolResultBlockParam['content']} resultForAssistant - 为助手格式化的结果。
 */
export type FullToolUseResult = {
  data: unknown // Matches tool's `Output` type
  resultForAssistant: ToolResultBlockParam['content']
}
/**
 * @function createUserMessage
 * @description 创建一个用户消息。
 *
 * @param {string | ContentBlockParam[]} content - 消息的内容。
 * @param {FullToolUseResult} [toolUseResult] - 工具使用的结果。
 * @returns {UserMessage} 创建的用户消息。
 */
export function createUserMessage(
  content: string | ContentBlockParam[],
  toolUseResult?: FullToolUseResult,
): UserMessage {
  const m: UserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    uuid: randomUUID(),
    toolUseResult,
  }
  return m
}
/**
 * @function createProgressMessage
 * @description 创建一个进度消息，用于在工具执行期间向用户显示反馈。
 *
 * @param {string} toolUseID - 工具使用的 ID。
 * @param {Set<string>} siblingToolUseIDs - 同级工具使用的 ID 集合。
 * @param {AssistantMessage} content - 进度消息的内容。
 * @param {NormalizedMessage[]} normalizedMessages - 规范化后的消息列表。
 * @param {Tool[]} tools - 可用的工具列表。
 * @returns {ProgressMessage} 创建的进度消息。
 */
export function createProgressMessage(
  toolUseID: string,
  siblingToolUseIDs: Set<string>,
  content: AssistantMessage,
  normalizedMessages: NormalizedMessage[],
  tools: Tool[],
): ProgressMessage {
  return {
    type: 'progress',
    content,
    normalizedMessages,
    siblingToolUseIDs,
    tools,
    toolUseID,
    uuid: randomUUID(),
  }
}
/**
 * @function createToolResultStopMessage
 * @description 创建一个表示工具使用被取消的结果消息。
 *
 * @param {string} toolUseID - 工具使用的 ID。
 * @returns {ToolResultBlockParam} 创建的工具结果块。
 */
export function createToolResultStopMessage(
  toolUseID: string,
): ToolResultBlockParam {
  return {
    type: 'tool_result',
    content: CANCEL_MESSAGE,
    is_error: true,
    tool_use_id: toolUseID,
  }
}

/**
 * @async
 * @function processUserInput
 * @description 处理用户的输入，根据当前的模式（bash、prompt 或 koding）将其转换为适当的消息。
 *
 * @param {string} input - 用户的输入字符串。
 * @param {('bash' | 'prompt' | 'koding')} mode - 当前的输入模式。
 * @param {SetToolJSXFn} setToolJSX - 用于设置自定义 JSX 的函数。
 * @param {ToolUseContext & { ... }} context - 工具使用的上下文。
 * @param {string | null} pastedImage - 粘贴的图片的 base64 编码。
 * @returns {Promise<Message[]>} 一个包含已处理消息的数组。
 */
export async function processUserInput(
  input: string,
  mode: 'bash' | 'prompt' | 'koding',
  setToolJSX: SetToolJSXFn,
  context: ToolUseContext & {
    setForkConvoWithMessagesOnTheNextRender: (
      forkConvoWithMessages: Message[],
    ) => void
    options?: {
      isKodingRequest?: boolean
      kodingContext?: string
    }
  },
  pastedImage: string | null,
): Promise<Message[]> {
  // Bash commands
  if (mode === 'bash') {
    logEvent('tengu_input_bash', {})

    const userMessage = createUserMessage(`<bash-input>${input}</bash-input>`)

    // Special case: cd
    if (input.startsWith('cd ')) {
      const oldCwd = getCwd()
      const newCwd = resolve(oldCwd, input.slice(3))
      try {
        await setCwd(newCwd)
        return [
          userMessage,
          createAssistantMessage(
            `<bash-stdout>Changed directory to ${chalk.bold(`${newCwd}/`)}</bash-stdout>`,
          ),
        ]
      } catch (e) {
        logError(e)
        return [
          userMessage,
          createAssistantMessage(
            `<bash-stderr>cwd error: ${e instanceof Error ? e.message : String(e)}</bash-stderr>`,
          ),
        ]
      }
    }

    // All other bash commands
    setToolJSX({
      jsx: (
        <Box flexDirection="column" marginTop={1}>
          <UserBashInputMessage
            addMargin={false}
            param={{ text: `<bash-input>${input}</bash-input>`, type: 'text' }}
          />
          <Spinner />
        </Box>
      ),
      shouldHidePromptInput: false,
    })
    try {
      const validationResult = await BashTool.validateInput({
        command: input,
      })
      if (!validationResult.result) {
        return [userMessage, createAssistantMessage(validationResult.message)]
      }
      const { data } = await lastX(BashTool.call({ command: input }, context))
      return [
        userMessage,
        createAssistantMessage(
          `<bash-stdout>${data.stdout}</bash-stdout><bash-stderr>${data.stderr}</bash-stderr>`,
        ),
      ]
    } catch (e) {
      return [
        userMessage,
        createAssistantMessage(
          `<bash-stderr>Command failed: ${e instanceof Error ? e.message : String(e)}</bash-stderr>`,
        ),
      ]
    } finally {
      setToolJSX(null)
    }
  }
  // Koding mode - special wrapper for display
  else if (mode === 'koding') {
    logEvent('tengu_input_koding', {})

    const userMessage = createUserMessage(
      `<koding-input>${input}</koding-input>`,
    )
    // Add the Koding flag to the message
    userMessage.options = {
      ...userMessage.options,
      isKodingRequest: true,
    }

    // Rest of koding processing is handled separately to capture assistant response
    return [userMessage]
  }

  // Slash commands
  if (input.startsWith('/')) {
    const words = input.slice(1).split(' ')
    let commandName = words[0]
    if (words.length > 1 && words[1] === '(MCP)') {
      commandName = commandName + ' (MCP)'
    }
    if (!commandName) {
      logEvent('tengu_input_slash_missing', { input })
      return [
        createAssistantMessage('Commands are in the form `/command [args]`'),
      ]
    }

    // Check if it's a real command before processing
    if (!hasCommand(commandName, context.options.commands)) {
      // If not a real command, treat it as a regular user input
      logEvent('tengu_input_prompt', {})
      return [createUserMessage(input)]
    }

    const args = input.slice(commandName.length + 2)
    const newMessages = await getMessagesForSlashCommand(
      commandName,
      args,
      setToolJSX,
      context,
    )

    // Local JSX commands
    if (newMessages.length === 0) {
      logEvent('tengu_input_command', { input })
      return []
    }

    // For invalid commands, preserve both the user message and error
    if (
      newMessages.length === 2 &&
      newMessages[0]!.type === 'user' &&
      newMessages[1]!.type === 'assistant' &&
      typeof newMessages[1]!.message.content === 'string' &&
      // @ts-expect-error: TODO: this is probably a bug
      newMessages[1]!.message.content.startsWith('Unknown command:')
    ) {
      logEvent('tengu_input_slash_invalid', { input })
      return newMessages
    }

    // User-Assistant pair (eg. local commands)
    if (newMessages.length === 2) {
      logEvent('tengu_input_command', { input })
      return newMessages
    }

    // A valid command
    logEvent('tengu_input_command', { input })
    return newMessages
  }

  // Regular user prompt
  logEvent('tengu_input_prompt', {})

  // Check if this is a Koding request that needs special handling
  const isKodingRequest = context.options?.isKodingRequest === true
  const kodingContextInfo = context.options?.kodingContext

  // Create base message
  let userMessage: UserMessage

  if (pastedImage) {
    userMessage = createUserMessage([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: pastedImage,
        },
      },
      {
        type: 'text',
        text:
          isKodingRequest && kodingContextInfo
            ? `${kodingContextInfo}\n\n${input}`
            : input,
      },
    ])
  } else {
    userMessage = createUserMessage(
      isKodingRequest && kodingContextInfo
        ? `${kodingContextInfo}\n\n${input}`
        : input,
    )
  }

  // Add the Koding flag to the message if needed
  if (isKodingRequest) {
    userMessage.options = {
      ...userMessage.options,
      isKodingRequest: true,
    }
  }

  return [userMessage]
}

/**
 * @async
 * @function getMessagesForSlashCommand
 * @description 为斜杠命令生成消息。
 * 根据命令的类型（local-jsx、local 或 prompt），它会执行相应的操作并返回一个消息数组。
 *
 * @param {string} commandName - 命令的名称。
 * @param {string} args - 命令的参数。
 * @param {SetToolJSXFn} setToolJSX - 用于设置自定义 JSX 的函数。
 * @param {ToolUseContext & { ... }} context - 工具使用的上下文。
 * @returns {Promise<Message[]>} 一个包含已生成消息的数组。
 */
async function getMessagesForSlashCommand(
  commandName: string,
  args: string,
  setToolJSX: SetToolJSXFn,
  context: ToolUseContext & {
    setForkConvoWithMessagesOnTheNextRender: (
      forkConvoWithMessages: Message[],
    ) => void
  },
): Promise<Message[]> {
  try {
    const command = getCommand(commandName, context.options.commands)
    switch (command.type) {
      case 'local-jsx': {
        return new Promise(resolve => {
          command
            .call(r => {
              setToolJSX(null)
              resolve([
                createUserMessage(`<command-name>${command.userFacingName()}</command-name>
          <command-message>${command.userFacingName()}</command-message>
          <command-args>${args}</command-args>`),
                r
                  ? createAssistantMessage(r)
                  : createAssistantMessage(NO_RESPONSE_REQUESTED),
              ])
            }, context)
            .then(jsx => {
              setToolJSX({
                jsx,
                shouldHidePromptInput: true,
              })
            })
        })
      }
      case 'local': {
        const userMessage =
          createUserMessage(`<command-name>${command.userFacingName()}</command-name>
        <command-message>${command.userFacingName()}</command-message>
        <command-args>${args}</command-args>`)

        try {
          const result = await command.call(args, context)

          return [
            userMessage,
            createAssistantMessage(
              `<local-command-stdout>${result}</local-command-stdout>`,
            ),
          ]
        } catch (e) {
          logError(e)
          return [
            userMessage,
            createAssistantMessage(
              `<local-command-stderr>${String(e)}</local-command-stderr>`,
            ),
          ]
        }
      }
      case 'prompt': {
        const prompt = await command.getPromptForCommand(args)
        return prompt.map(_ => {
          if (typeof _.content === 'string') {
            return {
              message: {
                role: _.role,
                content: `<command-message>${command.userFacingName()} is ${command.progressMessage}…</command-message>
                    <command-name>${command.userFacingName()}</command-name>
                    <command-args>${args}</command-args>
                    <command-contents>${JSON.stringify(
                      _.content,
                      null,
                      2,
                    )}</command-contents>`,
              },
              type: 'user',
              uuid: randomUUID(),
            }
          }
          return {
            message: {
              role: _.role,
              content: _.content.map(_ => {
                switch (_.type) {
                  case 'text':
                    return {
                      ..._,
                      text: `
                        <command-message>${command.userFacingName()} is ${command.progressMessage}…</command-message>
                        <command-name>${command.userFacingName()}</command-name>
                        <command-args>${args}</command-args>
                        <command-contents>${JSON.stringify(
                          _,
                          null,
                          2,
                        )}</command-contents>
                      `,
                    }
                  // TODO: These won't render properly
                  default:
                    return _
                }
              }),
            },
            type: 'user',
            uuid: randomUUID(),
          }
        })
      }
    }
  } catch (e) {
    if (e instanceof MalformedCommandError) {
      return [createAssistantMessage(e.message)]
    }
    throw e
  }
}

/**
 * @function extractTagFromMessage
 * @description 从消息中提取指定标签的内容。
 *
 * @param {Message} message - 要从中提取内容的消息。
 * @param {string} tagName - 要提取的标签的名称。
 * @returns {string | null} 标签的内容，或在未找到时返回 `null`。
 */
export function extractTagFromMessage(
  message: Message,
  tagName: string,
): string | null {
  if (message.type === 'progress') {
    return null
  }
  if (typeof message.message.content !== 'string') {
    return null
  }
  return extractTag(message.message.content, tagName)
}
/**
 * @function extractTag
 * @description 从一个类似 HTML 的字符串中提取指定标签的内容。
 * 它支持自闭合标签、带属性的标签、嵌套标签和多行内容。
 *
 * @param {string} html - 要从中提取内容的字符串。
 * @param {string} tagName - 要提取的标签的名称。
 * @returns {string | null} 标签的内容，或在未找到时返回 `null`。
 */
export function extractTag(html: string, tagName: string): string | null {
  if (!html.trim() || !tagName.trim()) {
    return null
  }

  // Escape special characters in the tag name
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Create regex pattern that handles:
  // 1. Self-closing tags
  // 2. Tags with attributes
  // 3. Nested tags of the same type
  // 4. Multiline content
  const pattern = new RegExp(
    `<${escapedTag}(?:\\s+[^>]*)?>` + // Opening tag with optional attributes
      '([\\s\\S]*?)' + // Content (non-greedy match)
      `<\\/${escapedTag}>`, // Closing tag
    'gi',
  )

  let match
  let depth = 0
  let lastIndex = 0
  const openingTag = new RegExp(`<${escapedTag}(?:\\s+[^>]*?)?>`, 'gi')
  const closingTag = new RegExp(`<\\/${escapedTag}>`, 'gi')

  while ((match = pattern.exec(html)) !== null) {
    // Check for nested tags
    const content = match[1]
    const beforeMatch = html.slice(lastIndex, match.index)

    // Reset depth counter
    depth = 0

    // Count opening tags before this match
    openingTag.lastIndex = 0
    while (openingTag.exec(beforeMatch) !== null) {
      depth++
    }

    // Count closing tags before this match
    closingTag.lastIndex = 0
    while (closingTag.exec(beforeMatch) !== null) {
      depth--
    }

    // Only include content if we're at the correct nesting level
    if (depth === 0 && content) {
      return content
    }

    lastIndex = match.index + match[0].length
  }

  return null
}

/**
 * @function isNotEmptyMessage
 * @description 检查一条消息是否不为空。
 * 空消息是指那些只包含空白字符或特定系统消息（如 `NO_CONTENT_MESSAGE`）的消息。
 *
 * @param {Message} message - 要检查的消息。
 * @returns {boolean} 如果消息不为空，则返回 `true`。
 */
export function isNotEmptyMessage(message: Message): boolean {
  if (message.type === 'progress') {
    return true
  }

  if (typeof message.message.content === 'string') {
    return message.message.content.trim().length > 0
  }

  if (message.message.content.length === 0) {
    return false
  }

  // Skip multi-block messages for now
  if (message.message.content.length > 1) {
    return true
  }

  if (message.message.content[0]!.type !== 'text') {
    return true
  }

  return (
    message.message.content[0]!.text.trim().length > 0 &&
    message.message.content[0]!.text !== NO_CONTENT_MESSAGE &&
    message.message.content[0]!.text !== INTERRUPT_MESSAGE_FOR_TOOL_USE
  )
}

/**
 * @typedef {object} NormalizedUserMessage
 * @description 规范化后的用户消息类型。
 */
// TODO: replace this with plain UserMessage if/when PR #405 lands
type NormalizedUserMessage = {
  message: {
    content: [
      | TextBlockParam
      | ImageBlockParam
      | ToolUseBlockParam
      | ToolResultBlockParam,
    ]
    role: 'user'
  }
  type: 'user'
  uuid: UUID
}
/**
 * @typedef {NormalizedUserMessage | AssistantMessage | ProgressMessage} NormalizedMessage
 * @description 规范化后的消息的联合类型。
 */
export type NormalizedMessage =
  | NormalizedUserMessage
  | AssistantMessage
  | ProgressMessage
/**
 * @function normalizeMessages
 * @description 将消息列表规范化，将包含多个内容块的消息拆分为多个单独的消息。
 * 这使得在 UI 中渲染和处理消息变得更加容易。
 *
 * @param {Message[]} messages - 要规范化的消息列表。
 * @returns {NormalizedMessage[]} 规范化后的消息列表。
 */
// Split messages, so each content block gets its own message
export function normalizeMessages(messages: Message[]): NormalizedMessage[] {
  return messages.flatMap(message => {
    if (message.type === 'progress') {
      return [message] as NormalizedMessage[]
    }
    if (typeof message.message.content === 'string') {
      return [message] as NormalizedMessage[]
    }
    return message.message.content.map(_ => {
      switch (message.type) {
        case 'assistant':
          return {
            type: 'assistant',
            uuid: randomUUID(),
            message: {
              ...message.message,
              content: [_],
            },
            costUSD:
              (message as AssistantMessage).costUSD /
              message.message.content.length,
            durationMs: (message as AssistantMessage).durationMs,
          } as NormalizedMessage
        case 'user':
          // It seems like the line below was a no-op before, but I'm not sure.
          // To check, we could throw an error if any of the following are true:
          // - message `role` does isn't `user` -- this possibility is allowed by MCP tools,
          //   though isn't supposed to happen in practice (we should fix this)
          // - message `content` is not an array -- this one is more concerning because it's
          //   not allowed by the `NormalizedUserMessage` type, but if it's happening that was
          //   probably a bug before.
          // Maybe I'm missing something? -(ab)
          // return createUserMessage([_]) as NormalizedMessage
          return message as NormalizedUserMessage
      }
    })
  })
}

/**
 * @typedef {AssistantMessage & { message: { content: ToolUseBlock[] } }} ToolUseRequestMessage
 * @description 表示一个请求使用工具的助手消息。
 */
type ToolUseRequestMessage = AssistantMessage & {
  message: { content: ToolUseBlock[] }
}
/**
 * @function isToolUseRequestMessage
 * @description 检查一条消息是否是请求使用工具的助手消息。
 *
 * @param {Message} message - 要检查的消息。
 * @returns {message is ToolUseRequestMessage} 如果是工具使用请求消息，则返回 `true`。
 */
function isToolUseRequestMessage(
  message: Message,
): message is ToolUseRequestMessage {
  return (
    message.type === 'assistant' &&
    'costUSD' in message &&
    // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly
    message.message.content.some(_ => _.type === 'tool_use')
  )
}
/**
 * @function reorderMessages
 * @description 重新排序消息列表，以确保工具结果消息紧跟在相应的工具使用消息之后。
 * 这对于在 UI 中正确地显示对话流程至关重要。
 *
 * @param {NormalizedMessage[]} messages - 要重新排序的消息列表。
 * @returns {NormalizedMessage[]} 重新排序后的消息列表。
 */
// Re-order, to move result messages to be after their tool use messages
export function reorderMessages(
  messages: NormalizedMessage[],
): NormalizedMessage[] {
  const ms: NormalizedMessage[] = []
  const toolUseMessages: ToolUseRequestMessage[] = []

  for (const message of messages) {
    // track tool use messages we've seen
    if (isToolUseRequestMessage(message)) {
      toolUseMessages.push(message)
    }

    // if it's a tool progress message...
    if (message.type === 'progress') {
      // replace any existing progress messages with this one
      const existingProgressMessage = ms.find(
        _ => _.type === 'progress' && _.toolUseID === message.toolUseID,
      )
      if (existingProgressMessage) {
        ms[ms.indexOf(existingProgressMessage)] = message
        continue
      }
      // otherwise, insert it after its tool use
      const toolUseMessage = toolUseMessages.find(
        _ => _.message.content[0]?.id === message.toolUseID,
      )
      if (toolUseMessage) {
        ms.splice(ms.indexOf(toolUseMessage) + 1, 0, message)
        continue
      }
    }

    // if it's a tool result, insert it after its tool use and progress messages
    if (
      message.type === 'user' &&
      Array.isArray(message.message.content) &&
      message.message.content[0]?.type === 'tool_result'
    ) {
      const toolUseID = (message.message.content[0] as ToolResultBlockParam)
        ?.tool_use_id

      // First check for progress messages
      const lastProgressMessage = ms.find(
        _ => _.type === 'progress' && _.toolUseID === toolUseID,
      )
      if (lastProgressMessage) {
        ms.splice(ms.indexOf(lastProgressMessage) + 1, 0, message)
        continue
      }

      // If no progress messages, check for tool use messages
      const toolUseMessage = toolUseMessages.find(
        _ => _.message.content[0]?.id === toolUseID,
      )
      if (toolUseMessage) {
        ms.splice(ms.indexOf(toolUseMessage) + 1, 0, message)
        continue
      }
    }

    // otherwise, just add it to the list
    else {
      ms.push(message)
    }
  }

  return ms
}

/**
 * @function getToolResultIDs
 * @description 获取一个包含了所有工具结果 ID 及其是否为错误的映射。
 * 这是一个 memoized 函数，以提高性能。
 *
 * @param {NormalizedMessage[]} normalizedMessages - 规范化后的消息列表。
 * @returns {{ [toolUseID: string]: boolean }} 一个从工具使用 ID 到布尔值（表示是否为错误）的映射。
 */
const getToolResultIDs = memoize(
  (normalizedMessages: NormalizedMessage[]): { [toolUseID: string]: boolean } =>
    Object.fromEntries(
      normalizedMessages.flatMap(_ =>
        _.type === 'user' && _.message.content[0]?.type === 'tool_result'
          ? [
              [
                _.message.content[0]!.tool_use_id,
                _.message.content[0]!.is_error ?? false,
              ],
            ]
          : ([] as [string, boolean][]),
      ),
    ),
)
/**
 * @function getUnresolvedToolUseIDs
 * @description 获取所有尚未解决的工具使用的 ID。
 *
 * @param {NormalizedMessage[]} normalizedMessages - 规范化后的消息列表。
 * @returns {Set<string>} 一个包含未解决工具使用 ID 的集合。
 */
export function getUnresolvedToolUseIDs(
  normalizedMessages: NormalizedMessage[],
): Set<string> {
  const toolResults = getToolResultIDs(normalizedMessages)
  return new Set(
    normalizedMessages
      .filter(
        (
          _,
        ): _ is AssistantMessage & {
          message: { content: [ToolUseBlockParam] }
        } =>
          _.type === 'assistant' &&
          Array.isArray(_.message.content) &&
          _.message.content[0]?.type === 'tool_use' &&
          !(_.message.content[0]?.id in toolResults),
      )
      .map(_ => _.message.content[0].id),
  )
}

/**
 * @function getInProgressToolUseIDs
 * @description 获取所有正在进行中的工具使用的 ID。
 * 一个工具使用被认为是“进行中”的，如果它有对应的进度消息但没有结果消息，或者如果它是第一个未解决的工具使用。
 *
 * @param {NormalizedMessage[]} normalizedMessages - 规范化后的消息列表。
 * @returns {Set<string>} 一个包含进行中工具使用 ID 的集合。
 */
/**
 * Tool uses are in flight if either:
 * 1. They have a corresponding progress message and no result message
 * 2. They are the first unresoved tool use
 *
 * TODO: Find a way to harden this logic to make it more explicit
 */
export function getInProgressToolUseIDs(
  normalizedMessages: NormalizedMessage[],
): Set<string> {
  const unresolvedToolUseIDs = getUnresolvedToolUseIDs(normalizedMessages)
  const toolUseIDsThatHaveProgressMessages = new Set(
    normalizedMessages.filter(_ => _.type === 'progress').map(_ => _.toolUseID),
  )
  return new Set(
    (
      normalizedMessages.filter(_ => {
        if (_.type !== 'assistant') {
          return false
        }
        if (_.message.content[0]?.type !== 'tool_use') {
          return false
        }
        const toolUseID = _.message.content[0].id
        if (toolUseID === unresolvedToolUseIDs.values().next().value) {
          return true
        }

        if (
          toolUseIDsThatHaveProgressMessages.has(toolUseID) &&
          unresolvedToolUseIDs.has(toolUseID)
        ) {
          return true
        }

        return false
      }) as AssistantMessage[]
    ).map(_ => (_.message.content[0]! as ToolUseBlockParam).id),
  )
}

/**
 * @function getErroredToolUseMessages
 * @description 获取所有导致错误的工具使用的助手消息。
 *
 * @param {NormalizedMessage[]} normalizedMessages - 规范化后的消息列表。
 * @returns {AssistantMessage[]} 一个包含导致错误的工具使用的助手消息的数组。
 */
export function getErroredToolUseMessages(
  normalizedMessages: NormalizedMessage[],
): AssistantMessage[] {
  const toolResults = getToolResultIDs(normalizedMessages)
  return normalizedMessages.filter(
    _ =>
      _.type === 'assistant' &&
      Array.isArray(_.message.content) &&
      _.message.content[0]?.type === 'tool_use' &&
      _.message.content[0]?.id in toolResults &&
      toolResults[_.message.content[0]?.id],
  ) as AssistantMessage[]
}
/**
 * @function normalizeMessagesForAPI
 * @description 为发送到 API 而规范化消息列表。
 * 它会合并连续的工具结果消息，以符合 API 的要求。
 *
 * @param {Message[]} messages - 要规范化的消息列表。
 * @returns {(UserMessage | AssistantMessage)[]} 规范化后的消息列表。
 */
export function normalizeMessagesForAPI(
  messages: Message[],
): (UserMessage | AssistantMessage)[] {
  const result: (UserMessage | AssistantMessage)[] = []
  messages
    .filter(_ => _.type !== 'progress')
    .forEach(message => {
      switch (message.type) {
        case 'user': {
          // If the current message is not a tool result, add it to the result
          if (
            !Array.isArray(message.message.content) ||
            message.message.content[0]?.type !== 'tool_result'
          ) {
            result.push(message)
            return
          }

          // If the last message is not a tool result, add it to the result
          const lastMessage = last(result)
          if (
            !lastMessage ||
            lastMessage?.type === 'assistant' ||
            !Array.isArray(lastMessage.message.content) ||
            lastMessage.message.content[0]?.type !== 'tool_result'
          ) {
            result.push(message)
            return
          }

          // Otherwise, merge the current message with the last message
          result[result.indexOf(lastMessage)] = {
            ...lastMessage,
            message: {
              ...lastMessage.message,
              content: [
                ...lastMessage.message.content,
                ...message.message.content,
              ],
            },
          }
          return
        }
        case 'assistant':
          result.push(message)
          return
      }
    })
  return result
}

/**
 * @function normalizeContentFromAPI
 * @description 规范化从 API 返回的内容，过滤掉空消息。
 *
 * @param {APIMessage['content']} content - 从 API 返回的内容。
 * @returns {APIMessage['content']} 规范化后的内容。
 */
// Sometimes the API returns empty messages (eg. "\n\n"). We need to filter these out,
// otherwise they will give an API error when we send them to the API next time we call query().
export function normalizeContentFromAPI(
  content: APIMessage['content'],
): APIMessage['content'] {
  const filteredContent = content.filter(
    _ => _.type !== 'text' || _.text.trim().length > 0,
  )

  if (filteredContent.length === 0) {
    return [{ type: 'text', text: NO_CONTENT_MESSAGE, citations: [] }]
  }

  return filteredContent
}
/**
 * @function isEmptyMessageText
 * @description 检查消息文本是否为空。
 *
 * @param {string} text - 要检查的文本。
 * @returns {boolean} 如果文本为空，则返回 `true`。
 */
export function isEmptyMessageText(text: string): boolean {
  return (
    stripSystemMessages(text).trim() === '' ||
    text.trim() === NO_CONTENT_MESSAGE
  )
}
/**
 * @constant {string[]} STRIPPED_TAGS
 * @description 一个包含了在显示给用户之前需要从消息中剥离的系统标签的数组。
 */
const STRIPPED_TAGS = [
  'commit_analysis',
  'context',
  'function_analysis',
  'pr_analysis',
]
/**
 * @function stripSystemMessages
 * @description 从内容中剥离所有系统消息标签。
 *
 * @param {string} content - 要处理的内容。
 * @returns {string} 剥离了系统消息后的内容。
 */
export function stripSystemMessages(content: string): string {
  const regex = new RegExp(`<(${STRIPPED_TAGS.join('|')})>.*?</\\1>\n?`, 'gs')
  return content.replace(regex, '').trim()
}

/**
 * @function getToolUseID
 * @description 从一条消息中获取工具使用的 ID。
 *
 * @param {NormalizedMessage} message - 要从中获取 ID 的消息。
 * @returns {string | null} 工具使用的 ID，或在消息不是工具使用或结果时返回 `null`。
 */
export function getToolUseID(message: NormalizedMessage): string | null {
  switch (message.type) {
    case 'assistant':
      if (message.message.content[0]?.type !== 'tool_use') {
        return null
      }
      return message.message.content[0].id
    case 'user':
      if (message.message.content[0]?.type !== 'tool_result') {
        return null
      }
      return message.message.content[0].tool_use_id
    case 'progress':
      return message.toolUseID
  }
}
/**
 * @function getLastAssistantMessageId
 * @description 获取最后一条助手消息的 ID。
 *
 * @param {Message[]} messages - 消息列表。
 * @returns {string | undefined} 最后一条助手消息的 ID，或在未找到时返回 `undefined`。
 */
export function getLastAssistantMessageId(
  messages: Message[],
): string | undefined {
  // Iterate from the end of the array to find the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && message.type === 'assistant') {
      return message.message.id
    }
  }
  return undefined
}
