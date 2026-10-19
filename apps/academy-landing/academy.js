/* Academy uses native GV preferences and one explicit catalog reset. No content depends on motion. */
(()=>{
  const root=document.documentElement,theme=document.querySelector('#academy-theme');
  const read=key=>{try{return localStorage.getItem(key);}catch{return null;}};
  const apply=value=>{root.dataset.theme=value==='light'?'light':'dark';theme.setAttribute('aria-label',root.dataset.theme==='dark'?'Activar tema claro':'Activar tema oscuro');theme.title=theme.getAttribute('aria-label');theme.setAttribute('aria-pressed',String(root.dataset.theme==='light'));theme.querySelector('svg').innerHTML=root.dataset.theme==='light'?'<path d="M20.8 13a9 9 0 0 1-9.8-9.8A9 9 0 1 0 20.8 13Z"/>':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';};
  apply(read('gv-cc-theme'));
  theme.addEventListener('click',()=>{apply(root.dataset.theme==='dark'?'light':'dark');try{localStorage.setItem('gv-cc-theme',root.dataset.theme);}catch{}});
  addEventListener('storage',event=>{if(event.key==='gv-cc-theme')apply(event.newValue);});
  const menu=document.querySelector('#academy-menu'),navigation=document.querySelector('#academy-navigation');
  function closeMenu(){navigation.classList.remove('is-open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Abrir menú');}
  menu.addEventListener('click',()=>{const open=navigation.classList.toggle('is-open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Cerrar menú':'Abrir menú');});
  navigation.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
  document.addEventListener('click',event=>{if(!event.target.closest('.academy-topbar'))closeMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&navigation.classList.contains('is-open')){closeMenu();menu.focus();}});
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),top=document.querySelector('#academy-top');
  top.addEventListener('click',()=>{document.querySelector('.academy-brand').focus({preventScroll:true});scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'});});
  const visibility=()=>{top.hidden=scrollY<600;root.classList.toggle('academy-scrolled',scrollY>24);};addEventListener('scroll',visibility,{passive:true});visibility();
  const hero=document.querySelector('.academy-hero');let frame=0;
  hero.addEventListener('pointermove',event=>{
    if(reduced.matches||event.pointerType==='touch'||frame)return;
    const x=event.clientX,y=event.clientY;
    frame=requestAnimationFrame(()=>{const b=hero.getBoundingClientRect();hero.style.setProperty('--light-x',(x-b.left)/b.width*100+'%');hero.style.setProperty('--light-y',(y-b.top)/b.height*100+'%');frame=0;});
  });
  // One authored focal moment: knowledge flows around the open book.
  // CSS does the work; no render loop, observers suspend it when it cannot be seen.
  const motion=document.querySelector('#academy-motion');let paused=false,visible=true;
  function updateMotion(){
    const stopped=paused||reduced.matches;
    root.dataset.academyMotion=stopped?'paused':document.hidden||!visible?'suspended':'playing';
    motion.hidden=false;motion.disabled=reduced.matches;
    motion.setAttribute('aria-pressed',String(stopped));
    motion.textContent=reduced.matches?'Movimiento reducido':paused?'Activar movimiento':'Pausar movimiento';
    if(stopped)document.getAnimations().forEach(animation=>{if(animation.effect?.target?.classList?.contains('academy-hero-copy'))animation.finish();});
  }
  motion.addEventListener('click',()=>{paused=!paused;updateMotion();});
  reduced.addEventListener('change',updateMotion);document.addEventListener('visibilitychange',updateMotion);updateMotion();
  if('IntersectionObserver' in window){
    new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;updateMotion();},{threshold:.08}).observe(hero);
    const links=[...navigation.querySelectorAll('a')];
    const spy=new IntersectionObserver(entries=>{entries.filter(entry=>entry.isIntersecting).forEach(entry=>links.forEach(link=>{if(link.hash==='#'+entry.target.id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}));},{rootMargin:'-15% 0px -60% 0px'});
    links.forEach(link=>{const section=document.querySelector(link.hash);if(section)spy.observe(section);});
  }
  if(!reduced.matches)document.querySelector('.academy-hero-copy').animate([{clipPath:'inset(0 0 8% 0)',opacity:.65},{clipPath:'inset(0)',opacity:1}],{duration:560,easing:'cubic-bezier(0.19,1,0.22,1)'});
  // A new catalog page arrives as a whole; reading never waits for individual cards.
  const arrivals=new WeakMap();
  document.addEventListener('gv:catalog-page',event=>{
    const grid=event.detail.grid;if(reduced.matches||paused||document.hidden||!grid.closest('section').classList.contains('active'))return;
    arrivals.get(grid)?.cancel();
    arrivals.set(grid,grid.animate([{opacity:.6,transform:'translateX(8px)'},{opacity:1,transform:'translateX(0)'}],{duration:280,easing:'cubic-bezier(0.19,1,0.22,1)'}));
  });
  let spotlight=0;
  document.addEventListener('pointermove',event=>{
    const card=event.target.closest?.('.product-section .card');if(!card||reduced.matches||paused||event.pointerType==='touch'||spotlight)return;
    const x=event.clientX,y=event.clientY;
    spotlight=requestAnimationFrame(()=>{const box=card.getBoundingClientRect();card.style.setProperty('--mx',x-box.left+'px');card.style.setProperty('--my',y-box.top+'px');spotlight=0;});
  },{passive:true});
})();
