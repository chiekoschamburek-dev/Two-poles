const MAX_INPUT_BYTES = 12 * 1024 * 1024

/** 异步编码，避免大图同步阻塞页面。 */
export function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('浏览器无法编码这张图片'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('浏览器无法读取压缩后的图片'))
      }
      reader.onerror = () => reject(reader.error ?? new Error('浏览器无法读取压缩后的图片'))
      reader.readAsDataURL(blob)
    }, 'image/jpeg', quality)
  })
}

/** 将图片缩到给定最长边，只在内存里保留 JPEG。 */
export async function prepareModelImage(file: File, maxEdge = 1024): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件（JPEG / PNG / WebP）。')
  if (file.size > MAX_INPUT_BYTES) throw new Error('这张图片超过 12 MB，请换一张更小的图片。')

  let bitmap: ImageBitmap | null = null
  try {
    if (file.size > 2 * 1024 * 1024) {
      try {
        bitmap = await createImageBitmap(file, { resizeWidth: maxEdge, resizeQuality: 'high' })
      } catch {
        bitmap = await createImageBitmap(file)
      }
    } else {
      bitmap = await createImageBitmap(file)
    }
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器无法处理这张图片')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await canvasToJpegDataUrl(canvas)
  } catch {
    throw new Error('这张图片无法读取，请换一张 JPEG / PNG / WebP 图片。')
  } finally {
    bitmap?.close()
  }
}
