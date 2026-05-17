import { useState, useRef, useEffect } from "react";
import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { collection, doc, setDoc, getDoc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from "firebase/firestore";

// ─── COLORES ──────────────────────────────────────────────────────────────
const C = { cyan:"#00D4D4",blue:"#3B4FE0",bg:"#F0FAFA",card:"#FFFFFF",text:"#1A2340",muted:"#7A90A4",success:"#00C48C",danger:"#FF5C7A",warning:"#FFB800" };
const GRAD = `linear-gradient(135deg,${C.cyan},${C.blue})`;
const GRAD_B = `linear-gradient(135deg,${C.blue},#5B6FFF)`;

// ─── TARIFAS ──────────────────────────────────────────────────────────────
const TARIFAS_INIT = {
  moto:         { kmRate:35,  hrRate:350,  label:"Moto",          icon:"🛵" },
  auto:         { kmRate:55,  hrRate:550,  label:"Auto",          icon:"🚗" },
  camioneta:    { kmRate:80,  hrRate:900,  label:"Camioneta",     icon:"🛻" },
  camion:       { kmRate:120, hrRate:1400, label:"Camión",        icon:"🚚" },
  camionGrande: { kmRate:160, hrRate:1900, label:"Camión grande", icon:"🚛" },
};
const COMISION_INIT = 15;

// ─── HELPERS ──────────────────────────────────────────────────────────────
function getTarifa(k, t) { return t[k] || t.camioneta; }
function detectarVehiculoKey(v = "") {
  const s = v.toLowerCase();
  if (s.includes("grande") || s.includes("3 ton") || s.includes("5 ton")) return "camionGrande";
  if (s.includes("camión") || s.includes("camion") || s.includes("1 ton")) return "camion";
  if (s.includes("camioneta")) return "camioneta";
  if (s.includes("auto") || s.includes("carro")) return "auto";
  if (s.includes("moto")) return "moto";
  return "camioneta";
}
function formatUYU(n) { return "$" + Math.round(n || 0).toLocaleString("es-UY"); }
function formatTiempo(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2,"0")}m ${String(ss).padStart(2,"0")}s` : `${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}
function costoViaje(sol) {
  if (!sol.precioFletyer) return 0;
  if (sol.tipo === "mudanza" && sol.tiempoTotal) return Math.round(sol.precioFletyer * (sol.tiempoTotal / 3600));
  return sol.precioFletyer;
}

// ─── GEOCODIFICACIÓN ──────────────────────────────────────────────────────
const GC = {};
const CFB = { lat: -34.9011, lng: -56.1645 };
async function geocod(dir) {
  if (!dir || dir.length < 3) return CFB;
  const k = dir.trim().toLowerCase();
  if (GC[k]) return GC[k];
  try {
    const q = dir.includes("Uruguay") || dir.includes("Montevideo") ? dir : `${dir}, Montevideo, Uruguay`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "es" } });
    const d = await r.json();
    if (d?.[0]) { const c = { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) }; GC[k] = c; return c; }
  } catch (e) {}
  return CFB;
}
function haversine(c1, c2) {
  const R = 6371, dLat = (c2.lat - c1.lat) * Math.PI / 180, dLng = (c2.lng - c1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(c1.lat*Math.PI/180) * Math.cos(c2.lat*Math.PI/180) * Math.sin(dLng/2)**2;
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1));
}

// ─── ESTILOS ──────────────────────────────────────────────────────────────
const st = {
  wrap: { minHeight:"100vh", background:C.bg, fontFamily:"'Segoe UI',sans-serif", display:"flex", flexDirection:"column", alignItems:"center", paddingBottom:72 },
  header: { width:"100%", background:GRAD, color:"#fff", padding:"13px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", boxSizing:"border-box" },
  cont: { width:"100%", maxWidth:480, padding:"14px 13px", boxSizing:"border-box" },
  card: { background:C.card, borderRadius:18, padding:18, marginBottom:14, boxShadow:"0 3px 16px rgba(0,180,180,0.10)" },
  btn: (col=GRAD, mb=10) => ({ background:col, color:"#fff", border:"none", borderRadius:12, padding:"12px 0", width:"100%", fontSize:14, fontWeight:700, cursor:"pointer", marginBottom:mb }),
  btnSm: (col=GRAD) => ({ background:col, color:"#fff", border:"none", borderRadius:10, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }),
  btnOut: (col=C.cyan) => ({ background:"transparent", color:col, border:`2px solid ${col}`, borderRadius:12, padding:"10px 0", width:"100%", fontSize:14, fontWeight:700, cursor:"pointer", marginBottom:10 }),
  input: { width:"100%", padding:"11px 13px", borderRadius:12, border:`1.5px solid ${C.cyan}44`, fontSize:14, marginBottom:11, boxSizing:"border-box", outline:"none", background:"#F7FEFE" },
  textarea: { width:"100%", padding:"11px 13px", borderRadius:12, border:`1.5px solid ${C.cyan}44`, fontSize:14, marginBottom:11, boxSizing:"border-box", minHeight:80, resize:"vertical", outline:"none", background:"#F7FEFE" },
  label: { fontSize:11, color:C.muted, marginBottom:4, display:"block", fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 },
  tag: (col=C.cyan) => ({ background:col+"22", color:col, borderRadius:20, padding:"3px 10px", fontSize:12, fontWeight:700, display:"inline-block" }),
  tabBar: { position:"fixed", bottom:0, left:0, right:0, background:"#fff", borderTop:`2px solid ${C.cyan}33`, display:"flex", justifyContent:"space-around", padding:"6px 0 10px", zIndex:100, boxShadow:"0 -2px 12px rgba(0,180,180,0.10)" },
  tabBtn: (a) => ({ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:2, color:a?C.blue:C.muted, fontWeight:a?700:400, fontSize:10, padding:"4px 2px" }),
};

// ─── LOGOS ────────────────────────────────────────────────────────────────
const LogoSVG = ({size=80}) => (
  <svg width={size} height={size*1.1} viewBox="0 0 120 130" fill="none">
    <defs><linearGradient id="lg1" x1="60" y1="0" x2="60" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#00D4D4"/><stop offset="100%" stopColor="#3B4FE0"/></linearGradient></defs>
    <path d="M60 0C38 0 20 18 20 40C20 65 60 100 60 100C60 100 100 65 100 40C100 18 82 0 60 0Z" fill="url(#lg1)"/>
    <circle cx="60" cy="38" r="22" fill="white"/>
    <text x="60" y="46" textAnchor="middle" fontSize="24" fontWeight="900" fill="url(#lg1)" fontFamily="Arial,sans-serif">F</text>
    <text x="60" y="125" textAnchor="middle" fontSize="22" fontWeight="900" fill="#00D4D4" fontFamily="Arial,sans-serif" letterSpacing="3">FLETY</text>
  </svg>
);
const LogoMark = ({size=30}) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <defs><linearGradient id="lg2" x1="50" y1="0" x2="50" y2="85" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#00D4D4"/><stop offset="100%" stopColor="#3B4FE0"/></linearGradient></defs>
    <path d="M50 2C30 2 14 18 14 38C14 60 50 88 50 88C50 88 86 60 86 38C86 18 70 2 50 2Z" fill="url(#lg2)"/>
    <circle cx="50" cy="36" r="18" fill="white"/>
    <text x="50" y="43" textAnchor="middle" fontSize="20" fontWeight="900" fill="url(#lg2)" fontFamily="Arial,sans-serif">F</text>
  </svg>
);

// ─── COMPONENTES UI ───────────────────────────────────────────────────────
function Estrellas({valor, onChange, size=22}) {
  const [h, setH] = useState(0);
  return <div style={{display:"flex",gap:4}}>{[1,2,3,4,5].map(n=><span key={n} style={{fontSize:size,cursor:onChange?"pointer":"default",color:(h||valor)>=n?"#FFB800":"#ddd"}} onMouseEnter={()=>onChange&&setH(n)} onMouseLeave={()=>onChange&&setH(0)} onClick={()=>onChange&&onChange(n)}>★</span>)}</div>;
}
function promEst(c) { if(!c?.length) return 0; return (c.reduce((a,x)=>a+x.estrellas,0)/c.length).toFixed(1); }
function Avatar({u, size=52}) {
  return <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",background:GRAD,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`2px solid ${C.cyan}55`}}>{u?.foto?<img src={u.foto} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<span style={{fontSize:size*0.4,color:"#fff"}}>{u?.tipo==="fletyer"?"🚚":"👤"}</span>}</div>;
}

// ─── MAPA LEAFLET ─────────────────────────────────────────────────────────
let leafletLoaded = false;
function MiniMapa({origen, destino}) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const mapId = useRef("m" + Math.random().toString(36).slice(2));
  const [coords, setCoords] = useState(null);
  const [dist, setDist] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!origen || !destino || origen.length < 5 || destino.length < 5) return;
    setLoading(true);
    Promise.all([geocod(origen), geocod(destino)]).then(([c1,c2]) => { setCoords({c1,c2}); setDist(haversine(c1,c2)); setLoading(false); }).catch(()=>setLoading(false));
  }, [origen, destino]);

  useEffect(() => {
    if (!coords || !mapRef.current) return;
    if (!leafletLoaded) {
      const link = document.createElement("link"); link.rel="stylesheet"; link.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(link);
      leafletLoaded = true;
    }
    const init = () => {
      if (!window.L) { setTimeout(init, 200); return; }
      if (mapInst.current) { mapInst.current.remove(); mapInst.current = null; }
      const {c1,c2} = coords;
      const map = window.L.map(mapRef.current, {center:[(c1.lat+c2.lat)/2,(c1.lng+c2.lng)/2],zoom:13,zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false});
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
      const mkA = window.L.divIcon({html:`<div style="background:#00C48C;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px">A</div>`,className:"",iconSize:[26,26],iconAnchor:[13,13]});
      const mkB = window.L.divIcon({html:`<div style="background:#FF5C7A;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px">B</div>`,className:"",iconSize:[26,26],iconAnchor:[13,13]});
      window.L.marker([c1.lat,c1.lng],{icon:mkA}).addTo(map);
      window.L.marker([c2.lat,c2.lng],{icon:mkB}).addTo(map);
      window.L.polyline([[c1.lat,c1.lng],[c2.lat,c2.lng]],{color:"#3B4FE0",weight:3,dashArray:"8,5"}).addTo(map);
      map.fitBounds([[c1.lat,c1.lng],[c2.lat,c2.lng]],{padding:[28,28]});
      mapInst.current = map;
    };
    if (!window.L) { const s=document.createElement("script"); s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; s.onload=init; document.head.appendChild(s); } else init();
    return () => { if (mapInst.current) { mapInst.current.remove(); mapInst.current = null; } };
  }, [coords]);

  if (!origen || !destino || origen.length < 5 || destino.length < 5) return null;
  return (
    <div style={{borderRadius:14,overflow:"hidden",marginBottom:10,border:`1px solid ${C.cyan}33`}}>
      {loading && <div style={{height:150,background:"#E0F7F7",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:12,color:C.muted}}>🗺️ Cargando mapa...</span></div>}
      {!loading && <div ref={mapRef} id={mapId.current} style={{height:175,width:"100%"}}/>}
      {dist !== null && !loading && <div style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",fontSize:12,color:C.muted,background:"#F0FAFA"}}><span><b style={{color:C.success}}>A</b> {origen.slice(0,24)}</span><b style={{color:C.blue}}>📍 {dist} km</b></div>}
    </div>
  );
}

