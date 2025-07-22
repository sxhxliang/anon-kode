/**
 * @file src/commands.ts
 * @description This file serves as the central hub for managing and exporting all slash commands
 * available in the application. It defines the structure of a command, categorizes commands into
 * different types, and provides utility functions for accessing and managing them.
 *
 * The file imports various command modules, each corresponding to a specific functionality,
 * such as `bug`, `clear`, `config`, etc. It then organizes these commands into a comprehensive
 * list that can be accessed by the rest of the application.
 */
import bug from './commands/bug'
import clear from './commands/clear'
import compact from './commands/compact'
import config from './commands/config'
import cost from './commands/cost'
import ctx_viz from './commands/ctx_viz'
import doctor from './commands/doctor'
import help from './commands/help'
import init from './commands/init'
import listen from './commands/listen'
import login from './commands/login'
import logout from './commands/logout'
import mcp from './commands/mcp'
import * as model from './commands/model'
import onboarding from './commands/onboarding'
import pr_comments from './commands/pr_comments'
import releaseNotes from './commands/release-notes'
import review from './commands/review'
import terminalSetup from './commands/terminalSetup'
import { Tool, ToolUseContext } from './Tool'
import resume from './commands/resume'
import { getMCPCommands } from './services/mcpClient'
import type { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { memoize } from 'lodash-es'
import type { Message } from './query'
import { isAnthropicAuthEnabled } from './utils/auth'

/**
 * @description
 * Represents a command that generates a prompt to be sent to the AI model.
 * @property {'prompt'} type - The type of the command.
 * @property {string} progressMessage - The message to display while the command is being processed.
 * @property {string[]} [argNames] - The names of the arguments that the command accepts.
 * @property {(args: string) => Promise<MessageParam[]>} getPromptForCommand - A function that takes the command arguments and returns a promise that resolves to an array of message parameters.
 */
type PromptCommand = {
  type: 'prompt'
  progressMessage: string
  argNames?: string[]
  getPromptForCommand(args: string): Promise<MessageParam[]>
}
/**
 * @description
 * Represents a command that is executed locally on the user's machine.
 * @property {'local'} type - The type of the command.
 * @property {(args: string, context: {...}) => Promise<string>} call - A function that executes the command's logic and returns a promise that resolves to a string result.
 */
type LocalCommand = {
  type: 'local'
  call(
    args: string,
    context: {
      options: {
        commands: Command[]
        tools: Tool[]
        slowAndCapableModel: string
      }
      abortController: AbortController
      setForkConvoWithMessagesOnTheNextRender: (
        forkConvoWithMessages: Message[],
      ) => void
    },
  ): Promise<string>
}
/**
 * @description
 * Represents a command that renders a custom JSX component for more complex interactions.
 * @property {'local-jsx'} type - The type of the command.
 * @property {(onDone: (result?: string) => void, context: {...}) => Promise<React.ReactNode>} call - A function that returns a promise resolving to a React node to be rendered.
 */
type LocalJSXCommand = {
  type: 'local-jsx'
  call(
    onDone: (result?: string) => void,
    context: ToolUseContext & {
      setForkConvoWithMessagesOnTheNextRender: (
        forkConvoWithMessages: Message[],
      ) => void
    },
  ): Promise<React.ReactNode>
}
/**
 * @description
 * The `Command` type is a union of `PromptCommand`, `LocalCommand`, and `LocalJSXCommand`, representing all possible command types in the application.
 * @property {string} description - A brief description of what the command does.
 * @property {boolean} isEnabled - A flag indicating whether the command is currently enabled.
 * @property {boolean} isHidden - A flag indicating whether the command should be hidden from the user.
 * @property {string} name - The name of the command.
 * @property {string[]} [aliases] - An array of alternative names for the command.
 * @property {() => string} userFacingName - A function that returns the name of the command as it should be displayed to the user.
 */
export type Command = {
  description: string
  isEnabled: boolean
  isHidden: boolean
  name: string
  aliases?: string[]
  userFacingName(): string
} & (PromptCommand | LocalCommand | LocalJSXCommand)
/**
 * @constant {Command[]} INTERNAL_ONLY_COMMANDS
 * @description A list of commands that are intended for internal use only and are not exposed to regular users.
 */
const INTERNAL_ONLY_COMMANDS = [ctx_viz, resume, listen]

// Declared as a function so that we don't run this until getCommands is called,
// since underlying functions read from config, which can't be read at module initialization time
/**
 * @constant {() => Command[]} COMMANDS
 * @description A memoized function that returns a list of all standard commands available in the application.
 * This function is memoized to avoid re-computing the list of commands on every call, which optimizes performance.
 * The command list includes a variety of functionalities, such as clearing the screen, managing configuration,
 * handling releases, and more. It also includes commands that are conditionally available based on the
 * authentication status (e.g., `login` and `logout`).
 */
const COMMANDS = memoize((): Command[] => [
  clear,
  compact,
  config,
  cost,
  doctor,
  help,
  init,
  mcp,
  model,
  onboarding,
  pr_comments,
  releaseNotes,
  bug,
  review,
  terminalSetup,
  ...(isAnthropicAuthEnabled() ? [logout, login()] : []),
  ...INTERNAL_ONLY_COMMANDS,
])

/**
 * @function getCommands
 * @description A memoized async function that retrieves all available commands, including standard commands and those from MCP (Multi-Claude-Proxy) servers.
 * It filters the list to include only enabled commands, ensuring that disabled commands are not exposed to the user.
 * @returns {Promise<Command[]>} A promise that resolves to an array of all enabled commands.
 */
export const getCommands = memoize(async (): Promise<Command[]> => {
  return [...(await getMCPCommands()), ...COMMANDS()].filter(_ => _.isEnabled)
})
/**
 * @function hasCommand
 * @description A utility function that checks if a command with a given name or alias exists in a list of commands.
 * This is useful for validating user input and ensuring that a command is available before attempting to execute it.
 * @param {string} commandName - The name or alias of the command to check for.
 * @param {Command[]} commands - The list of commands to search within.
 * @returns {boolean} `true` if the command exists, `false` otherwise.
 */
export function hasCommand(commandName: string, commands: Command[]): boolean {
  return commands.some(
    _ => _.userFacingName() === commandName || _.aliases?.includes(commandName),
  )
}
/**
 * @function getCommand
 * @description A utility function that retrieves a command by its name or alias from a list of commands.
 * If the command is not found, it throws a `ReferenceError` with a helpful message that lists all available commands.
 * This ensures that the application does not fail silently when an invalid command is provided.
 * @param {string} commandName - The name or alias of the command to retrieve.
 * @param {Command[]} commands - The list of commands to search within.
 * @returns {Command} The command object if found.
 * @throws {ReferenceError} If the command is not found.
 */
export function getCommand(commandName: string, commands: Command[]): Command {
  const command = commands.find(
    _ => _.userFacingName() === commandName || _.aliases?.includes(commandName),
  ) as Command | undefined
  if (!command) {
    throw ReferenceError(
      `Command ${commandName} not found. Available commands: ${commands
        .map(_ => {
          const name = _.userFacingName()
          return _.aliases ? `${name} (aliases: ${_.aliases.join(', ')})` : name
        })
        .join(', ')}`,
    )
  }

  return command
}
