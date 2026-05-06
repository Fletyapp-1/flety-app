import { useState, useRef, useEffect } from "react";
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged,
} from "firebase/auth";
import {
  collection, doc, setDoc, getDoc, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
} from "firebase/firestore";

// ─── COLORES ───────────────────────────────────────────────────────────────
const C = {
  cyan:"#00D4D4", blue:"#3B4FE0", cyanL:"#00EFEF", blueL:"#5B6FFF",
  bg:"#F0FAFA", card:"#FFFFFF", text:"#1A2340", muted:"#7A90A4",
  success:"#00C48C", danger:"#FF5C7A", warning:"#FFB800",
};
const GRAD   = `linear-gradient(135deg,${C.cyan},${C.blue})`;
const GRAD_B = `linear-gradient(135deg,${C.blue},${C.blueL})`;

// ─── TARIFAS GLOBALES (editables por Admin) ────────────────────────────────
const TARIFAS_INIT = {
  moto:         { kmRate:35,  hrRate:350,  label:"Moto",          icon:"🛵" },
  auto:         { kmRate:55,  hrRate:550,  label:"Auto",          icon:"🚗" },
  camioneta:    { kmRate:80,  hrRate:900,  label:"Camioneta",     icon:"🛻" },
  camion:       { kmRate:120, hrRate:1400, label:"Camión",        icon:"🚚" },
  camionGrande: { kmRate:160, hrRate:1900, label:"Camión grande", icon:"🚛" },
};
const COMISION_INIT = 15; // %

// ─── HELPERS ──────────────────────────────────────────────────────────────
function getTarifa(vehiculoKey, tarifas) {
  return tarifas[vehiculoKey] || tarifas.camioneta;
}
function detectarVehiculoKey(vehiculo="") {
  const v = vehiculo.toLowerCase();
  if (v.includes("grande")||v.includes("3 ton")||v.includes("5 ton")) return "camionGrande";
  if (v.includes("camión")||v.includes("camion")||v.includes("1 ton")) return "camion";
  if (v.includes("camioneta")) return "camioneta";
  if (v.includes("auto")||v.includes("carro")||v.includes("sedan")) return "auto";
  if (v.includes("moto")) return "moto";
  return "camioneta";
}
function formatUYU(n) { return "$" + Math.round(n||0).toLocaleString("es-UY"); }
function formatTiempo(seg) {
  const h=Math.floor(seg/3600), m=Math.floor((seg%3600)/60), s=seg%60;
  if(h>0) return `${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function costoViaje(sol) {
  if (!sol.precioFletyer) return 0;
  if (sol.tipo==="mudanza" && sol.tiempoTotal) {
    return Math.round(sol.precioFletyer * (sol.tiempoTotal/3600));
  }
  return sol.precioFletyer;
}

// ─── DATOS INICIALES ──────────────────────────────────────────────────────
const initUsuarios = [
  {id:1,tipo:"fletyer",nombre:"Carlos Pérez",edad:38,direccion:"Pocitos, Montevideo",telefono:"099111222",vehiculo:"Camioneta 1 tonelada",vehiculoKey:"camioneta",pass:"1234",foto:null,calificaciones:[],habilitado:false,
    libretaDesde:"",libretaHasta:"",libretaImg:null,
    cedulaFrente:null,cedulaDorso:null},
  {id:2,tipo:"fletyer",nombre:"Diego Martínez",edad:45,direccion:"Malvín, Montevideo",telefono:"099333444",vehiculo:"Camión 3 toneladas",vehiculoKey:"camion",pass:"1234",foto:null,
    calificaciones:[{estrellas:5,comentario:"Excelente servicio!",cliente:"Laura"},{estrellas:4,comentario:"Muy puntual.",cliente:"Marcos"}],habilitado:true,
    libretaDesde:"",libretaHasta:"",libretaImg:null,
    cedulaFrente:null,cedulaDorso:null},
  {id:3,tipo:"cliente",nombre:"Ana López",edad:29,direccion:"Centro, Montevideo",telefono:"098000111",pass:"1234",foto:null,calificaciones:[]},
  {id:99,tipo:"admin",nombre:"Admin FLETY",pass:"admin123",foto:null},
];

// ─── GEOCODIFICACIÓN REAL (Nominatim / OpenStreetMap — gratis) ────────────
const geocodeCache = {};
const COORDS_FALLBACK = { lat:-34.9011, lng:-56.1645 };
async function geocodificar(direccion) {
  if (!direccion || direccion.trim().length < 3) return COORDS_FALLBACK;
  const key = direccion.trim().toLowerCase();
  if (geocodeCache[key]) return geocodeCache[key];
  try {
    const q = (direccion.includes("Uruguay") || direccion.includes("Montevideo"))
      ? direccion : `${direccion}, Montevideo, Uruguay`;
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { "Accept-Language": "es" } }
    );
    const data = await res.json();
    if (data?.[0]) {
      const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geocodeCache[key] = coords;
      return coords;
    }
  } catch(e) {}
  return COORDS_FALLBACK;
}

function distanciaHaversine(c1, c2) {
  const R = 6371;
  const dLat = (c2.lat-c1.lat)*Math.PI/180;
  const dLng = (c2.lng-c1.lng)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(c1.lat*Math.PI/180)*Math.cos(c2.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return parseFloat((R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toFixed(1));
}

function calcularDistancia(origen, destino) {
  const c1 = geocodeCache[origen?.trim().toLowerCase()] || COORDS_FALLBACK;
  const c2 = geocodeCache[destino?.trim().toLowerCase()] || COORDS_FALLBACK;
  return distanciaHaversine(c1, c2);
}

const initSolicitudes = [
  {id:1,clienteId:3,clienteNombre:"Ana López",clienteTelefono:"098000111",tipo:"mudanza",
   origen:"Rivera 1234, Montevideo",destino:"Agraciada 567, Montevideo",descripcion:"Mudanza de 2 ambientes.",
   fecha:"2026-04-20",estado:"activa",chats:{},ofertasFletyer:{},
   fleteroAceptado:null,calificado:false,distancia:3.2,
   viajeInicio:null,viajeFin:null,tiempoTotal:null,precioFletyer:null,comisionPagada:false},
];

// ─── ESTILOS ──────────────────────────────────────────────────────────────
const st = {
  wrap:{minHeight:"100vh",background:C.bg,fontFamily:"'Segoe UI',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",paddingBottom:72},
  header:{width:"100%",background:GRAD,color:"#fff",padding:"13px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",boxSizing:"border-box"},
  logoTxt:{fontSize:22,fontWeight:900,color:"#fff",letterSpacing:2},
  cont:{width:"100%",maxWidth:480,padding:"14px 13px",boxSizing:"border-box"},
  card:{background:C.card,borderRadius:18,padding:18,marginBottom:14,boxShadow:"0 3px 16px rgba(0,180,180,0.10)"},
  btn:(col=GRAD,mb=10)=>({background:col,color:"#fff",border:"none",borderRadius:12,padding:"12px 0",width:"100%",fontSize:14,fontWeight:700,cursor:"pointer",marginBottom:mb,transition:"opacity 0.15s"}),
  btnSm:(col=GRAD)=>({background:col,color:"#fff",border:"none",borderRadius:10,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}),
  btnOut:(col=C.cyan)=>({background:"transparent",color:col,border:`2px solid ${col}`,borderRadius:12,padding:"10px 0",width:"100%",fontSize:14,fontWeight:700,cursor:"pointer",marginBottom:10}),
  input:{width:"100%",padding:"11px 13px",borderRadius:12,border:`1.5px solid ${C.cyan}44`,fontSize:14,marginBottom:11,boxSizing:"border-box",outline:"none",background:"#F7FEFE"},
  inputSm:{padding:"8px 11px",borderRadius:10,border:`1.5px solid ${C.cyan}44`,fontSize:13,boxSizing:"border-box",outline:"none",background:"#F7FEFE"},
  textarea:{width:"100%",padding:"11px 13px",borderRadius:12,border:`1.5px solid ${C.cyan}44`,fontSize:14,marginBottom:11,boxSizing:"border-box",minHeight:80,resize:"vertical",outline:"none",background:"#F7FEFE"},
  label:{fontSize:11,color:C.muted,marginBottom:4,display:"block",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5},
  tag:(col=C.cyan)=>({background:col+"22",color:col,borderRadius:20,padding:"3px 10px",fontSize:12,fontWeight:700,display:"inline-block"}),
  title:{fontSize:18,fontWeight:800,color:C.text,marginBottom:4},
  sub:{fontSize:13,color:C.muted,marginBottom:16},
  tabBar:{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderTop:`2px solid ${C.cyan}33`,display:"flex",justifyContent:"space-around",padding:"6px 0 10px",zIndex:100,boxShadow:"0 -2px 12px rgba(0,180,180,0.10)"},
  tabBtn:(active)=>({flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,color:active?C.blue:C.muted,fontWeight:active?700:400,fontSize:10,padding:"4px 2px"}),
  divider:{borderTop:`1px solid ${C.cyan}22`,margin:"10px 0"},
};

// ─── SVG LOGOS ──────────────────────────────────────────────────────────
const LogoSVG=({size=48})=>(
  <svg width={size} height={size*1.1} viewBox="0 0 120 130" fill="none">
    <defs><linearGradient id="pg" x1="60" y1="0" x2="60" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#00D4D4"/><stop offset="100%" stopColor="#3B4FE0"/></linearGradient></defs>
    <path d="M60 0C38 0 20 18 20 40C20 65 60 100 60 100C60 100 100 65 100 40C100 18 82 0 60 0Z" fill="url(#pg)"/>
    <circle cx="60" cy="38" r="22" fill="white"/>
    <text x="60" y="46" textAnchor="middle" fontSize="24" fontWeight="900" fill="url(#pg)" fontFamily="Arial,sans-serif">F</text>
    <ellipse cx="60" cy="105" rx="18" ry="5" fill="#3B4FE0" opacity="0.18"/>
    <text x="60" y="125" textAnchor="middle" fontSize="22" fontWeight="900" fill="#00D4D4" fontFamily="Arial,sans-serif" letterSpacing="3">FLETY</text>
  </svg>
);
const LogoMark=({size=32})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <defs><linearGradient id="pg2" x1="50" y1="0" x2="50" y2="85" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#00D4D4"/><stop offset="100%" stopColor="#3B4FE0"/></linearGradient></defs>
    <path d="M50 2C30 2 14 18 14 38C14 60 50 88 50 88C50 88 86 60 86 38C86 18 70 2 50 2Z" fill="url(#pg2)"/>
    <circle cx="50" cy="36" r="18" fill="white"/>
    <text x="50" y="43" textAnchor="middle" fontSize="20" fontWeight="900" fill="url(#pg2)" fontFamily="Arial,sans-serif">F</text>
  </svg>
);

// ─── ESTRELLAS ─────────────────────────────────────────────────────────────
function Estrellas({valor,onChange,size=22}){
  const[hover,setHover]=useState(0);
  return(
    <div style={{display:"flex",gap:4}}>
      {[1,2,3,4,5].map(n=>(
        <span key={n} style={{fontSize:size,cursor:onChange?"pointer":"default",color:(hover||valor)>=n?"#FFB800":"#ddd"}}
          onMouseEnter={()=>onChange&&setHover(n)} onMouseLeave={()=>onChange&&setHover(0)}
          onClick={()=>onChange&&onChange(n)}>★</span>
      ))}
    </div>
  );
}
function promedioEstrellas(califs){
  if(!califs?.length)return 0;
  return(califs.reduce((a,c)=>a+c.estrellas,0)/califs.length).toFixed(1);
}

// ─── AVATAR ────────────────────────────────────────────────────────────────
function Avatar({u,size=52}){
  return(
    <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",background:GRAD,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`2.5px solid ${C.cyan}55`}}>
      {u?.foto?<img src={u.foto} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<span style={{fontSize:size*0.42,color:"#fff"}}>{u?.tipo==="fletyer"?"🚚":"👤"}</span>}
    </div>
  );
}

// ─── MAPA REAL CON LEAFLET + OPENSTREETMAP ────────────────────────────────
// Inyectar CSS de Leaflet una sola vez
let leafletCSSInjected = false;
function injectLeafletCSS() {
  if (leafletCSSInjected) return;
  leafletCSSInjected = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);
}

function MiniMapa({ origen, destino }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [coords, setCoords] = useState(null);
  const [dist, setDist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const mapId = useRef(`map-${Math.random().toString(36).slice(2)}`);

  // Geocodificar ambas direcciones cuando cambien
  useEffect(() => {
    if (!origen || !destino || origen.length < 5 || destino.length < 5) return;
    setLoading(true);
    setError(false);
    Promise.all([geocodificar(origen), geocodificar(destino)])
      .then(([c1, c2]) => {
        setCoords({ c1, c2 });
        setDist(distanciaHaversine(c1, c2));
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, [origen, destino]);

  // Inicializar/actualizar mapa Leaflet
  useEffect(() => {
    if (!coords || !mapRef.current) return;
    injectLeafletCSS();

    const init = () => {
      if (!window.L) { setTimeout(init, 200); return; }
      const L = window.L;
      const { c1, c2 } = coords;

      // Destruir mapa anterior si existe
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }

      const centerLat = (c1.lat + c2.lat) / 2;
      const centerLng = (c1.lng + c2.lng) / 2;

      const map = L.map(mapRef.current, {
        center: [centerLat, centerLng],
        zoom: 13,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      // Marcador A (origen) — verde
      const iconA = L.divIcon({
        html: `<div style="background:#00C48C;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.3);">A</div>`,
        className: "", iconSize: [26, 26], iconAnchor: [13, 13],
      });
      // Marcador B (destino) — rojo
      const iconB = L.divIcon({
        html: `<div style="background:#FF5C7A;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.3);">B</div>`,
        className: "", iconSize: [26, 26], iconAnchor: [13, 13],
      });

      L.marker([c1.lat, c1.lng], { icon: iconA }).addTo(map);
      L.marker([c2.lat, c2.lng], { icon: iconB }).addTo(map);

      // Línea entre A y B
      L.polyline([[c1.lat, c1.lng], [c2.lat, c2.lng]], {
        color: "#3B4FE0", weight: 3, dashArray: "8,5", opacity: 0.85,
      }).addTo(map);

      // Ajustar zoom para que entren los dos puntos
      map.fitBounds([[c1.lat, c1.lng], [c2.lat, c2.lng]], { padding: [28, 28] });

      mapInstance.current = map;
    };

    // Cargar Leaflet JS si no está
    if (!window.L) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = init;
      document.head.appendChild(script);
    } else {
      init();
    }

    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
    };
  }, [coords]);

  if (!origen || !destino || origen.length < 5 || destino.length < 5) return null;

  return (
    <div style={{ borderRadius: 14, overflow: "hidden", marginBottom: 10, border: `1.5px solid ${C.cyan}33` }}>
      {loading && (
        <div style={{ height: 150, background: "#E0F7F7", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 20 }}>🗺️</div>
          <div style={{ fontSize: 12, color: C.muted }}>Buscando ubicaciones reales...</div>
        </div>
      )}
      {error && (
        <div style={{ height: 80, background: `${C.warning}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, color: C.warning }}>⚠️ No se pudo cargar el mapa — verificá las direcciones</span>
        </div>
      )}
      {!loading && !error && (
        <div ref={mapRef} id={mapId.current} style={{ height: 175, width: "100%" }}/>
      )}
      {dist !== null && !loading && !error && (
        <div style={{ display: "flex", gap: 10, padding: "7px 12px 8px", fontSize: 12, color: C.muted, background: "#F0FAFA", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <span><span style={{ color: C.success, fontWeight: 700 }}>A </span>{origen.length > 26 ? origen.slice(0, 26) + "…" : origen}</span>
            <span><span style={{ color: C.danger, fontWeight: 700 }}>B </span>{destino.length > 26 ? destino.slice(0, 26) + "…" : destino}</span>
          </div>
          <span style={{ fontWeight: 700, color: C.blue, whiteSpace: "nowrap" }}>📍 {dist} km</span>
        </div>
      )}
    </div>
  );
}

