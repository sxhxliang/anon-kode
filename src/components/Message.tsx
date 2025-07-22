/**
 * @file src/components/Message.tsx
 * @description 该文件定义了 `Message` 组件，它是用于在终端中渲染单个对话消息的核心组件。
 * 它能够处理来自用户和助手的不同类型的消息，并根据消息的类型和内容，
 * 将其分派给相应的子组件进行渲染。
 *
 * `Message` 组件是对话界面的基本构建块，负责以清晰和有组织的方式向用户呈现信息。
 */
import { Box } from 'ink'
import * as React from 'react'
import type { AssistantMessage, Message, UserMessage } from '../query'
import type {
  ContentBlock,
  DocumentBlockParam,
  ImageBlockParam,
  TextBlockParam,
  ThinkingBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { Tool } from '../Tool'
import { logError } from '../utils/log'
import { UserToolResultMessage } from './messages/UserToolResultMessage/UserToolResultMessage'
import { AssistantToolUseMessage } from './messages/AssistantToolUseMessage'
import { AssistantTextMessage } from './messages/AssistantTextMessage'
import { UserTextMessage } from './messages/UserTextMessage'
import { NormalizedMessage } from '../utils/messages'
import { AssistantThinkingMessage } from './messages/AssistantThinkingMessage'
import { AssistantRedactedThinkingMessage } from './messages/AssistantRedactedThinkingMessage'
import { useTerminalSize } from '../hooks/useTerminalSize'

/**
 * @typedef {object} Props
 * @description `Message` 组件的属性。
 * @property {UserMessage | AssistantMessage} message - 要渲染的消息对象。
 * @property {NormalizedMessage[]} messages - 整个对话的消息列表。
 * @property {boolean} addMargin - 是否在消息周围添加边距。
 * @property {Tool[]} tools - 可用的工具列表。
 * @property {boolean} verbose - 是否启用详细模式。
 * @property {boolean} debug - 是否启用调试模式。
 * @property {Set<string>} erroredToolUseIDs - 导致错误的工具使用的 ID 集合。
 * @property {Set<string>} inProgressToolUseIDs - 正在进行的工具使用的 ID 集合。
 * @property {Set<string>} unresolvedToolUseIDs - 未解决的工具使用的 ID 集合。
 * @property {boolean} shouldAnimate - 是否应该为消息的渲染添加动画效果。
 * @property {boolean} shouldShowDot - 是否应该显示一个点，以指示消息的来源。
 * @property {number | string} [width] - 消息的宽度。
 */
type Props = {
  message: UserMessage | AssistantMessage
  messages: NormalizedMessage[]
  // TODO: Find a way to remove this, and leave spacing to the consumer
  addMargin: boolean
  tools: Tool[]
  verbose: boolean
  debug: boolean
  erroredToolUseIDs: Set<string>
  inProgressToolUseIDs: Set<string>
  unresolvedToolUseIDs: Set<string>
  shouldAnimate: boolean
  shouldShowDot: boolean
  width?: number | string
}
/**
 * @component Message
 * @description `Message` 组件的实现。
 * 它根据消息的类型（`assistant` 或 `user`）来决定如何渲染，并将其传递给相应的子组件。
 *
 * @param {Props} props - 组件的属性。
 * @returns {React.ReactNode} 渲染后的消息组件。
 */
export function Message({
  message,
  messages,
  addMargin,
  tools,
  verbose,
  debug,
  erroredToolUseIDs,
  inProgressToolUseIDs,
  unresolvedToolUseIDs,
  shouldAnimate,
  shouldShowDot,
  width,
}: Props): React.ReactNode {
  // Assistant message
  if (message.type === 'assistant') {
    return (
      <Box flexDirection="column" width="100%">
        {message.message.content.map((_, index) => (
          <AssistantMessage
            key={index}
            param={_}
            costUSD={message.costUSD}
            durationMs={message.durationMs}
            addMargin={addMargin}
            tools={tools}
            debug={debug}
            options={{ verbose }}
            erroredToolUseIDs={erroredToolUseIDs}
            inProgressToolUseIDs={inProgressToolUseIDs}
            unresolvedToolUseIDs={unresolvedToolUseIDs}
            shouldAnimate={shouldAnimate}
            shouldShowDot={shouldShowDot}
            width={width}
          />
        ))}
      </Box>
    )
  }

  // User message
  // TODO: normalize upstream
  const content =
    typeof message.message.content === 'string'
      ? [{ type: 'text', text: message.message.content } as TextBlockParam]
      : message.message.content
  return (
    <Box flexDirection="column" width="100%">
      {content.map((_, index) => (
        <UserMessage
          key={index}
          message={message}
          messages={messages}
          addMargin={addMargin}
          tools={tools}
          param={_ as TextBlockParam}
          options={{ verbose }}
        />
      ))}
    </Box>
  )
}

/**
 * @component UserMessage
 * @description 一个内部组件，用于渲染来自用户的消息。
 * 它根据消息内容的类型（文本、工具结果等）来选择合适的渲染方式。
 *
 * @param {object} props - 组件的属性。
 * @returns {React.ReactNode} 渲染后的用户消息。
 */
function UserMessage({
  message,
  messages,
  addMargin,
  tools,
  param,
  options: { verbose },
}: {
  message: UserMessage
  messages: Message[]
  addMargin: boolean
  tools: Tool[]
  param:
    | TextBlockParam
    | DocumentBlockParam
    | ImageBlockParam
    | ToolUseBlockParam
    | ToolResultBlockParam
  options: {
    verbose: boolean
  }
}): React.ReactNode {
  const { columns } = useTerminalSize()
  switch (param.type) {
    case 'text':
      return <UserTextMessage addMargin={addMargin} param={param} />
    case 'tool_result':
      return (
        <UserToolResultMessage
          param={param}
          message={message}
          messages={messages}
          tools={tools}
          verbose={verbose}
          width={columns - 5}
        />
      )
  }
}

/**
 * @component AssistantMessage
 * @description 一个内部组件，用于渲染来自助手的消息。
 * 它根据消息内容的类型（工具使用、文本、思考过程等）来选择合适的渲染方式。
 *
 * @param {object} props - 组件的属性。
 * @returns {React.ReactNode} 渲染后的助手消息。
 */
function AssistantMessage({
  param,
  costUSD,
  durationMs,
  addMargin,
  tools,
  debug,
  options: { verbose },
  erroredToolUseIDs,
  inProgressToolUseIDs,
  unresolvedToolUseIDs,
  shouldAnimate,
  shouldShowDot,
  width,
}: {
  param:
    | ContentBlock
    | TextBlockParam
    | ImageBlockParam
    | ThinkingBlockParam
    | ToolUseBlockParam
    | ToolResultBlockParam
  costUSD: number
  durationMs: number
  addMargin: boolean
  tools: Tool[]
  debug: boolean
  options: {
    verbose: boolean
  }
  erroredToolUseIDs: Set<string>
  inProgressToolUseIDs: Set<string>
  unresolvedToolUseIDs: Set<string>
  shouldAnimate: boolean
  shouldShowDot: boolean
  width?: number | string
}): React.ReactNode {
  switch (param.type) {
    case 'tool_use':
      return (
        <AssistantToolUseMessage
          param={param}
          costUSD={costUSD}
          durationMs={durationMs}
          addMargin={addMargin}
          tools={tools}
          debug={debug}
          verbose={verbose}
          erroredToolUseIDs={erroredToolUseIDs}
          inProgressToolUseIDs={inProgressToolUseIDs}
          unresolvedToolUseIDs={unresolvedToolUseIDs}
          shouldAnimate={shouldAnimate}
          shouldShowDot={shouldShowDot}
        />
      )
    case 'text':
      return (
        <AssistantTextMessage
          param={param}
          costUSD={costUSD}
          durationMs={durationMs}
          debug={debug}
          addMargin={addMargin}
          shouldShowDot={shouldShowDot}
          verbose={verbose}
          width={width}
        />
      )
    case 'redacted_thinking':
      return <AssistantRedactedThinkingMessage addMargin={addMargin} />
    case 'thinking':
      return <AssistantThinkingMessage addMargin={addMargin} param={param} />
    default:
      logError(`Unable to render message type: ${param.type}`)
      return null
  }
}
