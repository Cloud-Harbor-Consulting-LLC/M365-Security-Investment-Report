import type { DroppedFile } from '@/portfolio';

/** Reads dropped or chosen files as JSON, in the order given. Invalid JSON reads as null. */
export function readFiles(files: FileList | readonly File[]): Promise<DroppedFile[]> {
  return Promise.all(
    [...files].map(
      (file) =>
        new Promise<DroppedFile>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              resolve({ name: file.name, raw: JSON.parse(String(reader.result)) });
            } catch {
              resolve({ name: file.name, raw: null });
            }
          };
          reader.onerror = () => resolve({ name: file.name, raw: null });
          reader.readAsText(file);
        }),
    ),
  );
}
