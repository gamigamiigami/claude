let tasks = [];
let categories = [];
let editingId = null; // 編集中のタスクID(nullなら新規登録)

const $ = (id) => document.getElementById(id);
const formCard = $('form-card');
const notifyOptions = $('notify-options');

const REPEAT_LABEL = { daily: '毎日', weekly: '毎週', monthly: '毎月' };

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
});

function resetForm() {
  editingId = null;
  $('f-save').textContent = '登録';
  $('f-title').value = '';
  renderCategorySelect(null);
  $('new-cat-row').hidden = true;
  $('f-deadline').value = '';
  $('f-repeat').value = 'none';
  $('f-target').value = '';
  $('f-url').value = '';
  $('f-memo').value = '';
  $('f-notify').checked = false;
  $('f-notify-at').value = '';
  document.querySelector('input[name="f-sound"][value="sound"]').checked = true;
  notifyOptions.classList.remove('open');
}

// ISO日時 → datetime-local用のローカル表記
function toLocalInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function startEdit(task) {
  editingId = task.id;
  $('f-save').textContent = '保存';
  $('f-title').value = task.title;
  renderCategorySelect(task.category);
  $('new-cat-row').hidden = true;
  $('f-deadline').value = task.deadline || '';
  $('f-repeat').value = task.repeat || 'none';
  $('f-target').value = task.target || '';
  $('f-url').value = task.url || '';
  $('f-memo').value = task.memo || '';
  $('f-notify').checked = !!task.notify;
  $('f-notify-at').value = task.notifyAt ? toLocalInput(task.notifyAt) : '';
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
  const notifyAtInput = $('f-notify-at').value;
  if (notify && !notifyAtInput) {
    alert('通知時間を入力してください');
    return;
  }
  const notifyAt = notify ? new Date(notifyAtInput).toISOString() : null;
  const sound =
    document.querySelector('input[name="f-sound"]:checked').value === 'sound';

  const fields = {
    title,
    category,
    deadline: $('f-deadline').value || null,
    repeat: $('f-repeat').value,
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

function render() {
  const list = $('list');
  list.innerHTML = '';
  $('empty').hidden = tasks.length > 0;

  // 未完了→期限が近い順、完了は最後
  const sorted = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1;
  });

  for (const task of sorted) {
    const note = document.createElement('div');
    note.className = 'note' + (task.done ? ' done' : '') + (isOverdue(task) ? ' overdue' : '');
    const cat = findCategory(task.category);
    if (cat) note.style.background = cat.color;

    const title = document.createElement('div');
    title.className = 'note-title';
    title.textContent = task.title + (task.memo ? ' 📝' : '');
    note.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'note-meta';

    const badges = document.createElement('div');
    if (cat) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = cat.name;
      badges.appendChild(b);
    }
    if (task.repeat && task.repeat !== 'none') {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = `🔁 ${REPEAT_LABEL[task.repeat]}`;
      badges.appendChild(b);
    }
    if (badges.childNodes.length) meta.appendChild(badges);

    if (task.deadline) {
      const el = document.createElement('div');
      el.textContent = `📅 期限: ${fmtDate(task.deadline)}` + (isOverdue(task) ? ' (期限切れ!)' : '');
      meta.appendChild(el);
    }
    if (task.target) {
      const el = document.createElement('div');
      el.textContent = `📮 提出先: ${task.target}`;
      meta.appendChild(el);
    }
    if (task.notify && task.notifyAt) {
      const el = document.createElement('div');
      el.innerHTML = `<span class="badge">${task.sound ? '🔔 音あり' : '🔕 音なし'}</span>`;
      el.append(`通知: ${fmtDateTime(task.notifyAt)}`);
      meta.appendChild(el);
    }
    if (task.url) {
      const el = document.createElement('div');
      const a = document.createElement('a');
      a.textContent = `🔗 ${task.url}`;
      a.addEventListener('click', () => window.api.openUrl(task.url));
      el.appendChild(a);
      meta.appendChild(el);
    }
    note.appendChild(meta);

    // メモはタスクをクリックすると開閉する
    if (task.memo) {
      const memo = document.createElement('div');
      memo.className = 'note-memo';
      memo.textContent = task.memo;
      memo.hidden = true;
      note.appendChild(memo);
      note.addEventListener('click', (e) => {
        if (e.target.closest('button, a')) return;
        memo.hidden = !memo.hidden;
      });
      note.classList.add('has-memo');
    }

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
        }
        await window.api.saveTasks(tasks);
        render();
      });
      actions.appendChild(doneBtn);
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
