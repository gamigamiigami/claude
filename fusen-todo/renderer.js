let tasks = [];

const $ = (id) => document.getElementById(id);
const formCard = $('form-card');
const notifyOptions = $('notify-options');

// ===== フォーム開閉 =====

$('add-btn').addEventListener('click', () => {
  formCard.classList.toggle('open');
  if (formCard.classList.contains('open')) $('f-title').focus();
});

$('f-cancel').addEventListener('click', () => {
  formCard.classList.remove('open');
  resetForm();
});

$('f-notify').addEventListener('change', (e) => {
  notifyOptions.classList.toggle('open', e.target.checked);
});

function resetForm() {
  $('f-title').value = '';
  $('f-deadline').value = '';
  $('f-target').value = '';
  $('f-url').value = '';
  $('f-memo').value = '';
  $('f-notify').checked = false;
  $('f-notify-at').value = '';
  document.querySelector('input[name="f-sound"][value="sound"]').checked = true;
  notifyOptions.classList.remove('open');
}

// ===== 登録 =====

$('f-save').addEventListener('click', async () => {
  const title = $('f-title').value.trim();
  if (!title) {
    $('f-title').focus();
    return;
  }
  const notify = $('f-notify').checked;
  const notifyAt = $('f-notify-at').value;
  if (notify && !notifyAt) {
    alert('通知時間を入力してください');
    return;
  }

  tasks.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    deadline: $('f-deadline').value || null,
    target: $('f-target').value.trim() || null,
    url: $('f-url').value.trim() || null,
    memo: $('f-memo').value.trim() || null,
    notify,
    notifyAt: notify ? new Date(notifyAt).toISOString() : null,
    sound: document.querySelector('input[name="f-sound"]:checked').value === 'sound',
    notified: false,
    done: false,
    createdAt: new Date().toISOString()
  });

  await window.api.saveTasks(tasks);
  formCard.classList.remove('open');
  resetForm();
  render();
});

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

    const title = document.createElement('div');
    title.className = 'note-title';
    title.textContent = task.title;
    if (task.memo) title.textContent += ' 📝';
    note.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'note-meta';
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
      const doneBtn = document.createElement('button');
      doneBtn.className = 'done-btn';
      doneBtn.textContent = '✓ 完了';
      doneBtn.addEventListener('click', async () => {
        task.done = true;
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

// リマインドポップアップ側で完了/スヌーズされた時に同期する
window.api.onTasksUpdated((updated) => {
  tasks = updated;
  render();
});

(async () => {
  tasks = await window.api.getTasks();
  render();
})();
