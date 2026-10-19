/* Progressive catalog navigation and native product preview. All product facts remain in HTML. */
(function(){
  'use strict';
  const columns=()=>innerWidth<600?1:innerWidth<900?2:innerWidth<1200?3:4;
  let filtering=false;
  const grids=[];
  const empty=document.createElement('div');empty.className='catalog-empty';empty.hidden=true;empty.setAttribute('role','status');
  empty.innerHTML='<h2>No encontramos materiales con esos filtros.</h2><p>Probá otro tema o volvé a explorar el catálogo completo.</p><button class="btn btn-ghost" type="button">Limpiar filtros</button>';
  document.querySelector('#filter-bar').after(empty);
  empty.querySelector('button').addEventListener('click',()=>document.querySelector('#filter-clear').click());
  document.querySelectorAll('.product-section .grid').forEach((grid,index)=>{
    const cards=Array.from(grid.children).filter(el=>el.classList.contains('card'));
    if(!cards.length)return;
    grid.id=grid.id||'catalog-grid-'+index;
    const controls=document.createElement('nav');controls.className='catalog-navigation';controls.setAttribute('aria-label','Páginas de '+grid.closest('section').querySelector('h2').textContent);
    const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const buttons=document.createElement('div');buttons.className='catalog-buttons';
    const prev=document.createElement('button'),next=document.createElement('button'),pages=document.createElement('div');pages.className='catalog-pages';
    for(const button of [prev,next]){button.type='button';button.className='btn btn-ghost';button.setAttribute('aria-controls',grid.id);}
    prev.classList.add('catalog-prev');next.classList.add('catalog-next');prev.textContent='Anterior';next.textContent='Siguiente';
    buttons.append(prev,pages,next);controls.append(status,buttons);grid.after(controls);
    const state={grid,cards,status,prev,next,pages,page:1,controls};grids.push(state);
    prev.addEventListener('click',()=>navigate(state,state.page-1));next.addEventListener('click',()=>navigate(state,state.page+1));
  });
  function navigate(state,page){
    state.page=page;render(state);
    const section=state.grid.closest('section'),title=section.querySelector('.section-title');
    title.setAttribute('tabindex','-1');title.focus({preventScroll:true});
    section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  function render(state){
    const size=columns(),limit=size===1?3:size*2;
    const matching=state.cards.filter(card=>!card.classList.contains('card-hidden'));
    const count=Math.max(1,Math.ceil(matching.length/limit));state.page=Math.min(count,Math.max(1,state.page));
    const start=(state.page-1)*limit;
    let seen=0;
    state.cards.forEach(card=>{
      const match=!card.classList.contains('card-hidden');
      card.classList.toggle('card-collapsed',match&&(seen<start||seen>=start+limit));
      if(match)seen++;
    });
    state.status.textContent='Página '+state.page+' de '+count+' · '+(matching.length?start+1:0)+'–'+Math.min(start+limit,matching.length)+' de '+matching.length+' materiales';
    state.prev.disabled=state.page===1;state.next.disabled=state.page===count;
    state.pages.replaceChildren();let previous=0;
    for(let number=1;number<=count;number++){
      if(number!==1&&number!==count&&Math.abs(number-state.page)>1)continue;
      if(previous&&number-previous>1){const gap=document.createElement('span');gap.textContent='…';gap.setAttribute('aria-hidden','true');state.pages.append(gap);}
      const button=document.createElement('button');button.type='button';button.className='catalog-page';button.dataset.page=String(number);button.textContent=String(number);button.setAttribute('aria-label','Página '+number);button.setAttribute('aria-controls',state.grid.id);
      if(number===state.page)button.setAttribute('aria-current','page');
      button.addEventListener('click',()=>navigate(state,number));state.pages.append(button);previous=number;
    }
    state.controls.hidden=matching.length===0;
    document.dispatchEvent(new CustomEvent('gv:catalog-page',{detail:{grid:state.grid}}));
  }
  function refresh(){grids.forEach(render);empty.hidden=!filtering||grids.some(state=>state.grid.closest('section').classList.contains('active')&&state.cards.some(card=>!card.classList.contains('card-hidden')));}
  document.addEventListener('gv:catalog-filter',event=>{filtering=!!event.detail.active;grids.forEach(state=>state.page=1);refresh();});
  let resizing;
  addEventListener('resize',()=>{clearTimeout(resizing);resizing=setTimeout(refresh,120);});
  document.querySelectorAll('.tabbar .tab').forEach(tab=>{
    tab.setAttribute('aria-pressed',String(tab.classList.contains('active')));
    tab.addEventListener('click',()=>queueMicrotask(()=>{
      document.querySelectorAll('.tabbar .tab').forEach(button=>button.setAttribute('aria-pressed',String(button.classList.contains('active'))));
      refresh();
    }));
  });
  refresh();

  if(typeof HTMLDialogElement==='undefined'||!HTMLDialogElement.prototype.showModal)return;
  const dialog=document.createElement('dialog');dialog.className='product-dialog';dialog.setAttribute('aria-labelledby','product-preview-title');
  dialog.innerHTML='<header class="product-dialog-header"><p>GentleVanguard Academy · Contenido del material</p><button class="product-dialog-close" type="button" aria-label="Cerrar detalle"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="product-dialog-layout"></div>';
  document.body.append(dialog);
  let trigger=null;
  const close=()=>dialog.close();
  dialog.querySelector('.product-dialog-close').addEventListener('click',close);
  dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();}});
  dialog.addEventListener('close',()=>{document.documentElement.classList.remove('catalog-preview-open');if(trigger&&trigger.isConnected)trigger.focus({preventScroll:true});});
  document.addEventListener('click',event=>{
    const summary=event.target.closest('.product-details>summary');if(!summary)return;
    event.preventDefault();trigger=summary;
    const card=summary.closest('.card'),body=dialog.querySelector('.product-dialog-layout');body.replaceChildren();
    const image=card.querySelector('.card-cover img').cloneNode(true);image.className='product-dialog-cover';image.removeAttribute('loading');body.append(image);
    const content=document.createElement('div');const title=document.createElement('h2');title.id='product-preview-title';title.textContent=card.querySelector('h3').textContent;
    content.append(title,card.querySelector('.details-body').cloneNode(true),card.querySelector('.card-price').cloneNode(true));
    const actions=card.querySelector('.card-actions').cloneNode(true);
    actions.querySelectorAll('a').forEach((anchor,index)=>{
      const original=card.querySelectorAll('.card-actions a')[index];
      if(original.classList.contains('btn-checkout'))anchor.addEventListener('click',event=>{event.preventDefault();close();original.click();});
    });
    content.append(actions);body.append(content);dialog.showModal();document.documentElement.classList.add('catalog-preview-open');
  });
})();
