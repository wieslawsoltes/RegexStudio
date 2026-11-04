import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
const root = path.resolve(process.env.SERVE_SOURCE ? '.' : 'dist');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.png':'image/png','.woff2':'font/woff2'};
const server = http.createServer(async(req,res)=>{
  try {
    let pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.startsWith('/RegexStudio/')) pathname = pathname.slice('/RegexStudio'.length);
    const file = path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    if(!file.startsWith(root+path.sep) && file!==root) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
  }catch {res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found');}
});
server.listen(Number(process.env.PORT||5173),'0.0.0.0',()=>console.log(`RegexStudio listening on ${server.address().port}`));
