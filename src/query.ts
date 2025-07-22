/**
 * @file src/query.ts
 * @description This file is the core of the AI interaction logic. It defines the `query` function,
 * which is responsible for sending requests to the AI model, handling responses, and managing
 * the entire lifecycle of a query. This includes processing tool usage, handling streaming
 * responses, and managing conversational context.
 *
 * The file orchestrates the communication between the user, the AI model, and the available
 * tools, making it a central piece of the application's architecture.
 */
import {
  Message as APIAssistantMessage,
  MessageParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { UUID } from 'crypto'
import type { Tool, ToolUseContext } from './Tool'
import {
  messagePairValidForBinaryFeedback,
  shouldUseBinaryFeedback,
} from './components/binary-feedback/utils.js'
import { CanUseToolFn } from './hooks/useCanUseTool'
import {
  formatSystemPromptWithContext,
  querySonnet,
} from './services/claude.js'
import { logEvent } from './services/statsig'
import { all } from './utils/generators'
import { logError } from './utils/log'
import {
  createAssistantMessage,
  createProgressMessage,
  createToolResultStopMessage,
  createUserMessage,
  FullToolUseResult,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  NormalizedMessage,
  normalizeMessagesForAPI,
} from './utils/messages.js'
import { BashTool } from './tools/BashTool/BashTool'
import { getCwd } from './utils/state'

/**
 * @typedef {object} Response
 * @description Represents a simple response object containing the cost and the response string.
 * @property {number} costUSD - The cost of the response in USD.
 * @property {string} response - The response string.
 */
export type Response = { costUSD: number; response: string }
/**
 * @typedef {object} UserMessage
 * @description Represents a message from the user.
 * @property {MessageParam} message - The message content, formatted for the API.
 * @property {'user'} type - The type of the message.
 * @property {UUID} uuid - A unique identifier for the message.
 * @property {FullToolUseResult} [toolUseResult] - The result of a tool use, if applicable.
 * @property {object} [options] - Additional options for the message.
 */
export type UserMessage = {
  message: MessageParam
  type: 'user'
  uuid: UUID
  toolUseResult?: FullToolUseResult
  options?: {
    isKodingRequest?: boolean
    kodingContext?: string
  }
}
/**
 * @typedef {object} AssistantMessage
 * @description Represents a message from the assistant.
 * @property {number} costUSD - The cost of the assistant's response in USD.
 * @property {number} durationMs - The duration of the API call in milliseconds.
 * @property {APIAssistantMessage} message - The assistant's message content from the API.
 * @property {'assistant'} type - The type of the message.
 * @property {UUID} uuid - A unique identifier for the message.
 * @property {boolean} [isApiErrorMessage] - A flag indicating if the message is an API error message.
 */
export type AssistantMessage = {
  costUSD: number
  durationMs: number
  message: APIAssistantMessage
  type: 'assistant'
  uuid: UUID
  isApiErrorMessage?: boolean
}
/**
 * @typedef {object} BinaryFeedbackResult
 * @description Represents the result of a binary feedback session.
 * @property {AssistantMessage | null} message - The selected message, or null if the user cancelled.
 * @property {boolean} shouldSkipPermissionCheck - A flag indicating if the permission check should be skipped.
 */
export type BinaryFeedbackResult =
  | { message: AssistantMessage | null; shouldSkipPermissionCheck: false }
  | { message: AssistantMessage; shouldSkipPermissionCheck: true }
/**
 * @typedef {object} ProgressMessage
 * @description Represents a progress update message, typically used for streaming tool output.
 * @property {AssistantMessage} content - The content of the progress message.
 * @property {NormalizedMessage[]} normalizedMessages - The normalized messages associated with the progress.
 * @property {Set<string>} siblingToolUseIDs - The IDs of sibling tool uses.
 * @property {Tool[]} tools - The tools associated with the progress message.
 * @property {string} toolUseID - The ID of the tool use that this progress message is for.
 * @property {'progress'} type - The type of the message.
 * @property {UUID} uuid - A unique identifier for the message.
 */
export type ProgressMessage = {
  content: AssistantMessage
  normalizedMessages: NormalizedMessage[]
  siblingToolUseIDs: Set<string>
  tools: Tool[]
  toolUseID: string
  type: 'progress'
  uuid: UUID
}

/**
 * @typedef {UserMessage | AssistantMessage | ProgressMessage} Message
 * @description A union type representing all possible message types in a conversation.
 */
// Each array item is either a single message or a message-and-response pair
export type Message = UserMessage | AssistantMessage | ProgressMessage

const MAX_TOOL_USE_CONCURRENCY = 10

/**
 * @async
 * @function queryWithBinaryFeedback
 * @description This function handles the logic for querying the AI model with binary feedback.
 * If the user is an "ant" and binary feedback is enabled, it fetches two responses from the
 * assistant and prompts the user to choose the better one. Otherwise, it fetches a single
 * response.
 *
 * @param {ToolUseContext} toolUseContext - The context for the tool use.
 * @param {() => Promise<AssistantMessage>} getAssistantResponse - A function to get a response from the assistant.
 * @param {(m1: AssistantMessage, m2: AssistantMessage) => Promise<BinaryFeedbackResult>} [getBinaryFeedbackResponse] - A function to get binary feedback from the user.
 * @returns {Promise<BinaryFeedbackResult>} A promise that resolves to the result of the feedback session, or a single response if feedback is not used.
 */
// Returns a message if we got one, or `null` if the user cancelled
async function queryWithBinaryFeedback(
  toolUseContext: ToolUseContext,
  getAssistantResponse: () => Promise<AssistantMessage>,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
): Promise<BinaryFeedbackResult> {
  if (
    process.env.USER_TYPE !== 'ant' ||
    !getBinaryFeedbackResponse ||
    !(await shouldUseBinaryFeedback())
  ) {
    const assistantMessage = await getAssistantResponse()
    if (toolUseContext.abortController.signal.aborted) {
      return { message: null, shouldSkipPermissionCheck: false }
    }
    return { message: assistantMessage, shouldSkipPermissionCheck: false }
  }
  const [m1, m2] = await Promise.all([
    getAssistantResponse(),
    getAssistantResponse(),
  ])
  if (toolUseContext.abortController.signal.aborted) {
    return { message: null, shouldSkipPermissionCheck: false }
  }
  if (m2.isApiErrorMessage) {
    // If m2 is an error, we might as well return m1, even if it's also an error --
    // the UI will display it as an error as it would in the non-feedback path.
    return { message: m1, shouldSkipPermissionCheck: false }
  }
  if (m1.isApiErrorMessage) {
    return { message: m2, shouldSkipPermissionCheck: false }
  }
  if (!messagePairValidForBinaryFeedback(m1, m2)) {
    return { message: m1, shouldSkipPermissionCheck: false }
  }
  return await getBinaryFeedbackResponse(m1, m2)
}

/**
 * @async
 * @generator
 * @function query
 * @description This is the main function for querying the AI model. It is an async generator that yields messages as they are processed.
 * It handles the entire lifecycle of a query, from sending the request to processing the response, including tool usage and streaming.
 *
 * ### The Rules of Thinking:
 *
 * 1. A message containing a `thinking` or `redacted_thinking` block must be part of a query where `max_thinking_length` > 0.
 * 2. A `thinking` block cannot be the last message in a block.
 * 3. `Thinking` blocks must be preserved throughout an assistant's turn, including tool use and results.
 *
 * Adherence to these rules is crucial for the proper functioning of the thinking process.
 *
 * @param {Message[]} messages - The conversation history.
 * @param {string[]} systemPrompt - The system prompt to guide the AI model.
 * @param {{ [k: string]: string }} context - The user's context, including environment and configuration.
 * @param {CanUseToolFn} canUseTool - A function to check if a tool can be used.
 * @param {ToolUseContext} toolUseContext - The context for tool usage.
 * @param {(m1: AssistantMessage, m2: AssistantMessage) => Promise<BinaryFeedbackResult>} [getBinaryFeedbackResponse] - A function to get binary feedback from the user.
 *
 * @yields {Message} A message representing the assistant's response or a progress update.
 */
export async function* query(
  messages: Message[],
  systemPrompt: string[],
  context: { [k: string]: string },
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
): AsyncGenerator<Message, void> {
  const fullSystemPrompt = formatSystemPromptWithContext(systemPrompt, context)
  function getAssistantResponse() {
    return querySonnet(
      normalizeMessagesForAPI(messages),
      fullSystemPrompt,
      toolUseContext.options.maxThinkingTokens,
      toolUseContext.options.tools,
      toolUseContext.abortController.signal,
      {
        dangerouslySkipPermissions:
          toolUseContext.options.dangerouslySkipPermissions ?? false,
        model: toolUseContext.options.slowAndCapableModel,
        prependCLISysprompt: true,
      },
    )
  }

  const result = await queryWithBinaryFeedback(
    toolUseContext,
    getAssistantResponse,
    getBinaryFeedbackResponse,
  )

  if (result.message === null) {
    yield createAssistantMessage(INTERRUPT_MESSAGE)
    return
  }

  const assistantMessage = result.message
  const shouldSkipPermissionCheck = result.shouldSkipPermissionCheck

  yield assistantMessage

  // @see https://docs.anthropic.com/en/docs/build-with-claude/tool-use
  // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly
  const toolUseMessages = assistantMessage.message.content.filter(
    _ => _.type === 'tool_use',
  )

  // If there's no more tool use, we're done
  if (!toolUseMessages.length) {
    return
  }

  const toolResults: UserMessage[] = []

  // Prefer to run tools concurrently, if we can
  // TODO: tighten up the logic -- we can run concurrently much more often than this
  if (
    toolUseMessages.every(msg =>
      toolUseContext.options.tools.find(t => t.name === msg.name)?.isReadOnly(),
    )
  ) {
    for await (const message of runToolsConcurrently(
      toolUseMessages,
      assistantMessage,
      canUseTool,
      toolUseContext,
      shouldSkipPermissionCheck,
    )) {
      yield message
      // progress messages are not sent to the server, so don't need to be accumulated for the next turn
      if (message.type === 'user') {
        toolResults.push(message)
      }
    }
  } else {
    for await (const message of runToolsSerially(
      toolUseMessages,
      assistantMessage,
      canUseTool,
      toolUseContext,
      shouldSkipPermissionCheck,
    )) {
      yield message
      // progress messages are not sent to the server, so don't need to be accumulated for the next turn
      if (message.type === 'user') {
        toolResults.push(message)
      }
    }
  }

  if (toolUseContext.abortController.signal.aborted) {
    yield createAssistantMessage(INTERRUPT_MESSAGE_FOR_TOOL_USE)
    return
  }

  // Sort toolResults to match the order of toolUseMessages
  const orderedToolResults = toolResults.sort((a, b) => {
    const aIndex = toolUseMessages.findIndex(
      tu => tu.id === (a.message.content[0] as ToolUseBlock).id,
    )
    const bIndex = toolUseMessages.findIndex(
      tu => tu.id === (b.message.content[0] as ToolUseBlock).id,
    )
    return aIndex - bIndex
  })

  yield* await query(
    [...messages, assistantMessage, ...orderedToolResults],
    systemPrompt,
    context,
    canUseTool,
    toolUseContext,
    getBinaryFeedbackResponse,
  )
}

/**
 * @async
 * @generator
 * @function runToolsConcurrently
 * @description This function runs multiple tools concurrently, which is useful for improving
 * performance when multiple tool uses are requested by the AI model. It uses the `all` utility
 * to manage the concurrent execution of tools.
 *
 * @param {ToolUseBlock[]} toolUseMessages - The tool use messages from the assistant.
 * @param {AssistantMessage} assistantMessage - The assistant message that triggered the tool use.
 * @param {CanUseToolFn} canUseTool - A function to check if a tool can be used.
 * @param {ToolUseContext} toolUseContext - The context for the tool use.
 * @param {boolean} [shouldSkipPermissionCheck] - A flag to skip the permission check.
 *
 * @yields {Message} A message representing the result of a tool use or a progress update.
 */
async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  yield* all(
    toolUseMessages.map(toolUse =>
      runToolUse(
        toolUse,
        new Set(toolUseMessages.map(_ => _.id)),
        assistantMessage,
        canUseTool,
        toolUseContext,
        shouldSkipPermissionCheck,
      ),
    ),
    MAX_TOOL_USE_CONCURRENCY,
  )
}
/**
 * @async
 * @generator
 * @function runToolsSerially
 * @description This function runs multiple tools serially, one after another. This is used
 * when tools cannot be run concurrently, for example, if they modify the same state or
 * have other dependencies.
 *
 * @param {ToolUseBlock[]} toolUseMessages - The tool use messages from the assistant.
 * @param {AssistantMessage} assistantMessage - The assistant message that triggered the tool use.
 * @param {CanUseToolFn} canUseTool - A function to check if a tool can be used.
 * @param {ToolUseContext} toolUseContext - The context for the tool use.
 * @param {boolean} [shouldSkipPermissionCheck] - A flag to skip the permission check.
 *
 * @yields {Message} A message representing the result of a tool use or a progress update.
 */
