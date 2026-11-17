/** Runs before first paint so the saved theme never flashes. Stored value: light | dark | system. */
export const THEME_KEY = 'touchline.theme';
export const themeInitScript = `(function(){try{var p=localStorage.getItem('${THEME_KEY}')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;
