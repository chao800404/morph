import type { FileWithPreview } from "./_store/upload.store";

/**
 * Move the files held by the upload store into the outgoing `FormData`.
 *
 * The upload field keeps its files in a store rather than a native input, so a
 * form submit carries none of them until this runs. Durations are extracted
 * when the file is picked, and travel alongside as a parallel array because
 * `FormData` has nowhere to hang per-file metadata.
 *
 * This lived inside `CreateDialog`, which meant a create page that was not that
 * dialog silently submitted no files.
 */
export const appendUploadFiles = (
  formData: FormData,
  fileData: Record<string, FileWithPreview[]>,
): void => {
  const durations: Array<number | null> = [];
  let fileIndex = 0;

  for (const [name, files] of Object.entries(fileData)) {
    if (!Array.isArray(files)) continue;
    for (const { file, duration } of files) {
      formData.append(name, file);
      durations[fileIndex] =
        duration !== undefined && duration > 0 ? duration : null;
      fileIndex++;
    }
  }

  if (durations.length > 0) {
    formData.set("durations", JSON.stringify(durations));
  }
};
