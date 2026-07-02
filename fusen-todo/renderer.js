let tasks = [];
let categories = [];
let editingId = null;
let currentTab = 'active';
let sortBy = localStorage.getItem('sortBy') || 'deadline';

const $ = (id) => document.getElementById(id);
const formCard = $('form-card');
const notifyOptions = $('notify-options');

const REPEAT_LABEL = { daily: '毎日', weekly: '毎週', monthly: '毎月' };
const PRIORITY_LABEL = { high: '🔴 高', mid: '🟡 中', low: '🔵 低' };
const PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };

// ===== パスワード暗号化 =====

async function hashPassword(password) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ===== モーダルダイアログ(window.prompt/confirmはElectronで動作しないため自前実装) =====

function openModal({ title, message, fields = [], buttons }) {
  return new Promise((resolve) => {
    const overlay = $('modal-overlay');
    $('modal-title').textContent = title || '';
    $('modal-message').textContent = message || '';

    const fieldsBox = $('modal-fields');
    fieldsBox.innerHTML = '';
    const inputs = {};
    for (const f of fields) {
      const label = document.createElement('label');
      label.textContent = f.label;
      const input = document.createElement('input');
      input.type = f.type || 'text';
      input.autocomplete = 'off';
      label.appendChild(input);
      fieldsBox.appendChild(label);
      inputs[f.id] = input;
    }

    const actionsBox = $('modal-actions');
    actionsBox.innerHTML = '';

    const finish = (result) => {
      overlay.hidden = true;
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };

    const onKeydown = (e) => {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter') {
        const primaryBtn = actionsBox.querySelector('button.primary');
        if (primaryBtn) primaryBtn.click();
      }
    };

    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.className = b.primary ? 'primary' : 'ghost';
      btn.addEventListener('click', () => {
        if (b.cancel) {
          finish(null);
          return;
        }
        const values = {};
        for (const key in inputs) values[key] = inputs[key].value;
        finish({ action: b.value, values });
      });
      actionsBox.appendChild(btn);
    }

    document.addEventListener('keydown', onKeydown);
    overlay.hidden = false;
    const firstInput = fieldsBox.querySelector('input');
    if (firstInput) firstInput.focus();
  });
}

// 新しいパスワードを2回入力させる。戻り値はハッシュ文字列、キャンセルならnull
async function askNewPassword() {
  while (true) {
    const pw = await openModal({
      title: '🔒 パスワードを設定',
      message: '保存用のパスワードを入力してください。',
      fields: [
        { id: 'pw1', label: 'パスワード', type: 'password' },
        { id: 'pw2', label: 'パスワード(確認)', type: 'password' }
      ],
      buttons: [
        { label: '設定する', value: 'ok', primary: true },
        { label: 'キャンセル', value: 'cancel', cancel: true }
      ]
    });
    if (!pw) return null;
    const { pw1, pw2 } = pw.values;
    if (!pw1) {
      alert('パスワードを入力してください');
      continue;
    }
    if (pw1 !== pw2) {
      alert('パスワードが一致しません');
      continue;
    }
    return hashPassword(pw1);
  }
}

// 戻り値: { aborted: true } なら保存自体を中止、passwordHash は null(パスワードなし)か文字列
async function askPasswordForSave() {
  const choice = await openModal({
    title: '💾 タスクを保存',
    message: 'このタスクをパスワードで保護しますか?',
    buttons: [
      { label: '🔓 かけない', value: 'no-protect', primary: true },
      { label: '🔒 パスワードをかける', value: 'protect' },
      { label: 'キャンセル', value: 'cancel', cancel: true }
    ]
  });
  if (!choice) return { aborted: true };
  if (choice.action === 'no-protect') return { aborted: false, passwordHash: null };

  const hash = await askNewPassword();
  if (hash === null) return { aborted: true };
  return { aborted: false, passwordHash: hash };
}

async function askPasswordForLoad() {
  const result = await openModal({
    title: '🔓 ロック解除',
    message: 'このタスクを表示するにはパスワードが必要です。',
    fields: [{ id: 'pw', label: 'パスワード', type: 'password' }],
    buttons: [
      { label: '解除する', value: 'ok', primary: true },
      { label: 'キャンセル', value: 'cancel', cancel: true }
    ]
  });
  if (!result) return null;
  return hashPassword(result.values.pw);
}

