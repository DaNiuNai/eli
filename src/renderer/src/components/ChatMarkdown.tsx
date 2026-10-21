import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode
} from 'react'
import Markdown, { defaultUrlTransform, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getChatImageSource, isChatImageReference } from '../../../shared/chat-images'
import { useLanguage } from '@renderer/hooks/use-language'
import { MarkdownImage } from './MarkdownImage'
import { remarkImagePaths } from '@renderer/lib/remark-image-paths'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle
} from '@renderer/components/ui/code-block'

function linkText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      return isValidElement<{ children?: ReactNode }>(child) ? linkText(child.props.children) : ''
    })
    .join('')
}

function MarkdownLink({
  children,
  href,
  title,
  node
}: ComponentProps<'a'> & ExtraProps): React.JSX.Element {
  const hasImage = node?.children.some(
    (child) => child.type === 'element' && child.tagName === 'img'
  )
  if (href && isChatImageReference(href) && !hasImage) {
    return <MarkdownImage key={href} source={href} alt={linkText(children)} title={title} />
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

function MarkdownImageElement({ src, alt, title }: ComponentProps<'img'>): React.JSX.Element {
  const source = typeof src === 'string' ? src : ''
  return <MarkdownImage key={source} source={source} alt={alt} title={title} />
}

export function ChatMarkdown({ text }: { text: string }): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkImagePaths]}
        skipHtml
        urlTransform={(value, key) => {
          if (key === 'src' || isChatImageReference(value)) {
            return getChatImageSource(value)?.value ?? ''
          }
          return defaultUrlTransform(value)
        }}
        components={{
          a: MarkdownLink,
          img: MarkdownImageElement,
          pre: ({ children }) => {
            const code = children as ReactElement<{ children?: string; className?: string }>
            const value = String(code.props.children ?? '').replace(/\n$/, '')
            const language = code.props.className?.replace('language-', '') || t('代码')
            return (
              <CodeBlock>
                <CodeBlockHeader>
                  <CodeBlockTitle>{language}</CodeBlockTitle>
                  <CodeBlockActions>
                    <CodeBlockCopyButton
                      value={value}
                      aria-label={t('复制代码')}
                      title={t('复制代码')}
                    />
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
