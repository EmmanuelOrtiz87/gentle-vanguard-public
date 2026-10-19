/* Documentation-only navigation; does not change studio state or generation. */
(function(){
  function init(){
    var sidebar=document.querySelector('.control-panel>.sidebar');
    if(!sidebar)return;
    var button=document.createElement('button');
    button.type='button';button.className='gv-doc-section-menu';
    button.textContent='Secciones / Sections / Seções';
    sidebar.id=sidebar.id||'document-sections';
    button.setAttribute('aria-controls',sidebar.id);button.setAttribute('aria-expanded','false');
    document.querySelector('.control-panel').before(button);
    button.addEventListener('click',function(){var open=sidebar.classList.toggle('is-open');button.setAttribute('aria-expanded',String(open));});
    sidebar.addEventListener('click',function(event){if(event.target.closest('.nav-item,a')){sidebar.classList.remove('is-open');button.setAttribute('aria-expanded','false');}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
