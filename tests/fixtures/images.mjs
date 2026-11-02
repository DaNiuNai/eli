/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { crc32, deflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { getPackageDir } from '@earendil-works/pi-coding-agent'

export function createPng(width = 3000, height = 1000) {
  const chunk = (type, data) => {
    const content = Buffer.concat([Buffer.from(type), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(content))
    return Buffer.concat([length, content, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const stride = width * 3 + 1
  const pixels = Buffer.alloc(stride * height, 240)
  for (let y = 0; y < height; y++) pixels[y * stride] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export function imageSize(dataUrl) {
  const require = createRequire(join(getPackageDir(), 'package.json'))
  const { PhotonImage } = require('@silvia-odwyer/photon-node')
  const image = PhotonImage.new_from_byteslice(Buffer.from(dataUrl.split(',')[1], 'base64'))
  try {
    return { width: image.get_width(), height: image.get_height() }
  } finally {
    image.free()
  }
}

export function requestImages(body) {
  return body.messages.flatMap(({ content }) =>
    Array.isArray(content)
      ? content.filter(({ type }) => type === 'image_url').map(({ image_url }) => image_url.url)
      : []
  )
}
