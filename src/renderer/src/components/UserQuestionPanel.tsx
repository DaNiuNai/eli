import { CheckIcon } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Bubble, BubbleContent } from '@renderer/components/ui/bubble'
import { Message, MessageContent } from '@renderer/components/ui/message'
import { Field, FieldLabel } from '@renderer/components/ui/field'
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle
} from '@renderer/components/ui/questionnaire'
import { Spinner } from '@renderer/components/ui/spinner'
import { Textarea } from '@renderer/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useLanguage } from '@renderer/hooks/use-language'
import {
  isUserQuestionAnswered,
  type UserQuestionDraft,
  type UserQuestionFormState
} from '@renderer/hooks/use-user-questions'
import { cn } from '@renderer/lib/utils'
import type { UserQuestionRequest } from '../../../shared/user-question'

function QuestionForm({
  request,
  state,
  disabled,
  onDraft,
  onItemChange,
  onSubmit
}: {
  request: UserQuestionRequest
  state: UserQuestionFormState
  disabled: boolean
  onDraft: (index: number, draft: UserQuestionDraft) => void
  onItemChange: (item: string) => void
  onSubmit: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const { drafts, item, submitting } = state
  const currentIndex = Number(item)
  const question = request.questions[currentIndex]
  const draft = drafts[currentIndex]
  const hasPreview = question.options.some((option) => option.preview !== undefined)
  const selectedOption = draft.selectedOptions[0]
  const previewOption = selectedOption === undefined ? undefined : question.options[selectedOption]
  const allAnswered = drafts.every(isUserQuestionAnswered)

  function choose(index: number, option: number | 'other', checked: boolean): void {
    const question = request.questions[index]
    const draft = drafts[index]
    if (option === 'other') {
      onDraft(index, {
        ...draft,
        otherSelected: checked,
        selectedOptions: question.multiSelect ? draft.selectedOptions : []
      })
    } else {
      onDraft(index, {
        ...draft,
        selectedOptions: question.multiSelect
          ? checked
            ? [...draft.selectedOptions, option]
            : draft.selectedOptions.filter((selected) => selected !== option)
          : [option],
        otherSelected: question.multiSelect && draft.otherSelected
      })
    }
  }

  return (
    <Questionnaire
      item={item}
      onItemChange={(nextItem) => {
        // 自定义答案独立校验；键盘前进也不能跳过尚未填写的答案。
        if (Number(nextItem) > currentIndex && !isUserQuestionAnswered(draft)) return
        onItemChange(nextItem)
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && !submitting && allAnswered) onSubmit()
      }}
    >
      <ToggleGroup
        value={[item]}
        onValueChange={(value) => {
          if (value[0] !== undefined) onItemChange(value[0])
        }}
        disabled={disabled || submitting}
        variant="outline"
        size="sm"
        className="flex flex-wrap justify-start gap-2"
        aria-label={t('切换问题')}
      >
        {request.questions.map((question, index) => (
          <ToggleGroupItem key={index} value={String(index)}>
            {isUserQuestionAnswered(drafts[index]) && <CheckIcon data-icon="inline-start" />}
            {question.header}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className={cn('grid min-h-0 gap-5', hasPreview && 'sm:grid-cols-2')}>
        <div className="min-w-0">
          {request.questions.map((question, index) => {
            const draft = drafts[index]
            const inputId = `${request.id}-${index}-other`
            return (
              <QuestionnaireItem
                key={index}
                name={String(index)}
                multiple={question.multiSelect}
                required
                disabled={disabled || submitting}
                className="user-question-item"
              >
                <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
                <QuestionnaireDescription>
                  <Badge variant="secondary">{t(question.multiSelect ? '可多选' : '单选')}</Badge>
                  <span className="ml-2">{t('也可以选择“其他”填写自己的答案。')}</span>
                </QuestionnaireDescription>
                <QuestionnaireChoices>
                  {question.options.map((option, optionIndex) => (
                    <QuestionnaireChoice
                      key={optionIndex}
                      value={String(optionIndex)}
                      checked={draft.selectedOptions.includes(optionIndex)}
                      onChange={(event) => choose(index, optionIndex, event.target.checked)}
                    >
                      {option.label}
                      <QuestionnaireChoiceDescription>
                        {option.description}
                      </QuestionnaireChoiceDescription>
                    </QuestionnaireChoice>
                  ))}
                  <QuestionnaireChoice
                    value="other"
                    checked={draft.otherSelected}
                    onChange={(event) => choose(index, 'other', event.target.checked)}
                  >
                    {t('其他')}
                    <QuestionnaireChoiceDescription>
                      {t('输入自定义答案')}
                    </QuestionnaireChoiceDescription>
                  </QuestionnaireChoice>
                </QuestionnaireChoices>
                {draft.otherSelected && (
                  <Field>
                    <FieldLabel htmlFor={inputId}>{t('自定义答案')}</FieldLabel>
                    <Textarea
                      id={inputId}
                      value={draft.other}
                      onChange={(event) => onDraft(index, { ...draft, other: event.target.value })}
                      placeholder={t('输入你的答案…')}
                      maxLength={10000}
                      aria-invalid={!draft.other.trim() || undefined}
                      className="max-h-40 min-h-24"
                    />
                  </Field>
                )}
              </QuestionnaireItem>
            )
          })}
        </div>
        {hasPreview && (
          <section
            aria-label={t('选项预览')}
            className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4"
          >
            <Badge variant="outline" className="max-w-full self-start whitespace-normal">
              {previewOption?.label ?? t('选项预览')}
            </Badge>
            {previewOption?.preview !== undefined ? (
              <div className="user-question-preview min-w-0 overflow-auto font-mono text-sm">
                <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                  {previewOption.preview}
                </Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t(
                  previewOption || draft.otherSelected
                    ? '此答案没有预览。'
                    : '选择左侧选项，查看对应预览。'
                )}
              </p>
            )}
          </section>
        )}
      </div>
      <QuestionnaireProgress aria-label={t('回答进度')}>
        {t('问题 {current} / {total}', {
          current: currentIndex + 1,
          total: request.questions.length
        })}
      </QuestionnaireProgress>
      <QuestionnaireActions>
        <QuestionnairePrevious disabled={disabled || submitting}>
          {t('上一题')}
        </QuestionnairePrevious>
        <QuestionnaireNext disabled={disabled || submitting || !isUserQuestionAnswered(draft)}>
          {t('下一题')}
        </QuestionnaireNext>
        <QuestionnaireSubmit disabled={disabled || submitting || !allAnswered}>
          {submitting && <Spinner data-icon="inline-start" />}
          {t('提交答案')}
        </QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  )
}

export function UserQuestionPanel({
  request,
  state,
  disabled,
  onDraft,
  onItemChange,
  onSubmit
}: {
  request: UserQuestionRequest
  state: UserQuestionFormState
  disabled: boolean
  onDraft: (index: number, draft: UserQuestionDraft) => void
  onItemChange: (item: string) => void
  onSubmit: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <Message align="start">
      <MessageContent>
        <Bubble variant="outline" className="w-full max-w-full">
          <BubbleContent className="w-full">
            <section aria-label={t('回答问题')} className="flex min-w-0 flex-col gap-4 py-2">
              {state.failed && (
                <Alert variant="destructive">
                  <AlertTitle>{t('答案未提交')}</AlertTitle>
                  <AlertDescription>{t('请检查连接后重试，已填写的答案会保留。')}</AlertDescription>
                </Alert>
              )}
              <QuestionForm
                request={request}
                state={state}
                disabled={disabled}
                onDraft={onDraft}
                onItemChange={onItemChange}
                onSubmit={onSubmit}
              />
            </section>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
