/**
 * @file src/components/Spinner.tsx
 * @description 该文件定义了 `Spinner` 和 `SimpleSpinner` 组件，它们用于在应用程序
 * 正在执行后台任务（如等待 API 响应）时，向用户显示一个加载指示器。
 *
 * `Spinner` 组件显示一个动画图标、一条随机的加载消息和经过的时间。
 * `SimpleSpinner` 组件只显示一个简单的动画图标。
 */
import { Box, Text } from 'ink'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { getTheme } from '../utils/theme'
import { sample } from 'lodash-es'
import { getSessionState } from '../utils/sessionState'
/**
 * @constant {string[]} CHARACTERS
 * @description 用于旋转器动画的字符数组。
 * 根据操作系统的不同，会使用不同的字符集，以确保最佳的显示效果。
 */
// NB: The third character in this string is an emoji that
// renders on Windows consoles with a green background
const CHARACTERS =
  process.platform === 'darwin'
    ? ['·', '✢', '✳', '∗', '✻', '✽']
    : ['·', '✢', '*', '∗', '✻', '✽']
/**
 * @constant {string[]} MESSAGES
 * @description 一个包含了各种加载消息的数组。
 * 在显示旋转器时，会从中随机选择一条消息。
 */
const MESSAGES = [
  'Accomplishing',
  'Actioning',
  'Actualizing',
  'Baking',
  'Brewing',
  'Calculating',
  'Cerebrating',
  'Churning',
  'Koding',
  'Coalescing',
  'Cogitating',
  'Computing',
  'Conjuring',
  'Considering',
  'Cooking',
  'Crafting',
  'Creating',
  'Crunching',
  'Deliberating',
  'Determining',
  'Doing',
  'Effecting',
  'Finagling',
  'Forging',
  'Forming',
  'Generating',
  'Hatching',
  'Herding',
  'Honking',
  'Hustling',
  'Ideating',
  'Inferring',
  'Manifesting',
  'Marinating',
  'Moseying',
  'Mulling',
  'Mustering',
  'Musing',
  'Noodling',
  'Percolating',
  'Pondering',
  'Processing',
  'Puttering',
  'Reticulating',
  'Ruminating',
  'Schlepping',
  'Shucking',
  'Simmering',
  'Smooshing',
  'Spinning',
  'Stewing',
  'Synthesizing',
  'Thinking',
  'Transmuting',
  'Vibing',
  'Working',
]

/**
 * @component Spinner
 * @description 一个功能齐全的旋转器组件，显示动画、加载消息和经过的时间。
 *
 * @returns {React.ReactNode} 渲染后的旋转器组件。
 */
export function Spinner(): React.ReactNode {
  const frames = [...CHARACTERS, ...[...CHARACTERS].reverse()]
  const [frame, setFrame] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)
  const message = useRef(sample(MESSAGES))
  const startTime = useRef(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length)
    }, 120)

    return () => clearInterval(timer)
  }, [frames.length])

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime.current) / 1000))
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  return (
    <Box flexDirection="row" marginTop={1}>
      <Box flexWrap="nowrap" height={1} width={2}>
        <Text color={getTheme().claude}>{frames[frame]}</Text>
      </Box>
      <Text color={getTheme().claude}>{message.current}… </Text>
      <Text color={getTheme().secondaryText}>
        ({elapsedTime}s · <Text bold>esc</Text> to interrupt)
      </Text>
      <Text color={getTheme().secondaryText}>
        · {getSessionState('currentError')}
      </Text>
    </Box>
  )
}
/**
 * @component SimpleSpinner
 * @description 一个简化的旋转器组件，只显示动画图标。
 *
 * @returns {React.ReactNode} 渲染后的简化旋转器组件。
 */
export function SimpleSpinner(): React.ReactNode {
  const frames = [...CHARACTERS, ...[...CHARACTERS].reverse()]
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length)
    }, 120)

    return () => clearInterval(timer)
  }, [frames.length])

  return (
    <Box flexWrap="nowrap" height={1} width={2}>
      <Text color={getTheme().claude}>{frames[frame]}</Text>
    </Box>
  )
}