// ロック解除状態(unlocked/justUnlocked)は表示専用のフラグなので、
// ディスクに保存する前に取り除く(保存すると次回起動時にパスワードなしで見えてしまう)
async function persistTasks() {
  const clean = tasks.map(({ unlocked, justUnlocked, ...rest }) => rest);
  await window.api.saveTasks(clean);
}

function findCategory(name) {
  return categories.find((c) => c.name === name) || null;
}

// ===== カテゴリ選択 =====

function renderCategorySelect(selected) {
  const sel = $('f-category');
  sel.innerHTML = '';
  for (const c of categories) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  const add = document.createElement('option');
  add.value = '__new__';
  add.textContent = '＋ 新しいカテゴリを追加…';
  sel.appendChild(add);
  sel.value = selected && findCategory(selected) ? selected : 'その他';
  if (!sel.value) sel.selectedIndex = 0;
}

$('f-category').addEventListener('change', (e) => {
  $('new-cat-row').hidden = e.target.value !== '__new__';
  if (e.target.value === '__new__') $('nc-name').focus();
});

$('nc-add').addEventListener('click', async () => {
  const name = $('nc-name').value.trim();
  if (!name) {
    $('nc-name').focus();
    return;
  }
  if (findCategory(name)) {
    alert('同じ名前のカテゴリがあります');
    return;
  }
  categories.push({ name, color: $('nc-color').value });
  await window.api.saveCategories(categories);
  $('nc-name').value = '';
  $('new-cat-row').hidden = true;
  renderCategorySelect(name);
});

// ===== タブと並び替え =====

for (const btn of document.querySelectorAll('#tabs .tab')) {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.tab;
    for (const b of document.querySelectorAll('#tabs .tab')) {
      b.classList.toggle('active', b === btn);
    }
    render();
  });
}

$('sort-select').value = sortBy;
$('sort-select').addEventListener('change', (e) => {
  sortBy = e.target.value;
  localStorage.setItem('sortBy', sortBy);
  render();
});

// ===== フォーム開閉 =====

$('add-btn').addEventListener('click', () => {
  if (formCard.classList.contains('open')) {
    formCard.classList.remove('open');
    resetForm();
  } else {
    resetForm();
    formCard.classList.add('open');
    $('f-title').focus();
  }
});

$('f-cancel').addEventListener('click', () => {
  formCard.classList.remove('open');
  resetForm();
});

$('f-notify').addEventListener('change', (e) => {
  notifyOptions.classList.toggle('open', e.target.checked);
  if (e.target.checked && !$('f-notify-date').value) {
    $('f-notify-date').value = todayStr();
  }
});

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function clampField(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  let v = parseInt(input.value, 10);
  if (isNaN(v)) v = min;
  input.value = Math.min(Math.max(v, min), max);
}
for (const id of ['f-notify-hour', 'f-notify-min']) {
  $(id).addEventListener('change', (e) => clampField(e.target));
  $(id).addEventListener('blur', (e) => clampField(e.target));
}

function resetForm() {
  editingId = null;
  $('f-save').textContent = '登録';
  $('f-title').value = '';
  renderCategorySelect(null);
  $('new-cat-row').hidden = true;
  $('f-deadline').value = '';
  $('f-repeat').value = 'none';
  $('f-priority').value = 'mid';
  $('f-target').value = '';
  $('f-url').value = '';
  $('f-memo').value = '';
  $('f-notify').checked = true;
  $('f-notify-date').value = todayStr();
  $('f-notify-hour').value = 8;
  $('f-notify-min').value = 0;
  document.querySelector('input[name="f-sound"][value="silent"]').checked = true;
  notifyOptions.classList.add('open');
}

