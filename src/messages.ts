/**
 * @file src/messages.ts
 * @description 该文件提供了一个简单的全局状态管理机制，用于在应用程序的不同部分之间共享
 * 对话消息列表。它使用 getter 和 setter 函数来访问和修改消息列表，这允许 React 组件
 * 和非 React 模块之间进行通信。
 */
import type { Message } from './query'
/**
 * @description 一个函数，用于获取当前的消息列表。
 * @type {() => Message[]}
 */
let getMessages: () => Message[] = () => []
/**
 * @description 一个 React state setter 函数，用于更新消息列表。
 * @type {React.Dispatch<React.SetStateAction<Message[]>>}
 */
let setMessages: React.Dispatch<React.SetStateAction<Message[]>> = () => {}
/**
 * @function setMessagesGetter
 * @description 设置用于获取消息列表的 getter 函数。
 *
 * @param {() => Message[]} getter - 新的 getter 函数。
 */
export function setMessagesGetter(getter: () => Message[]) {
  getMessages = getter
}
/**
 * @function getMessagesGetter
 * @description 获取当前的消息列表 getter 函数。
 *
 * @returns {() => Message[]} 当前的 getter 函数。
 */
export function getMessagesGetter(): () => Message[] {
  return getMessages
}
/**
 * @function setMessagesSetter
 * @description 设置用于更新消息列表的 setter 函数。
 *
 * @param {React.Dispatch<React.SetStateAction<Message[]>>} setter - 新的 setter 函数。
 */
export function setMessagesSetter(
  setter: React.Dispatch<React.SetStateAction<Message[]>>,
) {
  setMessages = setter
}
/**
 * @function getMessagesSetter
 * @description 获取当前的消息列表 setter 函数。
 *
 * @returns {React.Dispatch<React.SetStateAction<Message[]>>} 当前的 setter 函数。
 */
export function getMessagesSetter(): React.Dispatch<
  React.SetStateAction<Message[]>
> {
  return setMessages
}