// ─── INPUT DIRECCIÓN CON AUTOCOMPLETE ─────────────────────────────────────
function InputDir({value, onChange, label, placeholder}) {
  const [calle, setCalle] = useState("");
  const [numero, setNumero] = useState("");
  const [sugs, setSugs] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const timer = useRef(null);
  const wrap = useRef(null);

  useEffect(() => {
    const h = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    const dir = numero.trim() ? `${calle} ${numero.trim()}` : calle;
    onChange(dir);
  }, [calle, numero]);

  const buscar = txt => {
    setCalle(txt); setOk(false);
    clearTimeout(timer.current);
    if (txt.length < 4) { setSugs([]); setOpen(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&q=${encodeURIComponent(txt+", Montevideo, Uruguay")}`, {headers:{"Accept-Language":"es"}});
        const data = await r.json();
        const lista = data.map(d => {
          const a = d.address || {};
          const nombre = a.road || a.pedestrian || d.display_name.split(",")[0];
          const barrio = a.suburb || a.neighbourhood || "";
          return { label: barrio ? `${nombre}, ${barrio}` : nombre, lat: parseFloat(d.lat), lng: parseFloat(d.lon) };
        }).filter((v,i,arr) => arr.findIndex(x=>x.label===v.label)===i);
        setSugs(lista); setOpen(lista.length > 0);
      } catch(e) { setSugs([]); }
      setLoading(false);
    }, 400);
  };

  const elegir = sug => {
    setCalle(sug.label); setOk(true); setSugs([]); setOpen(false);
    GC[sug.label.trim().toLowerCase()] = {lat:sug.lat, lng:sug.lng};
  };

  const geocodManual = async () => {
    setOpen(false);
    if (ok || !calle || calle.length < 4) return;
    const dir = numero.trim() ? `${calle} ${numero.trim()}, Montevideo, Uruguay` : `${calle}, Montevideo, Uruguay`;
    const c = await geocod(dir);
    if (c !== CFB) { setOk(true); const k=(numero.trim()?`${calle} ${numero.trim()}`:calle).trim().toLowerCase(); GC[k]=c; }
  };

  return (
    <div ref={wrap} style={{marginBottom:11}}>
      {label && <label style={st.label}>{label}</label>}
      <div style={{display:"flex",gap:8}}>
        <div style={{position:"relative",flex:1}}>
          <input style={{...st.input,marginBottom:0,borderColor:ok?`${C.success}88`:undefined}} placeholder={placeholder||"Nombre de calle"} value={calle} onChange={e=>buscar(e.target.value)} onFocus={()=>sugs.length>0&&setOpen(true)} onBlur={geocodManual} autoComplete="off"/>
          {loading && <span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:12}}>⏳</span>}
          {ok && !loading && <span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:12}}>✅</span>}
          {open && sugs.length > 0 && (
            <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",borderRadius:12,boxShadow:"0 6px 24px rgba(0,0,0,0.14)",zIndex:999,border:`1.5px solid ${C.cyan}44`,overflow:"hidden",marginTop:3}}>
              {sugs.map((s,i) => <div key={i} onMouseDown={()=>elegir(s)} style={{padding:"9px 13px",fontSize:13,cursor:"pointer",borderBottom:i<sugs.length-1?`1px solid ${C.cyan}18`:"none"}} onMouseEnter={e=>e.currentTarget.style.background=`${C.cyan}15`} onMouseLeave={e=>e.currentTarget.style.background="#fff"}>📍 {s.label}</div>)}
            </div>
          )}
        </div>
        <input style={{...st.input,marginBottom:0,width:70,flexShrink:0,textAlign:"center",fontWeight:700}} placeholder="Nº" value={numero} onChange={e=>setNumero(e.target.value)} onBlur={geocodManual} maxLength={6}/>
      </div>
      <div style={{fontSize:11,color:ok?C.success:C.muted,minHeight:15,marginTop:2}}>{ok?"📍 Ubicación encontrada":calle.length>3&&!loading?"Elegí una sugerencia o escribí la dirección completa":""}</div>
    </div>
  );
}

// ─── RESUMEN VIAJE ────────────────────────────────────────────────────────
function ResumenViaje({sol, comisionPct, mostrarComision=true}) {
  if (sol.estado !== "finalizado") return null;
  const costo = costoViaje(sol), com = Math.round(costo*(comisionPct/100)), neto = costo - com;
  return (
    <div style={{background:`${C.success}12`,borderRadius:14,padding:"14px 16px",marginBottom:10,border:`1.5px solid ${C.success}44`}}>
      <div style={{fontWeight:800,fontSize:14,color:C.success,marginBottom:10}}>✅ Resumen del viaje</div>
      {sol.tiempoTotal && <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:13,color:C.muted}}>⏱ Tiempo:</span><span style={{fontSize:13,fontWeight:700}}>{formatTiempo(sol.tiempoTotal)}</span></div>}
      {sol.tipo==="mudanza"&&sol.precioFletyer&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:13,color:C.muted}}>Tarifa/h:</span><span style={{fontSize:13,fontWeight:700}}>{formatUYU(sol.precioFletyer)}/h</span></div>}
      <div style={{display:"flex",justifyContent:"space-between",paddingTop:6,borderTop:`1px solid ${C.success}33`,marginBottom:mostrarComision?8:0}}><span style={{fontSize:14,fontWeight:700}}>Costo final:</span><span style={{fontSize:19,fontWeight:900,color:C.success}}>{formatUYU(costo)}</span></div>
      {mostrarComision && <div style={{display:"flex",gap:8}}><div style={{flex:1,textAlign:"center",background:"rgba(255,92,122,0.10)",borderRadius:10,padding:"7px 0"}}><div style={{fontSize:11,color:C.muted}}>Comisión ({comisionPct}%)</div><div style={{fontSize:14,fontWeight:700,color:C.danger}}>−{formatUYU(com)}</div></div><div style={{flex:1,textAlign:"center",background:"rgba(0,196,140,0.10)",borderRadius:10,padding:"7px 0"}}><div style={{fontSize:11,color:C.muted}}>Fletyer recibe</div><div style={{fontSize:14,fontWeight:700,color:C.success}}>{formatUYU(neto)}</div></div></div>}
    </div>
  );
}

// ─── CONTADOR VIAJE ───────────────────────────────────────────────────────
function ContadorViaje({sol, tipoUsuario, onIniciar, onFinalizar}) {
  const [seg, setSeg] = useState(0);
  const ref = useRef();
  const esFletyer = tipoUsuario === "fletyer";
  const activo = sol.viajeInicio && !sol.viajeFin;

  useEffect(() => {
    if (activo && sol.viajeInicio) {
      const upd = () => setSeg(Math.floor((Date.now()-sol.viajeInicio)/1000));
      upd(); ref.current = setInterval(upd, 1000);
    }
    return () => clearInterval(ref.current);
  }, [activo, sol.viajeInicio]);

  if (sol.estado !== "en_curso") return null;
  if (!sol.viajeInicio && esFletyer) return <div style={{background:`${C.warning}15`,border:`1.5px solid ${C.warning}55`,borderRadius:14,padding:"14px",marginBottom:10}}><div style={{fontSize:13,fontWeight:700,color:C.warning,marginBottom:8}}>🚦 Listo para arrancar</div><button style={st.btn(`linear-gradient(135deg,${C.success},#00a87a)`)} onClick={onIniciar}>🚀 Iniciar viaje</button></div>;
  if (!sol.viajeInicio && !esFletyer) return <div style={{background:`${C.warning}15`,borderRadius:14,padding:"12px 16px",marginBottom:10}}><span style={{fontSize:13,color:C.warning,fontWeight:700}}>⏳ Esperando que el Fletyer inicie el viaje...</span></div>;
  if (activo) {
    const costoActual = sol.tipo==="mudanza" ? Math.round((sol.precioFletyer||0)*(seg/3600)) : (sol.precioFletyer||0);
    return (
      <div style={{background:`linear-gradient(135deg,${C.success}18,${C.cyan}12)`,border:`2px solid ${C.success}55`,borderRadius:14,padding:"16px",marginBottom:10}}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:C.success,textTransform:"uppercase"}}>🟢 Viaje en curso</div>
          <div style={{fontSize:44,fontWeight:900,color:C.text,fontFamily:"monospace"}}>{formatTiempo(seg)}</div>
          <div style={{fontSize:13,color:C.muted,marginTop:4}}>{sol.tipo==="mudanza"?`Acumulado: ${formatUYU(costoActual)} · tarifa ${formatUYU(sol.precioFletyer||0)}/h`:`Precio fijo: ${formatUYU(sol.precioFletyer||0)}`}</div>
        </div>
        {esFletyer && <button style={st.btn(`linear-gradient(135deg,${C.danger},#ff8c60)`)} onClick={()=>onFinalizar(seg)}>🏁 Finalizar viaje</button>}
        {!esFletyer && <div style={{fontSize:12,color:C.success,textAlign:"center",fontWeight:600}}>El Fletyer está en camino...</div>}
      </div>
    );
  }
  return null;
}

// ─── PERFIL PÚBLICO ───────────────────────────────────────────────────────
function PerfilUsuario({u, onClose}) {
  if (!u) return null;
  const ef = u.tipo === "fletyer", p = promEst(u.calificaciones);
  return (
    <div style={{...st.wrap,paddingBottom:0,position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:200,background:C.bg,overflowY:"auto"}}>
      <div style={st.header}><button onClick={onClose} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>←</button><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>FLETY</span></div><div/></div>
      <div style={st.cont}>
        <div style={{...st.card,background:GRAD,marginBottom:0,borderRadius:"18px 18px 0 0",padding:"28px 18px 22px"}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
            <Avatar u={u} size={80}/>
            <div style={{textAlign:"center"}}><div style={{fontWeight:800,fontSize:20,color:"#fff"}}>{u.nombre}</div><span style={{background:"rgba(255,255,255,0.25)",color:"#fff",borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700}}>{ef?"🚚 Fletyer":"🏠 Cliente"}</span></div>
            {ef && <div style={{display:"flex",alignItems:"center",gap:6}}><Estrellas valor={Math.round(parseFloat(p))} size={18}/><span style={{color:"#fff",fontWeight:700}}>{p>0?`${p} (${u.calificaciones?.length})`:"Sin calificaciones"}</span></div>}
          </div>
        </div>
        <div style={{...st.card,borderRadius:"0 0 18px 18px",paddingTop:20}}>
          {[{l:"Edad",v:u.edad?`${u.edad} años`:"—"},{l:"Dirección",v:u.direccion||"—"},{l:"Teléfono",v:u.telefono||"—"},...(ef?[{l:"Vehículo",v:u.vehiculo||"—"}]:[])].map(f=><div key={f.l} style={{borderBottom:`1px solid ${C.cyan}22`,paddingBottom:10,marginBottom:10}}><div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{f.l}</div><div style={{fontSize:15,fontWeight:600,marginTop:2}}>{f.v}</div></div>)}
        </div>
        {ef && u.calificaciones?.length > 0 && <div style={st.card}><div style={{fontWeight:800,marginBottom:12}}>⭐ Reseñas</div>{u.calificaciones.map((c,i)=><div key={i} style={{borderBottom:`1px solid ${C.cyan}22`,paddingBottom:10,marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between"}}><Estrellas valor={c.estrellas} size={15}/><span style={{fontSize:12,color:C.muted}}>— {c.cliente}</span></div>{c.comentario&&<div style={{fontSize:13,fontStyle:"italic",marginTop:4}}>"{c.comentario}"</div>}</div>)}</div>}
      </div>
    </div>
  );
}

// ─── MODAL CALIFICAR ──────────────────────────────────────────────────────
function ModalCalificar({fletyer, onCalificar, onCerrar}) {
  const [est, setEst] = useState(0), [com, setCom] = useState("");
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.45)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:C.card,borderRadius:20,padding:24,width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:16}}><Avatar u={fletyer} size={60}/><div style={{fontWeight:800,fontSize:17,marginTop:8}}>Calificá a {fletyer?.nombre}</div></div>
        <div style={{display:"flex",justifyContent:"center",marginBottom:14}}><Estrellas valor={est} onChange={setEst} size={36}/></div>
        <textarea style={st.textarea} placeholder="Comentario (opcional)..." value={com} onChange={e=>setCom(e.target.value)}/>
        <button style={st.btn(GRAD)} disabled={!est} onClick={()=>onCalificar(est,com)}>{est?`Enviar (${est}★)`:"Seleccioná una puntuación"}</button>
        <button style={st.btnOut(C.muted)} onClick={onCerrar}>Ahora no</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [fbUser, setFbUser] = useState(undefined);
  const [perfil, setPerfil] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [tarifas, setTarifas] = useState(TARIFAS_INIT);
  const [comisionPct, setComisionPct] = useState(COMISION_INIT);
  const [tab, setTab] = useState("inicio");
  const [modo, setModo] = useState(null); // "cliente-login" etc
  const [loginForm, setLoginForm] = useState({email:"",pass:""});
  const [loginErr, setLoginErr] = useState("");
  const [regForm, setRegForm] = useState({nombre:"",email:"",edad:"",direccion:"",telefono:"",vehiculo:"",pass:""});
  const [nuevaSol, setNuevaSol] = useState({tipo:"mudanza",origen:"",destino:"",descripcion:""});
  const [aviso, setAviso] = useState(false);
  const [chatActivo, setChatActivo] = useState(null);
  const [nuevoMsg, setNuevoMsg] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({});
  const [verPerfil, setVerPerfil] = useState(null);
  const [modalCal, setModalCal] = useState(null);
  const [precioEdit, setPrecioEdit] = useState({});
  const [editTar, setEditTar] = useState(false);
  const [tarEdit, setTarEdit] = useState({});
  const [comEdit, setComEdit] = useState(COMISION_INIT);
  const [subiendo, setSubiendo] = useState(false);
  const fotoRef = useRef();
  const libRef = useRef();
  const ciARef = useRef();
  const ciBRef = useRef();

  const getPI = id => precioEdit[id] ?? "";
  const setPI = (id,v) => setPrecioEdit(p=>({...p,[id]:v}));

  // ── Auth ──
  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      setFbUser(u);
      if (u) {
        try {
          const s = await getDoc(doc(db,"usuarios",u.uid));
          setPerfil(s.exists() ? {id:u.uid,...s.data()} : null);
        } catch(e) { setPerfil(null); }
      } else { setPerfil(null); }
    });
  }, []);

  // ── Usuarios listener ──
  useEffect(() => {
    const unsub = onSnapshot(collection(db,"usuarios"), s => {
      setUsuarios(s.docs.map(d=>({id:d.id,...d.data()})));
    }, err => console.warn("usuarios err:", err));
    return unsub;
  }, []);

  // ── Solicitudes listener ──
  useEffect(() => {
    const unsub = onSnapshot(collection(db,"solicitudes"), s => {
      const docs = s.docs.map(d=>({id:d.id,...d.data()}));
      docs.sort((a,b) => ((b.creadoEn?.seconds||0) - (a.creadoEn?.seconds||0)));
      setSolicitudes(docs);
    }, err => console.warn("solicitudes err:", err));
    return unsub;
  }, []);

  // ── Config listener ──
  useEffect(() => {
    const unsub = onSnapshot(doc(db,"config","tarifas"), s => {
      if (s.exists()) { const d=s.data(); if(d.tarifas) setTarifas(d.tarifas); if(d.comisionPct) setComisionPct(d.comisionPct); }
    }, err => console.warn("config err:", err));
    return unsub;
  }, []);

  // ── Sync perfil ──
  useEffect(() => {
    if (fbUser && usuarios.length) {
      const u = usuarios.find(x=>x.id===fbUser.uid);
      if (u) setPerfil(u);
    }
  }, [usuarios, fbUser]);

  // ── ACCIONES ──────────────────────────────────────────────────────────
  const login = async () => {
    setLoginErr("");
    try {
      const cred = await signInWithEmailAndPassword(auth, loginForm.email, loginForm.pass);
      const snap = await getDoc(doc(db,"usuarios",cred.user.uid));
      if (snap.exists()) {
        const tipoReal = snap.data().tipo;
        const tipoElegido = modo.replace("-login","");
        if (tipoReal !== tipoElegido) {
          await signOut(auth);
          setLoginErr(`Esta cuenta es de tipo "${tipoReal==="cliente"?"Cliente":tipoReal==="fletyer"?"Fletyer":"Admin"}". Elegí el botón correcto.`);
        }
      }
    } catch(e) {
      if (e.code==="auth/invalid-credential"||e.code==="auth/user-not-found"||e.code==="auth/wrong-password") setLoginErr("Email o contraseña incorrectos");
      else if (e.code) setLoginErr("Error: "+e.message);
    }
  };

  const registrar = async () => {
    setLoginErr("");
    if (!regForm.nombre||!regForm.email||!regForm.pass) { setLoginErr("Completá nombre, email y contraseña"); return; }
    try {
      const cred = await createUserWithEmailAndPassword(auth, regForm.email, regForm.pass);
      const tipo = modo.replace("-registro","");
      const vKey = detectarVehiculoKey(regForm.vehiculo);
      await setDoc(doc(db,"usuarios",cred.user.uid), {
        nombre:regForm.nombre, email:regForm.email, tipo,
        edad:parseInt(regForm.edad)||0, direccion:regForm.direccion||"",
        telefono:regForm.telefono||"", vehiculo:regForm.vehiculo||"",
        vehiculoKey:vKey, foto:"", calificaciones:[], habilitado:false,
        ...(tipo==="fletyer"?{libretaDesde:"",libretaHasta:"",libretaImg:"",cedulaFrente:"",cedulaDorso:""}:{}),
        creadoEn: serverTimestamp(),
      });
      setTab("inicio");
    } catch(e) {
      if (e.code==="auth/email-already-in-use") setLoginErr("Ese email ya está registrado");
      else if (e.code==="auth/weak-password") setLoginErr("Contraseña mínimo 6 caracteres");
      else setLoginErr("Error: "+e.message);
    }
  };

  const salir = () => { signOut(auth); setTab("inicio"); setChatActivo(null); setModo(null); };

  const publicarSolicitud = async () => {
    if (!nuevaSol.origen||!nuevaSol.destino) return;
    const [c1,c2] = await Promise.all([geocod(nuevaSol.origen), geocod(nuevaSol.destino)]);
    const dist = haversine(c1, c2);
    await addDoc(collection(db,"solicitudes"), {
      clienteId:perfil.id, clienteNombre:perfil.nombre, clienteTelefono:perfil.telefono||"",
      tipo:nuevaSol.tipo, origen:nuevaSol.origen, destino:nuevaSol.destino,
      descripcion:nuevaSol.descripcion, distancia:dist,
      fecha:new Date().toISOString().split("T")[0], estado:"activa",
      chats:{}, ofertasFletyer:{}, fleteroAceptado:null, calificado:false,
      precioFletyer:null, viajeInicio:null, viajeFin:null, tiempoTotal:null, comisionPagada:false,
      creadoEn: serverTimestamp(),
    });
    setAviso(true); setTimeout(()=>setAviso(false),3500);
    setNuevaSol({tipo:"mudanza",origen:"",destino:"",descripcion:""});
    setTab("solicitudes");
  };

  const enviarMsg = async () => {
    if (!nuevoMsg.trim()||!chatActivo) return;
    const {solId, fid} = chatActivo;
    const sol = solicitudes.find(s=>s.id===solId); if (!sol) return;
    const msg = {de:perfil.tipo, texto:nuevoMsg, hora:new Date().toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit"}), ...(perfil.tipo==="fletyer"?{fletyerId:perfil.id,fletyerNombre:perfil.nombre}:{})};
    const chats = {...(sol.chats||{})}; chats[fid] = [...(chats[fid]||[]), msg];
    await updateDoc(doc(db,"solicitudes",solId),{chats});
    setNuevoMsg("");
  };

  const ofertarPrecio = async (solId, precio) => {
    if (!precio||parseFloat(precio)<=0) return;
    const p = parseFloat(precio);
    const sol = solicitudes.find(s=>s.id===solId); if (!sol) return;
    const fid = String(perfil.id);
    const label = sol.tipo==="mudanza" ? `${formatUYU(p)}/hora` : `${formatUYU(p)} total`;
    const ofertasFletyer = {...(sol.ofertasFletyer||{}), [fid]:{precio:p,nombre:perfil.nombre,bloqueado:false}};
    const chats = {...(sol.chats||{})};
    if (!chats[fid]||chats[fid].length===0) chats[fid]=[{de:"fletyer",fletyerId:fid,fletyerNombre:perfil.nombre,texto:`¡Hola! Mi precio es ${label}. ¿Te parece bien?`,hora:new Date().toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit"}),esOfertaAuto:true}];
    await updateDoc(doc(db,"solicitudes",solId),{ofertasFletyer,chats});
    setPI(solId,"");
  };

  const modificarOferta = async (solId, precio) => {
    if (!precio||parseFloat(precio)<=0) return;
    const p = parseFloat(precio);
    const sol = solicitudes.find(s=>s.id===solId); if (!sol) return;
    const fid = String(perfil.id);
    const oferta = sol.ofertasFletyer?.[fid]; if (!oferta||oferta.bloqueado) return;
    const label = sol.tipo==="mudanza" ? `${formatUYU(p)}/hora` : `${formatUYU(p)} total`;
    const ofertasFletyer = {...sol.ofertasFletyer,[fid]:{...oferta,precio:p}};
    const chats = {...(sol.chats||{})};
    if (chats[fid]) chats[fid] = chats[fid].map(m=>m.esOfertaAuto?{...m,texto:`¡Hola! Mi precio es ${label}. ¿Te parece bien?`}:m);
    await updateDoc(doc(db,"solicitudes",solId),{ofertasFletyer,chats});
    setPI(solId,"");
  };

  const aceptarFletyer = async (solId, fletyerId) => {
    const sol = solicitudes.find(s=>s.id===solId); if (!sol) return;
    const fid = String(fletyerId);
    const of = {...(sol.ofertasFletyer||{})};
    if (of[fid]) of[fid]={...of[fid],bloqueado:true};
    await updateDoc(doc(db,"solicitudes",solId),{fleteroAceptado:fid,estado:"en_curso",ofertasFletyer:of,precioFletyer:of[fid]?.precio||0});
  };

  const iniciarViaje = async solId => await updateDoc(doc(db,"solicitudes",solId),{viajeInicio:Date.now()});
  const finalizarViaje = async (solId,seg) => await updateDoc(doc(db,"solicitudes",solId),{estado:"finalizado",viajeFin:Date.now(),tiempoTotal:seg||null});
  const cancelarViaje = async solId => {
    const sol = solicitudes.find(s=>s.id===solId); if (!sol) return;
    const of = Object.fromEntries(Object.entries(sol.ofertasFletyer||{}).map(([k,v])=>[k,{...v,bloqueado:false}]));
    await updateDoc(doc(db,"solicitudes",solId),{estado:"activa",fleteroAceptado:null,viajeInicio:null,viajeFin:null,tiempoTotal:null,precioFletyer:null,ofertasFletyer:of});
    setChatActivo(null);
  };
  const eliminarSolicitud = async solId => await deleteDoc(doc(db,"solicitudes",solId));

  const calificar = async (solId, fletyerId, est, com) => {
    const fid = String(fletyerId);
    const snap = await getDoc(doc(db,"usuarios",fid)); if (!snap.exists()) return;
    const califs = [...(snap.data().calificaciones||[]),{estrellas:est,comentario:com,cliente:perfil.nombre}];
    await updateDoc(doc(db,"usuarios",fid),{calificaciones:califs});
    await updateDoc(doc(db,"solicitudes",solId),{calificado:true});
    setModalCal(null);
  };

  const marcarPagada = async solId => await updateDoc(doc(db,"solicitudes",solId),{comisionPagada:true});
  const toggleHabilitar = async uid => { const u=usuarios.find(x=>x.id===uid); if(u) await updateDoc(doc(db,"usuarios",uid),{habilitado:!u.habilitado}); };
  const asignarVehiculo = async (uid,vKey) => await updateDoc(doc(db,"usuarios",uid),{vehiculoKey:vKey,vehiculo:tarifas[vKey].label});
  const guardarTarifas = async () => { await setDoc(doc(db,"config","tarifas"),{tarifas:tarEdit,comisionPct:parseFloat(comEdit)||15}); setTarifas(tarEdit); setComisionPct(parseFloat(comEdit)||15); setEditTar(false); };
  const guardarEdicion = async () => { const vKey=detectarVehiculoKey(editData.vehiculo||""); await updateDoc(doc(db,"usuarios",perfil.id),{...editData,vehiculoKey:vKey}); setEditMode(false); };

  const handleImg = async (campo, e) => {
    const file = e.target.files[0]; if (!file) return; setSubiendo(true);
    const reader = new FileReader();
    reader.onload = async ev => { try { await updateDoc(doc(db,"usuarios",perfil.id),{[campo]:ev.target.result}); } catch(err){} setSubiendo(false); };
    reader.readAsDataURL(file);
  };

  const eLabel = e => ({activa:{label:"● Activa",col:C.cyan},en_curso:{label:"🔄 En curso",col:C.warning},finalizado:{label:"✅ Finalizado",col:C.success}}[e]||{label:e,col:C.muted});

  // ─── TAB BAR ────────────────────────────────────────────────────────────
  const badge = (() => {
    if (!perfil) return 0;
    if (perfil.tipo==="cliente") return solicitudes.filter(s=>s.clienteId===perfil.id&&Object.keys(s.ofertasFletyer||{}).length>0).length;
    if (perfil.tipo==="fletyer") return solicitudes.filter(s=>s.estado==="en_curso"&&s.fleteroAceptado===perfil.id&&(s.chats?.[perfil.id]||[]).some(m=>m.de==="cliente")).length;
    return 0;
  })();

  const TabBar = () => {
    const tipo = perfil?.tipo;
    const tabs = tipo==="admin"?[{id:"admin-sols",icon:"📋",label:"Solicitudes"},{id:"admin-users",icon:"👥",label:"Usuarios"},{id:"admin-config",icon:"⚙️",label:"Config"}]:tipo==="cliente"?[{id:"inicio",icon:"🏠",label:"Inicio"},{id:"solicitudes",icon:"📋",label:"Solicitudes"},{id:"cuenta",icon:"👤",label:"Mi Cuenta"}]:[{id:"inicio",icon:"🔍",label:"Disponibles"},{id:"solicitudes",icon:"📋",label:"Mis Trabajos"},{id:"cuenta",icon:"👤",label:"Mi Cuenta"}];
    return <div style={st.tabBar}>{tabs.map(t=><button key={t.id} style={st.tabBtn(tab===t.id)} onClick={()=>{setTab(t.id);setChatActivo(null);}}><div style={{position:"relative"}}><span style={{fontSize:20}}>{t.icon}</span>{t.id==="solicitudes"&&badge>0&&<span style={{position:"absolute",top:-4,right:-8,background:C.danger,color:"#fff",borderRadius:"50%",width:16,height:16,fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{badge}</span>}</div><span>{t.label}</span></button>)}</div>;
  };

  // ─── ESTADOS GLOBALES ────────────────────────────────────────────────────
  if (fbUser === undefined) return <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}><LogoSVG/><div style={{fontSize:14,color:C.muted}}>Iniciando FLETY...</div></div>;

  if (verPerfil) return <PerfilUsuario u={usuarios.find(u=>u.id===verPerfil)||verPerfil} onClose={()=>setVerPerfil(null)}/>;

  if (modalCal) {
    const fl = usuarios.find(u=>u.id===String(modalCal.fid));
    if (!fl) { setTimeout(()=>setModalCal(null),0); return null; }
    return <ModalCalificar fletyer={fl} onCalificar={(e,c)=>calificar(modalCal.solId,modalCal.fid,e,c)} onCerrar={()=>setModalCal(null)}/>;
  }

  // ═══ SIN LOGIN ════════════════════════════════════════════════════════════
  if (!fbUser || !perfil) {
    if (!modo) return (
      <div style={{...st.wrap,paddingBottom:0}}>
        <div style={{width:"100%",background:GRAD,minHeight:"42vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 24px 36px",boxSizing:"border-box"}}>
          <LogoSVG size={100}/>
          <div style={{fontSize:13,color:"#fff",opacity:0.9,marginTop:8,textAlign:"center"}}>Conectamos Fletyers con clientes en Uruguay</div>
          <div style={{display:"flex",gap:10,marginTop:18}}>{["🚚 Rápido","📍 Montevideo","⭐ Confiable"].map(t=><span key={t} style={{background:"rgba(255,255,255,0.2)",color:"#fff",borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700}}>{t}</span>)}</div>
        </div>
        <div style={{...st.cont,marginTop:-10}}>
          <div style={st.card}>
            <div style={{fontSize:18,fontWeight:800,color:C.blue,textAlign:"center",marginBottom:6}}>¿Cómo querés ingresar?</div>
            <div style={{fontSize:13,color:C.muted,textAlign:"center",marginBottom:18}}>Seleccioná tu perfil</div>
            <button style={st.btn(GRAD)} onClick={()=>setModo("cliente-login")}>🏠 Soy Cliente</button>
            <button style={st.btn(GRAD_B)} onClick={()=>setModo("fletyer-login")}>🚚 Soy Fletyer</button>
            <button style={{...st.btnOut(C.muted),color:"#999"}} onClick={()=>setModo("admin-login")}>⚙️ Administrador</button>
          </div>
        </div>
      </div>
    );

    const tipo = modo.replace("-login","").replace("-registro","");
    const esLogin = modo.endsWith("-login");
    return (
      <div style={st.wrap}>
        <div style={st.header}><button onClick={()=>{setModo(null);setLoginErr("");}} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>←</button><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>FLETY</span></div><div/></div>
        <div style={st.cont}>
          <div style={st.card}>
            <div style={{fontSize:18,fontWeight:800,color:C.blue,marginBottom:4}}>{esLogin?"Iniciar sesión":"Crear cuenta"}</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Como {tipo==="admin"?"Administrador":tipo==="cliente"?"Cliente":"Fletyer"}</div>
            {!esLogin && <>
              <label style={st.label}>Nombre completo</label><input style={st.input} placeholder="Tu nombre" value={regForm.nombre} onChange={e=>setRegForm(p=>({...p,nombre:e.target.value}))}/>
              <label style={st.label}>Edad</label><input style={st.input} type="number" placeholder="30" value={regForm.edad} onChange={e=>setRegForm(p=>({...p,edad:e.target.value}))}/>
              <label style={st.label}>Dirección</label><input style={st.input} placeholder="Tu barrio" value={regForm.direccion} onChange={e=>setRegForm(p=>({...p,direccion:e.target.value}))}/>
              <label style={st.label}>Teléfono</label><input style={st.input} placeholder="09X XXX XXX" value={regForm.telefono} onChange={e=>setRegForm(p=>({...p,telefono:e.target.value}))}/>
              {tipo==="fletyer"&&<><label style={st.label}>Tipo de vehículo</label><input style={st.input} placeholder="Ej: Camioneta 1 tonelada" value={regForm.vehiculo} onChange={e=>setRegForm(p=>({...p,vehiculo:e.target.value}))}/></>}
            </>}
            <label style={st.label}>Email</label>
            <input style={st.input} type="email" placeholder="tu@email.com" value={esLogin?loginForm.email:regForm.email} onChange={e=>esLogin?setLoginForm(p=>({...p,email:e.target.value})):setRegForm(p=>({...p,email:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&esLogin&&login()}/>
            <label style={st.label}>Contraseña {!esLogin&&"(mín. 6 caracteres)"}</label>
            <input style={st.input} type="password" placeholder="••••••" value={esLogin?loginForm.pass:regForm.pass} onChange={e=>esLogin?setLoginForm(p=>({...p,pass:e.target.value})):setRegForm(p=>({...p,pass:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&esLogin&&login()}/>
            {loginErr && <div style={{color:C.danger,fontSize:13,marginBottom:10}}>⚠️ {loginErr}</div>}
            <button style={st.btn(tipo==="fletyer"?GRAD_B:GRAD)} onClick={esLogin?login:registrar}>{esLogin?"Ingresar":"Registrarme"}</button>
            {tipo!=="admin"&&<button style={st.btnOut(C.cyan)} onClick={()=>{setLoginErr("");setModo(esLogin?`${tipo}-registro`:`${tipo}-login`);}}>{esLogin?"Crear cuenta nueva":"Ya tengo cuenta"}</button>}
          </div>
        </div>
      </div>
    );
  }

  // ═══ APP CON USUARIO ══════════════════════════════════════════════════════
  const TU = perfil.tipo;
  const UA = perfil;

  // ─── CHAT ─────────────────────────────────────────────────────────────
  if (chatActivo) {
    const sol = solicitudes.find(s=>s.id===chatActivo.solId);
    const msgs = sol?.chats?.[chatActivo.fid] || [];
    const fl = usuarios.find(u=>u.id===String(chatActivo.fid));
    const cl = usuarios.find(u=>u.id===sol?.clienteId);
    const esCliente = TU==="cliente";
    const esFletyer = TU==="fletyer" && UA.id===String(chatActivo.fid);
    const aceptado = sol?.fleteroAceptado===String(chatActivo.fid)||sol?.fleteroAceptado===chatActivo.fid;
    const final = sol?.estado==="finalizado";
    const enCurso = sol?.estado==="en_curso" && aceptado;
    const puedo = !final && (sol?.estado==="activa"||aceptado);
    const oferta = sol?.ofertasFletyer?.[chatActivo.fid]||sol?.ofertasFletyer?.[String(chatActivo.fid)];
    const bloqueado = oferta?.bloqueado;

    return (
      <div style={{...st.wrap,paddingBottom:0}}>
        <div style={st.header}><button onClick={()=>setChatActivo(null)} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>←</button><div style={{textAlign:"center"}}><div style={{fontWeight:700,fontSize:14}}>{TU==="admin"?`${sol?.clienteNombre} ↔ ${fl?.nombre}`:esCliente?`🚚 ${fl?.nombre}`:`🏠 ${sol?.clienteNombre}`}</div><div style={{fontSize:11,opacity:0.85}}>{sol?.origen} → {sol?.destino}</div></div><div/></div>
        {final&&<div style={{width:"100%",background:C.success,color:"#fff",textAlign:"center",padding:"9px",fontSize:13,fontWeight:700,boxSizing:"border-box"}}>✅ Viaje finalizado. ¡Gracias por usar FLETY!</div>}
        {sol?.estado==="en_curso"&&!aceptado&&<div style={{width:"100%",background:C.danger,color:"#fff",textAlign:"center",padding:"9px",fontSize:13,fontWeight:700,boxSizing:"border-box"}}>🔒 Solicitud tomada por otro Fletyer.</div>}
        <div style={{...st.cont,flex:1,display:"flex",flexDirection:"column",maxHeight:"calc(100vh - 115px)",overflowY:"auto"}}>
          {TU!=="admin"&&<button style={{...st.btnOut(C.blue),marginBottom:8}} onClick={()=>setVerPerfil(esCliente?fl?.id:cl?.id)}>👤 Ver perfil de {esCliente?fl?.nombre:sol?.clienteNombre}</button>}
          {oferta&&<div style={{background:sol.tipo==="mudanza"?`${C.blue}12`:`${C.cyan}12`,border:`1.5px solid ${sol.tipo==="mudanza"?C.blue:C.cyan}44`,borderRadius:12,padding:"10px 14px",marginTop:4,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontSize:11,fontWeight:700,color:sol.tipo==="mudanza"?C.blue:C.cyan,textTransform:"uppercase"}}>💰 {sol.tipo==="mudanza"?"Precio/hora":"Precio fijo"}</div><div style={{fontSize:11,color:C.muted}}>{sol.tipo==="mudanza"?"Se cobra por tiempo real":"Precio total acordado"}</div></div><div style={{fontSize:24,fontWeight:900,color:sol.tipo==="mudanza"?C.blue:C.cyan}}>{formatUYU(oferta.precio)}{sol.tipo==="mudanza"?<span style={{fontSize:14}}>/h</span>:""}</div></div>}
          {esFletyer&&!final&&<div style={{background:`${C.blue}08`,border:`1.5px solid ${C.blue}22`,borderRadius:12,padding:"12px 14px",marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:C.blue,marginBottom:8}}>{oferta?"✏️ Modificar mi precio":"⚡ Publicar mi precio"}{bloqueado&&<span style={{marginLeft:8,background:C.warning+"22",color:C.warning,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:700}}>🔒 Bloqueado</span>}</div>
            {!bloqueado?<div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{position:"relative",flex:1}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontWeight:700,color:C.blue}}>$</span><input type="number" min="0" style={{...st.input,marginBottom:0,paddingLeft:24,fontWeight:700}} placeholder={oferta?String(oferta.precio):(sol?.tipo==="mudanza"?"Precio/hora":"Precio total")} value={getPI(sol.id)} onChange={e=>setPI(sol.id,e.target.value)}/></div><button style={st.btnSm(GRAD_B)} disabled={!getPI(sol.id)||parseFloat(getPI(sol.id))<=0} onClick={()=>oferta?modificarOferta(sol.id,getPI(sol.id)):ofertarPrecio(sol.id,getPI(sol.id))}>{oferta?"Actualizar":"Publicar"}</button></div>:<div style={{fontSize:12,color:C.muted}}>No podés modificar el precio una vez aceptado.</div>}
          </div>}
          {enCurso&&<ContadorViaje sol={sol} tipoUsuario={TU} onIniciar={()=>iniciarViaje(sol.id)} onFinalizar={s=>finalizarViaje(sol.id,s)}/>}
          {final&&<ResumenViaje sol={sol} comisionPct={comisionPct}/>}
          {esCliente&&sol?.estado==="activa"&&oferta&&<button style={{...st.btn(C.success),marginBottom:8}} onClick={()=>aceptarFletyer(sol.id,chatActivo.fid)}>✅ Aceptar oferta de {fl?.nombre}</button>}
          {esCliente&&sol?.estado==="activa"&&!oferta&&<div style={{background:`${C.warning}12`,borderRadius:12,padding:"10px 14px",marginBottom:8,fontSize:13,color:C.warning,fontWeight:600}}>⏳ Esperando que el Fletyer publique su precio...</div>}
          {(esCliente||esFletyer)&&enCurso&&!sol?.viajeInicio&&<button style={{...st.btnOut(C.warning),marginBottom:8,color:C.warning}} onClick={()=>cancelarViaje(sol.id)}>↩️ Cancelar</button>}
          {esCliente&&final&&!sol.calificado&&<button style={{...st.btn(C.warning),marginBottom:8}} onClick={()=>setModalCal({solId:sol.id,fid:chatActivo.fid})}>⭐ Calificar a {fl?.nombre}</button>}
          {esCliente&&final&&sol.calificado&&<div style={{background:C.success+"22",color:C.success,borderRadius:12,padding:"8px 0",textAlign:"center",marginBottom:8,fontWeight:700}}>✅ Ya calificaste este viaje</div>}
          {msgs.length===0&&<div style={{textAlign:"center",color:C.muted,fontSize:13,marginTop:20}}>Aún no hay mensajes.</div>}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
            {msgs.map((m,i)=>{const isMe=(esCliente&&m.de==="cliente")||(esFletyer&&m.de==="fletyer"&&m.fletyerId===UA.id);return<div key={i} style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start"}}><div style={{background:isMe?C.cyan+"22":m.esOfertaAuto?"#FFF8E7":"#F0F4FF",borderRadius:14,padding:"8px 13px",maxWidth:"78%",fontSize:13,border:m.esOfertaAuto?`1px solid ${C.warning}44`:"none"}}>{m.esOfertaAuto&&<div style={{fontSize:10,color:C.warning,fontWeight:700,marginBottom:3}}>💬 OFERTA</div>}<div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:2}}>{m.de==="fletyer"?`🚚 ${m.fletyerNombre}`:"🏠 Cliente"}</div>{m.texto}<div style={{fontSize:10,color:C.muted,textAlign:"right",marginTop:2}}>{m.hora}</div></div></div>;})}
          </div>
        </div>
        {TU!=="admin"&&puedo&&<div style={{width:"100%",maxWidth:480,padding:"10px 13px",boxSizing:"border-box",background:"#fff",borderTop:`1px solid ${C.cyan}33`,display:"flex",gap:8}}><input style={{...st.input,marginBottom:0,flex:1}} placeholder="Escribí tu mensaje..." value={nuevoMsg} onChange={e=>setNuevoMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&enviarMsg()}/><button style={{...st.btn(GRAD),width:44,marginBottom:0,padding:0,borderRadius:12}} onClick={enviarMsg}>➤</button></div>}
      </div>
    );
  }

  // ─── NUEVA SOLICITUD ──────────────────────────────────────────────────
  if (tab==="nueva-sol") {
    const mostrarMapa = nuevaSol.origen.length>4 && nuevaSol.destino.length>4;
    return (
      <div style={st.wrap}>
        <div style={st.header}><button onClick={()=>setTab("inicio")} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>←</button><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>Nueva Solicitud</span></div><div/></div>
        <div style={st.cont}>
          <div style={st.card}>
            <label style={st.label}>Tipo de servicio</label>
            <div style={{display:"flex",gap:8,marginBottom:14}}>{[{v:"mudanza",icon:"🏠",label:"Mudanza"},{v:"flete",icon:"📦",label:"Flete"}].map(op=><button key={op.v} onClick={()=>setNuevaSol(p=>({...p,tipo:op.v}))} style={{flex:1,padding:"10px 0",borderRadius:12,border:`2px solid ${nuevaSol.tipo===op.v?C.cyan:"#ddd"}`,background:nuevaSol.tipo===op.v?C.cyan+"18":"#fff",color:nuevaSol.tipo===op.v?C.blue:C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}}>{op.icon} {op.label}</button>)}</div>
            <InputDir label="📍 Partida" placeholder="Nombre de calle" value={nuevaSol.origen} onChange={v=>setNuevaSol(p=>({...p,origen:v}))}/>
            <InputDir label="🏁 Destino" placeholder="Nombre de calle" value={nuevaSol.destino} onChange={v=>setNuevaSol(p=>({...p,destino:v}))}/>
            {mostrarMapa&&<MiniMapa origen={nuevaSol.origen} destino={nuevaSol.destino}/>}
            <label style={st.label}>📝 Descripción</label>
            <textarea style={st.textarea} placeholder={nuevaSol.tipo==="mudanza"?"Ej: 2 ambientes, heladera...":"Ej: 3 cajas medianas..."} value={nuevaSol.descripcion} onChange={e=>setNuevaSol(p=>({...p,descripcion:e.target.value}))}/>
            <button style={st.btn(GRAD)} onClick={publicarSolicitud}>🚀 Publicar Solicitud</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── INICIO CLIENTE ───────────────────────────────────────────────────
  if (tab==="inicio" && TU==="cliente") {
    const misSols = solicitudes.filter(s=>s.clienteId===UA.id);
    return (
      <div style={st.wrap}>
        <div style={st.header}><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>FLETY</span></div><button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button></div>
        <div style={st.cont}>
          {aviso&&<div style={{background:C.success,color:"#fff",padding:"12px 16px",borderRadius:14,marginBottom:14,fontWeight:700,textAlign:"center"}}>✅ ¡Solicitud publicada!</div>}
          <div style={{...st.card,background:GRAD,marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:16,color:"#fff"}}>Hola, {UA.nombre} 👋</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.8)",marginBottom:12}}>¿Qué necesitás hoy?</div>
            <div style={{display:"flex",gap:10}}>{[{n:misSols.filter(s=>s.estado==="activa").length,l:"Activas"},{n:misSols.filter(s=>s.estado==="en_curso").length,l:"En curso"},{n:usuarios.filter(u=>u.tipo==="fletyer").length,l:"Fletyers"}].map(x=><div key={x.l} style={{flex:1,background:"rgba(255,255,255,0.2)",borderRadius:12,padding:"8px",textAlign:"center"}}><div style={{fontSize:18,fontWeight:900,color:"#fff"}}>{x.n}</div><div style={{fontSize:10,color:"rgba(255,255,255,0.8)"}}>{x.l}</div></div>)}</div>
          </div>
          <div style={{display:"flex",gap:10,marginBottom:14}}>
            <button style={{...st.btn(GRAD),flex:1,marginBottom:0,flexDirection:"column",display:"flex",alignItems:"center",padding:"16px 0",gap:4,fontSize:13}} onClick={()=>{setNuevaSol(p=>({...p,tipo:"mudanza"}));setTab("nueva-sol");}}><span style={{fontSize:26}}>🏠</span>Mudanza</button>
            <button style={{...st.btn(GRAD_B),flex:1,marginBottom:0,flexDirection:"column",display:"flex",alignItems:"center",padding:"16px 0",gap:4,fontSize:13}} onClick={()=>{setNuevaSol(p=>({...p,tipo:"flete"}));setTab("nueva-sol");}}><span style={{fontSize:26}}>📦</span>Pedir Flete</button>
          </div>
          <div style={{fontSize:16,fontWeight:800,color:C.text,marginBottom:10}}>Solicitudes recientes</div>
          {misSols.slice(0,3).map(sol=>{const e=eLabel(sol.estado);const nOf=Object.keys(sol.ofertasFletyer||{}).length;return<div key={sol.id} style={{...st.card,padding:14}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span><span style={st.tag(e.col)}>{e.label}</span></div><div style={{fontSize:13}}>📍 {sol.origen}</div><div style={{fontSize:13}}>🏁 {sol.destino}</div>{nOf>0&&<div style={{fontSize:12,color:C.cyan,marginTop:4,fontWeight:600}}>💬 {nOf} oferta(s) recibida(s)</div>}</div>;})}
        </div>
        <TabBar/>
      </div>
    );
  }

  // ─── SOLICITUDES CLIENTE ──────────────────────────────────────────────
  if (tab==="solicitudes" && TU==="cliente") {
    const misSols = solicitudes.filter(s=>s.clienteId===UA.id);
    return (
      <div style={st.wrap}>
        <div style={st.header}><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>FLETY</span></div><button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button></div>
        <div style={st.cont}>
          <div style={{fontSize:16,fontWeight:800,marginBottom:10}}>Mis solicitudes ({misSols.length})</div>
          {misSols.length===0&&<div style={{...st.card,textAlign:"center",color:C.muted}}>Aún no tenés solicitudes.</div>}
          {misSols.map(sol=>{const e=eLabel(sol.estado);const chatsKeys=Object.keys(sol.chats||{});return(
            <div key={sol.id} style={st.card}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,alignItems:"center"}}>
                <span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={st.tag(e.col)}>{e.label}</span>
                  {sol.estado==="activa"&&<button onClick={()=>eliminarSolicitud(sol.id)} style={{background:"none",border:`1.5px solid ${C.danger}`,borderRadius:8,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:C.danger,fontSize:14}}>🗑️</button>}
                </div>
              </div>
              <MiniMapa origen={sol.origen} destino={sol.destino}/>
              <div style={{fontSize:13}}>📍 {sol.origen}</div><div style={{fontSize:13}}>🏁 {sol.destino}</div>
              {sol.descripcion&&<div style={{fontSize:12,color:C.muted,marginTop:4,fontStyle:"italic"}}>"{sol.descripcion}"</div>}
              {sol.estado==="finalizado"&&<ResumenViaje sol={sol} comisionPct={comisionPct} mostrarComision={false}/>}
              <div style={{fontSize:12,color:C.muted,marginTop:6}}>💬 {chatsKeys.length} Fletyer(s) contactaron</div>
              {sol.estado==="en_curso"&&!sol.viajeInicio&&<button style={{...st.btnOut(C.warning),color:C.warning,marginTop:8}} onClick={()=>cancelarViaje(sol.id)}>↩️ Cancelar viaje</button>}
              {sol.estado==="finalizado"&&!sol.calificado&&<button style={{...st.btn(C.warning),marginTop:8}} onClick={()=>setModalCal({solId:sol.id,fid:sol.fleteroAceptado})}>⭐ Calificar al Fletyer</button>}
              {chatsKeys.map(fid=>{const fl=usuarios.find(u=>u.id===fid);const acept=sol.fleteroAceptado===fid;const of=sol.ofertasFletyer?.[fid];const p=promEst(fl?.calificaciones);return(
                <div key={fid} style={{display:"flex",alignItems:"center",gap:8,marginTop:8,padding:"10px",background:"#F0FAFA",borderRadius:12}}>
                  <button onClick={()=>setVerPerfil(fid)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Avatar u={fl} size={36}/></button>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.blue}}>{fl?.nombre}</div>
                    <div style={{display:"flex",alignItems:"center",gap:4}}><Estrellas valor={Math.round(parseFloat(p))} size={13}/>{p>0&&<span style={{fontSize:11,color:C.muted}}>{p}</span>}</div>
                    {of&&<div style={{fontSize:13,fontWeight:800,color:sol.tipo==="mudanza"?C.blue:C.cyan}}>{formatUYU(of.precio)}{sol.tipo==="mudanza"?"/h":""}</div>}
                  </div>
                  {acept&&<span style={st.tag(C.success)}>✅</span>}
                  <button style={{...st.btn(acept?C.success:GRAD,0),width:"auto",padding:"6px 14px",fontSize:12}} onClick={()=>setChatActivo({solId:sol.id,fid})}>Chat</button>
                </div>
              );})}
            </div>
          );})}
        </div>
        <TabBar/>
      </div>
    );
  }

  // ─── INICIO FLETYER ───────────────────────────────────────────────────
  if (tab==="inicio" && TU==="fletyer") {
    const vKey = UA.vehiculoKey||detectarVehiculoKey(UA.vehiculo);
    const tarifa = getTarifa(vKey, tarifas);
    const uReal = usuarios.find(u=>u.id===UA.id)||UA;
    const habilitado = uReal.habilitado===true;
    const activas = solicitudes.filter(s=>s.estado==="activa");
    return (
      <div style={st.wrap}>
        <div style={st.header}><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>FLETY</span></div><button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button></div>
        <div style={st.cont}>
          <div style={{...st.card,background:GRAD_B,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div><div style={{fontWeight:700,color:"#fff"}}>Hola, {UA.nombre} 🚚</div><div style={{fontSize:13,color:"rgba(255,255,255,0.8)"}}>{tarifa.icon} {UA.vehiculo||"Sin vehículo"}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>Tarifas sugeridas</div><div style={{fontSize:14,fontWeight:800,color:"#fff"}}>{formatUYU(tarifa.kmRate)}/km</div><div style={{fontSize:12,color:"rgba(255,255,255,0.8)"}}>{formatUYU(tarifa.hrRate)}/hora</div></div>
            </div>
          </div>
          {!habilitado?(
            <div style={{...st.card,textAlign:"center",padding:"28px 20px",border:`2px solid ${C.warning}55`}}>
              <div style={{fontSize:36,marginBottom:12}}>🔒</div>
              <div style={{fontSize:16,fontWeight:800,color:C.warning,marginBottom:8}}>Cuenta pendiente de activación</div>
              <div style={{fontSize:13,color:C.muted,lineHeight:1.6,marginBottom:16}}>El equipo de FLETY debe verificar tu documentación antes de que puedas operar.<br/><br/>Subí en <strong>"Mi Cuenta"</strong>:<br/>✅ Libreta de conducir<br/>✅ Cédula de identidad</div>
              <button style={st.btn(GRAD_B)} onClick={()=>setTab("cuenta")}>📋 Ir a Mi Cuenta</button>
            </div>
          ):(
            <>
              <div style={{fontSize:16,fontWeight:800,marginBottom:10}}>Solicitudes disponibles ({activas.length})</div>
              {activas.length===0&&<div style={{...st.card,textAlign:"center",color:C.muted}}>No hay solicitudes activas.</div>}
              {activas.map(sol=>{
                const cl = usuarios.find(u=>u.id===sol.clienteId);
                const miOf = sol.ofertasFletyer?.[UA.id];
                const hayChat = !!(sol.chats?.[UA.id]?.length);
                const dist = sol.distancia||0;
                const estKm = Math.round(dist*tarifa.kmRate);
                const estHr = tarifa.hrRate;
                return (
                  <div key={sol.id} style={st.card}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span><span style={st.tag(C.success)}>● Disponible</span></div>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <button onClick={()=>setVerPerfil(cl?.id)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Avatar u={cl} size={28}/></button>
                      <span style={{fontSize:14,fontWeight:700,color:C.blue}}>{sol.clienteNombre}</span>
                      <span style={{fontSize:11,color:C.muted,marginLeft:"auto"}}>📅 {sol.fecha}</span>
                    </div>
                    <MiniMapa origen={sol.origen} destino={sol.destino}/>
                    <div style={{fontSize:13}}>📍 {sol.origen}</div><div style={{fontSize:13}}>🏁 {sol.destino}</div>
                    {sol.descripcion&&<div style={{fontSize:12,color:C.muted,marginTop:4,fontStyle:"italic"}}>"{sol.descripcion}"</div>}
                    <div style={{fontSize:12,marginTop:4}}>📞 {sol.clienteTelefono}</div>
                    <div style={{background:`${C.blue}09`,borderRadius:10,padding:"8px 12px",marginTop:8,marginBottom:8}}>
                      <div style={{fontSize:11,color:C.blue,fontWeight:700,marginBottom:4}}>📊 Tu referencia ({tarifa.icon} {tarifa.label})</div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span style={{color:C.muted}}>{sol.tipo==="mudanza"?"Sugerido/hora:":"Sugerido/flete:"}</span><span style={{fontWeight:700,color:C.blue}}>{sol.tipo==="mudanza"?formatUYU(estHr)+"/h":formatUYU(estKm)}</span></div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginTop:2}}><span style={{color:C.muted}}>Recibís (−{comisionPct}%):</span><span style={{color:C.success,fontWeight:700}}>{sol.tipo==="mudanza"?formatUYU(Math.round(estHr*(1-comisionPct/100)))+"/h":formatUYU(Math.round(estKm*(1-comisionPct/100)))}</span></div>
                    </div>
                    {!miOf?(
                      <div style={{background:`${C.warning}10`,border:`1.5px solid ${C.warning}33`,borderRadius:12,padding:"12px 14px",marginBottom:8}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.warning,marginBottom:8}}>{sol.tipo==="mudanza"?"⚡ Ingresá tu precio por hora":"⚡ Ingresá tu precio total"}</div>
                        <div style={{display:"flex",gap:8}}><div style={{position:"relative",flex:1}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontWeight:700,color:C.blue}}>$</span><input type="number" min="0" style={{...st.input,marginBottom:0,paddingLeft:24,fontWeight:700}} placeholder={sol.tipo==="mudanza"?String(estHr):String(estKm)} value={getPI(sol.id)} onChange={e=>setPI(sol.id,e.target.value)}/></div><button style={st.btnSm(GRAD_B)} disabled={!getPI(sol.id)||parseFloat(getPI(sol.id))<=0} onClick={()=>ofertarPrecio(sol.id,getPI(sol.id))}>Ofertar</button></div>
                        <div style={{fontSize:11,color:C.muted,marginTop:5}}>Al publicar tu precio se enviará al cliente automáticamente.</div>
                      </div>
                    ):(
                      <div style={{background:`${C.success}12`,border:`1.5px solid ${C.success}33`,borderRadius:12,padding:"10px 14px",marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><span style={{fontSize:12,color:C.muted,fontWeight:700}}>✅ Tu oferta:</span><span style={{fontSize:18,fontWeight:900,color:C.success}}>{formatUYU(miOf.precio)}{sol.tipo==="mudanza"?"/h":""}</span></div>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{position:"relative",flex:1}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontWeight:700,color:C.blue}}>$</span><input type="number" min="0" style={{...st.input,marginBottom:0,paddingLeft:24,fontSize:13}} placeholder="Nuevo precio..." value={getPI(sol.id)} onChange={e=>setPI(sol.id,e.target.value)}/></div><button style={st.btnSm(`linear-gradient(135deg,${C.warning},#e0a000)`)} disabled={!getPI(sol.id)||parseFloat(getPI(sol.id))<=0} onClick={()=>modificarOferta(sol.id,getPI(sol.id))}>Modificar</button></div>
                      </div>
                    )}
                    <button style={{...st.btn(hayChat?GRAD:GRAD_B),marginTop:2,marginBottom:0}} onClick={()=>setChatActivo({solId:sol.id,fid:String(UA.id)})}>{hayChat?"💬 Ver mi chat":"💬 Abrir chat con cliente"}</button>
                  </div>
                );
              })}
            </>
          )}
        </div>
        <TabBar/>
      </div>
    );
  }

  // ─── MIS TRABAJOS FLETYER ─────────────────────────────────────────────
  if (tab==="solicitudes" && TU==="fletyer") {
    const misTrab = solicitudes.filter(s=>(s.estado==="en_curso"||s.estado==="finalizado")&&s.fleteroAceptado===UA.id);
    return (
      <div style={st.wrap}>
        <div style={st.header}><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>FLETY</span></div><button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button></div>
        <div style={st.cont}>
          <div style={{fontSize:16,fontWeight:800,marginBottom:10}}>Mis trabajos</div>
          {misTrab.length===0&&<div style={{...st.card,textAlign:"center",color:C.muted}}>Aún no tenés trabajos asignados.</div>}
          {misTrab.map(sol=>{const e=eLabel(sol.estado);const cl=usuarios.find(u=>u.id===sol.clienteId);return(
            <div key={sol.id} style={{...st.card,borderLeft:`4px solid ${e.col}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span><span style={st.tag(e.col)}>{e.label}</span></div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><Avatar u={cl} size={28}/><span style={{fontSize:14,fontWeight:700,color:C.blue}}>{sol.clienteNombre}</span></div>
              <MiniMapa origen={sol.origen} destino={sol.destino}/>
              <div style={{fontSize:13}}>📍 {sol.origen}</div><div style={{fontSize:13}}>🏁 {sol.destino}</div>
              {sol.precioFletyer&&<div style={{background:sol.tipo==="mudanza"?`${C.blue}12`:`${C.cyan}12`,borderRadius:10,padding:"8px 12px",marginTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:12,color:C.muted,fontWeight:700}}>{sol.tipo==="mudanza"?"💰 Tu precio/h":"💰 Precio acordado"}</span><span style={{fontSize:17,fontWeight:900,color:sol.tipo==="mudanza"?C.blue:C.cyan}}>{formatUYU(sol.precioFletyer)}{sol.tipo==="mudanza"?"/h":""}</span></div>}
              {sol.estado==="finalizado"&&<ResumenViaje sol={sol} comisionPct={comisionPct}/>}
              <button style={{...st.btn(GRAD,8),marginTop:10}} onClick={()=>setChatActivo({solId:sol.id,fid:String(UA.id)})}>💬 Chat</button>
              {sol.estado==="en_curso"&&!sol.viajeInicio&&<button style={{...st.btnOut(C.warning),color:C.warning,marginBottom:0}} onClick={()=>cancelarViaje(sol.id)}>↩️ Cancelar trabajo</button>}
            </div>
          );})}
        </div>
        <TabBar/>
      </div>
    );
  }

  // ─── MI CUENTA ────────────────────────────────────────────────────────
  if (tab==="cuenta") {
    const campos = TU==="cliente"?["nombre","edad","direccion","telefono"]:["nombre","edad","direccion","telefono","vehiculo"];
    const uAct = usuarios.find(u=>u.id===UA.id)||UA;
    const vKey = uAct.vehiculoKey||detectarVehiculoKey(uAct.vehiculo);
    const tarifa = TU==="fletyer" ? getTarifa(vKey,tarifas) : null;
    const finalizados = TU==="fletyer" ? solicitudes.filter(s=>s.estado==="finalizado"&&s.fleteroAceptado===UA.id) : [];
    const finCliente = TU==="cliente" ? solicitudes.filter(s=>s.estado==="finalizado"&&s.clienteId===UA.id) : [];
    const totalB = finalizados.reduce((a,s)=>a+costoViaje(s),0);
    const totalC = finalizados.reduce((a,s)=>a+Math.round(costoViaje(s)*(comisionPct/100)),0);
    return (
      <div style={st.wrap}>
        <div style={st.header}><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>FLETY</span></div><button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button></div>
        <div style={st.cont}>
          <div style={{...st.card,background:GRAD,borderRadius:"18px 18px 0 0",padding:"28px 18px 20px",marginBottom:0}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
              <div style={{position:"relative"}}>
                <Avatar u={uAct} size={84}/>
                <button onClick={()=>fotoRef.current.click()} style={{position:"absolute",bottom:0,right:0,background:C.blue,border:"none",borderRadius:"50%",width:28,height:28,color:"#fff",cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>{subiendo?"⏳":"📷"}</button>
                <input ref={fotoRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleImg("foto",e)}/>
              </div>
              <div style={{textAlign:"center"}}><div style={{fontWeight:800,fontSize:19,color:"#fff"}}>{uAct.nombre}</div><span style={{background:"rgba(255,255,255,0.25)",color:"#fff",borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700}}>{TU==="cliente"?"🏠 Cliente":"🚚 Fletyer"}</span></div>
              {TU==="fletyer"&&<div style={{display:"flex",alignItems:"center",gap:6}}><Estrellas valor={Math.round(parseFloat(promEst(uAct.calificaciones)))} size={18}/><span style={{color:"#fff",fontWeight:700,fontSize:13}}>{promEst(uAct.calificaciones)>0?`${promEst(uAct.calificaciones)} (${uAct.calificaciones?.length})`:"Sin calificaciones"}</span></div>}
            </div>
          </div>
          <div style={{...st.card,borderRadius:"0 0 18px 18px",paddingTop:20}}>
            {!editMode?(<>{campos.map(c=><div key={c} style={{borderBottom:`1px solid ${C.cyan}22`,paddingBottom:10,marginBottom:10}}><div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{c==="vehiculo"?"Vehículo":c}</div><div style={{fontSize:15,fontWeight:600,marginTop:2}}>{uAct[c]||"—"}</div></div>)}<button style={st.btn(GRAD)} onClick={()=>{setEditData({...uAct});setEditMode(true);}}>✏️ Editar datos</button></>)
            :(<>{campos.map(c=><div key={c}><label style={st.label}>{c==="vehiculo"?"Vehículo":c.charAt(0).toUpperCase()+c.slice(1)}</label><input style={st.input} value={editData[c]||""} onChange={e=>setEditData(p=>({...p,[c]:e.target.value}))}/></div>)}<div style={{display:"flex",gap:10}}><button style={{...st.btn(C.success),flex:1}} onClick={guardarEdicion}>Guardar</button><button style={{...st.btn(C.muted),flex:1}} onClick={()=>setEditMode(false)}>Cancelar</button></div></>)}
          </div>
          {TU==="fletyer"&&tarifa&&<div style={st.card}><div style={{fontSize:14,fontWeight:700,marginBottom:10}}>💰 Mis tarifas</div><div style={{display:"flex",gap:10}}><div style={{flex:1,background:`${C.cyan}12`,borderRadius:12,padding:"10px",textAlign:"center"}}><div style={{fontSize:11,color:C.muted}}>Por km</div><div style={{fontSize:18,fontWeight:800,color:C.cyan}}>{formatUYU(tarifa.kmRate)}</div></div><div style={{flex:1,background:`${C.blue}12`,borderRadius:12,padding:"10px",textAlign:"center"}}><div style={{fontSize:11,color:C.muted}}>Por hora</div><div style={{fontSize:18,fontWeight:800,color:C.blue}}>{formatUYU(tarifa.hrRate)}</div></div></div><div style={{fontSize:11,color:C.muted,marginTop:8,textAlign:"center"}}>{tarifa.icon} {tarifa.label} · comisión Flety: {comisionPct}%</div></div>}
          {TU==="fletyer"&&(()=>{
            const est=(() => {if(!uAct.libretaHasta)return{label:"Sin datos",col:C.muted};const d=Math.round((new Date(uAct.libretaHasta)-new Date())/(1000*60*60*24));return d<0?{label:"⛔ Vencida",col:C.danger}:d<60?{label:`⚠️ Vence en ${d}d`,col:C.warning}:{label:"✅ Vigente",col:C.success};})();
            return <div style={st.card}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}><span style={{fontSize:18}}>🔒</span><div><div style={{fontSize:14,fontWeight:800}}>Documentos privados</div><div style={{fontSize:11,color:C.muted}}>Solo vos y el Admin los ven</div></div></div>
              <div style={{borderBottom:`1px solid ${C.cyan}20`,paddingBottom:14,marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontSize:13,fontWeight:700}}>🪪 Libreta de conducir</div><span style={st.tag(est.col)}>{est.label}</span></div>
                <div style={{display:"flex",gap:10,marginBottom:10}}>
                  <div style={{flex:1}}><label style={st.label}>Desde</label><input type="date" style={{...st.input,marginBottom:0}} value={uAct.libretaDesde||""} onChange={async e=>await updateDoc(doc(db,"usuarios",UA.id),{libretaDesde:e.target.value})}/></div>
                  <div style={{flex:1}}><label style={st.label}>Hasta</label><input type="date" style={{...st.input,marginBottom:0}} value={uAct.libretaHasta||""} onChange={async e=>await updateDoc(doc(db,"usuarios",UA.id),{libretaHasta:e.target.value})}/></div>
                </div>
                <label style={st.label}>Imagen de libreta</label>
                {uAct.libretaImg?<div style={{position:"relative",marginBottom:4}}><img src={uAct.libretaImg} alt="Libreta" style={{width:"100%",borderRadius:10,maxHeight:140,objectFit:"cover"}}/><button onClick={()=>libRef.current.click()} style={{position:"absolute",top:6,right:6,...st.btnSm(GRAD_B)}}>📷 Cambiar</button></div>:<button onClick={()=>libRef.current.click()} style={{...st.btnOut(C.cyan),marginBottom:4,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><span>📷</span> Subir imagen</button>}
                <input ref={libRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleImg("libretaImg",e)}/>
              </div>
              <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>🪪 Cédula de identidad</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[{campo:"cedulaFrente",ref:ciARef,label:"Frente"},{campo:"cedulaDorso",ref:ciBRef,label:"Dorso"}].map(({campo,ref,label})=>(
                  <div key={campo}>
                    <label style={st.label}>{label}</label>
                    {uAct[campo]?<div style={{position:"relative"}}><img src={uAct[campo]} alt={label} style={{width:"100%",borderRadius:10,height:90,objectFit:"cover"}}/><button onClick={()=>ref.current.click()} style={{position:"absolute",bottom:4,right:4,...st.btnSm(GRAD_B),fontSize:10,padding:"4px 8px"}}>📷</button></div>
                    :<button onClick={()=>ref.current.click()} style={{width:"100%",height:80,borderRadius:10,border:`2px dashed ${C.cyan}66`,background:`${C.cyan}08`,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,color:C.cyan,fontWeight:700,fontSize:12}}><span style={{fontSize:20}}>📷</span>Subir {label.toLowerCase()}</button>}
                    <input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleImg(campo,e)}/>
                  </div>
                ))}
              </div>
              <div style={{fontSize:11,color:C.muted,marginTop:8,textAlign:"center"}}>🔒 Solo el equipo de FLETY verá estos documentos</div>
            </div>;
          })()}
          {TU==="fletyer"&&<div style={st.card}><div style={{fontSize:14,fontWeight:700,marginBottom:12}}>📊 Mi historial</div>{finalizados.length===0?<div style={{textAlign:"center",color:C.muted,fontSize:13}}>Sin viajes finalizados.</div>:<>{finalizados.map(s=>{const c=costoViaje(s),com=Math.round(c*(comisionPct/100));return<div key={s.id} style={{borderBottom:`1px solid ${C.cyan}18`,paddingBottom:10,marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:13,fontWeight:600}}>{s.tipo==="mudanza"?"🏠 Mudanza":"📦 Flete"}</div><div style={{fontSize:11,color:C.muted}}>{s.fecha}</div>{s.tiempoTotal&&<div style={{fontSize:11,color:C.muted}}>⏱ {formatTiempo(s.tiempoTotal)}</div>}</div><div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:800,color:C.success}}>{formatUYU(c-com)}</div><div style={{fontSize:11,color:C.danger}}>−{formatUYU(com)} Flety</div></div></div></div>;})}<div style={{background:GRAD_B,borderRadius:14,padding:14,marginTop:4}}><div style={{display:"flex",gap:8}}><div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>Bruto</div><div style={{fontSize:15,fontWeight:800,color:"#fff"}}>{formatUYU(totalB)}</div></div><div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>Com.Flety</div><div style={{fontSize:15,fontWeight:800,color:"#FFB800"}}>−{formatUYU(totalC)}</div></div><div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>Recibís</div><div style={{fontSize:15,fontWeight:800,color:"#7FFFD4"}}>{formatUYU(totalB-totalC)}</div></div></div></div></>}</div>}
          {TU==="cliente"&&finCliente.length>0&&<div style={st.card}><div style={{fontSize:14,fontWeight:700,marginBottom:12}}>📊 Mi historial</div>{finCliente.map(s=>{const c=costoViaje(s);const fl=usuarios.find(u=>u.id===s.fleteroAceptado);return<div key={s.id} style={{borderBottom:`1px solid ${C.cyan}18`,paddingBottom:10,marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:13,fontWeight:600}}>{s.tipo==="mudanza"?"🏠 Mudanza":"📦 Flete"}</div><div style={{fontSize:11,color:C.muted}}>{s.fecha} · {fl?.nombre}</div></div><div style={{fontSize:14,fontWeight:800,color:C.blue}}>{formatUYU(c)}</div></div></div>;})} <div style={{display:"flex",justifyContent:"space-between",borderTop:`1px solid ${C.cyan}22`,paddingTop:10}}><span style={{fontWeight:700}}>Total pagado</span><span style={{fontSize:15,fontWeight:800,color:C.blue}}>{formatUYU(finCliente.reduce((a,s)=>a+costoViaje(s),0))}</span></div></div>}
          {TU==="fletyer"&&uAct.calificaciones?.length>0&&<div style={st.card}><div style={{fontWeight:800,marginBottom:12}}>⭐ Mis reseñas</div>{uAct.calificaciones.map((c,i)=><div key={i} style={{borderBottom:`1px solid ${C.cyan}22`,paddingBottom:10,marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between"}}><Estrellas valor={c.estrellas} size={15}/><span style={{fontSize:12,color:C.muted}}>— {c.cliente}</span></div>{c.comentario&&<div style={{fontSize:13,fontStyle:"italic",marginTop:4}}>"{c.comentario}"</div>}</div>)}</div>}
        </div>
        <TabBar/>
      </div>
    );
  }

  // ─── ADMIN SOLICITUDES ────────────────────────────────────────────────
  if (tab==="admin-sols") {
    const fins = solicitudes.filter(s=>s.estado==="finalizado");
    const pendiente = fins.filter(s=>!s.comisionPagada).reduce((a,s)=>a+Math.round(costoViaje(s)*(comisionPct/100)),0);
    return (
      <div style={st.wrap}>
        <div style={st.header}><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>Admin</span></div><button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button></div>
        <div style={st.cont}>
          <div style={{display:"flex",gap:10,marginBottom:14}}>{[{l:"Solicitudes",v:solicitudes.length,c:C.cyan},{l:"Clientes",v:usuarios.filter(u=>u.tipo==="cliente").length,c:C.blue},{l:"Fletyers",v:usuarios.filter(u=>u.tipo==="fletyer").length,c:C.blue}].map(x=><div key={x.l} style={{...st.card,flex:1,textAlign:"center",marginBottom:0,padding:14}}><div style={{fontSize:22,fontWeight:800,color:x.c}}>{x.v}</div><div style={{fontSize:11,color:C.muted}}>{x.l}</div></div>)}</div>
          {fins.length>0&&<div style={st.card}><div style={{fontSize:14,fontWeight:800,marginBottom:10}}>💰 Comisiones pendientes</div>
            {fins.map(sol=>{const fl=usuarios.find(u=>u.id===sol.fleteroAceptado);const c=costoViaje(sol);const com=Math.round(c*(comisionPct/100));return<div key={sol.id} style={{borderBottom:`1px solid ${C.cyan}18`,paddingBottom:10,marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{fontSize:13,fontWeight:700}}>{fl?.nombre||"—"}</div><div style={{fontSize:11,color:C.muted}}>{sol.clienteNombre} · {sol.fecha}</div><div style={{fontSize:12}}>Total: <b style={{color:C.success}}>{formatUYU(c)}</b></div></div><div style={{textAlign:"right",flexShrink:0}}>{sol.comisionPagada?<span style={st.tag(C.success)}>✅ Pagada</span>:<><div style={{fontSize:15,fontWeight:800,color:C.danger}}>−{formatUYU(com)}</div><button style={{...st.btnSm(C.success),marginTop:6}} onClick={()=>marcarPagada(sol.id)}>Marcar pagada</button></>}</div></div></div>;})}
            <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${C.cyan}22`}}><span style={{fontWeight:700}}>Total pendiente:</span><span style={{fontSize:18,fontWeight:900,color:C.danger}}>{formatUYU(pendiente)}</span></div>
          </div>}
          <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>📋 Todas las solicitudes</div>
          {solicitudes.map(sol=>{const e=eLabel(sol.estado);const c=costoViaje(sol);const com=Math.round(c*(comisionPct/100));return<div key={sol.id} style={st.card}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span><span style={st.tag(e.col)}>{e.label}</span></div><div style={{fontSize:13,fontWeight:700}}>{sol.clienteNombre}</div><div style={{fontSize:12,color:C.muted}}>{sol.origen} → {sol.destino}</div>{c>0&&<div style={{display:"flex",gap:8,marginTop:8}}><div style={{flex:1,background:`${C.cyan}12`,borderRadius:10,padding:"6px",textAlign:"center"}}><div style={{fontSize:10,color:C.muted}}>Costo</div><div style={{fontSize:14,fontWeight:800,color:C.cyan}}>{formatUYU(c)}</div></div><div style={{flex:1,background:`${C.success}12`,borderRadius:10,padding:"6px",textAlign:"center"}}><div style={{fontSize:10,color:C.muted}}>Comisión</div><div style={{fontSize:14,fontWeight:800,color:C.success}}>{formatUYU(com)}</div></div></div>}{Object.keys(sol.chats||{}).map(fid=>{const fl=usuarios.find(u=>u.id===fid);return<div key={fid} style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}><span style={{fontSize:13}}>🚚 {fl?.nombre}</span><span style={{fontSize:12,color:C.muted}}>({(sol.chats[fid]||[]).length} msgs)</span><button style={{...st.btnSm(GRAD),marginLeft:"auto"}} onClick={()=>setChatActivo({solId:sol.id,fid})}>Ver</button></div>;})} {Object.keys(sol.chats||{}).length===0&&<div style={{fontSize:12,color:C.muted,marginTop:6}}>Sin chats aún.</div>}</div>;})}
        </div>
        <TabBar/>
      </div>
    );
  }

  // ─── ADMIN USUARIOS ───────────────────────────────────────────────────
  if (tab==="admin-users") {
    return (
      <div style={st.wrap}>
        <div style={st.header}><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>Admin</span></div><button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button></div>
        <div style={st.cont}>
          {usuarios.filter(u=>u.tipo!=="admin").map(u=>{
            const p=promEst(u.calificaciones);
            const vKey=u.vehiculoKey||detectarVehiculoKey(u.vehiculo||"");
            const tarifa=u.tipo==="fletyer"?getTarifa(vKey,tarifas):null;
            const viajes=u.tipo==="fletyer"?solicitudes.filter(s=>s.estado==="finalizado"&&s.fleteroAceptado===u.id):[];
            const vB=viajes.reduce((a,s)=>a+costoViaje(s),0);
            const vC=viajes.reduce((a,s)=>a+Math.round(costoViaje(s)*(comisionPct/100)),0);
            return (
              <div key={u.id} style={st.card}>
                <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:10}}><Avatar u={u} size={44}/><div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>{u.nombre}</div><span style={st.tag(u.tipo==="cliente"?C.cyan:C.blue)}>{u.tipo==="cliente"?"🏠 Cliente":"🚚 Fletyer"}</span></div>{u.tipo==="fletyer"&&<div style={{textAlign:"right"}}><Estrellas valor={Math.round(parseFloat(p))} size={13}/><div style={{fontSize:11,color:C.muted}}>{p>0?`${p} (${u.calificaciones?.length})`:"Sin calif."}</div></div>}</div>
                <div style={{fontSize:13,color:C.muted}}>📍 {u.direccion} · 📞 {u.telefono}</div>
                {u.tipo==="fletyer"&&<>
                  <div style={{borderTop:`1px solid ${C.cyan}22`,margin:"10px 0"}}/>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,background:u.habilitado?`${C.success}12`:`${C.danger}10`,borderRadius:12,padding:"10px 14px",border:`1.5px solid ${u.habilitado?C.success:C.danger}33`}}>
                    <div><div style={{fontSize:13,fontWeight:700,color:u.habilitado?C.success:C.danger}}>{u.habilitado?"✅ Habilitado":"🔒 Deshabilitado"}</div><div style={{fontSize:11,color:C.muted}}>{u.habilitado?"Puede operar":"No puede ver solicitudes"}</div></div>
                    <button onClick={()=>toggleHabilitar(u.id)} style={st.btnSm(u.habilitado?C.danger:C.success)}>{u.habilitado?"Deshabilitar":"Habilitar"}</button>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>🚗 Tipo de vehículo</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>{Object.entries(tarifas).map(([k,t])=><button key={k} onClick={()=>asignarVehiculo(u.id,k)} style={{padding:"5px 10px",borderRadius:10,border:`2px solid ${vKey===k?C.blue:"#ddd"}`,background:vKey===k?C.blue+"18":"#fff",color:vKey===k?C.blue:C.muted,fontSize:12,fontWeight:700,cursor:"pointer"}}>{t.icon} {t.label}</button>)}</div>
                  {tarifa&&<div style={{fontSize:12,color:C.muted,marginBottom:10}}>Ref: {formatUYU(tarifa.kmRate)}/km · {formatUYU(tarifa.hrRate)}/h</div>}
                  <div style={{borderTop:`1px solid ${C.cyan}18`,paddingTop:10}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.blue,marginBottom:8}}>🔒 Documentos</div>
                    <div style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><span style={{fontSize:12,fontWeight:600}}>🪪 Libreta</span>{u.libretaHasta?(()=>{const d=Math.round((new Date(u.libretaHasta)-new Date())/(1000*60*60*24));return<span style={st.tag(d<0?C.danger:d<60?C.warning:C.success)}>{d<0?"⛔ Vencida":d<60?`⚠️ ${d}d`:"✅ "+u.libretaHasta}</span>;})():<span style={st.tag(C.muted)}>Sin datos</span>}</div>{u.libretaImg?<img src={u.libretaImg} alt="Libreta" style={{width:"100%",borderRadius:8,maxHeight:90,objectFit:"cover"}}/>:<div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Sin imagen</div>}</div>
                    <div style={{fontSize:12,fontWeight:600,marginBottom:6}}>🪪 Cédula</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>{["cedulaFrente","cedulaDorso"].map(c=><div key={c}><div style={{fontSize:11,color:C.muted,marginBottom:2}}>{c==="cedulaFrente"?"Frente":"Dorso"}</div>{u[c]?<img src={u[c]} alt={c} style={{width:"100%",borderRadius:8,height:65,objectFit:"cover"}}/>:<div style={{height:65,borderRadius:8,background:"#F0F4FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:C.muted}}>Sin imagen</div>}</div>)}</div>
                  </div>
                  {viajes.length>0&&<div style={{marginTop:10}}><div style={{fontSize:12,fontWeight:700,marginBottom:6}}>📊 {viajes.length} viajes · {formatUYU(vB)} · <span style={{color:C.danger}}>Com: {formatUYU(vC)}</span></div>{viajes.map(s=>{const c=costoViaje(s);const com=Math.round(c*(comisionPct/100));return<div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"4px 0",borderBottom:`1px solid ${C.cyan}15`}}><span style={{color:C.muted}}>{s.fecha} · {s.tipo==="mudanza"?"🏠":"📦"} {s.clienteNombre?.split(" ")[0]}</span><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontWeight:700}}>{formatUYU(c)}</span>{s.comisionPagada?<span style={st.tag(C.success)}>✅</span>:<button style={st.btnSm(C.success)} onClick={()=>marcarPagada(s.id)}>Pagar {formatUYU(com)}</button>}</div></div>;})}</div>}
                </>}
              </div>
            );
          })}
        </div>
        <TabBar/>
      </div>
    );
  }

  // ─── ADMIN CONFIG ─────────────────────────────────────────────────────
  if (tab==="admin-config") {
    return (
      <div style={st.wrap}>
        <div style={st.header}><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark/><span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:2}}>Config</span></div><button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button></div>
        <div style={st.cont}>
          <div style={st.card}>
            <div style={{fontSize:15,fontWeight:800,marginBottom:14}}>⚙️ Comisión Flety</div>
            <label style={st.label}>Porcentaje (%)</label>
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14}}><input type="number" min="0" max="50" step="0.5" style={{...st.input,marginBottom:0,flex:1,fontSize:20,fontWeight:800,textAlign:"center"}} value={editTar?comEdit:comisionPct} onChange={e=>{if(!editTar){setEditTar(true);setTarEdit({...tarifas});}setComEdit(parseFloat(e.target.value)||0);}}/><span style={{fontSize:20,fontWeight:800,color:C.blue}}>%</span></div>
            <div style={{background:`${C.cyan}10`,borderRadius:12,padding:"10px 14px",marginBottom:14}}><div style={{fontSize:12,color:C.muted}}>Con {editTar?comEdit:comisionPct}%, un viaje de $1.000 deja:</div><div style={{display:"flex",gap:10,marginTop:6}}><div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:C.muted}}>Fletyer</div><div style={{fontWeight:800,color:C.success}}>{formatUYU(1000*(1-(editTar?comEdit:comisionPct)/100))}</div></div><div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:C.muted}}>Flety</div><div style={{fontWeight:800,color:C.blue}}>{formatUYU(1000*(editTar?comEdit:comisionPct)/100)}</div></div></div></div>
          </div>
          <div style={st.card}>
            <div style={{fontSize:15,fontWeight:800,marginBottom:4}}>🚗 Tarifas por vehículo</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Referencias que ven los Fletyers al cotizar.</div>
            {Object.entries(editTar?tarEdit:tarifas).map(([k,t])=><div key={k} style={{borderBottom:`1px solid ${C.cyan}18`,paddingBottom:12,marginBottom:12}}><div style={{fontSize:13,fontWeight:700,marginBottom:8}}>{t.icon} {t.label}</div><div style={{display:"flex",gap:10}}><div style={{flex:1}}><label style={st.label}>UYU/km</label><input type="number" style={{...st.input,marginBottom:0,fontWeight:700}} value={editTar?(tarEdit[k]?.kmRate??t.kmRate):t.kmRate} onChange={e=>{if(!editTar){setEditTar(true);setTarEdit({...tarifas});}setTarEdit(p=>({...p,[k]:{...p[k],kmRate:parseFloat(e.target.value)||0}}));}}/></div><div style={{flex:1}}><label style={st.label}>UYU/hora</label><input type="number" style={{...st.input,marginBottom:0,fontWeight:700}} value={editTar?(tarEdit[k]?.hrRate??t.hrRate):t.hrRate} onChange={e=>{if(!editTar){setEditTar(true);setTarEdit({...tarifas});}setTarEdit(p=>({...p,[k]:{...p[k],hrRate:parseFloat(e.target.value)||0}}));}}/></div></div></div>)}
            {editTar&&<div style={{display:"flex",gap:10,marginTop:4}}><button style={{...st.btn(C.success),flex:1}} onClick={guardarTarifas}>💾 Guardar cambios</button><button style={{...st.btn(C.muted),flex:1}} onClick={()=>setEditTar(false)}>Cancelar</button></div>}
            {!editTar&&<div style={{fontSize:12,color:C.muted,textAlign:"center",marginTop:4}}>Editá cualquier campo para activar.</div>}
          </div>
        </div>
        <TabBar/>
      </div>
    );
  }

  return null;
}
