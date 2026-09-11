/**
 * Handing the user a file.
 *
 * Everything this tool exports is produced in the browser and saved by the browser. There
 * is no backend to post to, so a download is the only delivery mechanism there is, and
 * the only one consistent with the promise that tenant data never leaves the machine.
 */

export type DownloadResult = { ok: true } | { ok: false; reason: string };

/**
 * Saves text as a file.
 *
 * Returns a result rather than throwing, because a blocked download is a normal thing for
 * a browser to do and the caller needs to say so on screen. A silent failure here would be
 * the worst outcome: the user believes their negotiated prices are safely on disk when
 * nothing was written.
 */
export function downloadText(filename: string, text: string, mime: string): DownloadResult {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on the next tick: revoking synchronously can cancel the download in some
    // browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason:
        e instanceof Error
          ? `The browser refused the download: ${e.message}`
          : 'The browser refused the download.',
    };
  }
}

export function downloadJson(filename: string, value: unknown): DownloadResult {
  return downloadText(filename, JSON.stringify(value, null, 2), 'application/json');
}
