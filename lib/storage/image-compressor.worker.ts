export {}

type CompressionRequest = {
  file: File
  maxDimension: number
  quality: number
}

type CompressionResponse =
  | { success: true; blob: Blob }
  | { success: false; error: string }

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<CompressionRequest>) => void) | null
  postMessage: (message: CompressionResponse) => void
}

workerScope.onmessage = async ({ data }: MessageEvent<CompressionRequest>) => {
  let bitmap: ImageBitmap | undefined

  try {
    bitmap = await createImageBitmap(data.file, { imageOrientation: "from-image" })
    const scale = Math.min(1, data.maxDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext("2d")

    if (!context) throw new Error("تعذّر تجهيز أداة معالجة الصورة")

    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: data.quality })
    workerScope.postMessage({ success: true, blob })
  } catch (error) {
    workerScope.postMessage({
      success: false,
      error: error instanceof Error ? error.message : "تعذّر ضغط الصورة",
    })
  } finally {
    bitmap?.close()
  }
}