async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  for (const toolUse of toolUseMessages) {
    yield* runToolUse(
      toolUse,
      new Set(toolUseMessages.map(_ => _.id)),
      assistantMessage,
      canUseTool,
      toolUseContext,
      shouldSkipPermissionCheck,
    )
  }
}

/**
 * @async
 * @generator
 * @function runToolUse
 * @description This function executes a single tool use request from the AI model. It finds the
 * corresponding tool, validates the input, checks for permissions, and then calls the tool's
 * `run` method. It yields progress and result messages as they become available.
 *
 * @param {ToolUseBlock} toolUse - The tool use block from the assistant's message.
 * @param {Set<string>} siblingToolUseIDs - The IDs of sibling tool uses.
 * @param {AssistantMessage} assistantMessage - The assistant message that triggered the tool use.
 * @param {CanUseToolFn} canUseTool - A function to check if a tool can be used.
 * @param {ToolUseContext} toolUseContext - The context for the tool use.
 * @param {boolean} [shouldSkipPermissionCheck] - A flag to skip the permission check.
 *
 * @yields {Message} A message representing the result of the tool use or a progress update.
 */
export async function* runToolUse(
  toolUse: ToolUseBlock,
  siblingToolUseIDs: Set<string>,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  const toolName = toolUse.name
  const tool = toolUseContext.options.tools.find(t => t.name === toolName)

  // Check if the tool exists
  if (!tool) {
    logEvent('tengu_tool_use_error', {
      error: `No such tool available: ${toolName}`,
      messageID: assistantMessage.message.id,
      toolName,
      toolUseID: toolUse.id,
    })
    yield createUserMessage([
      {
        type: 'tool_result',
        content: `Error: No such tool available: ${toolName}`,
        is_error: true,
        tool_use_id: toolUse.id,
      },
    ])
    return
  }

  const toolInput = toolUse.input as { [key: string]: string }

  try {
    if (toolUseContext.abortController.signal.aborted) {
      logEvent('tengu_tool_use_cancelled', {
        toolName: tool.name,
        toolUseID: toolUse.id,
      })
      const message = createUserMessage([
        createToolResultStopMessage(toolUse.id),
      ])
      yield message
      return
    }

    for await (const message of checkPermissionsAndCallTool(
      tool,
      toolUse.id,
      siblingToolUseIDs,
      toolInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
      shouldSkipPermissionCheck,
    )) {
      yield message
    }
  } catch (e) {
    logError(e)
  }
}

