const byId = id => document.getElementById(id);
const login = byId('login');
const editor = byId('editor');
const roles = Array.from(document.querySelectorAll('[data-role]'));
let role = 'guest';
let registering = false;

async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function setMode(nextRole, signup) {
  role = nextRole;
  registering = signup;
  roles.forEach(button => button.setAttribute('aria-pressed', button.dataset.role === role));
  byId('entry-title').textContent = signup ? '注册游客账号' : '翻开手记';
  byId('login-submit').textContent = signup ? '创建账号' : '登录';
  byId('register').hidden = role === 'owner';
  byId('register').textContent = signup ? '已有账号？返回登录' : '还没有账号？注册';
  login.elements.password.autocomplete = signup ? 'new-password' : 'current-password';
  login.elements.password.minLength = signup ? 8 : 0;
  login.elements.password.value = '';
  byId('auth-status').textContent = signup ? '账号使用 3–32 位字母、数字或下划线，密码至少 8 位。' : '';
}

roles.forEach(button => button.onclick = () => setMode(button.dataset.role, false));
byId('register').onclick = () => setMode('guest', !registering);

async function loadPosts() {
  const posts = await api('/api/posts');
  const list = byId('posts');
  list.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement('p');
    empty.className = 'card';
    empty.textContent = '这里还没有手记。第一篇故事，等博主提笔。';
    list.append(empty);
  }
  for (const post of posts) {
    const article = document.createElement('article');
    article.className = 'card post';
    const date = document.createElement('time');
    date.dateTime = post.created.replace(' ', 'T') + 'Z';
    date.textContent = new Date(date.dateTime).toLocaleDateString('zh-CN');
    article.append(date);
    if (post.title) {
      const title = document.createElement('h3');
      title.textContent = post.title;
      article.append(title);
    }
    if (post.body) {
      const body = document.createElement('p');
      body.textContent = post.body;
      article.append(body);
    }
    if (post.image) {
      const img = document.createElement('img');
      img.src = '/media/' + post.id;
      img.alt = post.title ? post.title + '的配图' : '手记配图';
      img.loading = 'lazy';
      article.append(img);
    }
    list.append(article);
  }
}

async function refresh() {
  const {name, owner} = await api('/api/me');
  byId('entry').hidden = Boolean(name);
  byId('journal').hidden = !name;
  byId('logout').hidden = !name;
  byId('compose').hidden = !owner;
  if (!owner) editor.hidden = true;
  byId('identity').textContent = name ? (owner ? '博主 · ' : '游客 · ') + name : 'YEARNWINGWINGS / JOURNAL';
  if (name) await loadPosts();
}

login.onsubmit = async event => {
  event.preventDefault();
  const status = byId('auth-status');
  const buttons = [...roles, byId('register'), byId('login-submit')];
  buttons.forEach(button => button.disabled = true);
  status.textContent = '';
  try {
    const fields = Object.fromEntries(new FormData(login));
    if (registering) {
      await api('/api/register', fields);
      setMode('guest', false);
      status.textContent = '注册成功，请使用刚创建的账号登录。';
      login.elements.password.focus();
    } else {
      await api('/api/login', {...fields, role});
      login.reset();
      await refresh();
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    buttons.forEach(button => button.disabled = false);
  }
};

byId('logout').onclick = async () => {
  try {
    await api('/api/logout', {});
    editor.reset();
    byId('journal-status').textContent = '';
    setMode('guest', false);
    await refresh();
  } catch (error) {
    byId('journal-status').textContent = error.message;
  }
};

byId('compose').onclick = () => {
  editor.hidden = !editor.hidden;
  if (!editor.hidden) editor.elements.title.focus();
};

function readImage(file) {
  if (!file.size) return Promise.resolve('');
  if (file.size > 5 * 1024 * 1024) throw new Error('图片不能超过 5 MB。');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取图片。'));
    reader.readAsDataURL(file);
  });
}

editor.onsubmit = async event => {
  event.preventDefault();
  const button = editor.querySelector('button');
  const status = byId('journal-status');
  button.disabled = true;
  status.textContent = '';
  try {
    const {title, body, photo} = Object.fromEntries(new FormData(editor));
    await api('/api/posts', {title, body, image: await readImage(photo)});
    editor.reset();
    editor.hidden = true;
    status.textContent = '已发布。';
    await loadPosts();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

refresh().catch(error => {
  byId(byId('journal').hidden ? 'auth-status' : 'journal-status').textContent = error.message;
});
