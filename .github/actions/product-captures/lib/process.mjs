import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { inside } from './config.mjs';

/** Launch a trusted repository command in an isolated process group. */
function launch(spec, root) {
  const child = spawn(spec.command, {cwd:inside(root,spec.cwd ?? '.'),shell:true,detached:process.platform !== 'win32',stdio:['ignore','inherit','inherit'],env:process.env});
  let exited = false;
  const result = new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});});
  });
  /** Stop only this invocation's own process group, including its server children. */
  let stopping;
  function stop() {
    if(stopping)return stopping;
    stopping=(async()=>{
      if(!child.pid)return;
      if(process.platform==='win32') {
        if(!exited)await new Promise(resolve=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});killer.once('error',()=>{child.kill('SIGTERM');resolve();});killer.once('exit',resolve);});
      } else {
        try {process.kill(-child.pid,'SIGTERM');} catch(error){if(error.code==='ESRCH')return;throw error;}
      }
      const timeout=new AbortController();
      try {await Promise.race([result,pause(2000,undefined,{signal:timeout.signal})]);}finally{timeout.abort();}
      if(!exited)try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
      await result;
    })();
    return stopping;
  }
  return {child,result,stop,get exited(){return exited;}};
}

/** Run a bounded preparation command and always clean up the spawned process. */
export async function runCommand(spec,root,{registerCleanup}={}) {
  const process = launch(spec,root);
  const unregister=registerCleanup?.(process.stop);
  const timeout=new AbortController();
  try {
    const result = await Promise.race([process.result,pause(spec.timeoutMs ?? 300000,undefined,{signal:timeout.signal}).then(()=>{throw new Error('Preparation command timed out');})]);
    if (result.code !== 0) throw new Error(`Preparation command failed (${result.code ?? result.signal})`);
  } finally { timeout.abort();try{await process.stop();}finally{unregister?.();} }
}

/** Start a server only on a free configured port and wait for HTTP readiness. */
export async function startServer(spec,root,{registerCleanup}={}) {
  const url = new URL(spec.url);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  await new Promise((resolve,reject)=>{
    const probe=net.createServer();
    probe.once('error',()=>reject(new Error(`Server port ${port} is already in use; use --base-url to deliberately reuse an existing server`)));
    probe.listen(port,url.hostname.replace(/^\[|\]$/g,''),()=>probe.close(resolve));
  });
  const process = launch(spec,root);
  const unregister=registerCleanup?.(process.stop);
  const deadline=Date.now()+(spec.timeoutMs ?? 120000);
  try {
    while(Date.now()<deadline) {
      if(process.exited) throw new Error('Capture server exited before becoming ready');
      try { const response=await fetch(spec.url,{signal:AbortSignal.timeout(1500)}); if(response.ok)return process; } catch {}
      await pause(150);
    }
    throw new Error(`Capture server did not become ready: ${spec.url}`);
  } catch(error) {try{await process.stop();}finally{unregister?.();}throw error;}
}
