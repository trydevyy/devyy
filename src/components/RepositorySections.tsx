// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import ErrorToast from "./ui/ErrorToast";
import {useEffect,useState} from 'react';
import {GitBranch,Plus,RefreshCw} from 'lucide-react';
import {invoke} from '../lib/native';
import type {GitState} from '../lib/types';
import type {GitSubmodule} from '../lib/git';
export default function RepositorySections({modules,refreshToken,onRefresh,onDiff}:{modules:GitSubmodule[];refreshToken:unknown;onRefresh:()=>void;onDiff:(repository:string,path:string,staged:boolean)=>void}){
 return <div className="scm-repositories">{modules.filter(m=>m.initialized&&!m.conflict).map(module=><Repository key={module.path} module={module} refreshToken={refreshToken} onRefresh={onRefresh} onDiff={onDiff}/>)}</div>;
}
function Repository({module,refreshToken,onRefresh,onDiff}:{module:GitSubmodule;refreshToken:unknown;onRefresh:()=>void;onDiff:(repository:string,path:string,staged:boolean)=>void}){
 const [open,setOpen]=useState(true),[state,setState]=useState<GitState>(),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){try{setState(await invoke<GitState>('git_status',{repository:module.path}));setError('');}catch(e){setError(String(e));}}
 useEffect(()=>{void refresh();},[module.path,refreshToken]);
 async function action(command:string,args:Record<string,unknown>={}){setBusy(true);try{await invoke(command,{repository:module.path,...args});if(command==='git_commit')setMessage('');await refresh();onRefresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
 const staged=state?.changes.some(c=>c.index.trim()&&!['?','!','U'].includes(c.index));
 const update=module.expected!==module.head&&!module.dirty;
 return <section className="scm-repository-section"><header><button aria-expanded={open} onClick={()=>setOpen(!open)}><GitBranch size={13}/>{module.path}<small>{state?.changes.length??0}</small></button><button className="icon-button" aria-label={`Refresh ${module.path}`} onClick={()=>void refresh()}><RefreshCw size={12}/></button></header>{open&&<div>
 <p className="scm-upstream">{state?.branch??module.branch}{!!state?.behind&&` ↓ ${state.behind}`}</p>
 <textarea aria-label={`Commit message for ${module.path}`} placeholder="Commit message" value={message} onChange={e=>setMessage(e.target.value)}/>
 <button className="primary full" disabled={busy||(!update&&!state?.behind&&(!staged||!message.trim()))} onClick={()=>void (update?action('git_submodule_action',{action:'update',path:module.path}):state?.behind&&!staged?action('git_pull'):action('git_commit',{message}))}>{update?'Update submodule':state?.behind&&!staged?'Pull incoming changes':'Commit staged changes'}</button>
 {state?.changes.map(c=><div className="change-row" key={c.path}><button className="change-file" onClick={()=>onDiff(module.path,c.path,!!c.index.trim()&&c.index!=='?')}>{c.path.slice(module.path.length+1)}</button><button className="icon-button" aria-label={`Stage ${c.path}`} disabled={busy} onClick={()=>void action('git_stage',{path:c.path,staged:false})}><Plus size={12}/></button></div>)}
 {error&&<ErrorToast message={error} />}
 </div>}</section>;
}
