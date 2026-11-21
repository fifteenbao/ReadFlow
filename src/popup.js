import { noteLength, MAX_REMARK_LENGTH } from './lib/capture-metadata.js';
import { chooseLanguage, translate, localizeError } from './lib/options-i18n.js';
const { uiLanguage: saved } = await chrome.storage.local.get('uiLanguage');
let language = chooseLanguage(saved);
const t = (key, values) => translate(language, key, values);
document.documentElement.lang = language;
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.getAttribute('data-i18n'));
for (const [id, route] of [['open-collection', '#reading-list'], ['open-settings', '#settings']]) {
  document.getElementById(id).addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') + route });
    window.close();
  });
}
const element = id => document.getElementById(id);
const button = element('capture'), status = element('capture-status');
const selectedTags = new Set(), options = new Set();
let saving = false;
let context, initial = { tags: [], remark: '' };
const organizationValues = () => ({ purpose: element('capture-reference').checked ? 'reference' : 'later', contentType: element('capture-reference').checked ? element('capture-type').value : initial.contentType, starred: element('capture-starred').checked });
function saveLabel() { element('capture-type-field').hidden = !element('capture-reference').checked; button.textContent = context?.existing ? '保存修改' : organizationValues().purpose === 'reference' ? '保存为资料' : '保存到稍后看'; }
for (const id of ['capture-later', 'capture-reference']) element(id).addEventListener('change', saveLabel);
button.disabled = true;
function renderTags() {
  const list = element('capture-tag-options'); list.replaceChildren();
  const query = element('capture-new-tag').value.trim().normalize('NFC').toLowerCase();
  const matches = query ? [...options].filter(name => name.toLowerCase().includes(query)) : [...selectedTags];
  element('capture-tag-count').textContent = t('tagCount', { count: selectedTags.size });
  element('capture-tag-count').hidden = selectedTags.size === 0;
  element('capture-tags-empty').hidden = matches.length > 0;
  element('capture-tags-empty').textContent = t(query ? 'tagNoMatch' : 'tagSearchHint');
  element('capture-more-tags').hidden = matches.length <= 6;
  for (const name of matches.slice(0, 6)) {
    const label = document.createElement('label'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = selectedTags.has(name);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedTags.add(name); else selectedTags.delete(name);
      element('capture-new-tag').value = ''; status.textContent = ''; renderTags();
    });
    const text = document.createElement('span'); text.textContent = name;
    label.append(checkbox, text); list.append(label);
  }
}