function startEdit(task) {
  editingId = task.id;
  $('f-save').textContent = '保存';
  $('f-title').value = task.title;
  renderCategorySelect(task.category);
  $('new-cat-row').hidden = true;
  $('f-deadline').value = task.deadline || '';
  $('f-repeat').value = task.repeat || 'none';
  $('f-priority').value = task.priority || 'mid';
  $('f-target').value = task.target || '';
  $('f-url').value = task.url || '';
  $('f-memo').value = task.memo || '';
  $('f-notify').checked = !!task.notify;
  if (task.notifyAt) {
    const d = new Date(task.notifyAt);
    const p = (n) => String(n).padStart(2, '0');
    $('f-notify-date').value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    $('f-notify-hour').value = d.getHours();
    $('f-notify-min').value = d.getMinutes();
  } else {
    $('f-notify-date').value = todayStr();
    $('f-notify-hour').value = 8;
    $('f-notify-min').value = 0;
  }
  document.querySelector(
    `input[name="f-sound"][value="${task.sound ? 'sound' : 'silent'}"]`
  ).checked = true;
  notifyOptions.classList.toggle('open', !!task.notify);
  formCard.classList.add('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('f-title').focus();
}

// ===== 登録 / 保存 =====

$('f-save').addEventListener('click', async () => {
  const title = $('f-title').value.trim();
  if (!title) {
    $('f-title').focus();
    return;
  }
  let category = $('f-category').value;
  if (category === '__new__') {
    alert('カテゴリ名を入力して「追加」を押すか、別のカテゴリを選んでください');
    return;
  }
  const notify = $('f-notify').checked;
  let notifyAt = null;
  if (notify) {
    const date = $('f-notify-date').value;
    if (!date) {
      alert('通知する日付を入力してください');
      return;
    }
    clampField($('f-notify-hour'));
    clampField($('f-notify-min'));
    const p = (n) => String(n).padStart(2, '0');
    notifyAt = new Date(
      `${date}T${p($('f-notify-hour').value)}:${p($('f-notify-min').value)}`
    ).toISOString();
  }
  const sound =
    document.querySelector('input[name="f-sound"]:checked').value === 'sound';

  const fields = {
    title,
    category,
    deadline: $('f-deadline').value || null,
    repeat: $('f-repeat').value,
    priority: $('f-priority').value,
    target: $('f-target').value.trim() || null,
    url: $('f-url').value.trim() || null,
    memo: $('f-memo').value.trim() || null,
    notify,
    notifyAt,
    sound
  };

  if (editingId) {
    const task = tasks.find((t) => t.id === editingId);
    if (task) {
      Object.assign(task, fields);
      task.notified = notifyAt ? new Date(notifyAt).getTime() <= Date.now() : false;
    }
  } else {
    tasks.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ...fields,
      notified: false,
      done: false,
      saved: false,
      createdAt: new Date().toISOString()
    });
  }

  await persistTasks();
  formCard.classList.remove('open');
  resetForm();
  render();
});

// ===== 繰り返しタスクの完了処理 =====

