export interface UserQuestionOption {
  label: string
  description: string
  preview?: string
}

export interface UserQuestion {
  header: string
  question: string
  multiSelect: boolean
  options: UserQuestionOption[]
}

export interface UserQuestionRequest {
  id: string
  agentId?: string
  toolCallId: string
  questions: UserQuestion[]
}

export interface UserQuestionAnswer {
  selectedOptions: number[]
  other?: string
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('无效的提问数据')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, name: string, maxLength: number, trim = true): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > maxLength) {
    throw new Error(`${name}须为 1–${maxLength} 个字符`)
  }
  return trim ? value.trim() : value
}

/** 在 Runtime 再次校验模型参数，不能仅依赖模型侧的 JSON Schema。 */
export function parseUserQuestions(input: unknown): UserQuestion[] {
  const { questions } = record(input)
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 4) {
    throw new Error('一次须询问 1–4 个问题')
  }
  return questions.map((value) => {
    const question = record(value)
    if (typeof question.multiSelect !== 'boolean') throw new Error('multiSelect 须为布尔值')
    if (
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 4
    ) {
      throw new Error('每个问题须提供 2–4 个选项')
    }
    const options = question.options.map((value): UserQuestionOption => {
      const option = record(value)
      if (question.multiSelect && option.preview !== undefined) {
        throw new Error('preview 只支持单选问题')
      }
      return {
        label: text(option.label, '选项标签', 200),
        description: text(option.description, '选项说明', 2000),
        ...(option.preview !== undefined
          ? { preview: text(option.preview, '选项预览', 20000, false) }
          : {})
      }
    })
    if (new Set(options.map(({ label }) => label)).size !== options.length) {
      throw new Error('同一个问题的选项标签不能重复')
    }
    return {
      header: text(question.header, 'header', 12),
      question: text(question.question, '问题', 2000),
      multiSelect: question.multiSelect,
      options
    }
  })
}

export function parseUserQuestionAnswers(
  questions: UserQuestion[],
  input: unknown
): UserQuestionAnswer[] {
  if (!Array.isArray(input) || input.length !== questions.length) {
    throw new Error('请回答全部问题后提交')
  }
  return questions.map((question, index) => {
    const answer = record(input[index])
    if (
      !Array.isArray(answer.selectedOptions) ||
      answer.selectedOptions.some(
        (value) => !Number.isInteger(value) || value < 0 || value >= question.options.length
      ) ||
      new Set(answer.selectedOptions).size !== answer.selectedOptions.length
    ) {
      throw new Error('无效的问题选项')
    }
    const selectedOptions = [...answer.selectedOptions].sort((a, b) => a - b)
    const other = answer.other === undefined ? undefined : text(answer.other, '自定义答案', 10000)
    const count = selectedOptions.length + (other ? 1 : 0)
    if (!count || (!question.multiSelect && count !== 1)) {
      throw new Error(
        question.multiSelect ? '请至少选择一个选项或填写其他答案' : '单选题须选择一个答案'
      )
    }
    return { selectedOptions, ...(other ? { other } : {}) }
  })
}

export function formatUserQuestionAnswers(
  questions: UserQuestion[],
  answers: UserQuestionAnswer[]
): string {
  const lines = questions.map((question, index) => {
    const answer = answers[index]
    const selected = answer.selectedOptions.map((option) => question.options[option])
    const labels = [...selected.map(({ label }) => label), ...(answer.other ? [answer.other] : [])]
    const preview = selected.find((option) => option.preview !== undefined)?.preview
    return `“${question.question}”=“${labels.join(',')}”${preview !== undefined ? ` 选中预览：${preview}` : ''}`
  })
  return `你的问题已被回答：\n\n${lines.join('，\n')}。\n\n你现在可以带着这些答案继续了。`
}