/**
 * @function normalizeToolInput
 * @description This function normalizes the input for a tool before it is used.
 * For example, it can remove unnecessary parts of a command for the `BashTool`.
 * This helps in cleaning up the input and making it more consistent.
 *
 * @param {Tool} tool - The tool whose input is to be normalized.
 * @param {{ [key: string]: boolean | string | number }} input - The input to the tool.
 * @returns {{ [key: string]: boolean | string | number }} The normalized tool input.
 */
// TODO: Generalize this to all tools
export function normalizeToolInput(
  tool: Tool,
  input: { [key: string]: boolean | string | number },
): { [key: string]: boolean | string | number } {
  switch (tool) {
    case BashTool: {
      const { command, timeout } = BashTool.inputSchema.parse(input) // already validated upstream, won't throw
      return {
        command: command.replace(`cd ${getCwd()} && `, ''),
        ...(timeout ? { timeout } : {}),
      }
    }
    default:
      return input
  }
}
/**
 * @async
 * @generator
 * @function checkPermissionsAndCallTool
 * @description This function checks for permissions to use a tool, and if permission is
 * granted, it calls the tool. It handles input validation, permission checks, and the
 * actual execution of the tool.
 *
 * @param {Tool} tool - The tool to be called.
 * @param {string} toolUseID - The ID of the tool use.
 * @param {Set<string>} siblingToolUseIDs - The IDs of sibling tool uses.
 * @param {{ [key: string]: boolean | string | number }} input - The input to the tool.
 * @param {ToolUseContext} context - The context for the tool use.
 * @param {CanUseToolFn} canUseTool - A function to check if a tool can be used.
 * @param {AssistantMessage} assistantMessage - The assistant message that triggered the tool use.
 * @param {boolean} [shouldSkipPermissionCheck] - A flag to skip the permission check.
 *
 * @yields {UserMessage | ProgressMessage} A message representing the result of the tool use or a progress update.
 */
