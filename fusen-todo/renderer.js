let tasks = [];
let categories = [];
let editingId = null; // 編集中のタスクID(nullなら新規登録)
let currentTab = 'active';
let sortBy = localStorage.getItem('sortBy') || 'deadline';

const $ = (id) => document.getElementById(id);
const formCard = $('form-card');
const notifyOptions = $('notify-options');

const REPEAT_LABEL = { daily: '毎日', weekly: '毎週', monthly: '毎月' };
const PRIORITY_LABEL = { high: '🔴 高', mid: '🟡 中', low: '🔵 低' };
const PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };

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
  // 通知日が空なら今日を入れておく
  if (e.target.checked && !$('f-notify-date').value) {
    $('f-notify-date').value = todayStr();
  }
});

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 時・分の入力は範囲内で止める(回転させない)
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
  // 通知ありが標準
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
    $('f-notify-date').value = '';
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
      // 通知時間が未来なら再通知できるようにリセット
      task.notified = notifyAt ? new Date(notifyAt).getTime() <= Date.now() : false;
    }
  } else {
    tasks.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ...fields,
      notified: false,
      done: false,
      createdAt: new Date().toISOString()
    });
  }

  await window.api.saveTasks(tasks);
  formCard.classList.remove('open');
  resetForm();
  render();
});

// ===== 繰り返しタスクの完了処理(次の回へ進める) =====

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

  const visible = tasks.filter((t) =>
    currentTab === 'done' ? t.done : !t.done
  );
  $('empty').hidden = visible.length > 0;
  $('empty').textContent =
    currentTab === 'done'
      ? '完了したタスクはまだありません。'
      : 'タスクはありません。「＋」から追加してください。';

  for (const task of sortTasks(visible)) {
    const note = document.createElement('div');
    note.className = 'note' + (task.done ? ' done' : '') + (isOverdue(task) ? ' overdue' : '');
    const cat = findCategory(task.category);
    if (cat) note.style.background = cat.color;

    // 一覧にはタスク名と締め切りだけを表示する
    const title = document.createElement('div');
    title.className = 'note-title';
    title.textContent = task.title;
    note.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'note-meta';
    if (task.deadline) {
      const el = document.createElement('div');
      el.textContent = `📅 締め切り: ${fmtDate(task.deadline)}` + (isOverdue(task) ? ' (期限切れ!)' : '');
      meta.appendChild(el);
    }
    const hint = document.createElement('div');
    hint.className = 'detail-hint';
    hint.textContent = '▸ クリックで詳細';
    meta.appendChild(hint);
    note.appendChild(meta);

    // 残りの情報はクリックで開く詳細に入れる
    const detail = document.createElement('div');
    detail.className = 'note-detail';
    detail.hidden = true;

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
    if (!task.done) {
      const editBtn = document.createElement('button');
      editBtn.textContent = '✏ 編集';
      editBtn.addEventListener('click', () => startEdit(task));
      actions.appendChild(editBtn);

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
        await window.api.saveTasks(tasks);
        render();
      });
      actions.appendChild(doneBtn);
    } else {
      const undoBtn = document.createElement('button');
      undoBtn.textContent = '↩ 戻す';
      undoBtn.addEventListener('click', async () => {
        task.done = false;
        delete task.doneAt;
        await window.api.saveTasks(tasks);
        render();
      });
      actions.appendChild(undoBtn);
    }
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '🗑 削除';
    delBtn.addEventListener('click', async () => {
      tasks = tasks.filter((t) => t.id !== task.id);
      await window.api.saveTasks(tasks);
      render();
    });
    actions.appendChild(delBtn);
    note.appendChild(actions);

    list.appendChild(note);
  }
}

// ===== 自動起動設定 =====

$('autostart').addEventListener('change', (e) => {
  window.api.setAutostart(e.target.checked);
});

// リマインドポップアップ側で完了/スヌーズされた時に同期する
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
