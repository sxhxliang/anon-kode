/**
 * @file src/tools.ts
 * @description This file serves as the central registry for all tools that the AI model can use.
 * It imports the various tool modules, organizes them, and provides functions to access them
 * based on different criteria, such as whether they are read-only or if certain features
 * like the Architect tool are enabled.
 *
 * The file plays a crucial role in the application's architecture by providing a single
 * source of truth for all available tools, making it easy to manage and extend the
 * toolset.
 */
import { Tool } from './Tool'
import { AgentTool } from './tools/AgentTool/AgentTool'
import { ArchitectTool } from './tools/ArchitectTool/ArchitectTool'
import { BashTool } from './tools/BashTool/BashTool'
import { FileEditTool } from './tools/FileEditTool/FileEditTool'
import { FileReadTool } from './tools/FileReadTool/FileReadTool'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool'
import { GlobTool } from './tools/GlobTool/GlobTool'
import { GrepTool } from './tools/GrepTool/GrepTool'
import { LSTool } from './tools/lsTool/lsTool'
import { MemoryReadTool } from './tools/MemoryReadTool/MemoryReadTool'
import { MemoryWriteTool } from './tools/MemoryWriteTool/MemoryWriteTool'
import { NotebookEditTool } from './tools/NotebookEditTool/NotebookEditTool'
import { NotebookReadTool } from './tools/NotebookReadTool/NotebookReadTool'
import { ThinkTool } from './tools/ThinkTool/ThinkTool'
import { getMCPTools } from './services/mcpClient'
import { memoize } from 'lodash-es'

/**
 * @constant {Tool[]} ANT_ONLY_TOOLS
 * @description A list of tools that are available only to internal "ant" users.
 * These tools may have advanced capabilities or are still in a testing phase.
 */
const ANT_ONLY_TOOLS = [MemoryReadTool, MemoryWriteTool]
/**
 * @function getAllTools
 * @description A function that returns a comprehensive list of all built-in tools available in the application.
 * This function is designed to avoid circular dependencies that can cause issues with module bundlers like Bun.
 * The list includes a wide range of tools for file system operations, command execution, memory management, and more.
 *
 * @returns {Tool[]} An array of all built-in tool objects.
 */
// Function to avoid circular dependencies that break bun
export const getAllTools = (): Tool[] => {
  return [
    AgentTool,
    BashTool,
    GlobTool,
    GrepTool,
    LSTool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    NotebookReadTool,
    NotebookEditTool,
    ThinkTool,
    ...ANT_ONLY_TOOLS,
  ]
}
/**
 * @function getTools
 * @description A memoized async function that retrieves all available tools, including built-in tools,
 * tools from MCP (Multi-Claude-Proxy) servers, and conditionally included tools like the Architect tool.
 * It filters the list to include only enabled tools, ensuring that disabled or unavailable tools are not
 * exposed to the AI model.
 *
 * @param {boolean} [enableArchitect] - A flag to indicate whether the Architect tool should be included.
 * @returns {Promise<Tool[]>} A promise that resolves to an array of all enabled and available tools.
 */
export const getTools = memoize(
  async (enableArchitect?: boolean): Promise<Tool[]> => {
    const tools = [...getAllTools(), ...(await getMCPTools())]

    // Only include Architect tool if enabled via config or CLI flag
    if (enableArchitect) {
      tools.push(ArchitectTool)
    }

    const isEnabled = await Promise.all(tools.map(tool => tool.isEnabled()))
    return tools.filter((_, i) => isEnabled[i])
  },
)
/**
 * @function getReadOnlyTools
 * @description A memoized async function that retrieves all tools that are marked as "read-only".
 * Read-only tools are those that do not modify the user's file system or state, such as tools for
 * reading files or listing directories. This function is useful for scenarios where only safe,
 * non-destructive operations are permitted.
 *
 * @returns {Promise<Tool[]>} A promise that resolves to an array of all enabled read-only tools.
 */
export const getReadOnlyTools = memoize(async (): Promise<Tool[]> => {
  const tools = getAllTools().filter(tool => tool.isReadOnly())
  const isEnabled = await Promise.all(tools.map(tool => tool.isEnabled()))
  return tools.filter((_, index) => isEnabled[index])
})