function advanceRepeat(task) {
  const step = (d) => {
    if (task.repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (task.repeat === 'weekly') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
  };
  const advancePast = (d, endOfDay) => {
    do {
      step(d);
    } while (
      (endOfDay ? new Date(d).setHours(23, 59, 59, 999) : d.getTime()) <=
      Date.now()
    );
    return d;
  };
  const pad = (n) => String(n).padStart(2, '0');
  if (task.deadline) {
    const d = advancePast(new Date(task.deadline + 'T00:00:00'), true);
    task.deadline = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (task.notifyAt) {
    task.notifyAt = advancePast(new Date(task.notifyAt), false).toISOString();
    task.notified = false;
  }
}

// ===== 一覧表示 =====

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isOverdue(task) {
  if (task.done || !task.deadline) return false;
  const end = new Date(task.deadline);
  end.setHours(23, 59, 59, 999);
  return end.getTime() < Date.now();
}

function sortTasks(list) {
  const byDeadline = (a, b) =>
    (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1;
  const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : 1);
  return [...list].sort((a, b) => {
    if (sortBy === 'created') return byCreated(a, b);
    if (sortBy === 'priority') {
      const pa = PRIORITY_ORDER[a.priority || 'mid'];
      const pb = PRIORITY_ORDER[b.priority || 'mid'];
      if (pa !== pb) return pa - pb;
      return byDeadline(a, b);
    }
    return byDeadline(a, b);
  });
}

function render() {
  const list = $('list');
  list.innerHTML = '';

  const visible = tasks.filter((t) => {
    if (currentTab === 'done') return t.done;
    if (currentTab === 'saved') return t.saved;
    return !t.done && !t.saved;
  });
  $('empty').hidden = visible.length > 0;
  $('empty').textContent =
    currentTab === 'done'
      ? '完了したタスクはまだありません。'
      : currentTab === 'saved'
        ? '保存したタスクはまだありません。'
        : 'タスクはありません。「＋」から追加してください。';

  for (const task of sortTasks(visible)) {
    // パスワード保護されていて保存タブの場合、パスワード確認
    if (currentTab === 'saved' && task.passwordHash && !task.unlocked) {
      // パスワード保護されているので表示スキップ
      continue;
    }

    const note = document.createElement('div');
    note.className =
      'note' +
      (task.done ? ' done' : '') +
      (isOverdue(task) ? ' overdue' : '') +
      (task.passwordHash ? ' protected' : '');
    const cat = findCategory(task.category);
    if (cat) note.style.background = cat.color;

    const title = document.createElement('div');
    title.className = 'note-title';
    title.textContent = task.title + (task.passwordHash ? ' 🔐' : '');
    note.appendChild(title);

    const justUnlocked = !!task.justUnlocked;
    delete task.justUnlocked;

    const meta = document.createElement('div');
    meta.className = 'note-meta';
    if (task.deadline) {
      const el = document.createElement('div');
      el.textContent = `📅 締め切り: ${fmtDate(task.deadline)}` + (isOverdue(task) ? ' (期限切れ!)' : '');
      meta.appendChild(el);
    }
    const hint = document.createElement('div');
    hint.className = 'detail-hint';
    hint.textContent = justUnlocked ? '▾ 詳細を閉じる' : '▸ クリックで詳細';
    meta.appendChild(hint);
    note.appendChild(meta);

    const detail = document.createElement('div');
    detail.className = 'note-detail';
    detail.hidden = !justUnlocked;

    const badges = document.createElement('div');
    if (cat) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = cat.name;
      badges.appendChild(b);
    }
    {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = PRIORITY_LABEL[task.priority || 'mid'];
      badges.appendChild(b);
    }
    if (task.repeat && task.repeat !== 'none') {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = `🔁 ${REPEAT_LABEL[task.repeat]}`;
      badges.appendChild(b);
    }
    detail.appendChild(badges);

    if (task.target) {
      const el = document.createElement('div');
      el.textContent = `📮 提出先: ${task.target}`;
      detail.appendChild(el);
    }
    if (task.notify && task.notifyAt && !task.done) {
      const el = document.createElement('div');
      el.textContent = `${task.sound ? '🔔' : '🔕'} 通知: ${fmtDateTime(task.notifyAt)}`;
      detail.appendChild(el);
    }
    if (task.url) {
      const el = document.createElement('div');
      const a = document.createElement('a');
      a.textContent = `🔗 ${task.url}`;
      a.addEventListener('click', () => window.api.openUrl(task.url));
      el.appendChild(a);
      detail.appendChild(el);
    }
    if (task.memo) {
      const memo = document.createElement('div');
      memo.className = 'note-memo';
      memo.textContent = task.memo;
      detail.appendChild(memo);
    }
    note.appendChild(detail);

    note.classList.add('has-memo');
    note.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      detail.hidden = !detail.hidden;
      hint.textContent = detail.hidden ? '▸ クリックで詳細' : '▾ 詳細を閉じる';
    });

    const actions = document.createElement('div');
    actions.className = 'note-actions';
    if (!task.done && !task.saved) {
      const editBtn = document.createElement('button');
      editBtn.textContent = '✏ 編集';
      editBtn.addEventListener('click', () => startEdit(task));
      actions.appendChild(editBtn);

      const saveBtn = document.createElement('button');
      saveBtn.textContent = '💾 保存';
      saveBtn.addEventListener('click', async () => {
        const result = await askPasswordForSave();
        if (result.aborted) return; // 保存自体をキャンセル
        task.saved = true;
        task.savedAt = new Date().toISOString();
        task.passwordHash = result.passwordHash;
        await persistTasks();
        render();
      });
      actions.appendChild(saveBtn);

      const doneBtn = document.createElement('button');
      doneBtn.className = 'done-btn';
      doneBtn.textContent = '✓ 完了';
      doneBtn.addEventListener('click', async () => {
        if (task.repeat && task.repeat !== 'none') {
          advanceRepeat(task);
        } else {
          task.done = true;
          task.doneAt = new Date().toISOString();
        }
        await persistTasks();
        render();
      });
      actions.appendChild(doneBtn);
    } else if (task.saved && !task.done) {
      if (task.passwordHash) {
        // 保護中(かつロック解除済み)のタスクはパスワードを外せる
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '🔓 パスワード解除';
        removeBtn.addEventListener('click', async () => {
          if (!confirm('パスワード保護を外しますか?')) return;
          task.passwordHash = null;
          await persistTasks();
          render();
        });
        actions.appendChild(removeBtn);
      } else {
        // パスワードなしで保存されたタスクに、あとからパスワードをかけられる
        const protectBtn = document.createElement('button');
        protectBtn.textContent = '🔒 パスワード設定';
        protectBtn.addEventListener('click', async () => {
          const hash = await askNewPassword();
          if (hash === null) return;
          task.passwordHash = hash;
          await persistTasks();
          render();
        });
        actions.appendChild(protectBtn);
      }

      const restoreBtn = document.createElement('button');
      restoreBtn.textContent = '↩ 戻す';
      restoreBtn.addEventListener('click', async () => {
        task.saved = false;
        delete task.savedAt;
        delete task.passwordHash;
        await persistTasks();
        render();
      });
      actions.appendChild(restoreBtn);
    } else if (task.done) {
      const undoBtn = document.createElement('button');
      undoBtn.textContent = '↩ 戻す';
      undoBtn.addEventListener('click', async () => {
        task.done = false;
        delete task.doneAt;
        await persistTasks();
        render();
      });
      actions.appendChild(undoBtn);
    }
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '🗑 削除';
    delBtn.addEventListener('click', async () => {
      tasks = tasks.filter((t) => t.id !== task.id);
      await persistTasks();
      render();
    });
    actions.appendChild(delBtn);
    note.appendChild(actions);

    list.appendChild(note);
  }

  // パスワード保護タスクのロック状態を表示
  if (currentTab === 'saved') {
    const protected_tasks = tasks.filter(
      (t) => t.saved && t.passwordHash && !t.unlocked
    );
    for (const task of protected_tasks) {
      const note = document.createElement('div');
      note.className = 'note protected';
      const cat = findCategory(task.category);
      if (cat) note.style.background = cat.color;

      const title = document.createElement('div');
      title.className = 'note-title';
      title.textContent = task.title + ' 🔐';
      note.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'note-meta';
      const el = document.createElement('div');
      el.textContent = '🔒 パスワード保護';
      meta.appendChild(el);
      note.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'note-actions';
      const unlockBtn = document.createElement('button');
      unlockBtn.textContent = '🔓 ロック解除';
      unlockBtn.addEventListener('click', async () => {
        const hash = await askPasswordForLoad();
        if (hash === null) return; // キャンセル
        if (hash === task.passwordHash) {
          task.unlocked = true;
          task.justUnlocked = true;
          render();
        } else {
          alert('パスワードが一致しません');
        }
      });
      actions.appendChild(unlockBtn);
      const delBtn = document.createElement('button');
      delBtn.className = 'del-btn';
      delBtn.textContent = '🗑 削除';
      delBtn.addEventListener('click', async () => {
        tasks = tasks.filter((t) => t.id !== task.id);
        await persistTasks();
        render();
      });
      actions.appendChild(delBtn);
      note.appendChild(actions);

      list.appendChild(note);
    }
  }
}

$('autostart').addEventListener('change', (e) => {
  window.api.setAutostart(e.target.checked);
});

window.api.onTasksUpdated((updated) => {
  tasks = updated;
  render();
});

(async () => {
  const data = await window.api.getData();
  tasks = data.tasks;
  categories = data.categories;
  renderCategorySelect(null);
  $('autostart').checked = await window.api.getAutostart();
  render();
})();
