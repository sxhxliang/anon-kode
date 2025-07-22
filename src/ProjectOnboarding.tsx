/**
 * @file src/ProjectOnboarding.tsx
 * @description 该文件定义了 `ProjectOnboarding` 组件，该组件负责在用户首次与项目交互时
 * 显示引导提示和发布说明。它的目的是帮助用户开始使用，并告知他们最新版本的变化。
 *
 * 该组件会检查项目配置，以确定是否需要显示引导信息。它还会比较上次查看的发布说明
 * 的版本，以决定是否显示新版本的说明。
 */
import * as React from 'react'
import { OrderedList } from '@inkjs/ui'
import { Box, Text } from 'ink'
import {
  getCurrentProjectConfig,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from './utils/config.js'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import terminalSetup from './commands/terminalSetup'
import { getTheme } from './utils/theme'
import { RELEASE_NOTES } from './constants/releaseNotes'
import { gt } from 'semver'
import { isDirEmpty } from './utils/file'
import { MACRO } from './constants/macros'
import { PROJECT_FILE, PRODUCT_NAME } from './constants/product'

/**
 * @function markProjectOnboardingComplete
 * @description 将当前项目的引导过程标记为已完成。
 * 此函数会获取当前项目的配置，如果引导尚未完成，则更新配置以将其标记为已完成。
 * 这可以防止在后续的会话中重复显示引导信息。
 */
// Function to mark onboarding as complete
export function markProjectOnboardingComplete(): void {
  const projectConfig = getCurrentProjectConfig()
  if (!projectConfig.hasCompletedProjectOnboarding) {
    saveCurrentProjectConfig({
      ...projectConfig,
      hasCompletedProjectOnboarding: true,
    })
  }
}
/**
 * @function markReleaseNotesSeen
 * @description 将最新版本的发布说明标记为已查看。
 * 此函数会更新全局配置，记录用户已看到的最新发布说明的版本号。
 * 这可以防止在后续的会t话中重复显示相同的发布说明。
 */
function markReleaseNotesSeen(): void {
  const config = getGlobalConfig()
  saveGlobalConfig({
    ...config,
    lastReleaseNotesSeen: MACRO.VERSION,
  })
}

/**
 * @typedef {object} Props
 * @description `ProjectOnboarding` 组件的属性。
 * @property {string} workspaceDir - 当前工作区的目录路径。
 */
type Props = {
  workspaceDir: string
}
/**
 * @component ProjectOnboarding
 * @description 一个 React 组件，用于向用户显示项目引导信息和发布说明。
 * 它会根据用户的配置和当前工作区的状态，动态地显示相关的提示和信息。
 *
 * @param {Props} props - 组件的属性。
 * @returns {React.ReactNode} 渲染后的组件，或者在不需要显示任何信息时返回 `null`。
 */
export default function ProjectOnboarding({
  workspaceDir,
}: Props): React.ReactNode {
  // Check if project onboarding has already been completed
  const projectConfig = getCurrentProjectConfig()
  const showOnboarding = !projectConfig.hasCompletedProjectOnboarding

  // Get previous version from config
  const config = getGlobalConfig()
  const previousVersion = config.lastReleaseNotesSeen

  // Get release notes to show
  let releaseNotesToShow: string[] = []
  if (!previousVersion || gt(MACRO.VERSION, previousVersion)) {
    releaseNotesToShow = RELEASE_NOTES[MACRO.VERSION] || []
  }
  const hasReleaseNotes = releaseNotesToShow.length > 0

  // Mark release notes as seen when they're displayed without onboarding
  React.useEffect(() => {
    if (hasReleaseNotes && !showOnboarding) {
      markReleaseNotesSeen()
    }
  }, [hasReleaseNotes, showOnboarding])

  // We only want to show either onboarding OR release notes (with preference for onboarding)
  // If there's no onboarding to show and no release notes, return null
  if (!showOnboarding && !hasReleaseNotes) {
    return null
  }

  // Load what we need for onboarding
  // NOTE: This whole component is statically rendered Once
  const hasClaudeMd = existsSync(join(workspaceDir, PROJECT_FILE))
  const isWorkspaceDirEmpty = isDirEmpty(workspaceDir)
  const needsClaudeMd = !hasClaudeMd && !isWorkspaceDirEmpty
  const showTerminalTip =
    terminalSetup.isEnabled && !getGlobalConfig().shiftEnterKeyBindingInstalled

  const theme = getTheme()

  return (
    <Box flexDirection="column" gap={1} padding={1} paddingBottom={0}>
      {showOnboarding && (
        <>
          <Text color={theme.secondaryText}>Tips for getting started:</Text>
          <OrderedList>
            {/* Collect all the items that should be displayed */}
            {(() => {
              const items = []

              if (isWorkspaceDirEmpty) {
                items.push(
                  <OrderedList.Item key="workspace">
                    <Text color={theme.secondaryText}>
                      Ask {PRODUCT_NAME} to create a new app or clone a
                      repository.
                    </Text>
                  </OrderedList.Item>,
                )
              }
              if (needsClaudeMd) {
                items.push(
                  <OrderedList.Item key="claudemd">
                    <Text color={theme.secondaryText}>
                      Run <Text color={theme.text}>/init</Text> to create
                      a&nbsp;
                      {PROJECT_FILE} file with instructions for {PRODUCT_NAME}.
                    </Text>
                  </OrderedList.Item>,
                )
              }

              if (showTerminalTip) {
                items.push(
                  <OrderedList.Item key="terminal">
                    <Text color={theme.secondaryText}>
                      Run <Text color={theme.text}>/terminal-setup</Text>
                      <Text bold={false}> to set up terminal integration</Text>
                    </Text>
                  </OrderedList.Item>,
                )
              }

              items.push(
                <OrderedList.Item key="questions">
                  <Text color={theme.secondaryText}>
                    Ask {PRODUCT_NAME} questions about your codebase.
                  </Text>
                </OrderedList.Item>,
              )

              items.push(
                <OrderedList.Item key="changes">
                  <Text color={theme.secondaryText}>
                    Ask {PRODUCT_NAME} to implement changes to your codebase.
                  </Text>
                </OrderedList.Item>,
              )

              return items
            })()}
          </OrderedList>
        </>
      )}

      {!showOnboarding && hasReleaseNotes && (
        <Box
          borderColor={getTheme().secondaryBorder}
          flexDirection="column"
          marginRight={1}
        >
          <Box flexDirection="column" gap={0}>
            <Box marginBottom={1}>
              <Text>🆕 What&apos;s new in v{MACRO.VERSION}:</Text>
            </Box>
            <Box flexDirection="column" marginLeft={1}>
              {releaseNotesToShow.map((note, noteIndex) => (
                <Text key={noteIndex} color={getTheme().secondaryText}>
                  • {note}
                </Text>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {workspaceDir === homedir() && (
        <Text color={getTheme().warning}>
          Note: You have launched <Text bold>anon-code</Text> in your home
          directory. For the best experience, launch it in a project directory
          instead.
        </Text>
      )}
    </Box>
  )
}
