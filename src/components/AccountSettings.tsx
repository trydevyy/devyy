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

import {useEffect,useState,type Dispatch,type SetStateAction} from 'react';
import {openUrl} from '@tauri-apps/plugin-opener';
import {ExternalLink,RefreshCw,UserRound} from 'lucide-react';
import {invoke,native} from '../lib/native';
import {accountRequest,pullCloud,pushCloud,useSyncOptions,saveSyncOptions,type Cloud} from '../lib/account';
import {useExtensions} from '../lib/extensions';
import type {Settings} from '../lib/types';
import keys from '../lib/accountSyncKeys.json';
export default function AccountSettings({settings,onChange}:{settings:Settings;onChange:Dispatch<SetStateAction<Settings>>}){
 const options=useSyncOptions(),extensions=useExtensions();const [user,setUser]=useState<{name:string;email:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[cloud,setCloud]=useState<Cloud>();
 const update=(patch:Partial<typeof options>)=>saveSyncOptions({...options,...patch});
 async function refresh(){try{setUser(await accountRequest('/me'));setCloud(await accountRequest('/sync'));setError('');}catch{setUser(null);}}
 useEffect(()=>{void refresh();const changed=()=>void refresh();const sync=(e:Event)=>setStatus((e as CustomEvent<string>).detail);window.addEventListener('devyy-account-changed',changed);window.addEventListener('devyy-sync-status',sync);return()=>{window.removeEventListener('devyy-account-changed',changed);window.removeEventListener('devyy-sync-status',sync);};},[options.server]);
 async function work(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <section className="account-settings" aria-label="Devyy account"><div className="setting-row"><span><strong>Devyy account</strong><small>{user?`${user.name} / ${user.email}`:'Sign in through your browser to synchronize preferences and manage private forwarded ports.'}</small></span><UserRound size={22}/></div><label className="account-server-label">Account server<input value={options.server} disabled={busy} onChange={e=>update({server:e.target.value,enabled:false})}/></label>{!user?<button className="setting-action" disabled={!native||busy} onClick={()=>void work(async()=>{const result=await invoke<{url:string}>('account_begin',{serverUrl:options.server});await openUrl(result.url);})}><ExternalLink size={14}/>Sign in with Devyy</button>:<><div className="inline-actions"><button className="setting-action" disabled={busy} onClick={()=>void work(async()=>{await openUrl(options.server+'/account');})}>Manage account<ExternalLink size={13}/></button><button className="setting-action" disabled={busy} onClick={()=>void work(async()=>{await invoke('account_disconnect',{serverUrl:options.server});update({enabled:false});setUser(null);})}>Sign out</button></div><h4 className="settings-group-title">Synchronization on this device</h4><p className="settings-note">Upload this device’s choices or apply your account’s settings before enabling automatic sync. Secrets, provider credentials, workspace files and SSH keys are never included.</p>{[['settings','IDE settings'],['extensions','Extension list and enabled state'],['installExtensions','Automatically install synchronized extensions']].map(([key,label])=><label className="sync-check" key={key}><input type="checkbox" checked={Boolean(options[key as keyof typeof options])} onChange={e=>update({[key]:e.target.checked,enabled:false})}/>{label}</label>)}<div className="inline-actions"><button className="setting-action" disabled={busy} onClick={()=>void work(async()=>{await pushCloud(settings,extensions,options);update({enabled:true});setStatus('Uploaded. Automatic synchronization is on.');await refresh();})}>Upload this device</button><button className="setting-action" disabled={busy||!cloud} onClick={()=>void work(async()=>{const latest=await accountRequest<Cloud>('/sync');await pullCloud(latest,settings,onChange,extensions,options);update({enabled:true});setStatus('Applied account settings. Automatic synchronization is on.');await refresh();})}>Download from account</button><button className="icon-button" aria-label="Refresh account sync" onClick={()=>void refresh()}><RefreshCw size={14}/></button></div><p className="settings-note">Account revision {cloud?.revision??0}. {cloud?.data.extensions.length??0} synchronized extensions. {options.enabled?'Automatic sync enabled.':'Automatic sync paused.'}</p>{options.enabled&&<button className="setting-action" onClick={()=>update({enabled:false})}>Pause synchronization</button>}<details><summary>Keep individual settings local</summary><p className="settings-note">Checked settings are excluded from both upload and download on this device.</p><div className="sync-exclusions">{keys.map(key=><label className="sync-check" key={key}><input type="checkbox" checked={options.excluded.includes(key)} onChange={e=>update({excluded:e.target.checked?[...options.excluded,key]:options.excluded.filter(k=>k!==key),enabled:false})}/>{key.replace(/([A-Z])/g,' $1')}</label>)}</div></details>{status&&<p role="status" className="settings-note">{status}</p>}</>}{error&&<p role="alert" className="ai-error">{error}</p>}{!native&&<p className="settings-note">Browser-to-editor sign-in is available in the desktop app.</p>}</section>;
}
