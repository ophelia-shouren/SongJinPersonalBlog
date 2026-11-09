const form = document.getElementById('nickname-form');
const input = document.getElementById('nickname');
const entry = document.getElementById('entry');
const journal = document.getElementById('journal');
const identity = document.getElementById('identity');
const leave = document.getElementById('leave');

form.addEventListener('submit', event => {
  event.preventDefault();
  const nickname = input.value.trim();
  if (!nickname) {
    input.setCustomValidity('请输入昵称。');
    input.reportValidity();
    return;
  }
  try { sessionStorage.setItem('journal-nickname', nickname); } catch (_) {}
  identity.textContent = '访客 · ' + nickname;
  entry.hidden = true;
  journal.hidden = false;
  leave.hidden = false;
  document.getElementById('journal-title').focus();
});

input.addEventListener('input', () => input.setCustomValidity(''));

leave.addEventListener('click', () => {
  try { sessionStorage.removeItem('journal-nickname'); } catch (_) {}
  form.reset();
  identity.textContent = 'SONG JIN & LONG SHOUREN';
  journal.hidden = true;
  leave.hidden = true;
  entry.hidden = false;
  input.focus();
});

try {
  const saved = sessionStorage.getItem('journal-nickname');
  if (saved) {
    identity.textContent = '访客 · ' + saved;
    entry.hidden = true; journal.hidden = false; leave.hidden = false;
    if (location.hash === '#hp-world') requestAnimationFrame(() => document.getElementById('hp-world').scrollIntoView());
  }
} catch (_) {}

const storySearch = document.getElementById('story-search');
const storyKind = document.getElementById('story-kind');
const tocStatus = document.getElementById('toc-status');
if (storySearch && storyKind && tocStatus) {
  const cards = [...document.querySelectorAll('.toc-card')];
  const filterStories = () => {
    const query = storySearch.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const card of cards) {
      const match = (!storyKind.value || card.dataset.kind === storyKind.value) && (!query || card.dataset.search.toLocaleLowerCase().includes(query));
      card.hidden = !match;
      if (match) count++;
    }
    tocStatus.textContent = count ? '找到 ' + count + ' 篇 · 点击篇名阅读，展开目录直达篇内主题' : '没有找到匹配的篇章，试试其他关键词或选择全部内容。';
  };
  storySearch.addEventListener('input', filterStories);
  storyKind.addEventListener('change', filterStories);
}
