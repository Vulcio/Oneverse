/**
 * The files dropped on a page, folders and all (issue #40): a dropped
 * folder is read through, its folders inside it too. Where the browser
 * can't read folders, the files dropped as they are.
 */
export async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(transfer.items ?? [])
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length === 0) return Array.from(transfer.files ?? []);
  const files: File[] = [];
  await Promise.all(entries.map((entry) => readEntry(entry, files)));
  return files;
}

async function readEntry(entry: FileSystemEntry, into: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
    if (file) into.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // A folder's entries come a hundred or so at a time, until an empty batch.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (batch.length === 0) return;
    await Promise.all(batch.map((child) => readEntry(child, into)));
  }
}
