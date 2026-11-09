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
  identity.textContent = '访客 · ' + nickname;
  entry.hidden = true;
  journal.hidden = false;
  leave.hidden = false;
  document.getElementById('journal-title').focus();
});

input.addEventListener('input', () => input.setCustomValidity(''));

leave.addEventListener('click', () => {
  form.reset();
  identity.textContent = 'SONG JIN & LONG SHOUREN';
  journal.hidden = true;
  leave.hidden = true;
  entry.hidden = false;
  input.focus();
});
