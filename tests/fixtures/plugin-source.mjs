/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript 测试夹具。 */
export function imageInputPlugin(trigger, imageExpression, extra = '', additionalContent = '') {
  return `export const inject = ['attachments', 'eli', 'eliTools', 'tools']
export function apply(ctx) {
  ctx.on('agent/pre-step', async (_event, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    return { ...decision, messages: await Promise.all(decision.messages.map(async (message) => {
      if (!message.content.some(part => part.type === 'text' && part.text === ${JSON.stringify(trigger)})) return message
      const attachment = await ctx.attachments.saveImage({ data: ${imageExpression}, mediaType: 'image/png' })
      return { ...message, content: [...message.content, { type: 'image', attachment }${additionalContent ? `, ${additionalContent}` : ''}] }
    })) }
  })
  ${extra}
}`
}

export function commandPlugin(name, text, extra = '') {
  return `export const inject = ['commands', 'eli']
export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({ name: ${JSON.stringify(name)}, description: 'Fixture command',
    handler: async () => ({ kind: 'success', text: ${JSON.stringify(text)} }) }))
  ${extra}
}`
}
