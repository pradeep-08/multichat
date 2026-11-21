// Runs before the page paints: apply the saved theme and sidebar state (light theme and open sidebar are the defaults).
try {
  document.documentElement.dataset.theme = localStorage.getItem('multichat.theme') === 'dark' ? 'dark' : 'light';
  if (localStorage.getItem('multichat.sidebar') === 'collapsed') document.documentElement.classList.add('sb-collapsed');
} catch {}
