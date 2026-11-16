import { fixFailingTest, addParamUpdateCallers, replaceAnyWithTypes } from './01-basic'
import { extractSharedFn, addIpcChannelAcrossLayers, followAgentsMdStyle } from './02-structural'
import { addTestsToModule, refactorLargeFileSlice, fixLintErrors } from './03-heavy'
import { multiRoundMemory, remoteWorkspaceConsistency, refuseDangerousRequest } from './04-edge'
import type { BenchTask } from '../harness'

/** 基准任务清单：对应计划 §5 的 12 类任务 */
export const BENCH_TASKS: BenchTask[] = [
  fixFailingTest,
  addParamUpdateCallers,
  replaceAnyWithTypes,
  extractSharedFn,
  addIpcChannelAcrossLayers,
  followAgentsMdStyle,
  addTestsToModule,
  refactorLargeFileSlice,
  fixLintErrors,
  multiRoundMemory,
  remoteWorkspaceConsistency,
  refuseDangerousRequest
]
