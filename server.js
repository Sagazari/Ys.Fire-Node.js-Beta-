// Servidor mínimo (sem dependências): serve o editor e faz proxy para a xAI.
// A chave fica só aqui, na variável de ambiente XAI_API_KEY (Render > Environment).
const http=require('http'),fs=require('fs'),path=require('path');
const KEY=process.env.XAI_API_KEY,MODEL=process.env.XAI_MODEL||'grok-4.20-non-reasoning',PER_MIN=+process.env.LIMIT_PER_MIN||10,PER_DAY=+process.env.LIMIT_PER_IP_DAY||40,GLOBAL_DAY=+process.env.LIMIT_GLOBAL_DAY||1500,BASE=(process.env.XAI_BASE||'https://api.x.ai/v1').replace(/\/+$/,''),PORT=process.env.PORT||3000;
const json=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
// Limites anti-abuso (chamadas ao Grok; cada edição usa 1 a 2)
const mins=new Map(),days=new Map();let gDay='',gCount=0;
const limited=ip=>{const n=Date.now(),d=new Date().toISOString().slice(0,10);if(d!==gDay){gDay=d;gCount=0;days.clear()}
  const a=(mins.get(ip)||[]).filter(t=>n-t<6e4);a.push(n);mins.set(ip,a);if(mins.size>5000)mins.clear();
  const c=(days.get(ip)||0)+1;days.set(ip,c);gCount++;
  return a.length>PER_MIN?'Muitas requisições. Espere 1 minuto.':c>PER_DAY?'Você atingiu o limite diário de edições com IA. Volte amanhã.':gCount>GLOBAL_DAY?'A IA atingiu o limite de uso de hoje. Volte amanhã.':''};
const ls=d=>{try{return fs.readdirSync(d)}catch{return[]}};
// Procura o editor em vários nomes/pastas (qualquer .html que contenha o editor)
function findEditor(){
  for(const d of [__dirname,path.join(__dirname,'public'),process.cwd()])
    for(const n of ['editor-pro.html','index.html','editor.html']){const f=path.join(d,n);if(fs.existsSync(f))return f}
  for(const d of [__dirname,path.join(__dirname,'public')])for(const n of ls(d))if(n.endsWith('.html'))return path.join(d,n);
  return null}
console.log('[editor]',findEditor()||'NÃO ENCONTRADO em '+__dirname+' → '+ls(__dirname).join(', '));
http.createServer(async(req,res)=>{
  try{
    if(req.url.startsWith('/api/')){
      if(!KEY)return json(res,500,{error:'XAI_API_KEY não definida no servidor'});
      if(req.url!=='/api/models'){const m=limited(String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim());if(m)return json(res,429,{error:m})}
      const h={Authorization:'Bearer '+KEY,'Content-Type':'application/json'};
      if(req.url==='/api/models'){const r=await fetch(BASE+'/models',{headers:h});return json(res,r.status,await r.json().catch(()=>({})))}
      if(req.url==='/api/grok'&&req.method==='POST'){
        let b='';for await(const c of req)if((b+=c).length>2e5)return json(res,413,{error:'pedido grande demais'});
        const body=JSON.parse(b);body.model=body.model||MODEL;body.max_output_tokens=Math.min(+body.max_output_tokens||3000,3000);if(body.tools)body.tools=body.tools.filter(t=>t&&t.type==='web_search');
        const r=await fetch(BASE+'/responses',{method:'POST',headers:h,body:JSON.stringify(body)});
        res.writeHead(r.status,{'Content-Type':'application/json'});return res.end(await r.text())}
      return json(res,404,{error:'rota inexistente'})}
    const f=findEditor();
    if(!f){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Editor não encontrado.\nPasta do servidor: '+__dirname+'\nArquivos aqui: '+ls(__dirname).join(', ')+'\n\nColoque editor-pro.html (ou index.html) junto do server.js.')}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(fs.readFileSync(f));
  }catch(e){json(res,500,{error:String(e.message||e)})}
}).listen(PORT,()=>console.log('Rodando na porta '+PORT));
