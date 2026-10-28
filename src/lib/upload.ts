import { MEDIA_BUCKET } from "@/lib/supabase/env";

type UploadArgs = {
  /** Target bucket (defaults to project-media). */
  bucket?: string;
  path: string;
  file: File;
  accessToken: string;
  onProgress?: (fraction: number) => void;
};

/**
 * Uploads straight from the browser to Supabase Storage as the signed-in
 * admin (Storage RLS decides whether it's allowed). XHR is used instead of
 * fetch because it reports upload progress.
 */
export function uploadToStorage({
  bucket = MEDIA_BUCKET,
  path,
  file,
  accessToken,
  onProgress,
}: UploadArgs): Promise<void> {
  return new Promise((resolve, reject) => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/storage/v1/object/${bucket}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=31536000");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      let message = "Upload failed.";
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        message = body.message ?? body.error ?? message;
      } catch {
        // keep the generic message
      }
      reject(new Error(xhr.status === 413 ? "The file is too large for storage." : message));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading. Check your connection."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(file);
  });
}