async function* checkPermissionsAndCallTool(
  tool: Tool,
  toolUseID: string,
  siblingToolUseIDs: Set<string>,
  input: { [key: string]: boolean | string | number },
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<UserMessage | ProgressMessage, void> {
  // Validate input types with zod
  // (surprisingly, the model is not great at generating valid input)
  const isValidInput = tool.inputSchema.safeParse(input)
  if (!isValidInput.success) {
    logEvent('tengu_tool_use_error', {
      error: `InputValidationError: ${isValidInput.error.message}`,
      messageID: assistantMessage.message.id,
      toolName: tool.name,
      toolInput: JSON.stringify(input).slice(0, 200),
    })
    yield createUserMessage([
      {
        type: 'tool_result',
        content: `InputValidationError: ${isValidInput.error.message}`,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }

  const normalizedInput = normalizeToolInput(tool, input)

  // Validate input values. Each tool has its own validation logic
  const isValidCall = await tool.validateInput?.(
    normalizedInput as never,
    context,
  )
  if (isValidCall?.result === false) {
    logEvent('tengu_tool_use_error', {
      error: isValidCall?.message.slice(0, 2000),
      messageID: assistantMessage.message.id,
      toolName: tool.name,
      toolInput: JSON.stringify(input).slice(0, 200),
      ...(isValidCall?.meta ?? {}),
    })
    yield createUserMessage([
      {
        type: 'tool_result',
        content: isValidCall!.message,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }

  // Check whether we have permission to use the tool,
  // and ask the user for permission if we don't
  const permissionResult = shouldSkipPermissionCheck
    ? ({ result: true } as const)
    : await canUseTool(tool, normalizedInput, context, assistantMessage)
  if (permissionResult.result === false) {
    yield createUserMessage([
      {
        type: 'tool_result',
        content: permissionResult.message,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }

  // Call the tool
  try {
    const generator = tool.call(normalizedInput as never, context, canUseTool)
    for await (const result of generator) {
      switch (result.type) {
        case 'result':
          logEvent('tengu_tool_use_success', {
            messageID: assistantMessage.message.id,
            toolName: tool.name,
          })
          yield createUserMessage(
            [
              {
                type: 'tool_result',
                content: result.resultForAssistant,
                tool_use_id: toolUseID,
              },
            ],
            {
              data: result.data,
              resultForAssistant: result.resultForAssistant,
            },
          )
          return
        case 'progress':
          logEvent('tengu_tool_use_progress', {
            messageID: assistantMessage.message.id,
            toolName: tool.name,
          })
          yield createProgressMessage(
            toolUseID,
            siblingToolUseIDs,
            result.content,
            result.normalizedMessages,
            result.tools,
          )
      }
    }
  } catch (error) {
    const content = formatError(error)
    logError(error)
    logEvent('tengu_tool_use_error', {
      error: content.slice(0, 2000),
      messageID: assistantMessage.message.id,
      toolName: tool.name,
      toolInput: JSON.stringify(input).slice(0, 1000),
    })
    yield createUserMessage([
      {
        type: 'tool_result',
        content,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
  }
}

/**
 * @function formatError
 * @description This function formats an error object into a string that can be sent to the AI model.
 * It includes the error message, and if available, the `stderr` and `stdout` of the error.
 * To avoid sending excessively long error messages, it truncates the message if it exceeds
 * a certain length.
 *
 * @param {unknown} error - The error object to be formatted.
 * @returns {string} The formatted error string.
 */
function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const parts = [error.message]
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr)
  }
  if ('stdout' in error && typeof error.stdout === 'string') {
    parts.push(error.stdout)
  }
  const fullMessage = parts.filter(Boolean).join('\n')
  if (fullMessage.length <= 10000) {
    return fullMessage
  }
  const halfLength = 5000
  const start = fullMessage.slice(0, halfLength)
  const end = fullMessage.slice(-halfLength)
  return `${start}\n\n... [${fullMessage.length - 10000} characters truncated] ...\n\n${end}`
}