function addTag() {
  const input = element('capture-new-tag'), value = input.value.trim().normalize('NFC');
  input.removeAttribute('aria-invalid');
  if (!value) return true;
  if (value.length > 50 || /[\u0000-\u001f\u007f]/.test(value)) {
    input.setAttribute('aria-invalid', 'true'); status.textContent = t('captureTagLimit'); return false;
  }
  selectedTags.add(value); options.add(value); input.value = ''; renderTags();
  status.textContent = t('captureTagAdded', { tag: value }); return true;
}
element('capture-new-tag').addEventListener('input', renderTags);
element('capture-add-tag').addEventListener('click', addTag);
element('capture-new-tag').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } });
element('popup-language').value = language;
element('popup-language').addEventListener('change', async () => {
  await chrome.storage.local.set({ uiLanguage: element('popup-language').value });
  window.location.reload();
});
element('start-setup').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') + '#settings' }); window.close();
});
element('popup-connection').textContent = t('checking');
status.textContent = '';
try {
  const connection = await chrome.runtime.sendMessage({ type: 'POPUP_STATUS' });
  if (!connection?.ok || !connection.connected) {
    element('popup-connection').textContent = t('setupRequired');
    if (connection?.error) status.textContent = localizeError(connection.error, language);
  } else {
    element('setup-welcome').hidden = true;
    element('capture-editor').hidden = false;
    element('popup-connection').textContent = t('popupConnected');
    status.textContent = t('captureLoading');
    const result = await chrome.runtime.sendMessage({ type: 'CAPTURE_CONTEXT' });
    if (!result?.ok || typeof result.url !== 'string') throw new Error(result?.error || t('genericFailure'));
    context = result;
    initial = { tags: result.tags || [], remark: result.remark || '', purpose: result.purpose || 'later', contentType: result.contentType || 'web', starred: result.starred === true };
    element('capture-reference').checked = initial.purpose === 'reference';
    element('capture-later').checked = initial.purpose === 'later';
    element('capture-type').value = initial.contentType;
    element('capture-starred').checked = initial.starred;
    element('capture-organization').disabled = false;
    element('capture-starred').disabled = false;
    saveLabel();
    for (const tag of [...initial.tags, ...(result.tagOptions || [])]) if (typeof tag === 'string') options.add(tag);
    initial.tags.forEach(tag => selectedTags.add(tag));
    element('capture-page-title').textContent = result.title || result.url;
    element('capture-remark').value = initial.remark;
    renderTags(); element('capture-tags-fieldset').disabled = false; element('capture-remark').disabled = false;
    status.textContent = result.existing ? '已保存，可修改用途、类型、星标和笔记。' : ''; button.disabled = false;
  }
} catch (error) {
  if (element('capture-editor').hidden) element('popup-connection').textContent = t('setupRequired');
  status.textContent = localizeError(error, language);
}
button.addEventListener('click', async () => {
  if (saving || !context) return;
  if (element('capture-new-tag').value.trim()) { status.textContent = t('tagPending'); element('capture-new-tag').focus(); return; }
  const tags = [...selectedTags], remark = element('capture-remark').value;
  if (remark !== initial.remark && noteLength(remark) > MAX_REMARK_LENGTH) { element('capture-remark').setAttribute('aria-invalid', 'true'); status.textContent = t('captureRemarkLimit'); return; }
  element('capture-remark').removeAttribute('aria-invalid');
  const metadata = {};
  const organization = organizationValues();
  if (!context.existing) {
    Object.assign(metadata, organization);
    const sources = {
      purpose: organization.purpose === 'later' ? 'default' : 'user',
      starred: organization.starred ? 'user' : 'default',
      contentType: organization.contentType === context.inferredContentType && organization.contentType === initial.contentType
        ? (organization.contentType === 'web' ? 'default' : 'inferred')
        : 'user',
    };
    metadata.organizationSources = sources;
  } else {
    for (const key of Object.keys(organization)) if (organization[key] !== initial[key]) metadata[key] = organization[key];
  }
  if (JSON.stringify([...tags].sort()) !== JSON.stringify([...initial.tags].sort())) metadata.tags = tags;
  if (remark !== initial.remark) metadata.remark = remark;
  saving = true; button.disabled = true; element('capture-organization').disabled = true;
  element('capture-starred').disabled = true;
  button.textContent = t('capturing'); button.setAttribute('aria-busy', 'true');
  element('capture-tags-fieldset').disabled = true; element('capture-remark').disabled = true;
  status.setAttribute('data-state', 'saving'); status.textContent = t('capturing');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CAPTURE_PAGE', expectedUrl: context.url, metadata });
    if (!result?.ok || !result.saved || !result.synced) throw new Error(result?.error || t('genericFailure'));
    initial = { tags, remark, ...organization }; context.existing = true;
    button.textContent = t('captureSuccess');
    status.setAttribute('data-state', 'success');
    const savedAs = organization.purpose === 'reference' ? '已保存为资料（数据库已确认）' : '已保存到稍后看（数据库已确认）';
    status.textContent = savedAs + ' ';
    const openList = document.createElement('button');
    openList.type = 'button'; openList.className = 'text-link'; openList.textContent = '查看列表';
    openList.addEventListener('click', async () => {
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') + '#reading-list/' + organization.purpose });
      window.close();
    });
    status.appendChild(openList);
  } catch (error) {
    button.textContent = t('captureRetry');
    status.setAttribute('data-state', 'error');
    status.textContent = t('captureFailed', { reason: localizeError(error, language) });
  } finally {
    saving = false; button.disabled = false; element('capture-organization').disabled = false;
    element('capture-starred').disabled = false; button.removeAttribute('aria-busy');
    element('capture-tags-fieldset').disabled = false; element('capture-remark').disabled = false;
  }
});