// ─── INPUT CON AUTOCOMPLETE DE DIRECCIONES ────────────────────────────────
// Flujo: usuario escribe calle → elige sugerencia → agrega número de puerta
// Si escribe todo a mano sin sugerencia → se geocodifica al perder foco
function InputDireccion({ value, onChange, placeholder, label }) {
  // Separar valor en calle y número para el estado interno
  const [calle, setCalle] = useState("");
  const [numero, setNumero] = useState("");
  const [sugerencias, setSugerencias] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [calleElegida, setCalleElegida] = useState(false); // si ya eligió de la lista
  const [coordsCalle, setCoordsCalle] = useState(null);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  // Sincronizar hacia afuera cuando cambian calle o número
  useEffect(() => {
    const dir = numero.trim() ? `${calle} ${numero.trim()}` : calle;
    onChange(dir);
    // Si tenemos coords de la calle, cachear también con número
    if (coordsCalle && calle) {
      geocodeCache[dir.trim().toLowerCase()] = coordsCalle;
    }
  }, [calle, numero]);

  // Inicializar desde value externo (ej: edición)
  useEffect(() => {
    if (value && !calle) {
      setCalle(value);
    }
  }, []);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setAbierto(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const buscarCalle = (texto) => {
    setCalle(texto);
    setCalleElegida(false);
    setCoordsCalle(null);
    clearTimeout(timerRef.current);
    if (texto.length < 4) { setSugerencias([]); setAbierto(false); return; }
    setCargando(true);
    timerRef.current = setTimeout(async () => {
      try {
        const q = `${texto}, Montevideo, Uruguay`;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`,
          { headers: { "Accept-Language": "es" } }
        );
        const data = await res.json();
        const lista = data.map(d => {
          // Construir etiqueta limpia: solo calle y barrio si existe
          const a = d.address || {};
          const nombre = a.road || a.pedestrian || a.footway || d.display_name.split(",")[0];
          const barrio = a.suburb || a.neighbourhood || a.city_district || "";
          return {
            label: barrio ? `${nombre}, ${barrio}` : nombre,
            lat: parseFloat(d.lat),
            lng: parseFloat(d.lon),
          };
        }).filter((v, i, arr) => arr.findIndex(x => x.label === v.label) === i); // dedup
        setSugerencias(lista);
        setAbierto(lista.length > 0);
      } catch (e) { setSugerencias([]); }
      setCargando(false);
    }, 400);
  };

  const elegirCalle = (sug) => {
    setCalle(sug.label);
    setCoordsCalle({ lat: sug.lat, lng: sug.lng });
    setCalleElegida(true);
    setSugerencias([]);
    setAbierto(false);
    // Cachear con y sin número
    geocodeCache[sug.label.trim().toLowerCase()] = { lat: sug.lat, lng: sug.lng };
  };

  // Geocodificar al perder foco si el usuario escribió a mano
  const geocodificarManual = async () => {
    setAbierto(false);
    if (calleElegida || !calle || calle.length < 4) return;
    try {
      const dir = numero.trim() ? `${calle} ${numero.trim()}, Montevideo, Uruguay` : `${calle}, Montevideo, Uruguay`;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(dir)}`,
        { headers: { "Accept-Language": "es" } }
      );
      const data = await res.json();
      if (data?.[0]) {
        const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        setCoordsCalle(coords);
        const key = (numero.trim() ? `${calle} ${numero.trim()}` : calle).trim().toLowerCase();
        geocodeCache[key] = coords;
      }
    } catch (e) {}
  };

  return (
    <div ref={wrapRef} style={{ marginBottom: 11 }}>
      {label && <label style={st.label}>{label}</label>}
      <div style={{ display: "flex", gap: 8 }}>
        {/* Campo calle con autocomplete */}
        <div style={{ position: "relative", flex: 1 }}>
          <input
            style={{ ...st.input, marginBottom: 0, paddingRight: cargando ? 34 : 12,
              borderColor: calleElegida ? `${C.success}88` : undefined }}
            placeholder={placeholder || "Nombre de calle"}
            value={calle}
            onChange={e => buscarCalle(e.target.value)}
            onFocus={() => sugerencias.length > 0 && setAbierto(true)}
            onBlur={geocodificarManual}
            autoComplete="off"
          />
          {cargando && <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", fontSize:13 }}>⏳</span>}
          {calleElegida && !cargando && <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", fontSize:13 }}>✅</span>}
          {/* Dropdown sugerencias */}
          {abierto && sugerencias.length > 0 && (
            <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#fff", borderRadius:12,
              boxShadow:"0 6px 24px rgba(0,0,0,0.14)", zIndex:999, border:`1.5px solid ${C.cyan}44`,
              overflow:"hidden", marginTop:3 }}>
              {sugerencias.map((sug, i) => (
                <div key={i} onMouseDown={() => elegirCalle(sug)}
                  style={{ padding:"9px 13px", fontSize:13, cursor:"pointer", lineHeight:1.4,
                    borderBottom: i < sugerencias.length-1 ? `1px solid ${C.cyan}18` : "none" }}
                  onMouseEnter={e => e.currentTarget.style.background = `${C.cyan}15`}
                  onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                  <span style={{ marginRight:6 }}>📍</span>{sug.label}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Campo número de puerta */}
        <input
          style={{ ...st.input, marginBottom:0, width:72, flexShrink:0, textAlign:"center", fontWeight:700 }}
          placeholder="Nº"
          value={numero}
          onChange={e => setNumero(e.target.value)}
          onBlur={geocodificarManual}
          maxLength={6}
        />
      </div>
      {/* Indicador de estado */}
      <div style={{ fontSize:11, marginTop:4, color: coordsCalle ? C.success : C.muted, minHeight:16 }}>
        {coordsCalle
          ? `📍 Ubicación encontrada`
          : calle.length > 3 && !cargando
            ? "Elegí una sugerencia o esperá a que se geocodifique"
            : ""}
      </div>
    </div>
  );
}
function PrecioClienteTag({oferta,tipo}){
  if(!oferta)return null;
  const esMudanza=tipo==="mudanza";
  return(
    <div style={{background:esMudanza?`${C.blue}12`:`${C.cyan}12`,border:`1.5px solid ${esMudanza?C.blue:C.cyan}44`,borderRadius:12,padding:"10px 14px",marginTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div>
        <div style={{fontSize:11,fontWeight:700,color:esMudanza?C.blue:C.cyan,textTransform:"uppercase"}}>💰 {esMudanza?"Precio por hora":"Precio fijo"}</div>
        <div style={{fontSize:11,color:C.muted}}>{esMudanza?"Se cobra por tiempo real de ejecución":"Precio total acordado"}</div>
      </div>
      <div style={{fontSize:24,fontWeight:900,color:esMudanza?C.blue:C.cyan}}>{formatUYU(oferta)}{esMudanza?<span style={{fontSize:14}}>/h</span>:""}</div>
    </div>
  );
}

// ─── RESUMEN DE VIAJE FINALIZADO ──────────────────────────────────────────
function ResumenViaje({sol,comisionPct,mostrarComision=true}){
  if(sol.estado!=="finalizado")return null;
  const costo=costoViaje(sol);
  const comision=Math.round(costo*(comisionPct/100));
  const neto=costo-comision;
  return(
    <div style={{background:`${C.success}12`,borderRadius:14,padding:"14px 16px",marginBottom:10,border:`1.5px solid ${C.success}44`}}>
      <div style={{fontWeight:800,fontSize:14,color:C.success,marginBottom:10}}>✅ Resumen del viaje</div>
      {sol.tiempoTotal&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:13,color:C.muted}}>⏱ Tiempo real:</span><span style={{fontSize:13,fontWeight:700}}>{formatTiempo(sol.tiempoTotal)}</span></div>}
      {sol.tipo==="mudanza"&&sol.precioFletyer&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:13,color:C.muted}}>Tarifa/h:</span><span style={{fontSize:13,fontWeight:700}}>{formatUYU(sol.precioFletyer)}/h</span></div>}
      <div style={{display:"flex",justifyContent:"space-between",paddingTop:6,borderTop:`1px solid ${C.success}33`,marginBottom:8}}>
        <span style={{fontSize:14,fontWeight:700}}>Costo final:</span>
        <span style={{fontSize:19,fontWeight:900,color:C.success}}>{formatUYU(costo)}</span>
      </div>
      {mostrarComision&&(
        <div style={{display:"flex",gap:8}}>
          <div style={{flex:1,textAlign:"center",background:"rgba(255,92,122,0.10)",borderRadius:10,padding:"7px 0"}}>
            <div style={{fontSize:11,color:C.muted}}>Comisión Flety ({comisionPct}%)</div>
            <div style={{fontSize:14,fontWeight:700,color:C.danger}}>−{formatUYU(comision)}</div>
          </div>
          <div style={{flex:1,textAlign:"center",background:"rgba(0,196,140,0.10)",borderRadius:10,padding:"7px 0"}}>
            <div style={{fontSize:11,color:C.muted}}>Fletyer recibe</div>
            <div style={{fontSize:14,fontWeight:700,color:C.success}}>{formatUYU(neto)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CONTADOR DE VIAJE ────────────────────────────────────────────────────
function ContadorViaje({sol,tipoUsuario,onIniciar,onFinalizar}){
  const[seg,setSeg]=useState(0);
  const ref=useRef();
  const esFletyer=tipoUsuario==="fletyer";
  const viajeActivo=sol.viajeInicio&&!sol.viajeFin;
  const esMudanza=sol.tipo==="mudanza";

  useEffect(()=>{
    if(viajeActivo&&sol.viajeInicio){
      const upd=()=>setSeg(Math.floor((Date.now()-sol.viajeInicio)/1000));
      upd(); ref.current=setInterval(upd,1000);
    }
    return()=>clearInterval(ref.current);
  },[viajeActivo,sol.viajeInicio]);

  if(!["en_curso","finalizado"].includes(sol.estado))return null;

  if(sol.estado==="en_curso"&&!sol.viajeInicio&&esFletyer)return(
    <div style={{background:`${C.warning}15`,border:`1.5px solid ${C.warning}55`,borderRadius:14,padding:"14px 16px",marginBottom:10}}>
      <div style={{fontSize:13,fontWeight:700,color:C.warning,marginBottom:8}}>🚦 Listo para arrancar</div>
      <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Presioná cuando estés en el punto de partida.</div>
      <button style={st.btn(`linear-gradient(135deg,${C.success},#00a87a)`)} onClick={onIniciar}>🚀 Iniciar viaje</button>
    </div>
  );

  if(sol.estado==="en_curso"&&!sol.viajeInicio&&!esFletyer)return(
    <div style={{background:`${C.warning}15`,border:`1.5px solid ${C.warning}55`,borderRadius:14,padding:"12px 16px",marginBottom:10}}>
      <div style={{fontSize:13,color:C.warning,fontWeight:700}}>⏳ Esperando que el Fletyer inicie el viaje...</div>
    </div>
  );

  if(viajeActivo){
    const costoActual=esMudanza?Math.round((sol.precioFletyer||0)*(seg/3600)):(sol.precioFletyer||0);
    return(
      <div style={{background:`linear-gradient(135deg,${C.success}18,${C.cyan}12)`,border:`2px solid ${C.success}55`,borderRadius:14,padding:"16px",marginBottom:10}}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:C.success,textTransform:"uppercase",letterSpacing:1}}>🟢 Viaje en curso</div>
          <div style={{fontSize:44,fontWeight:900,color:C.text,letterSpacing:2,fontFamily:"monospace"}}>{formatTiempo(seg)}</div>
          {esMudanza&&<div style={{fontSize:13,color:C.muted,marginTop:4}}>Acumulado: <strong style={{color:C.blue}}>{formatUYU(costoActual)}</strong> · tarifa {formatUYU(sol.precioFletyer||0)}/h</div>}
          {!esMudanza&&<div style={{fontSize:13,color:C.muted,marginTop:4}}>Precio fijo: <strong style={{color:C.cyan}}>{formatUYU(sol.precioFletyer||0)}</strong></div>}
        </div>
        {esFletyer&&<button style={st.btn(`linear-gradient(135deg,${C.danger},#ff8c60)`)} onClick={()=>onFinalizar(seg)}>🏁 Finalizar viaje</button>}
        {!esFletyer&&<div style={{fontSize:12,color:C.success,textAlign:"center",fontWeight:600}}>El Fletyer está en camino...</div>}
      </div>
    );
  }
  return null;
}

// ─── PERFIL USUARIO ───────────────────────────────────────────────────────
function PerfilUsuario({u,onClose}){
  if(!u)return null;
  const esFletyer=u.tipo==="fletyer";
  const prom=promedioEstrellas(u.calificaciones);
  return(
    <div style={{...st.wrap,paddingBottom:0,position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:200,background:C.bg,overflowY:"auto"}}>
      <div style={st.header}>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>←</button>
        <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={26}/><span style={st.logoTxt}>FLETY</span></div>
        <div/>
      </div>
      <div style={st.cont}>
        <div style={{...st.card,background:GRAD,marginBottom:0,borderRadius:"18px 18px 0 0",padding:"28px 18px 22px"}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
            <Avatar u={u} size={84}/>
            <div style={{textAlign:"center"}}>
              <div style={{fontWeight:800,fontSize:20,color:"#fff"}}>{u.nombre}</div>
              <span style={{background:"rgba(255,255,255,0.25)",color:"#fff",borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700}}>{esFletyer?"🚚 Fletyer":"🏠 Cliente"}</span>
            </div>
            {esFletyer&&<div style={{display:"flex",alignItems:"center",gap:6}}><Estrellas valor={Math.round(parseFloat(prom))} size={20}/><span style={{color:"#fff",fontWeight:700,fontSize:14}}>{prom>0?`${prom} (${u.calificaciones.length})`:"Sin calificaciones"}</span></div>}
          </div>
        </div>
        <div style={{...st.card,borderRadius:"0 0 18px 18px",paddingTop:20}}>
          {[{label:"Edad",value:u.edad?`${u.edad} años`:"—"},{label:"Dirección",value:u.direccion||"—"},{label:"Teléfono",value:u.telefono||"—"},...(esFletyer?[{label:"Vehículo",value:u.vehiculo||"—"}]:[])].map(f=>(
            <div key={f.label} style={{borderBottom:`1px solid ${C.cyan}22`,paddingBottom:10,marginBottom:10}}>
              <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{f.label}</div>
              <div style={{fontSize:15,fontWeight:600,marginTop:2,color:C.text}}>{f.value}</div>
            </div>
          ))}
        </div>
        {esFletyer&&u.calificaciones?.length>0&&(
          <div style={st.card}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:12}}>⭐ Reseñas</div>
            {u.calificaciones.map((c,i)=>(
              <div key={i} style={{borderBottom:`1px solid ${C.cyan}22`,paddingBottom:10,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between"}}><Estrellas valor={c.estrellas} size={16}/><span style={{fontSize:12,color:C.muted}}>— {c.cliente}</span></div>
                {c.comentario&&<div style={{fontSize:13,fontStyle:"italic",marginTop:4}}>"{c.comentario}"</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MODAL CALIFICAR ──────────────────────────────────────────────────────
function ModalCalificar({fletyer,onCalificar,onCerrar}){
  const[estrellas,setEstrellas]=useState(0);
  const[comentario,setComentario]=useState("");
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.45)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:C.card,borderRadius:20,padding:24,width:"100%",maxWidth:380,boxShadow:"0 8px 32px rgba(0,180,180,0.18)"}}>
        <div style={{textAlign:"center",marginBottom:16}}>
          <Avatar u={fletyer} size={64}/>
          <div style={{fontWeight:800,fontSize:17,marginTop:8}}>Calificá a {fletyer?.nombre}</div>
        </div>
        <div style={{display:"flex",justifyContent:"center",marginBottom:14}}><Estrellas valor={estrellas} onChange={setEstrellas} size={36}/></div>
        <textarea style={st.textarea} placeholder="Comentario (opcional)..." value={comentario} onChange={e=>setComentario(e.target.value)}/>
        <button style={st.btn(GRAD)} disabled={!estrellas} onClick={()=>onCalificar(estrellas,comentario)}>{estrellas?`Enviar (${estrellas}★)`:"Seleccioná una puntuación"}</button>
        <button style={st.btnOut(C.muted)} onClick={onCerrar}>Ahora no</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL CON FIREBASE
// ══════════════════════════════════════════════════════════════════════════
export default function FLETY(){
  const[fireUser,setFireUser]=useState(undefined);
  const[perfil,setPerfil]=useState(null);
  const[usuarios,setUsuarios]=useState([]);
  const[solicitudes,setSolicitudes]=useState([]);
  const[tarifas,setTarifas]=useState(TARIFAS_INIT);
  const[comisionPct,setComisionPct]=useState(COMISION_INIT);
  const[tab,setTab]=useState("inicio");
  const[tipoReg,setTipoReg]=useState(null);
  const[loginForm,setLoginForm]=useState({email:"",pass:""});
  const[loginError,setLoginError]=useState("");
  const[regForm,setRegForm]=useState({nombre:"",email:"",edad:"",direccion:"",telefono:"",vehiculo:"",pass:""});
  const[nuevaSol,setNuevaSol]=useState({tipo:"mudanza",origen:"",destino:"",descripcion:""});
  const[avisoPublicado,setAvisoPublicado]=useState(false);
  const[chatActivo,setChatActivo]=useState(null);
  const[nuevoMsg,setNuevoMsg]=useState("");
  const[editMode,setEditMode]=useState(false);
  const[editData,setEditData]=useState({});
  const[perfilVisto,setPerfilVisto]=useState(null);
  const[modalCalificar,setModalCalificar]=useState(null);
  const[editandoPrecio,setEditandoPrecio]=useState({});
  const[editTarifas,setEditTarifas]=useState(false);
  const[tarifasEdit,setTarifasEdit]=useState({});
  const[comisionEdit,setComisionEdit]=useState(COMISION_INIT);
  const[subiendo,setSubiendo]=useState(false);
  const fotoRef=useRef();
  const libretaImgRef=useRef();
  const cedulaFrenteRef=useRef();
  const cedulaDorsoRef=useRef();

  const getPrecioInput=(id)=>editandoPrecio[id]??"";
  const setPrecioInput=(id,v)=>setEditandoPrecio(p=>({...p,[id]:v}));

  // ── Auth listener ──
  useEffect(()=>{
    return onAuthStateChanged(auth,async(u)=>{
      setFireUser(u);
      if(u){const s=await getDoc(doc(db,"usuarios",u.uid));if(s.exists())setPerfil({id:u.uid,...s.data()});else setPerfil(null);}
      else setPerfil(null);
    });
  },[]);

  // ── Usuarios en tiempo real ──
  useEffect(()=>onSnapshot(collection(db,"usuarios"),s=>setUsuarios(s.docs.map(d=>({id:d.id,...d.data()})))),[]);

  // ── Solicitudes en tiempo real ──
  useEffect(()=>{
    try{return onSnapshot(query(collection(db,"solicitudes"),orderBy("creadoEn","desc")),s=>setSolicitudes(s.docs.map(d=>({id:d.id,...d.data()}))));}
    catch(e){return onSnapshot(collection(db,"solicitudes"),s=>setSolicitudes(s.docs.map(d=>({id:d.id,...d.data()}))));}
  },[]);

  // ── Config en tiempo real ──
  useEffect(()=>onSnapshot(doc(db,"config","tarifas"),s=>{if(s.exists()){const d=s.data();if(d.tarifas)setTarifas(d.tarifas);if(d.comisionPct)setComisionPct(d.comisionPct);}}),[]);

  // ── Sincronizar perfil con cambios de Firestore ──
  useEffect(()=>{if(fireUser&&usuarios.length){const u=usuarios.find(x=>x.id===fireUser.uid);if(u)setPerfil(u);}},[usuarios,fireUser]);

  const badgeSolicitudes=(()=>{
    if(!perfil)return 0;
    if(perfil.tipo==="cliente")return solicitudes.filter(s=>s.clienteId===perfil.id&&Object.keys(s.ofertasFletyer||{}).length>0).length;
    if(perfil.tipo==="fletyer")return solicitudes.filter(s=>s.estado==="en_curso"&&s.fleteroAceptado===perfil.id&&s.chats?.[perfil.id]?.some(m=>m.de==="cliente")).length;
    return 0;
  })();

  // ── REGISTRO ──
  const registrar=async()=>{
    setLoginError("");
    if(!regForm.nombre||!regForm.email||!regForm.pass){setLoginError("Completá nombre, email y contraseña");return;}
    try{
      const cred=await createUserWithEmailAndPassword(auth,regForm.email,regForm.pass);
      const vKey=detectarVehiculoKey(regForm.vehiculo);
      await setDoc(doc(db,"usuarios",cred.user.uid),{
        nombre:regForm.nombre,email:regForm.email,tipo:tipoReg.replace("-registro",""),
        edad:parseInt(regForm.edad)||0,direccion:regForm.direccion,telefono:regForm.telefono,
        vehiculo:regForm.vehiculo||"",vehiculoKey:vKey,foto:"",calificaciones:[],habilitado:false,
        ...(tipoReg.includes("fletyer")?{libretaDesde:"",libretaHasta:"",libretaImg:"",cedulaFrente:"",cedulaDorso:""}:{}),
        creadoEn:serverTimestamp(),
      });
      setTab("inicio");
    }catch(e){
      if(e.code==="auth/email-already-in-use")setLoginError("Ese email ya está registrado");
      else if(e.code==="auth/weak-password")setLoginError("La contraseña debe tener al menos 6 caracteres");
      else setLoginError("Error: "+e.message);
    }
  };

  // ── LOGIN ──
  const login=async()=>{
    setLoginError("");
    try{
      const cred=await signInWithEmailAndPassword(auth,loginForm.email,loginForm.pass);
      // Verificar que el tipo coincida con el botón elegido
      const snap=await getDoc(doc(db,"usuarios",cred.user.uid));
      if(snap.exists()){
        const tipoReal=snap.data().tipo;
        const tipoElegido=tipoReg.replace("-login","");
        if(tipoReal!==tipoElegido){
          await signOut(auth);
          setLoginError(`Esta cuenta es de tipo "${tipoReal==="cliente"?"Cliente":tipoReal==="fletyer"?"Fletyer":"Admin"}". Volvé al inicio y elegí el botón correcto.`);
        }
      }
    }catch(e){
      if(e.code==="auth/user-not-found"||e.code==="auth/wrong-password"||e.code==="auth/invalid-credential")setLoginError("Email o contraseña incorrectos");
      else if(!e.code)return;
      else setLoginError("Error: "+e.message);
    }
  };

  const salir=()=>{signOut(auth);setTab("inicio");setChatActivo(null);setTipoReg(null);};

  // ── PUBLICAR SOLICITUD ──
  const publicarSolicitud=async()=>{
    if(!nuevaSol.origen||!nuevaSol.destino)return;
    const[c1,c2]=await Promise.all([geocodificar(nuevaSol.origen),geocodificar(nuevaSol.destino)]);
    const dist=distanciaHaversine(c1,c2);
    await addDoc(collection(db,"solicitudes"),{
      clienteId:perfil.id,clienteNombre:perfil.nombre,clienteTelefono:perfil.telefono||"",
      tipo:nuevaSol.tipo,origen:nuevaSol.origen,destino:nuevaSol.destino,
      descripcion:nuevaSol.descripcion,distancia:dist,
      fecha:new Date().toISOString().split("T")[0],estado:"activa",
      chats:{},ofertasFletyer:{},fleteroAceptado:null,calificado:false,
      precioFletyer:null,viajeInicio:null,viajeFin:null,tiempoTotal:null,comisionPagada:false,
      creadoEn:serverTimestamp(),
    });
    setAvisoPublicado(true);setTimeout(()=>setAvisoPublicado(false),3500);
    setNuevaSol({tipo:"mudanza",origen:"",destino:"",descripcion:""});
    setTab("solicitudes");
  };

  // ── MENSAJE ──
  const enviarMsg=async()=>{
    if(!nuevoMsg.trim()||!chatActivo)return;
    const{solicitudId,fletyerId}=chatActivo;
    const sol=solicitudes.find(s=>s.id===solicitudId);if(!sol)return;
    const msg={de:perfil.tipo,texto:nuevoMsg,hora:new Date().toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit"}),...(perfil.tipo==="fletyer"?{fletyerId:perfil.id,fletyerNombre:perfil.nombre}:{})};
    const chats={...sol.chats};chats[fletyerId]=[...(chats[fletyerId]||[]),msg];
    await updateDoc(doc(db,"solicitudes",solicitudId),{chats});
    setNuevoMsg("");
  };

  // ── OFERTA FLETYER ──
  const guardarOfertaFletyer=async(solId,precio)=>{
    if(!precio||parseFloat(precio)<=0)return;
    const p=parseFloat(precio);
    const sol=solicitudes.find(s=>s.id===solId);if(!sol)return;
    const labelPrecio=sol.tipo==="mudanza"?`${formatUYU(p)}/hora`:`${formatUYU(p)} total`;
    const ofertasFletyer={...sol.ofertasFletyer,[perfil.id]:{precio:p,nombre:perfil.nombre,bloqueado:false}};
    let chats={...sol.chats};
    if(!chats[perfil.id]||chats[perfil.id].length===0){
      chats[perfil.id]=[{de:"fletyer",fletyerId:perfil.id,fletyerNombre:perfil.nombre,
        texto:`¡Hola! Me ofrezco para realizar este servicio. Mi precio es ${labelPrecio}. ¿Te parece bien?`,
        hora:new Date().toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit"}),esOfertaAutomatica:true}];
    }
    await updateDoc(doc(db,"solicitudes",solId),{ofertasFletyer,chats});
    setPrecioInput(solId,"");
  };

  const modificarOferta=async(solId,precio)=>{
    if(!precio||parseFloat(precio)<=0)return;
    const p=parseFloat(precio);
    const sol=solicitudes.find(s=>s.id===solId);if(!sol)return;
    const oferta=sol.ofertasFletyer?.[perfil.id];if(!oferta||oferta.bloqueado)return;
    const labelPrecio=sol.tipo==="mudanza"?`${formatUYU(p)}/hora`:`${formatUYU(p)} total`;
    const ofertasFletyer={...sol.ofertasFletyer,[perfil.id]:{...oferta,precio:p}};
    let chats={...sol.chats};
    if(chats[perfil.id])chats[perfil.id]=chats[perfil.id].map(m=>m.esOfertaAutomatica?{...m,texto:`¡Hola! Me ofrezco para realizar este servicio. Mi precio es ${labelPrecio}. ¿Te parece bien?`}:m);
    await updateDoc(doc(db,"solicitudes",solId),{ofertasFletyer,chats});
    setPrecioInput(solId,"");
  };

  const aceptarFletyer=async(solId,fletyerId)=>{
    const sol=solicitudes.find(s=>s.id===solId);if(!sol)return;
    const ofertasFletyer={...sol.ofertasFletyer};
    if(ofertasFletyer[fletyerId])ofertasFletyer[fletyerId]={...ofertasFletyer[fletyerId],bloqueado:true};
    await updateDoc(doc(db,"solicitudes",solId),{fleteroAceptado:fletyerId,estado:"en_curso",ofertasFletyer,precioFletyer:ofertasFletyer[fletyerId]?.precio||0});
  };

  const iniciarViaje=async(solId)=>await updateDoc(doc(db,"solicitudes",solId),{viajeInicio:Date.now()});
  const finalizarViaje=async(solId,seg)=>await updateDoc(doc(db,"solicitudes",solId),{estado:"finalizado",viajeFin:Date.now(),tiempoTotal:seg||null});
  const cancelarViaje=async(solId)=>{
    const sol=solicitudes.find(s=>s.id===solId);if(!sol)return;
    const ofertasFletyer=Object.fromEntries(Object.entries(sol.ofertasFletyer||{}).map(([k,v])=>[k,{...v,bloqueado:false}]));
    await updateDoc(doc(db,"solicitudes",solId),{estado:"activa",fleteroAceptado:null,viajeInicio:null,viajeFin:null,tiempoTotal:null,precioFletyer:null,ofertasFletyer});
    setChatActivo(null);
  };
  const eliminarSolicitud=async(solId)=>await deleteDoc(doc(db,"solicitudes",solId));

  const calificar=async(solId,fletyerId,estrellas,comentario)=>{
    const fId=String(fletyerId);
    const snap=await getDoc(doc(db,"usuarios",fId));if(!snap.exists())return;
    const califs=[...(snap.data().calificaciones||[]),{estrellas,comentario,cliente:perfil.nombre}];
    await updateDoc(doc(db,"usuarios",fId),{calificaciones:califs});
    await updateDoc(doc(db,"solicitudes",solId),{calificado:true});
    setModalCalificar(null);
  };

  const marcarComisionPagada=async(solId)=>await updateDoc(doc(db,"solicitudes",solId),{comisionPagada:true});
  const toggleHabilitar=async(userId)=>{const u=usuarios.find(x=>x.id===userId);if(u)await updateDoc(doc(db,"usuarios",userId),{habilitado:!u.habilitado});};
  const asignarVehiculoAdmin=async(userId,vKey)=>await updateDoc(doc(db,"usuarios",userId),{vehiculoKey:vKey,vehiculo:tarifas[vKey].label});
  const guardarTarifas=async()=>{await setDoc(doc(db,"config","tarifas"),{tarifas:tarifasEdit,comisionPct:parseFloat(comisionEdit)||15});setTarifas(tarifasEdit);setComisionPct(parseFloat(comisionEdit)||15);setEditTarifas(false);};

  // ── FOTOS (base64 en Firestore, sin Storage) ──
  const handleFoto=async(e)=>{
    const file=e.target.files[0];if(!file)return;setSubiendo(true);
    const reader=new FileReader();
    reader.onload=async(ev)=>{await updateDoc(doc(db,"usuarios",perfil.id),{foto:ev.target.result});setSubiendo(false);};
    reader.readAsDataURL(file);
  };
  const handleDocImg=async(campo,e)=>{
    const file=e.target.files[0];if(!file)return;setSubiendo(true);
    const reader=new FileReader();
    reader.onload=async(ev)=>{await updateDoc(doc(db,"usuarios",perfil.id),{[campo]:ev.target.result});setSubiendo(false);};
    reader.readAsDataURL(file);
  };
  const guardarEdicion=async()=>{const vKey=detectarVehiculoKey(editData.vehiculo||"");await updateDoc(doc(db,"usuarios",perfil.id),{...editData,vehiculoKey:vKey});setEditMode(false);};

  const estadoLabel=(e)=>({activa:{label:"● Activa",col:C.cyan},en_curso:{label:"🔄 En curso",col:C.warning},finalizado:{label:"✅ Finalizado",col:C.success}}[e]||{label:e,col:C.muted});

  const TabBar=()=>{
    const tipo=perfil?.tipo;
    const tabs=tipo==="admin"?[{id:"admin-sols",icon:"📋",label:"Solicitudes"},{id:"admin-users",icon:"👥",label:"Usuarios"},{id:"admin-config",icon:"⚙️",label:"Config"}]:tipo==="cliente"?[{id:"inicio",icon:"🏠",label:"Inicio"},{id:"solicitudes",icon:"📋",label:"Solicitudes"},{id:"cuenta",icon:"👤",label:"Mi Cuenta"}]:[{id:"inicio",icon:"🔍",label:"Disponibles"},{id:"solicitudes",icon:"📋",label:"Mis Trabajos"},{id:"cuenta",icon:"👤",label:"Mi Cuenta"}];
    return<div style={st.tabBar}>{tabs.map(t=><button key={t.id} style={st.tabBtn(tab===t.id)} onClick={()=>{setTab(t.id);setChatActivo(null);}}><div style={{position:"relative"}}><span style={{fontSize:20}}>{t.icon}</span>{t.id==="solicitudes"&&badgeSolicitudes>0&&<span style={{position:"absolute",top:-4,right:-8,background:C.danger,color:"#fff",borderRadius:"50%",width:16,height:16,fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{badgeSolicitudes}</span>}</div><span style={{color:tab===t.id?C.blue:C.muted}}>{t.label}</span></button>)}</div>;
  };

  // ── CARGANDO ──
  if(fireUser===undefined)return<div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}><LogoSVG size={80}/><div style={{fontSize:14,color:C.muted}}>Iniciando FLETY...</div></div>;

  if(perfilVisto)return<PerfilUsuario u={usuarios.find(u=>u.id===perfilVisto.id)||perfilVisto} onClose={()=>setPerfilVisto(null)}/>;
  if(modalCalificar){const fl=usuarios.find(u=>u.id===String(modalCalificar.fletyerId));if(!fl){setTimeout(()=>setModalCalificar(null),0);return null;}return<ModalCalificar fletyer={fl} onCalificar={(e,c)=>calificar(modalCalificar.solicitudId,modalCalificar.fletyerId,e,c)} onCerrar={()=>setModalCalificar(null)}/>;}

  // ═══ SIN LOGIN ═══════════════════════════════════════════════════════════
  if(!fireUser||!perfil){
    if(!tipoReg)return(
      <div style={{...st.wrap,paddingBottom:0}}>
        <div style={{width:"100%",background:GRAD,minHeight:"42vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 24px 36px",boxSizing:"border-box"}}>
          <LogoSVG size={100}/>
          <div style={{fontSize:13,opacity:0.9,marginTop:8,color:"#fff",textAlign:"center"}}>Conectamos Fletyers con clientes en Uruguay</div>
          <div style={{display:"flex",gap:12,marginTop:20}}>{["🚚 Rápido","📍 Montevideo","⭐ Confiable"].map(t=><span key={t} style={{background:"rgba(255,255,255,0.2)",color:"#fff",borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700}}>{t}</span>)}</div>
        </div>
        <div style={{...st.cont,marginTop:-10}}>
          <div style={{...st.card,boxShadow:"0 4px 24px rgba(0,180,180,0.13)"}}>
            <div style={{...st.title,textAlign:"center",color:C.blue}}>¿Cómo querés ingresar?</div>
            <div style={{fontSize:13,color:C.muted,textAlign:"center",marginBottom:18}}>Seleccioná tu perfil</div>
            <button style={st.btn(GRAD)} onClick={()=>setTipoReg("cliente-login")}>🏠 Soy Cliente</button>
            <button style={st.btn(GRAD_B)} onClick={()=>setTipoReg("fletyer-login")}>🚚 Soy Fletyer</button>
            <button style={{...st.btnOut(C.muted),color:"#999"}} onClick={()=>setTipoReg("admin-login")}>⚙️ Administrador</button>
          </div>
        </div>
      </div>
    );
    const tipoActual=tipoReg.replace("-login","").replace("-registro","");
    const esLogin=tipoReg.endsWith("-login");
    return(
      <div style={st.wrap}>
        <div style={st.header}><button onClick={()=>{setTipoReg(null);setLoginError("");}} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>←</button><div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={26}/><span style={st.logoTxt}>FLETY</span></div><div/></div>
        <div style={st.cont}>
          <div style={st.card}>
            <div style={{...st.title,color:C.blue}}>{esLogin?"Iniciar sesión":"Crear cuenta"}</div>
            <div style={st.sub}>Como {tipoActual==="admin"?"Administrador":tipoActual==="cliente"?"Cliente":"Fletyer"}</div>
            {!esLogin&&<>
              <label style={st.label}>Nombre completo</label><input style={st.input} placeholder="Tu nombre" value={regForm.nombre} onChange={e=>setRegForm(p=>({...p,nombre:e.target.value}))}/>
              <label style={st.label}>Edad</label><input style={st.input} type="number" placeholder="30" value={regForm.edad} onChange={e=>setRegForm(p=>({...p,edad:e.target.value}))}/>
              <label style={st.label}>Dirección</label><input style={st.input} placeholder="Tu barrio" value={regForm.direccion} onChange={e=>setRegForm(p=>({...p,direccion:e.target.value}))}/>
              <label style={st.label}>Teléfono</label><input style={st.input} placeholder="09X XXX XXX" value={regForm.telefono} onChange={e=>setRegForm(p=>({...p,telefono:e.target.value}))}/>
              {tipoActual==="fletyer"&&<><label style={st.label}>Tipo de vehículo</label><input style={st.input} placeholder="Ej: Camioneta 1 tonelada" value={regForm.vehiculo} onChange={e=>setRegForm(p=>({...p,vehiculo:e.target.value}))}/></>}
            </>}
            <label style={st.label}>Email</label>
            <input style={st.input} type="email" placeholder="tu@email.com" value={esLogin?loginForm.email:regForm.email} onChange={e=>esLogin?setLoginForm(p=>({...p,email:e.target.value})):setRegForm(p=>({...p,email:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&esLogin&&login()}/>
            <label style={st.label}>Contraseña {!esLogin&&"(mín. 6 caracteres)"}</label>
            <input style={st.input} type="password" placeholder="••••••" value={esLogin?loginForm.pass:regForm.pass} onChange={e=>esLogin?setLoginForm(p=>({...p,pass:e.target.value})):setRegForm(p=>({...p,pass:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&esLogin&&login()}/>
            {loginError&&<div style={{color:C.danger,fontSize:13,marginBottom:10}}>⚠️ {loginError}</div>}
            <button style={st.btn(tipoActual==="fletyer"?GRAD_B:GRAD)} onClick={esLogin?login:registrar}>{esLogin?"Ingresar":"Registrarme"}</button>
            {tipoActual!=="admin"&&<button style={st.btnOut(C.cyan)} onClick={()=>{setLoginError("");setTipoReg(esLogin?`${tipoActual}-registro`:`${tipoActual}-login`);}}>{esLogin?"Crear cuenta nueva":"Ya tengo cuenta, ingresar"}</button>}
          </div>
        </div>
      </div>
    );
  }

  // ═══ APP ════════════════════════════════════════════════════════════════
  const tipoUsuario=perfil.tipo;
  const usuarioActual=perfil;

  // ─── CHAT ──────────────────────────────────────────────────────────────
    if(chatActivo){
      const sol=solicitudes.find(s=>s.id===chatActivo.solicitudId);
      const msgs=sol?.chats?.[chatActivo.fletyerId]||[];
      const fletyer=usuarios.find(u=>u.id===chatActivo.fletyerId);
      const cliente=usuarios.find(u=>u.id===sol?.clienteId);
      const esCliente=tipoUsuario==="cliente";
      const esFletyer=tipoUsuario==="fletyer"&&usuarioActual.id===chatActivo.fletyerId;
      const aceptado=sol?.fleteroAceptado===chatActivo.fletyerId;
      const finalizado=sol?.estado==="finalizado";
      const enCurso=sol?.estado==="en_curso"&&aceptado;
      const puedoEscribir=!finalizado&&(sol?.estado==="activa"||aceptado);
      const ofertaEste=sol?.ofertasFletyer?.[chatActivo.fletyerId];
      const precioBloqueado=ofertaEste?.bloqueado;

      return(
        <div style={{...st.wrap,paddingBottom:0}}>
          <div style={st.header}>
            <button onClick={()=>setChatActivo(null)} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>←</button>
            <div style={{textAlign:"center"}}>
              <div style={{fontWeight:700,fontSize:15}}>{tipoUsuario==="admin"?`${sol?.clienteNombre} ↔ ${fletyer?.nombre}`:esCliente?`🚚 ${fletyer?.nombre}`:`🏠 ${sol?.clienteNombre}`}</div>
              <div style={{fontSize:11,opacity:0.85}}>{sol?.origen} → {sol?.destino}</div>
            </div>
            <div/>
          </div>

          {finalizado&&<div style={{width:"100%",background:C.success,color:"#fff",textAlign:"center",padding:"9px",fontSize:13,fontWeight:700,boxSizing:"border-box"}}>✅ Viaje finalizado. ¡Gracias por usar FLETY!</div>}
          {sol?.estado==="en_curso"&&!aceptado&&<div style={{width:"100%",background:C.danger,color:"#fff",textAlign:"center",padding:"9px",fontSize:13,fontWeight:700,boxSizing:"border-box"}}>🔒 Solicitud tomada por otro Fletyer.</div>}

          <div style={{...st.cont,flex:1,display:"flex",flexDirection:"column",maxHeight:"calc(100vh - 115px)",overflowY:"auto"}}>
            {tipoUsuario!=="admin"&&(
              <button style={{...st.btnOut(C.blue),marginBottom:8}} onClick={()=>setPerfilVisto(esCliente?fletyer:cliente)}>
                👤 Ver perfil de {esCliente?fletyer?.nombre:sol?.clienteNombre}
              </button>
            )}

            {/* ── PRECIO: visible siempre para todos ── */}
            {ofertaEste&&<PrecioClienteTag oferta={ofertaEste.precio} tipo={sol.tipo}/>}

            {/* ── Fletyer puede modificar precio si no está bloqueado ── */}
            {esFletyer&&!finalizado&&(
              <div style={{background:`${C.blue}08`,border:`1.5px solid ${C.blue}22`,borderRadius:12,padding:"12px 14px",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,color:C.blue,marginBottom:8}}>
                  {ofertaEste?"✏️ Modificar mi precio":"⚡ Publicar mi precio"}
                  {precioBloqueado&&<span style={{...st.tag(C.warning),marginLeft:8,fontSize:10}}>🔒 Bloqueado (cliente aceptó)</span>}
                </div>
                {!precioBloqueado?(
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <div style={{position:"relative",flex:1}}>
                      <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontWeight:700,color:C.blue}}>$</span>
                      <input type="number" min="0" style={{...st.input,marginBottom:0,paddingLeft:24,fontWeight:700}} placeholder={ofertaEste?String(ofertaEste.precio):(sol?.tipo==="mudanza"?"Precio/hora":"Precio total")} value={getPrecioInput(sol.id)} onChange={e=>setPrecioInput(sol.id,e.target.value)}/>
                    </div>
                    <button style={st.btnSm(GRAD_B)} disabled={!getPrecioInput(sol.id)||parseFloat(getPrecioInput(sol.id))<=0}
                      onClick={()=>ofertaEste?modificarOferta(sol.id,getPrecioInput(sol.id)):guardarOfertaFletyer(sol.id,getPrecioInput(sol.id))}>
                      {ofertaEste?"Actualizar":"Publicar"}
                    </button>
                  </div>
                ):<div style={{fontSize:12,color:C.muted}}>No podés modificar el precio luego de que el cliente te aceptó.</div>}
                {sol?.tipo==="mudanza"&&!precioBloqueado&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>💡 El cliente verá este valor como precio/hora. Al finalizar se multiplica por el tiempo real.</div>}
              </div>
            )}

            {/* ── Contador / estado del viaje ── */}
            {enCurso&&<ContadorViaje sol={sol} tipoUsuario={tipoUsuario} onIniciar={()=>iniciarViaje(sol.id)} onFinalizar={(s)=>finalizarViaje(sol.id,s)}/>}

            {/* ── Resumen final ── */}
            {finalizado&&<ResumenViaje sol={sol} comisionPct={comisionPct}/>}

            {/* ── Acciones cliente ── */}
            {esCliente&&sol?.estado==="activa"&&ofertaEste&&(
              <button style={{...st.btn(C.success),marginBottom:8}} onClick={()=>aceptarFletyer(sol.id,chatActivo.fletyerId)}>✅ Aceptar oferta de {fletyer?.nombre}</button>
            )}
            {esCliente&&sol?.estado==="activa"&&!ofertaEste&&(
              <div style={{background:`${C.warning}12`,borderRadius:12,padding:"10px 14px",marginBottom:8,fontSize:13,color:C.warning,fontWeight:600}}>⏳ Esperando que el Fletyer publique su precio...</div>
            )}
            {(esCliente||esFletyer)&&enCurso&&!sol?.viajeInicio&&(
              <button style={{...st.btnOut(C.warning),marginBottom:8,color:C.warning}} onClick={()=>cancelarViaje(sol.id)}>↩️ Cancelar y volver a disponibles</button>
            )}
            {esCliente&&finalizado&&!sol.calificado&&(
              <button style={{...st.btn(C.warning),marginBottom:8}} onClick={()=>setModalCalificar({solicitudId:sol.id,fletyerId:Number(chatActivo.fletyerId)})}>⭐ Calificar a {fletyer?.nombre}</button>
            )}
            {esCliente&&finalizado&&sol.calificado&&(
              <div style={{...st.tag(C.success),textAlign:"center",marginBottom:8,padding:"8px 0",width:"100%",display:"block"}}>✅ Ya calificaste este viaje</div>
            )}

            {/* ── Mensajes ── */}
            {msgs.length===0&&<div style={{textAlign:"center",color:C.muted,fontSize:13,marginTop:20}}>Aún no hay mensajes.</div>}
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
              {msgs.map((m,i)=>{
                const isMe=(esCliente&&m.de==="cliente")||(esFletyer&&m.de==="fletyer"&&m.fletyerId===usuarioActual.id);
                return(
                  <div key={i} style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start"}}>
                    <div style={{background:isMe?C.cyan+"22":m.esOfertaAutomatica?"#FFF8E7":"#F0F4FF",borderRadius:14,padding:"8px 13px",maxWidth:"78%",fontSize:13,border:m.esOfertaAutomatica?`1px solid ${C.warning}44`:"none"}}>
                      {m.esOfertaAutomatica&&<div style={{fontSize:10,color:C.warning,fontWeight:700,marginBottom:3}}>💬 OFERTA AUTOMÁTICA</div>}
                      <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:2}}>{m.de==="fletyer"?`🚚 ${m.fletyerNombre}`:"🏠 Cliente"}</div>
                      {m.texto}
                      <div style={{fontSize:10,color:C.muted,textAlign:"right",marginTop:2}}>{m.hora}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {tipoUsuario!=="admin"&&puedoEscribir&&(
            <div style={{width:"100%",maxWidth:480,padding:"10px 13px",boxSizing:"border-box",background:"#fff",borderTop:`1px solid ${C.cyan}33`,display:"flex",gap:8}}>
              <input style={{...st.input,marginBottom:0,flex:1}} placeholder="Escribí tu mensaje..." value={nuevoMsg} onChange={e=>setNuevoMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&enviarMsg()}/>
              <button style={{...st.btn(GRAD),width:44,marginBottom:0,padding:0,borderRadius:12}} onClick={enviarMsg}>➤</button>
            </div>
          )}
          {tipoUsuario==="admin"&&<div style={{padding:10,textAlign:"center",fontSize:12,color:C.muted}}>Vista Admin — solo lectura</div>}
        </div>
      );
    }

    // ─── NUEVA SOLICITUD ───────────────────────────────────────────────────
    if(tab==="nueva-sol"){
      const mostrarMapa=nuevaSol.origen.length>4&&nuevaSol.destino.length>4;
      return(
        <div style={st.wrap}>
          <div style={st.header}>
            <button onClick={()=>setTab("inicio")} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>←</button>
            <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={24}/><span style={st.logoTxt}>Nueva Solicitud</span></div>
            <div/>
          </div>
          <div style={st.cont}>
            <div style={st.card}>
              <label style={st.label}>Tipo de servicio</label>
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                {[{v:"mudanza",icon:"🏠",label:"Mudanza"},{v:"flete",icon:"📦",label:"Flete / Encomienda"}].map(op=>(
                  <button key={op.v} onClick={()=>setNuevaSol(p=>({...p,tipo:op.v}))}
                    style={{flex:1,padding:"10px 0",borderRadius:12,border:`2px solid ${nuevaSol.tipo===op.v?C.cyan:"#ddd"}`,background:nuevaSol.tipo===op.v?C.cyan+"18":"#fff",color:nuevaSol.tipo===op.v?C.blue:C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {op.icon} {op.label}
                  </button>
                ))}
              </div>
              <InputDireccion label="📍 Partida" placeholder="Ej: Rivera 1234, Montevideo" value={nuevaSol.origen} onChange={v=>setNuevaSol(p=>({...p,origen:v}))}/>
              <InputDireccion label="🏁 Destino" placeholder="Ej: Agraciada 567, Montevideo" value={nuevaSol.destino} onChange={v=>setNuevaSol(p=>({...p,destino:v}))}/>
              {mostrarMapa&&<MiniMapa origen={nuevaSol.origen} destino={nuevaSol.destino}/>}
              <label style={st.label}>{nuevaSol.tipo==="mudanza"?"📝 Descripción":"📦 Descripción del envío"}</label>
              <textarea style={st.textarea} placeholder={nuevaSol.tipo==="mudanza"?"Ej: 2 ambientes, heladera...":"Ej: 3 cajas medianas..."} value={nuevaSol.descripcion} onChange={e=>setNuevaSol(p=>({...p,descripcion:e.target.value}))}/>
              <button style={st.btn(GRAD)} onClick={publicarSolicitud}>🚀 Publicar Solicitud</button>
            </div>
          </div>
        </div>
      );
    }

    // ─── INICIO CLIENTE ────────────────────────────────────────────────────
    if(tab==="inicio"&&tipoUsuario==="cliente"){
      const enCurso=solicitudes.filter(s=>s.clienteId===usuarioActual.id&&s.estado==="en_curso");
      const activas=solicitudes.filter(s=>s.clienteId===usuarioActual.id&&s.estado==="activa");
      return(
        <div style={st.wrap}>
          <div style={st.header}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={26}/><span style={st.logoTxt}>FLETY</span></div>
            <button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button>
          </div>
          <div style={st.cont}>
            {avisoPublicado&&<div style={{background:C.success,color:"#fff",padding:"12px 16px",borderRadius:14,marginBottom:14,fontWeight:700,textAlign:"center"}}>✅ ¡Solicitud publicada!</div>}
            <div style={{...st.card,background:GRAD,marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:16,color:"#fff"}}>Hola, {usuarioActual.nombre} 👋</div>
              <div style={{fontSize:13,color:"rgba(255,255,255,0.8)"}}>¿Qué necesitás hoy?</div>
              <div style={{display:"flex",gap:10,marginTop:12}}>
                {[{n:activas.length,l:"Activas"},{n:enCurso.length,l:"En curso"},{n:usuarios.filter(u=>u.tipo==="fletyer").length,l:"Fletyers"}].map(x=>(
                  <div key={x.l} style={{flex:1,background:"rgba(255,255,255,0.2)",borderRadius:12,padding:"8px",textAlign:"center"}}>
                    <div style={{fontSize:18,fontWeight:900,color:"#fff"}}>{x.n}</div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,0.8)"}}>{x.l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              <button style={{...st.btn(GRAD),flex:1,marginBottom:0,flexDirection:"column",display:"flex",alignItems:"center",padding:"16px 0",gap:4,fontSize:13}} onClick={()=>{setNuevaSol(p=>({...p,tipo:"mudanza"}));setTab("nueva-sol");}}>
                <span style={{fontSize:26}}>🏠</span>Mudanza
              </button>
              <button style={{...st.btn(GRAD_B),flex:1,marginBottom:0,flexDirection:"column",display:"flex",alignItems:"center",padding:"16px 0",gap:4,fontSize:13}} onClick={()=>{setNuevaSol(p=>({...p,tipo:"flete"}));setTab("nueva-sol");}}>
                <span style={{fontSize:26}}>📦</span>Pedir Flete
              </button>
            </div>
            <div style={{...st.title,fontSize:15,marginBottom:10}}>Solicitudes recientes</div>
            {solicitudes.filter(s=>s.clienteId===usuarioActual.id).slice(0,3).map(sol=>{
              const e=estadoLabel(sol.estado);
              const ofertas=Object.values(sol.ofertasFletyer||{});
              return(
                <div key={sol.id} style={{...st.card,padding:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span>
                    <span style={st.tag(e.col)}>{e.label}</span>
                  </div>
                  <div style={{fontSize:13}}>📍 {sol.origen}</div>
                  <div style={{fontSize:13}}>🏁 {sol.destino}</div>
                  {ofertas.length>0&&<div style={{fontSize:12,color:C.cyan,marginTop:4,fontWeight:600}}>💬 {ofertas.length} oferta(s) recibida(s)</div>}
                </div>
              );
            })}
          </div>
          <TabBar/>
        </div>
      );
    }

    // ─── SOLICITUDES CLIENTE ───────────────────────────────────────────────
    if(tab==="solicitudes"&&tipoUsuario==="cliente"){
      const misSols=solicitudes.filter(s=>s.clienteId===usuarioActual.id);
      return(
        <div style={st.wrap}>
          <div style={st.header}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={26}/><span style={st.logoTxt}>FLETY</span></div>
            <button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button>
          </div>
          <div style={st.cont}>
            <div style={{...st.title,fontSize:16,marginBottom:10}}>Mis solicitudes ({misSols.length})</div>
            {misSols.length===0&&<div style={{...st.card,textAlign:"center",color:C.muted,fontSize:13}}>Aún no tenés solicitudes.</div>}
            {misSols.map(sol=>{
              const e=estadoLabel(sol.estado);
              const nC=Object.keys(sol.chats).length;
              return(
                <div key={sol.id} style={st.card}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,alignItems:"center"}}>
                    <span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={st.tag(e.col)}>{e.label}</span>
                      {sol.estado==="activa"&&(
                        <button onClick={()=>eliminarSolicitud(sol.id)}
                          style={{background:"none",border:`1.5px solid ${C.danger}`,borderRadius:8,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:C.danger,fontSize:15,flexShrink:0}}
                          title="Eliminar solicitud">🗑️</button>
                      )}
                    </div>
                  </div>
                  <MiniMapa origen={sol.origen} destino={sol.destino}/>
                  <div style={{fontSize:13}}>📍 {sol.origen}</div>
                  <div style={{fontSize:13}}>🏁 {sol.destino}</div>
                  {sol.descripcion&&<div style={{fontSize:12,color:C.muted,marginTop:4,fontStyle:"italic"}}>"{sol.descripcion}"</div>}
                  {sol.estado==="finalizado"&&<ResumenViaje sol={sol} comisionPct={comisionPct} mostrarComision={false}/>}
                  <div style={{fontSize:12,color:C.muted,marginTop:6}}>💬 {nC} Fletyer(s) contactaron</div>
                  {sol.estado==="en_curso"&&!sol.viajeInicio&&<button style={{...st.btnOut(C.warning),color:C.warning,marginTop:8}} onClick={()=>cancelarViaje(sol.id)}>↩️ Cancelar viaje</button>}
                  {sol.estado==="finalizado"&&!sol.calificado&&<button style={{...st.btn(C.warning),marginTop:8}} onClick={()=>setModalCalificar({solicitudId:sol.id,fletyerId:Number(sol.fleteroAceptado)})}>⭐ Calificar al Fletyer</button>}
                  {/* Fletyers que ofertaron */}
                  {Object.keys(sol.chats).map(fid=>{
                    const fl=usuarios.find(u=>u.id===parseInt(fid));
                    const fAcept=sol.fleteroAceptado===parseInt(fid);
                    const oferta=sol.ofertasFletyer?.[parseInt(fid)];
                    const prom=promedioEstrellas(fl?.calificaciones);
                    return(
                      <div key={fid} style={{display:"flex",alignItems:"center",gap:8,marginTop:8,padding:"10px",background:"#F0FAFA",borderRadius:12}}>
                        <button onClick={()=>setPerfilVisto(fl)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Avatar u={fl} size={36}/></button>
                        <div style={{flex:1}}>
                          <button onClick={()=>setPerfilVisto(fl)} style={{background:"none",border:"none",cursor:"pointer",padding:0,textAlign:"left"}}>
                            <div style={{fontSize:13,fontWeight:700,color:C.blue,textDecoration:"underline dotted"}}>{fl?.nombre}</div>
                          </button>
                          <div style={{display:"flex",alignItems:"center",gap:4}}>
                            <Estrellas valor={Math.round(parseFloat(prom))} size={13}/>
                            {prom>0&&<span style={{fontSize:11,color:C.muted}}>{prom}</span>}
                          </div>
                          {oferta&&<div style={{fontSize:13,fontWeight:800,color:sol.tipo==="mudanza"?C.blue:C.cyan,marginTop:2}}>{formatUYU(oferta.precio)}{sol.tipo==="mudanza"?"/h":""}</div>}
                        </div>
                        {fAcept&&<span style={st.tag(C.success)}>✅</span>}
                        <button style={{...st.btn(fAcept?C.success:GRAD,0),width:"auto",padding:"6px 14px",fontSize:12}} onClick={()=>setChatActivo({solicitudId:sol.id,fletyerId:parseInt(fid)})}>Chat</button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <TabBar/>
        </div>
      );
    }

    // ─── INICIO FLETYER ────────────────────────────────────────────────────
    if(tab==="inicio"&&tipoUsuario==="fletyer"){
      const activas=solicitudes.filter(s=>s.estado==="activa");
      const vKey=usuarioActual.vehiculoKey||detectarVehiculoKey(usuarioActual.vehiculo);
      const tarifa=getTarifa(vKey,tarifas);
      const uActual=usuarios.find(u=>u.id===usuarioActual.id)||usuarioActual;
      const estaHabilitado=uActual.habilitado===true;
      return(
        <div style={st.wrap}>
          <div style={st.header}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={26}/><span style={st.logoTxt}>FLETY</span></div>
            <button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button>
          </div>
          <div style={st.cont}>
            <div style={{...st.card,background:GRAD_B,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontWeight:700,color:"#fff"}}>Hola, {usuarioActual.nombre} 🚚</div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,0.8)"}}>{tarifa.icon} {usuarioActual.vehiculo}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>Tus tarifas sugeridas</div>
                  <div style={{fontSize:14,fontWeight:800,color:"#fff"}}>{formatUYU(tarifa.kmRate)}/km</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.8)"}}>{formatUYU(tarifa.hrRate)}/hora</div>
                </div>
              </div>
            </div>

            {/* ── BLOQUEO si no está habilitado ── */}
            {!estaHabilitado?(
              <div style={{...st.card,textAlign:"center",padding:"28px 20px",border:`2px solid ${C.warning}55`}}>
                <div style={{fontSize:36,marginBottom:12}}>🔒</div>
                <div style={{fontSize:16,fontWeight:800,color:C.warning,marginBottom:8}}>Cuenta pendiente de activación</div>
                <div style={{fontSize:13,color:C.muted,lineHeight:1.6,marginBottom:16}}>
                  Para poder ver y ofertar solicitudes, el equipo de FLETY debe verificar tu documentación.<br/><br/>
                  Asegurate de haber cargado en <strong>"Mi Cuenta"</strong>:<br/>
                  ✅ Libreta de conducir (vigente)<br/>
                  ✅ Cédula de identidad (frente y dorso)
                </div>
                <button style={st.btn(GRAD_B)} onClick={()=>setTab("cuenta")}>📋 Ir a Mi Cuenta</button>
              </div>
            ):(
              <>
                <div style={{...st.title,fontSize:16,marginBottom:10}}>Solicitudes disponibles ({activas.length})</div>
                {activas.length===0&&<div style={{...st.card,textAlign:"center",color:C.muted,fontSize:13}}>No hay solicitudes activas.</div>}
                {activas.map(sol=>{
                  const dist=sol.distancia||calcularDistancia(sol.origen,sol.destino);
                  const cliente=usuarios.find(u=>u.id===sol.clienteId);
                  const miOferta=sol.ofertasFletyer?.[usuarioActual.id];
                  const hayChat=!!(sol.chats[usuarioActual.id]?.length);
                  const hrEst=Math.max(1,Math.round(dist/15));
                  const estimadoKm=Math.round(dist*tarifa.kmRate);
                  const estimadoHr=tarifa.hrRate;
                  return(
                    <div key={sol.id} style={st.card}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                        <span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span>
                        <span style={st.tag(C.success)}>● Disponible</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                        <button onClick={()=>setPerfilVisto(cliente)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Avatar u={cliente} size={30}/></button>
                        <button onClick={()=>setPerfilVisto(cliente)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}>
                          <span style={{fontSize:14,fontWeight:700,color:C.blue,textDecoration:"underline dotted"}}>{sol.clienteNombre}</span>
                        </button>
                        <span style={{fontSize:11,color:C.muted,marginLeft:"auto"}}>📅 {sol.fecha}</span>
                      </div>
                      <MiniMapa origen={sol.origen} destino={sol.destino}/>
                      <div style={{fontSize:13}}>📍 {sol.origen}</div>
                      <div style={{fontSize:13}}>🏁 {sol.destino}</div>
                      {sol.descripcion&&<div style={{fontSize:12,color:C.muted,marginTop:4,fontStyle:"italic"}}>"{sol.descripcion}"</div>}
                      <div style={{fontSize:12,marginTop:4}}>📞 {sol.clienteTelefono}</div>
                      <div style={{background:`${C.blue}09`,borderRadius:10,padding:"8px 12px",marginTop:8,marginBottom:8}}>
                        <div style={{fontSize:11,color:C.blue,fontWeight:700,marginBottom:4}}>📊 Tu referencia ({tarifa.icon} {tarifa.label})</div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
                          <span style={{color:C.muted}}>{sol.tipo==="mudanza"?"Sugerido/hora:":"Sugerido/flete:"}</span>
                          <span style={{fontWeight:700,color:C.blue}}>{sol.tipo==="mudanza"?formatUYU(estimadoHr)+"/h":formatUYU(estimadoKm)}</span>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginTop:2}}>
                          <span style={{color:C.muted}}>Recibís (−{comisionPct}%):</span>
                          <span style={{color:C.success,fontWeight:700}}>{sol.tipo==="mudanza"?formatUYU(Math.round(estimadoHr*(1-comisionPct/100)))+"/h":formatUYU(Math.round(estimadoKm*(1-comisionPct/100)))}</span>
                        </div>
                      </div>
                      {!miOferta?(
                        <div style={{background:`${C.warning}10`,border:`1.5px solid ${C.warning}33`,borderRadius:12,padding:"12px 14px",marginBottom:8}}>
                          <div style={{fontSize:12,fontWeight:700,color:C.warning,marginBottom:8}}>{sol.tipo==="mudanza"?"⚡ Ingresá tu precio por hora":"⚡ Ingresá tu precio total"}</div>
                          <div style={{display:"flex",gap:8}}>
                            <div style={{position:"relative",flex:1}}>
                              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontWeight:700,color:C.blue}}>$</span>
                              <input type="number" min="0" style={{...st.input,marginBottom:0,paddingLeft:24,fontWeight:700}} placeholder={sol.tipo==="mudanza"?String(estimadoHr):String(estimadoKm)} value={getPrecioInput(sol.id)} onChange={e=>setPrecioInput(sol.id,e.target.value)}/>
                            </div>
                            <button style={st.btnSm(GRAD_B)} disabled={!getPrecioInput(sol.id)||parseFloat(getPrecioInput(sol.id))<=0} onClick={()=>guardarOfertaFletyer(sol.id,getPrecioInput(sol.id))}>Ofertar</button>
                          </div>
                          <div style={{fontSize:11,color:C.muted,marginTop:5}}>Al publicar tu precio, se enviará al cliente automáticamente.</div>
                        </div>
                      ):(
                        <div style={{background:`${C.success}12`,border:`1.5px solid ${C.success}33`,borderRadius:12,padding:"10px 14px",marginBottom:8}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                            <span style={{fontSize:12,color:C.muted,fontWeight:700}}>✅ Tu oferta publicada:</span>
                            <span style={{fontSize:18,fontWeight:900,color:C.success}}>{formatUYU(miOferta.precio)}{sol.tipo==="mudanza"?"/h":""}</span>
                          </div>
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            <div style={{position:"relative",flex:1}}>
                              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontWeight:700,color:C.blue}}>$</span>
                              <input type="number" min="0" style={{...st.input,marginBottom:0,paddingLeft:24,fontSize:13}} placeholder="Nuevo precio..." value={getPrecioInput(sol.id)} onChange={e=>setPrecioInput(sol.id,e.target.value)}/>
                            </div>
                            <button style={st.btnSm(`linear-gradient(135deg,${C.warning},#e0a000)`)} disabled={!getPrecioInput(sol.id)||parseFloat(getPrecioInput(sol.id))<=0} onClick={()=>modificarOferta(sol.id,getPrecioInput(sol.id))}>Modificar</button>
                          </div>
                        </div>
                      )}
                      <button style={{...st.btn(hayChat?GRAD:GRAD_B),marginTop:2,marginBottom:0}} onClick={()=>setChatActivo({solicitudId:sol.id,fletyerId:usuarioActual.id})}>
                        {hayChat?"💬 Ver mi chat":"💬 Abrir chat con cliente"}
                      </button>
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

    // ─── MIS TRABAJOS FLETYER ──────────────────────────────────────────────
    if(tab==="solicitudes"&&tipoUsuario==="fletyer"){
      const misTrab=solicitudes.filter(s=>(s.estado==="en_curso"||s.estado==="finalizado")&&s.fleteroAceptado===usuarioActual.id);
      return(
        <div style={st.wrap}>
          <div style={st.header}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={26}/><span style={st.logoTxt}>FLETY</span></div>
            <button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button>
          </div>
          <div style={st.cont}>
            <div style={{...st.title,fontSize:16,marginBottom:10}}>Mis trabajos</div>
            {misTrab.length===0&&<div style={{...st.card,textAlign:"center",color:C.muted,fontSize:13}}>Aún no tenés trabajos asignados.</div>}
            {misTrab.map(sol=>{const e=estadoLabel(sol.estado);const cliente=usuarios.find(u=>u.id===sol.clienteId);return(
              <div key={sol.id} style={{...st.card,borderLeft:`4px solid ${e.col}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span>
                  <span style={st.tag(e.col)}>{e.label}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <button onClick={()=>setPerfilVisto(cliente)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Avatar u={cliente} size={30}/></button>
                  <span style={{fontSize:14,fontWeight:700,color:C.blue}}>{sol.clienteNombre}</span>
                </div>
                <MiniMapa origen={sol.origen} destino={sol.destino}/>
                <div style={{fontSize:13}}>📍 {sol.origen}</div>
                <div style={{fontSize:13}}>🏁 {sol.destino}</div>
                {sol.precioFletyer&&<div style={{background:sol.tipo==="mudanza"?`${C.blue}12`:`${C.cyan}12`,borderRadius:10,padding:"8px 12px",marginTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:12,color:C.muted,fontWeight:700}}>{sol.tipo==="mudanza"?"💰 Tu precio/h":"💰 Precio acordado"}</span>
                  <span style={{fontSize:17,fontWeight:900,color:sol.tipo==="mudanza"?C.blue:C.cyan}}>{formatUYU(sol.precioFletyer)}{sol.tipo==="mudanza"?"/h":""}</span>
                </div>}
                {sol.estado==="finalizado"&&<ResumenViaje sol={sol} comisionPct={comisionPct}/>}
                <button style={{...st.btn(GRAD,8),marginTop:10}} onClick={()=>setChatActivo({solicitudId:sol.id,fletyerId:usuarioActual.id})}>💬 Chat</button>
                {sol.estado==="en_curso"&&!sol.viajeInicio&&<button style={{...st.btnOut(C.warning),color:C.warning,marginBottom:0}} onClick={()=>cancelarViaje(sol.id)}>↩️ Cancelar trabajo</button>}
              </div>
            );})}
          </div>
          <TabBar/>
        </div>
      );
    }

    // ─── MI CUENTA ─────────────────────────────────────────────────────────
    if(tab==="cuenta"){
      const campos=tipoUsuario==="cliente"?["nombre","edad","direccion","telefono"]:["nombre","edad","direccion","telefono","vehiculo"];
      const uAct=usuarios.find(u=>u.id===usuarioActual.id)||usuarioActual;
      const vKey=uAct.vehiculoKey||detectarVehiculoKey(uAct.vehiculo);
      const tarifa=tipoUsuario==="fletyer"?getTarifa(vKey,tarifas):null;
      // Historial de viajes finalizados del fletyer
      const finalizados=tipoUsuario==="fletyer"?solicitudes.filter(s=>s.estado==="finalizado"&&s.fleteroAceptado===usuarioActual.id):[];
      const totalBruto=finalizados.reduce((a,s)=>a+costoViaje(s),0);
      const totalComision=finalizados.reduce((a,s)=>a+Math.round(costoViaje(s)*(comisionPct/100)),0);
      const totalNeto=totalBruto-totalComision;
      // Historial cliente
      const finalizadosCliente=tipoUsuario==="cliente"?solicitudes.filter(s=>s.estado==="finalizado"&&s.clienteId===usuarioActual.id):[];
      const totalPagadoCliente=finalizadosCliente.reduce((a,s)=>a+costoViaje(s),0);
      return(
        <div style={st.wrap}>
          <div style={st.header}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={26}/><span style={st.logoTxt}>FLETY</span></div>
            <button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button>
          </div>
          <div style={st.cont}>
            <div style={{...st.card,background:GRAD,borderRadius:"18px 18px 0 0",padding:"28px 18px 20px",marginBottom:0}}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
                <div style={{position:"relative"}}>
                  <Avatar u={uAct} size={88}/>
                  <button onClick={()=>fotoRef.current.click()} style={{position:"absolute",bottom:0,right:0,background:C.blue,border:"none",borderRadius:"50%",width:28,height:28,color:"#fff",cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>📷</button>
                  <input ref={fotoRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleFoto}/>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontWeight:800,fontSize:19,color:"#fff"}}>{uAct.nombre}</div>
                  <span style={{background:"rgba(255,255,255,0.25)",color:"#fff",borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700}}>{tipoUsuario==="cliente"?"🏠 Cliente":"🚚 Fletyer"}</span>
                </div>
                {tipoUsuario==="fletyer"&&(
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <Estrellas valor={Math.round(parseFloat(promedioEstrellas(uAct.calificaciones)))} size={20}/>
                    <span style={{color:"#fff",fontWeight:700,fontSize:13}}>{promedioEstrellas(uAct.calificaciones)>0?`${promedioEstrellas(uAct.calificaciones)} (${uAct.calificaciones?.length})`:"Sin calificaciones"}</span>
                  </div>
                )}
              </div>
            </div>
            <div style={{...st.card,borderRadius:"0 0 18px 18px",paddingTop:20}}>
              {!editMode?(
                <>
                  {campos.map(c=>(
                    <div key={c} style={{borderBottom:`1px solid ${C.cyan}22`,paddingBottom:10,marginBottom:10}}>
                      <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{c==="vehiculo"?"Vehículo":c}</div>
                      <div style={{fontSize:15,fontWeight:600,marginTop:2}}>{uAct[c]||"—"}</div>
                    </div>
                  ))}
                  <button style={st.btn(GRAD)} onClick={()=>{setEditData({...uAct});setEditMode(true);}}>✏️ Editar datos</button>
                </>
              ):(
                <>
                  {campos.map(c=>(
                    <div key={c}>
                      <label style={st.label}>{c==="vehiculo"?"Tipo de Vehículo":c.charAt(0).toUpperCase()+c.slice(1)}</label>
                      <input style={st.input} value={editData[c]||""} onChange={e=>setEditData(p=>({...p,[c]:e.target.value}))}/>
                    </div>
                  ))}
                  <div style={{display:"flex",gap:10}}>
                    <button style={{...st.btn(C.success),flex:1}} onClick={guardarEdicion}>Guardar</button>
                    <button style={{...st.btn(C.muted),flex:1}} onClick={()=>setEditMode(false)}>Cancelar</button>
                  </div>
                </>
              )}
            </div>

            {/* ── Mis tarifas (Fletyer) ── */}
            {tipoUsuario==="fletyer"&&tarifa&&(
              <div style={st.card}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>💰 Mis tarifas actuales</div>
                <div style={{display:"flex",gap:10}}>
                  <div style={{flex:1,background:`${C.cyan}12`,borderRadius:12,padding:"10px",textAlign:"center"}}>
                    <div style={{fontSize:11,color:C.muted}}>Por km (flete)</div>
                    <div style={{fontSize:18,fontWeight:800,color:C.cyan}}>{formatUYU(tarifa.kmRate)}</div>
                  </div>
                  <div style={{flex:1,background:`${C.blue}12`,borderRadius:12,padding:"10px",textAlign:"center"}}>
                    <div style={{fontSize:11,color:C.muted}}>Por hora (mudanza)</div>
                    <div style={{fontSize:18,fontWeight:800,color:C.blue}}>{formatUYU(tarifa.hrRate)}</div>
                  </div>
                </div>
                <div style={{fontSize:11,color:C.muted,marginTop:8,textAlign:"center"}}>{tarifa.icon} {tarifa.label} · comisión Flety: {comisionPct}%</div>
              </div>
            )}

            {/* ── DOCUMENTOS PRIVADOS (solo fletyer ve los suyos) ── */}
            {tipoUsuario==="fletyer"&&(()=>{
              const u=usuarios.find(x=>x.id===usuarioActual.id)||usuarioActual;
              const estadoLibreta=(()=>{
                if(!u.libretaHasta)return{label:"Sin datos",col:C.muted};
                const hoy=new Date(),hasta=new Date(u.libretaHasta);
                const dias=Math.round((hasta-hoy)/(1000*60*60*24));
                if(dias<0)return{label:"⛔ Vencida",col:C.danger};
                if(dias<60)return{label:`⚠️ Vence en ${dias} días`,col:C.warning};
                return{label:"✅ Vigente",col:C.success};
              })();
              return(
                <div style={st.card}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                    <span style={{fontSize:18}}>🔒</span>
                    <div>
                      <div style={{fontSize:14,fontWeight:800}}>Documentos privados</div>
                      <div style={{fontSize:11,color:C.muted}}>Solo vos y el Admin pueden ver esta información</div>
                    </div>
                  </div>

                  {/* ── LIBRETA DE CONDUCIR ── */}
                  <div style={{borderBottom:`1px solid ${C.cyan}20`,paddingBottom:14,marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontSize:13,fontWeight:700}}>🪪 Libreta de conducir</div>
                      <span style={{...st.tag(estadoLibreta.col),fontSize:11}}>{estadoLibreta.label}</span>
                    </div>
                    <div style={{display:"flex",gap:10,marginBottom:10}}>
                      <div style={{flex:1}}>
                        <label style={st.label}>Vigente desde</label>
                        <input type="date" style={{...st.input,marginBottom:0}} value={u.libretaDesde||""}
                          onChange={e=>{const v=e.target.value;setUsuarios(p=>p.map(x=>x.id===usuarioActual.id?{...x,libretaDesde:v}:x));setUsuarioActual(p=>({...p,libretaDesde:v}));}}/>
                      </div>
                      <div style={{flex:1}}>
                        <label style={st.label}>Válida hasta</label>
                        <input type="date" style={{...st.input,marginBottom:0}} value={u.libretaHasta||""}
                          onChange={e=>{const v=e.target.value;setUsuarios(p=>p.map(x=>x.id===usuarioActual.id?{...x,libretaHasta:v}:x));setUsuarioActual(p=>({...p,libretaHasta:v}));}}/>
                      </div>
                    </div>
                    <label style={st.label}>Imagen de libreta</label>
                    {u.libretaImg?(
                      <div style={{position:"relative",marginBottom:4}}>
                        <img src={u.libretaImg} alt="Libreta" style={{width:"100%",borderRadius:10,maxHeight:160,objectFit:"cover",border:`2px solid ${C.cyan}44`}}/>
                        <button onClick={()=>libretaImgRef.current.click()}
                          style={{position:"absolute",top:6,right:6,...st.btnSm(GRAD_B)}}>📷 Cambiar</button>
                      </div>
                    ):(
                      <button onClick={()=>libretaImgRef.current.click()}
                        style={{...st.btnOut(C.cyan),marginBottom:4,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                        <span style={{fontSize:18}}>📷</span> Subir imagen de libreta
                      </button>
                    )}
                    <input ref={libretaImgRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleDocImg("libretaImg",e)}/>
                  </div>

                  {/* ── CÉDULA DE IDENTIDAD ── */}
                  <div>
                    <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>🪪 Cédula de identidad</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      {/* Frente */}
                      <div>
                        <label style={st.label}>Frente</label>
                        {u.cedulaFrente?(
                          <div style={{position:"relative"}}>
                            <img src={u.cedulaFrente} alt="CI Frente" style={{width:"100%",borderRadius:10,height:100,objectFit:"cover",border:`2px solid ${C.cyan}44`}}/>
                            <button onClick={()=>cedulaFrenteRef.current.click()}
                              style={{position:"absolute",bottom:4,right:4,...st.btnSm(GRAD_B),fontSize:10,padding:"4px 8px"}}>📷</button>
                          </div>
                        ):(
                          <button onClick={()=>cedulaFrenteRef.current.click()}
                            style={{width:"100%",height:80,borderRadius:10,border:`2px dashed ${C.cyan}66`,background:`${C.cyan}08`,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,color:C.cyan,fontWeight:700,fontSize:12}}>
                            <span style={{fontSize:22}}>📷</span>Subir frente
                          </button>
                        )}
                        <input ref={cedulaFrenteRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleDocImg("cedulaFrente",e)}/>
                      </div>
                      {/* Dorso */}
                      <div>
                        <label style={st.label}>Dorso</label>
                        {u.cedulaDorso?(
                          <div style={{position:"relative"}}>
                            <img src={u.cedulaDorso} alt="CI Dorso" style={{width:"100%",borderRadius:10,height:100,objectFit:"cover",border:`2px solid ${C.cyan}44`}}/>
                            <button onClick={()=>cedulaDorsoRef.current.click()}
                              style={{position:"absolute",bottom:4,right:4,...st.btnSm(GRAD_B),fontSize:10,padding:"4px 8px"}}>📷</button>
                          </div>
                        ):(
                          <button onClick={()=>cedulaDorsoRef.current.click()}
                            style={{width:"100%",height:80,borderRadius:10,border:`2px dashed ${C.cyan}66`,background:`${C.cyan}08`,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,color:C.cyan,fontWeight:700,fontSize:12}}>
                            <span style={{fontSize:22}}>📷</span>Subir dorso
                          </button>
                        )}
                        <input ref={cedulaDorsoRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleDocImg("cedulaDorso",e)}/>
                      </div>
                    </div>
                    <div style={{fontSize:11,color:C.muted,marginTop:8,textAlign:"center"}}>🔒 Tus documentos son privados y solo los verá el equipo de FLETY</div>
                  </div>
                </div>
              );
            })()}

            {/* ── Historial / Resumen financiero Fletyer ── */}
            {tipoUsuario==="fletyer"&&(
              <div style={st.card}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>📊 Mi historial de viajes</div>
                {finalizados.length===0?(
                  <div style={{textAlign:"center",color:C.muted,fontSize:13}}>Aún no tenés viajes finalizados.</div>
                ):(
                  <>
                    {finalizados.map((s,i)=>{
                      const costo=costoViaje(s);
                      const com=Math.round(costo*(comisionPct/100));
                      return(
                        <div key={s.id} style={{borderBottom:`1px solid ${C.cyan}18`,paddingBottom:10,marginBottom:10}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div>
                              <div style={{fontSize:13,fontWeight:600}}>{s.tipo==="mudanza"?"🏠 Mudanza":"📦 Flete"}</div>
                              <div style={{fontSize:11,color:C.muted}}>{s.fecha} · {s.origen?.split(",")[0]}→{s.destino?.split(",")[0]}</div>
                              {s.tiempoTotal&&<div style={{fontSize:11,color:C.muted}}>⏱ {formatTiempo(s.tiempoTotal)}</div>}
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:15,fontWeight:800,color:C.success}}>{formatUYU(costo-com)}</div>
                              <div style={{fontSize:11,color:C.danger}}>−{formatUYU(com)} Flety</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{background:GRAD_B,borderRadius:14,padding:"14px",marginTop:4}}>
                      <div style={{fontSize:12,color:"rgba(255,255,255,0.8)",marginBottom:8}}>📈 Totales acumulados</div>
                      <div style={{display:"flex",gap:8}}>
                        <div style={{flex:1,textAlign:"center"}}>
                          <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>Total bruto</div>
                          <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>{formatUYU(totalBruto)}</div>
                        </div>
                        <div style={{flex:1,textAlign:"center"}}>
                          <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>Comisión Flety</div>
                          <div style={{fontSize:16,fontWeight:800,color:"#FFB800"}}>−{formatUYU(totalComision)}</div>
                        </div>
                        <div style={{flex:1,textAlign:"center"}}>
                          <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>Recibís vos</div>
                          <div style={{fontSize:16,fontWeight:800,color:"#7FFFD4"}}>{formatUYU(totalNeto)}</div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Historial cliente ── */}
            {tipoUsuario==="cliente"&&finalizadosCliente.length>0&&(
              <div style={st.card}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>📊 Mi historial de servicios</div>
                {finalizadosCliente.map(s=>{
                  const costo=costoViaje(s);
                  const fl=usuarios.find(u=>u.id===s.fleteroAceptado);
                  return(
                    <div key={s.id} style={{borderBottom:`1px solid ${C.cyan}18`,paddingBottom:10,marginBottom:10}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <div>
                          <div style={{fontSize:13,fontWeight:600}}>{s.tipo==="mudanza"?"🏠 Mudanza":"📦 Flete"}</div>
                          <div style={{fontSize:11,color:C.muted}}>{s.fecha} · {fl?.nombre}</div>
                        </div>
                        <div style={{fontSize:15,fontWeight:800,color:C.blue}}>{formatUYU(costo)}</div>
                      </div>
                    </div>
                  );
                })}
                <div style={{display:"flex",justifyContent:"space-between",borderTop:`1px solid ${C.cyan}22`,paddingTop:10}}>
                  <span style={{fontWeight:700}}>Total pagado</span>
                  <span style={{fontSize:16,fontWeight:800,color:C.blue}}>{formatUYU(totalPagadoCliente)}</span>
                </div>
              </div>
            )}

            {/* ── Reseñas fletyer ── */}
            {tipoUsuario==="fletyer"&&uAct.calificaciones?.length>0&&(
              <div style={st.card}>
                <div style={{fontWeight:800,fontSize:15,marginBottom:12}}>⭐ Mis reseñas</div>
                {uAct.calificaciones.map((c,i)=>(
                  <div key={i} style={{borderBottom:`1px solid ${C.cyan}22`,paddingBottom:10,marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between"}}><Estrellas valor={c.estrellas} size={16}/><span style={{fontSize:12,color:C.muted}}>— {c.cliente}</span></div>
                    {c.comentario&&<div style={{fontSize:13,fontStyle:"italic",marginTop:4}}>"{c.comentario}"</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <TabBar/>
        </div>
      );
    }

    // ─── ADMIN: SOLICITUDES ────────────────────────────────────────────────
    if(tab==="admin-sols"){
      return(
        <div style={st.wrap}>
          <div style={st.header}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={24}/><span style={st.logoTxt}>Admin</span></div>
            <button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button>
          </div>
          <div style={st.cont}>
            {/* Stats */}
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              {[{l:"Solicitudes",v:solicitudes.length,c:C.cyan},{l:"Clientes",v:usuarios.filter(u=>u.tipo==="cliente").length,c:C.blue},{l:"Fletyers",v:usuarios.filter(u=>u.tipo==="fletyer").length,c:C.blue}].map(x=>(
                <div key={x.l} style={{...st.card,flex:1,textAlign:"center",marginBottom:0,padding:14}}>
                  <div style={{fontSize:22,fontWeight:800,color:x.c}}>{x.v}</div>
                  <div style={{fontSize:11,color:C.muted}}>{x.l}</div>
                </div>
              ))}
            </div>
            {/* Viajes finalizados: tabla comisiones */}
            {(() => {
              const fins = solicitudes.filter(s=>s.estado==="finalizado");
              const totalCom = fins.filter(s=>!s.comisionPagada).reduce((a,s)=>a+Math.round(costoViaje(s)*(comisionPct/100)),0);
              return fins.length>0&&(
                <div style={st.card}>
                  <div style={{fontSize:14,fontWeight:800,marginBottom:10,color:C.text}}>💰 Comisiones pendientes de cobro</div>
                  {fins.map(sol=>{
                    const fl=usuarios.find(u=>u.id===sol.fleteroAceptado);
                    const costo=costoViaje(sol);
                    const com=Math.round(costo*(comisionPct/100));
                    return(
                      <div key={sol.id} style={{borderBottom:`1px solid ${C.cyan}18`,paddingBottom:10,marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                          <div>
                            <div style={{fontSize:13,fontWeight:700}}>{fl?.nombre||"—"}</div>
                            <div style={{fontSize:11,color:C.muted}}>{sol.clienteNombre} · {sol.tipo==="mudanza"?"🏠":"📦"} {sol.fecha}</div>
                            {sol.tiempoTotal&&<div style={{fontSize:11,color:C.muted}}>⏱ {formatTiempo(sol.tiempoTotal)}</div>}
                            <div style={{fontSize:12,marginTop:2}}>Costo: <strong style={{color:C.success}}>{formatUYU(costo)}</strong></div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            {sol.comisionPagada?(
                              <span style={st.tag(C.success)}>✅ Pagada</span>
                            ):(
                              <>
                                <div style={{fontSize:15,fontWeight:800,color:C.danger}}>−{formatUYU(com)}</div>
                                <button style={{...st.btnSm(C.success),marginTop:6}} onClick={()=>marcarComisionPagada(sol.id)}>Marcar pagada</button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${C.cyan}22`}}>
                    <span style={{fontWeight:700,fontSize:14}}>Total pendiente:</span>
                    <span style={{fontSize:18,fontWeight:900,color:C.danger}}>{formatUYU(totalCom)}</span>
                  </div>
                </div>
              );
            })()}
            {/* Todas las solicitudes */}
            <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>📋 Todas las solicitudes</div>
            {solicitudes.map(sol=>{
              const e=estadoLabel(sol.estado);
              const costo=costoViaje(sol);
              const com=Math.round(costo*(comisionPct/100));
              return(
                <div key={sol.id} style={st.card}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={st.tag(sol.tipo==="flete"?C.blue:C.cyan)}>{sol.tipo==="flete"?"📦 Flete":"🏠 Mudanza"}</span>
                    <span style={st.tag(e.col)}>{e.label}</span>
                  </div>
                  <div style={{fontSize:13,fontWeight:700}}>{sol.clienteNombre}</div>
                  <div style={{fontSize:12,color:C.muted}}>{sol.origen} → {sol.destino}</div>
                  {sol.tiempoTotal&&<div style={{fontSize:12,marginTop:2}}>⏱ {formatTiempo(sol.tiempoTotal)}</div>}
                  {costo>0&&<div style={{display:"flex",gap:8,marginTop:8}}>
                    <div style={{flex:1,background:`${C.cyan}12`,borderRadius:10,padding:"6px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:C.muted}}>Costo total</div>
                      <div style={{fontSize:14,fontWeight:800,color:C.cyan}}>{formatUYU(costo)}</div>
                    </div>
                    <div style={{flex:1,background:`${C.success}12`,borderRadius:10,padding:"6px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:C.muted}}>Comisión Flety</div>
                      <div style={{fontSize:14,fontWeight:800,color:C.success}}>{formatUYU(com)}</div>
                    </div>
                  </div>}
                  {Object.keys(sol.chats).map(fid=>{const fl=usuarios.find(u=>u.id===parseInt(fid));return(
                    <div key={fid} style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
                      <span style={{fontSize:13}}>🚚 {fl?.nombre}</span>
                      <span style={{fontSize:12,color:C.muted}}>({sol.chats[fid].length} msgs)</span>
                      <button style={{...st.btnSm(GRAD),marginLeft:"auto"}} onClick={()=>setChatActivo({solicitudId:sol.id,fletyerId:parseInt(fid)})}>Ver</button>
                    </div>
                  );})}
                  {Object.keys(sol.chats).length===0&&<div style={{fontSize:12,color:C.muted}}>Sin chats aún.</div>}
                </div>
              );
            })}
          </div>
          <TabBar/>
        </div>
      );
    }

    // ─── ADMIN: USUARIOS ───────────────────────────────────────────────────
    if(tab==="admin-users"){
      return(
        <div style={st.wrap}>
          <div style={st.header}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={24}/><span style={st.logoTxt}>Admin</span></div>
            <button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button>
          </div>
          <div style={st.cont}>
            {usuarios.filter(u=>u.tipo!=="admin").map(u=>{
              const prom=promedioEstrellas(u.calificaciones);
              const vKey=u.vehiculoKey||detectarVehiculoKey(u.vehiculo||"");
              const tarifa=u.tipo==="fletyer"?getTarifa(vKey,tarifas):null;
              // Viajes finalizados de este fletyer
              const viajesFl=u.tipo==="fletyer"?solicitudes.filter(s=>s.estado==="finalizado"&&s.fleteroAceptado===u.id):[];
              const totalFlBruto=viajesFl.reduce((a,s)=>a+costoViaje(s),0);
              const totalFlCom=viajesFl.reduce((a,s)=>a+Math.round(costoViaje(s)*(comisionPct/100)),0);
              return(
                <div key={u.id} style={st.card}>
                  <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:10}}>
                    <Avatar u={u} size={44}/>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14}}>{u.nombre}</div>
                      <span style={st.tag(u.tipo==="cliente"?C.cyan:C.blue)}>{u.tipo==="cliente"?"🏠 Cliente":"🚚 Fletyer"}</span>
                    </div>
                    {u.tipo==="fletyer"&&<div style={{textAlign:"right"}}><Estrellas valor={Math.round(parseFloat(prom))} size={14}/><div style={{fontSize:11,color:C.muted}}>{prom>0?`${prom} (${u.calificaciones?.length})`:"Sin calif."}</div></div>}
                  </div>
                  <div style={{fontSize:13,color:C.muted}}>📍 {u.direccion} · 📞 {u.telefono}</div>
                  {u.tipo==="fletyer"&&(
                    <>
                      <div style={st.divider}/>
                      {/* ── Toggle Habilitar / Deshabilitar ── */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,background:u.habilitado?`${C.success}12`:`${C.danger}10`,borderRadius:12,padding:"10px 14px",border:`1.5px solid ${u.habilitado?C.success:C.danger}33`}}>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:u.habilitado?C.success:C.danger}}>{u.habilitado?"✅ Habilitado para operar":"🔒 Deshabilitado"}</div>
                          <div style={{fontSize:11,color:C.muted,marginTop:2}}>{u.habilitado?"Puede ver solicitudes, ofertar e iniciar viajes":"No puede ver ni ofertar solicitudes"}</div>
                        </div>
                        <button onClick={()=>toggleHabilitar(u.id)}
                          style={{...st.btnSm(u.habilitado?C.danger:C.success),flexShrink:0}}>
                          {u.habilitado?"Deshabilitar":"Habilitar"}
                        </button>
                      </div>
                      <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:C.text}}>🚗 Tipo de vehículo (afecta tarifas sugeridas)</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                        {Object.entries(tarifas).map(([k,t])=>(
                          <button key={k} onClick={()=>asignarVehiculoAdmin(u.id,k)}
                            style={{padding:"5px 10px",borderRadius:10,border:`2px solid ${vKey===k?C.blue:"#ddd"}`,background:vKey===k?C.blue+"18":"#fff",color:vKey===k?C.blue:C.muted,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                            {t.icon} {t.label}
                          </button>
                        ))}
                      </div>
                      {tarifa&&<div style={{fontSize:12,color:C.muted}}>Ref: {formatUYU(tarifa.kmRate)}/km · {formatUYU(tarifa.hrRate)}/h</div>}
                      {/* ── DOCUMENTOS PRIVADOS visibles para admin ── */}
                      <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.cyan}18`}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.blue,marginBottom:8}}>🔒 Documentos del Fletyer</div>
                        {/* Libreta */}
                        <div style={{marginBottom:8}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                            <span style={{fontSize:12,fontWeight:600}}>🪪 Libreta de conducir</span>
                            {u.libretaHasta&&(()=>{
                              const dias=Math.round((new Date(u.libretaHasta)-new Date())/(1000*60*60*24));
                              const col=dias<0?C.danger:dias<60?C.warning:C.success;
                              const lbl=dias<0?"⛔ Vencida":dias<60?`⚠️ ${dias}d`:("✅ "+u.libretaHasta);
                              return<span style={st.tag(col)}>{lbl}</span>;
                            })()}
                            {!u.libretaHasta&&<span style={st.tag(C.muted)}>Sin datos</span>}
                          </div>
                          {u.libretaDesde&&<div style={{fontSize:11,color:C.muted}}>Desde: {u.libretaDesde} · Hasta: {u.libretaHasta||"—"}</div>}
                          {u.libretaImg?<img src={u.libretaImg} alt="Libreta" style={{width:"100%",borderRadius:8,marginTop:4,maxHeight:100,objectFit:"cover"}}/>
                            :<div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Sin imagen cargada</div>}
                        </div>
                        {/* Cédula */}
                        <div>
                          <div style={{fontSize:12,fontWeight:600,marginBottom:4}}>🪪 Cédula de identidad</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                            <div>
                              <div style={{fontSize:11,color:C.muted,marginBottom:2}}>Frente</div>
                              {u.cedulaFrente?<img src={u.cedulaFrente} alt="CI Frente" style={{width:"100%",borderRadius:8,height:70,objectFit:"cover"}}/>
                                :<div style={{height:70,borderRadius:8,background:"#F0F4FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:C.muted}}>Sin imagen</div>}
                            </div>
                            <div>
                              <div style={{fontSize:11,color:C.muted,marginBottom:2}}>Dorso</div>
                              {u.cedulaDorso?<img src={u.cedulaDorso} alt="CI Dorso" style={{width:"100%",borderRadius:8,height:70,objectFit:"cover"}}/>
                                :<div style={{height:70,borderRadius:8,background:"#F0F4FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:C.muted}}>Sin imagen</div>}
                            </div>
                          </div>
                        </div>
                      </div>
                      {viajesFl.length>0&&(
                        <div style={{marginTop:10}}>
                          <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>📊 Viajes: {viajesFl.length} · Bruto: {formatUYU(totalFlBruto)} · <span style={{color:C.danger}}>Com: {formatUYU(totalFlCom)}</span></div>
                          {viajesFl.map(s=>{
                            const c=costoViaje(s);const com=Math.round(c*(comisionPct/100));
                            return(
                              <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"4px 0",borderBottom:`1px solid ${C.cyan}15`}}>
                                <span style={{color:C.muted}}>{s.fecha} · {s.tipo==="mudanza"?"🏠":"📦"} {s.clienteNombre?.split(" ")[0]}</span>
                                <div style={{display:"flex",alignItems:"center",gap:8}}>
                                  <span style={{fontWeight:700}}>{formatUYU(c)}</span>
                                  {s.comisionPagada?(
                                    <span style={st.tag(C.success)}>✅</span>
                                  ):(
                                    <button style={st.btnSm(C.success)} onClick={()=>marcarComisionPagada(s.id)}>Pagar {formatUYU(com)}</button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <TabBar/>
        </div>
      );
    }

    // ─── ADMIN: CONFIGURACIÓN ──────────────────────────────────────────────
    if(tab==="admin-config"){
      return(
        <div style={st.wrap}>
          <div style={st.header}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><LogoMark size={24}/><span style={st.logoTxt}>Admin · Config</span></div>
            <button onClick={salir} style={{background:"none",border:"none",color:"#fff",fontSize:12,cursor:"pointer"}}>Salir</button>
          </div>
          <div style={st.cont}>
            {/* Comisión */}
            <div style={st.card}>
              <div style={{fontSize:15,fontWeight:800,marginBottom:14}}>⚙️ Configuración de comisión</div>
              <label style={st.label}>Porcentaje de comisión Flety (%)</label>
              <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14}}>
                <input type="number" min="0" max="50" step="0.5" style={{...st.input,marginBottom:0,flex:1,fontSize:20,fontWeight:800,textAlign:"center"}} value={editTarifas?comisionEdit:comisionPct}
                  onChange={e=>{if(!editTarifas){setEditTarifas(true);setTarifasEdit({...tarifas});setComisionEdit(parseFloat(e.target.value)||0);}else setComisionEdit(parseFloat(e.target.value)||0);}}/>
                <span style={{fontSize:20,fontWeight:800,color:C.blue}}>%</span>
              </div>
              <div style={{background:`${C.cyan}10`,borderRadius:12,padding:"10px 14px",marginBottom:14}}>
                <div style={{fontSize:12,color:C.muted}}>Con comisión del <strong>{editTarifas?comisionEdit:comisionPct}%</strong>, un viaje de <strong>$1.000</strong> deja:</div>
                <div style={{display:"flex",gap:10,marginTop:6}}>
                  <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:C.muted}}>Fletyer recibe</div><div style={{fontWeight:800,color:C.success}}>{formatUYU(1000*(1-(editTarifas?comisionEdit:comisionPct)/100))}</div></div>
                  <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:C.muted}}>Flety cobra</div><div style={{fontWeight:800,color:C.blue}}>{formatUYU(1000*(editTarifas?comisionEdit:comisionPct)/100)}</div></div>
                </div>
              </div>
            </div>
            {/* Tarifas sugeridas por vehículo */}
            <div style={st.card}>
              <div style={{fontSize:15,fontWeight:800,marginBottom:4}}>🚗 Tarifas sugeridas por vehículo</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Estas son las referencias que ven los Fletyers al cotizar. No son obligatorias.</div>
              {Object.entries(editTarifas?tarifasEdit:tarifas).map(([k,t])=>(
                <div key={k} style={{borderBottom:`1px solid ${C.cyan}18`,paddingBottom:12,marginBottom:12}}>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>{t.icon} {t.label}</div>
                  <div style={{display:"flex",gap:10}}>
                    <div style={{flex:1}}>
                      <label style={st.label}>UYU / km (flete)</label>
                      <input type="number" style={{...st.input,marginBottom:0,fontWeight:700}} value={editTarifas?(tarifasEdit[k]?.kmRate??t.kmRate):t.kmRate}
                        onChange={e=>{
                          if(!editTarifas){setEditTarifas(true);setTarifasEdit({...tarifas});}
                          setTarifasEdit(p=>({...p,[k]:{...p[k],kmRate:parseFloat(e.target.value)||0}}));
                        }}/>
                    </div>
                    <div style={{flex:1}}>
                      <label style={st.label}>UYU / hora (mudanza)</label>
                      <input type="number" style={{...st.input,marginBottom:0,fontWeight:700}} value={editTarifas?(tarifasEdit[k]?.hrRate??t.hrRate):t.hrRate}
                        onChange={e=>{
                          if(!editTarifas){setEditTarifas(true);setTarifasEdit({...tarifas});}
                          setTarifasEdit(p=>({...p,[k]:{...p[k],hrRate:parseFloat(e.target.value)||0}}));
                        }}/>
                    </div>
                  </div>
                </div>
              ))}
              {editTarifas&&(
                <div style={{display:"flex",gap:10,marginTop:4}}>
                  <button style={{...st.btn(C.success),flex:1}} onClick={guardarTarifas}>💾 Guardar cambios</button>
                  <button style={{...st.btn(C.muted),flex:1}} onClick={()=>setEditTarifas(false)}>Cancelar</button>
                </div>
              )}
              {!editTarifas&&<div style={{fontSize:12,color:C.muted,textAlign:"center",marginTop:4}}>Editá cualquier campo para activar los cambios.</div>}
            </div>
          </div>
          <TabBar/>
        </div>
      );
    }
  return null;
}
