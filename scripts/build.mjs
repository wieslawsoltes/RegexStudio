import { rm, mkdir, cp, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
const webOnly = process.argv.includes('--web-only');
if (!webOnly) {
  const sdk = process.env.DOTNET || 'dotnet';
  const args=['publish','engine/RegexStudio.Engine/RegexStudio.Engine.csproj','-c','Release'];
  if(process.env.REGEXSTUDIO_INPROCESS_BUILD==='1') args.push('-p:RegexStudioBuildInProcess=true','-m:1','-nr:false');
  const result = spawnSync(sdk,args,{stdio:'inherit',env:process.env});
  if (result.status !== 0) process.exit(result.status || 1);
}
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
for (const item of ['index.html','src','public']) await cp(item,path.join('dist',item),{recursive:true});
await writeFile('dist/.nojekyll','');
async function findFramework(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])) {
    if(!entry.isDirectory()) continue;
    const current = path.join(dir,entry.name);
    if(entry.name==='_framework') return current;
    const found = await findFramework(current); if(found) return found;
  }
}
const framework = await findFramework('engine/RegexStudio.Engine/bin/Release');
if(framework) await cp(framework,'dist/_framework',{recursive:true});
else if(!webOnly) throw new Error('Published WebAssembly framework not found');
console.log(`Built dist/ ${framework?'with .NET 10 WebAssembly':'(UI only; engine unavailable)'}`);
