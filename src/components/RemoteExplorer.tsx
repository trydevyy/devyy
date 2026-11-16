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

import {useEffect,useState} from 'react';
import {ExternalLink,Monitor,RefreshCw,X} from 'lucide-react';
import {openUrl} from '@tauri-apps/plugin-opener';
import {invoke,native,listen} from '../lib/native';
import {accountRequest,syncOptions} from '../lib/account';
interface Connection{id:string;kind:string;label:string;localPort:number}
interface Tunnel{id:string;port:number;label:string;url:string;connected:boolean}
export default function RemoteExplorer({onAccount}:{onAccount:()=>void}){const [connections,setConnections]=useState<Connection[]>([]),[tunnels,setTunnels]=useState<Tunnel[]>([]),[host,setHost]=useState(''),[user,setUser]=useState(''),[sshPort,setSshPort]=useState(22),[localPort,setLocalPort]=useState(3000),[remotePort,setRemotePort]=useState(3000),[port,setPort]=useState(3000),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){if(!native)return;setConnections(await invoke<Connection[]>('remote_list'));try{setTunnels(await accountRequest('/tunnels'));}catch{setTunnels([]);}}
 useEffect(()=>{void refresh();let stops:(()=>void)[]=[];let disposed=false;for(const event of ['devyy-remote-changed','devyy-account-changed'])void listen(event,()=>void refresh()).then(stop=>disposed?stop():stops.push(stop));return()=>{disposed=true;stops.forEach(stop=>stop());};},[]);
 async function work(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <div className="remote-explorer"><div className="section-label"><span>SSH TUNNELS</span><button className="icon-button" aria-label="Refresh remote connections" onClick={()=>void refresh()}><RefreshCw size={12}/></button></div><p className="settings-note">Forward a remote loopback port through your SSH agent. Host keys must already be trusted.</p><label>Host<input placeholder="server.example.com" value={host} onChange={e=>setHost(e.target.value)}/></label><label>User<input value={user} onChange={e=>setUser(e.target.value)} autoComplete="username"/></label><div className="remote-ports"><label>SSH port<input type="number" min={1} max={65535} value={sshPort} onChange={e=>setSshPort(Number(e.target.value))}/></label><label>Remote port<input type="number" min={1} max={65535} value={remotePort} onChange={e=>setRemotePort(Number(e.target.value))}/></label><label>Local port<input type="number" min={1} max={65535} value={localPort} onChange={e=>setLocalPort(Number(e.target.value))}/></label></div><button className="setting-action" disabled={!native||busy||!host||!user} onClick={()=>void work(()=>invoke('ssh_forward',{options:{host,user,sshPort,localPort,remotePort}}))}>Connect SSH tunnel</button>{connections.filter(c=>c.kind==='ssh').map(c=><div className="remote-connection" key={c.id}><Monitor size={13}/><span>{c.label}<small>localhost:{c.localPort}</small></span><button className="icon-button" aria-label={`Disconnect ${c.label}`} onClick={()=>void work(()=>invoke('remote_stop',{id:c.id}))}><X size={13}/></button></div>)}
 <div className="section-label"><span>FORWARDED PORTS</span></div><p className="settings-note">Private URLs on your Devyy server. Sign in to the same account in your browser to open them.</p><button className="setting-action" onClick={onAccount}>Devyy account & sync</button><label>Local HTTP port<input type="number" min={1} max={65535} value={port} onChange={e=>setPort(Number(e.target.value))}/></label><button className="setting-action" disabled={!native||busy||!port} onClick={()=>void work(async()=>{const tunnel=await accountRequest<Tunnel>('/tunnels','POST',{port,label:`localhost:${port}`});await invoke('port_forward',{serverUrl:syncOptions().server,tunnelId:tunnel.id,port});})}>Forward port</button>{tunnels.map(t=><div className="forwarded-port" key={t.id}><strong>localhost:{t.port}<small>Private / {t.connected?'Connected':'Offline'}</small></strong><span title={t.url}>{t.url}</span><div><button className="icon-button" disabled={!t.connected} aria-label={`Open forwarded port ${t.port}`} onClick={()=>void openUrl(t.url)}><ExternalLink size={13}/></button>{!t.connected&&<button className="setting-action" disabled={busy} onClick={()=>void work(()=>invoke('port_forward',{serverUrl:syncOptions().server,tunnelId:t.id,port:t.port}))}>Reconnect</button>}<button className="icon-button" aria-label={`Stop forwarding port ${t.port}`} disabled={busy} onClick={()=>void work(async()=>{await invoke('remote_stop',{id:`port-${t.id}`});await accountRequest('/tunnels/'+t.id,'DELETE');})}><X size={13}/></button></div></div>)}{error&&<p role="alert" className="ai-error">{error}</p>}<p className="settings-note">HTTP forwarding currently supports requests and responses up to 1 MiB. Application WebSockets and cookie-based app sessions are not forwarded yet.</p></div>;
}
