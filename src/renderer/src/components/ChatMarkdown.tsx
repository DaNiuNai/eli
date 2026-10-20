import type { ReactElement } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle
} from '@renderer/components/ui/code-block'

export function ChatMarkdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>[图片：{alt || '未加载'}]</span>,
          pre: ({ children }) => {
            const code = children as ReactElement<{ children?: string; className?: string }>
            const value = String(code.props.children ?? '').replace(/\n$/, '')
            const language = code.props.className?.replace('language-', '') || '代码'
            return (
              <CodeBlock>
                <CodeBlockHeader>
                  <CodeBlockTitle>{language}</CodeBlockTitle>
                  <CodeBlockActions>
                    <CodeBlockCopyButton value={value} aria-label="复制代码" />
                  </CodeBlockActions>
                </CodeBlockHeader>
                <CodeBlockContent className="max-h-96">{value}</CodeBlockContent>
              </CodeBlock>
            )
          }
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
