"use client";

// Compression d'images côté client (Canvas) avant envoi sur le DataChannel.
// L'image ne quitte JAMAIS l'appareil non chiffrée.

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.85;

export async function compressImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap | null = null;
  try {
    if ("createImageBitmap" in window) {
      bitmap = await createImageBitmap(file);
    }
  } catch {
    bitmap = null;
  }

  const { width, height } = bitmap
    ? { width: bitmap.width, height: bitmap.height }
    : await imageDims(file);

  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible");

  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0, w, h);
  } else {
    const img = await loadImg(file);
    ctx.drawImage(img, 0, 0, w, h);
  }

  const type = file.type === "image/png" && scale === 1 ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY));
  bitmap?.close();
  if (!blob) throw new Error("Compression impossible");
  return blob;
}

function loadImg(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible"));
    };
    img.src = url;
  });
}

async function imageDims(file: File): Promise<{ width: number; height: number }> {
  const img = await loadImg(file);
  return { width: img.naturalWidth, height: img.naturalHeight };
}
