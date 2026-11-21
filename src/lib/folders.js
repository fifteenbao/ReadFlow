export function isFolderId(value) {
  return typeof value === 'string' && /^folder_[0-9a-f]{32}$/.test(value);
}

export function isFolderName(value) {
  return typeof value === 'string' && !!value.trim() && [...value].length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function validFolders(value) {
  if (!Array.isArray(value) || value.length > 500) return false;
  const seen = new Set();
  return value.every(folder => {
    if (!folder || !isFolderId(folder.id) || !isFolderName(folder.name) || seen.has(folder.id) ||
        (folder.parentId !== null && !seen.has(folder.parentId))) return false;
    seen.add(folder.id);
    return true;
  });
}
