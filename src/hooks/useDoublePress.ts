/**
 * @file src/hooks/useDoublePress.ts
 * @description 该文件定义了 `useDoublePress` hook，它用于处理双击（或快速连续调用）事件。
 * 这个 hook 返回一个函数，当这个函数在指定的时间内被连续调用两次时，会触发一个“双击”回调。
 */
// Creates a function that calls one function on the first call and another
// function on the second call within a certain timeout

import { useRef } from 'react'
/**
 * @constant {number} DOUBLE_PRESS_TIMEOUT_MS
 * @description 双击事件的超时时间（毫秒）。
 */
export const DOUBLE_PRESS_TIMEOUT_MS = 2000
/**
 * @hook useDoublePress
 * @description 一个自定义的 React hook，用于检测双击事件。
 *
 * @param {(pending: boolean) => void} setPending - 一个用于设置“待定”状态的函数。在第一次按下后，状态会变为“待定”，在超时或第二次按下后，状态会变回“非待定”。
 * @param {() => void} onDoublePress - 在检测到双击时要调用的回调函数。
 * @param {() => void} [onFirstPress] - 在第一次按下时要调用的可选回调函数。
 * @returns {() => void} 一个函数，当被调用时，会触发双击检测逻辑。
 */
export function useDoublePress(
  setPending: (pending: boolean) => void,
  onDoublePress: () => void,
  onFirstPress?: () => void,
): () => void {
  const lastPressRef = useRef<number>(0)
  const timeoutRef = useRef<NodeJS.Timeout>()

  return () => {
    const now = Date.now()
    const timeSinceLastPress = now - lastPressRef.current

    // For this to count as a double-call, be sure to check that
    // timeoutRef.current exists so we don't trigger on triple call
    // (e.g. of Esc to clear the text input)
    if (timeSinceLastPress <= DOUBLE_PRESS_TIMEOUT_MS && timeoutRef.current) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = undefined
      }
      onDoublePress()
      setPending(false)
    } else {
      onFirstPress?.()
      setPending(true)
      // @ts-expect-error: Bun is overloading types here, but we're using the NodeJS runtime
      timeoutRef.current = setTimeout(
        () => setPending(false),
        DOUBLE_PRESS_TIMEOUT_MS,
      )
    }

    lastPressRef.current = now
  }
}
