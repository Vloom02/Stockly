// ═══════════════════════════════════════════════════════════════════════════
// Pantalla de venta. Escanea / busca → carrito → confirma (FEFO + offline).
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { IonContent, IonModal, IonToast, useIonAlert } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import { useStore } from '../../context/StoreContext';
import { useVentas, formatMoney } from '../context/VentasContext';
import { useAuth } from '../context/AuthContext';
import { useEmpleado } from '../context/EmpleadoContext';
import { useOwner } from '../context/OwnerContext';
import { Button, Card, SyncBanner, EmptyState, Opciones } from '../components/ui';
import {
  ShoppingCartIcon, MagnifyingGlass, PlusIcon, MinusIcon, XMarkIcon,
  TrashIcon, CheckIcon, LockClosedIcon, BanknotesIcon,
} from '../components/ui/icons';
import { Producto } from '../types';
import ScannerModal from '../../components/ScannerModal';
import { armarTicket } from '../lib/ticket';
import { Capacitor } from '@capacitor/core';
import { descuentoPromos, Promo } from '../lib/promos';
import { openDB, getLocalSetting, setLocalSetting } from '../lib/outbox';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../../lib/useConfirm';

import { parseMonto, billetesSugeridos } from '../../lib/numeros';
import { avisoVentaOk, avisoToque } from '../lib/aviso';
import { Contador } from '../../lib/useContador';
import { useAlVolver } from '../../lib/useAlVolver';
import CheckDibujo from '../components/CheckDibujo';
import AvisosDevolver from '../components/AvisosDevolver';
import { BanknotesIcon as IcoBanknotesIcon, CameraIcon as IcoCameraIcon, CreditCardIcon as IcoCreditCardIcon, DevicePhoneMobileIcon as IcoDevicePhoneMobileIcon, QrCodeIcon as IcoQrCodeIcon, UserIcon as IcoUserIcon } from '@heroicons/react/24/outline';
import { useLectorFisico } from '../../lib/useLectorFisico';
const payOptions = [
  { key: 'efectivo',     label: 'Efectivo',      Icono: IcoBanknotesIcon },
  { key: 'transferencia',label: 'Transferencia', Icono: IcoDevicePhoneMobileIcon },
  { key: 'tarjeta',      label: 'Tarjeta',       Icono: IcoCreditCardIcon },
  { key: 'qr',           label: 'QR',            Icono: IcoQrCodeIcon },
];

const VentaPage: React.FC = () => {
  const { state, escanear, buscarPorNombre, agregarProducto, agregarMontoLibre, setQty, quitar, vaciar, reponer, confirmarVenta, sincronizar } = useVentas();
  const { sucursalActiva, sucursales, setSucursalActiva, comercio } = useAuth();
  const { cajero, cerrarTurno } = useEmpleado();
  const { isUnlocked, lock } = useOwner();
  const confirmar = useConfirm();
  const [presentAlert] = useIonAlert();
  // Tablet acostada (o pantalla ancha): hay lugar para dos columnas.
  const [ancha, setAncha] = useState(() => matchMedia('(min-width: 900px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width: 900px)');
    const f = () => setAncha(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  const history = useHistory();
  // "Vender" desde Mercadería (/ventas?producto=ID): entra al carrito y la venta pasa por la caja.
  const location = useLocation();
  const { state: stock } = useStore();
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('producto');
    if (!id || !stock.loaded) return; // con el catálogo sin cargar el producto no aparecía y se perdía
    history.replace('/ventas');
    const p = stock.productos.find(x => x.id === id);
    if (p) agregarProducto({ id, comercio_id: comercio?.id ?? '', nombre: p.nombre, codigo_barras: p.codigoBarras ?? '', precio: p.precio, activo: true })
      .then(r => avisar(r));
  }, [location.search, stock.loaded]);
  // Lector físico: suma al carrito aunque el cursor no esté en "Escaneá el código".
  const lectorRef = useLectorFisico(codigo => handleScan(codigo));

  const pedirMontoLibre = () => presentAlert({
    header: 'Venta rápida',
    message: 'Cobrar un monto sin producto del catálogo (no descuenta stock).',
    inputs: [{ name: 'monto', type: 'number', placeholder: 'Monto $', min: 1 }],
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Agregar', handler: (d) => { const m = parseMonto(d.monto); if (m > 0) avisar(agregarMontoLibre(m)); } },
    ],
  });

  const [scan, setScan]           = useState('');
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<Producto[]>([]);
  const [showConfirm, setConfirm] = useState(false);
  const [metodoPago, setMetodo]   = useState('efectivo');
  const [cliente, setCliente]     = useState('');
  const [descuento, setDescuento] = useState('');
  const [recibido, setRecibido]   = useState(''); // efectivo recibido → vuelto
  const [masOpciones, setMasOpciones] = useState(false); // descuento / cliente
  const [processing, setProc]     = useState(false);
  const [ticket, setTicket]       = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [toast, setToast]         = useState({ show: false, msg: '', color: 'success' });
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => scanRef.current?.focus(), 200); }, []);

  // Favoritos: productos más vendidos (30 días), para tocar sin buscar. Se
  // cachea local para que anden offline. Se muestran solo con el carrito vacío.
  const [topIds, setTopIds] = useState<string[]>([]);
  useEffect(() => {
    if (!comercio) return;
    (async () => {
      try {
        // Sumado en el servidor (migración 14): antes se bajaban hasta 3.000 renglones y el tope de 1.000
        // del servidor dejaba "más vendidos" sacados de una parte cualquiera de las ventas.
        const { data, error } = await supabase.rpc('vendido_por_producto', { p_comercio: comercio.id, p_dias: 30, p_limite: 8 });
        if (error) throw error; // sin internet: los guardados (abajo)
        const ids = ((data ?? []) as { producto_id: string }[]).map(r => r.producto_id);
        setTopIds(ids);
        openDB().then(() => setLocalSetting('favoritos-cache', JSON.stringify(ids))).catch(() => {});
      } catch {
        try {
          await openDB();
          const raw = await getLocalSetting('favoritos-cache'); // las versiones viejas guardaban los productos enteros
          if (raw) setTopIds((JSON.parse(raw) as (string | { id: string })[]).map(x => (typeof x === 'string' ? x : x.id)));
        } catch { /* */ }
      }
    })();
  }, [comercio]);
  // Los productos salen de la mercadería en memoria (en el orden de lo más vendido): antes se volvían a pedir al servidor.
  const favoritos = useMemo(() => {
    const porId = new Map(stock.productos.map(p => [p.id, p]));
    return topIds.flatMap((id): Producto[] => {
      const p = porId.get(id);
      return p ? [{ id, comercio_id: comercio?.id ?? '', nombre: p.nombre, codigo_barras: p.codigoBarras ?? '', categoria: p.categoria, precio: p.precio, activo: true } as Producto] : [];
    });
  }, [topIds, stock.productos, comercio]);

  // Promos activas del comercio (con cache local para vender offline). Se releen al volver a Vender:
  // una oferta recién puesta desde Cargar no se veía hasta reabrir la app.
  const [promos, setPromos] = useState<Promo[]>([]);
  const [cargarPromosN, setCargarPromosN] = useState(0);
  useAlVolver(() => setCargarPromosN(n => n + 1));
  useEffect(() => {
    if (!comercio) return;
    (async () => {
      try {
        // Las dos a la vez (antes una detrás de la otra).
        // Ofertas de lo que está por vencer (migración 15). Si la tabla todavía no existe, siguen las otras.
        const [{ data, error }, { data: liq }] = await Promise.all([
          supabase.from('ventas_promos').select('producto_id, tipo, min_cant, pct').eq('comercio_id', comercio.id).eq('activa', true),
          supabase.from('ventas_liquidaciones').select('producto_id, pct, hasta')
            .eq('comercio_id', comercio.id).gte('hasta', new Date().toLocaleDateString('sv-SE')),
        ]);
        if (error) throw error;
        const ps: Promo[] = (data ?? []).map((r: { producto_id: string; tipo: Promo['tipo']; min_cant: number; pct: number }) =>
          ({ productoId: r.producto_id, tipo: r.tipo, minCant: r.min_cant, pct: Number(r.pct) }));
        for (const r of (liq ?? []) as { producto_id: string; pct: number; hasta: string }[])
          ps.push({ productoId: r.producto_id, tipo: 'liquidacion', minCant: 1, pct: Number(r.pct), hasta: r.hasta });
        setPromos(ps);
        openDB().then(() => setLocalSetting('promos-cache', JSON.stringify(ps))).catch(() => {});
      } catch {
        try {
          await openDB();
          const raw = await getLocalSetting('promos-cache');
          if (raw) setPromos(JSON.parse(raw));
        } catch { /* sin promos offline */ }
      }
    })();
  }, [comercio, cargarPromosN]);
  // La oferta por vencer alcanza solo a lo que vence en ESTE local (hasta la fecha de la oferta).
  const promosDelLocal = useMemo(() => promos.map(p => p.tipo !== 'liquidacion' ? p : {
    ...p,
    maxUnidades: stock.lotes.filter(l => l.productoId === p.productoId && l.sucursalId === sucursalActiva?.id
      && l.cantidad > 0 && l.fechaVencimiento <= (p.hasta ?? '')).reduce((s, l) => s + l.cantidad, 0),
  }), [promos, stock.lotes, sucursalActiva]);

  const toast$ = (msg: string, ok = true) => setToast({ show: true, msg, color: ok ? 'success' : 'danger' });

  // Lo que se agrega se ve en el carrito (el renglón se enciende), no en un cartel: tapaba el nombre del
  // comercio, el carrito y el botón Caja. El texto queda para el lector de pantalla; los errores sí van en cartel.
  const [dicho, setDicho] = useState('');
  const avisar = (r: { ok: boolean; msg: string }) => { if (r.ok) setDicho(r.msg); else toast$(r.msg, false); };
  const cantidades = useRef<Map<string, number> | null>(null);
  const [nuevo, setNuevo] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    const antes = cantidades.current;
    cantidades.current = new Map(state.cart.map(c => [c.productoId, c.qty]));
    if (!antes) return; // al abrir Vender, el carrito que ya estaba no es "recién agregado"
    const subio = state.cart.find(c => c.qty > (antes.get(c.productoId) ?? 0));
    if (!subio) return;
    setNuevo(v => ({ id: subio.productoId, n: (v?.n ?? 0) + 1 }));
    requestAnimationFrame(() => document.getElementById(`linea-${subio.productoId}`)?.scrollIntoView({ block: 'nearest' }));
  }, [state.cart]);

  // Quitar y vaciar no preguntan: se hacen y "Deshacer" queda a mano unos segundos. Preguntar cada vez
  // enseña a tocar "sí" sin leer; lo que se puede deshacer no necesita pregunta.
  const [quitado, setQuitado] = useState<{ items: typeof state.cart; texto: string } | null>(null);
  useEffect(() => {
    if (!quitado) return;
    const t = setTimeout(() => setQuitado(null), 8000);
    return () => clearTimeout(t);
  }, [quitado]);
  const quitarLinea = (item: typeof state.cart[number]) => { quitar(item.productoId); setQuitado({ items: [item], texto: `Quitaste ${item.nombre}` }); };
  const deshacer = () => {
    if (!quitado) return;
    // Lo que se agregó después se queda: solo vuelve lo que se había sacado.
    reponer([...state.cart.filter(c => !quitado.items.some(q => q.productoId === c.productoId)), ...quitado.items]);
    setQuitado(null);
  };

  const handleScan = async (codigo: string) => {
    setTicket(null); // el cliente siguiente ya está pasando sus cosas
    const r = await escanear(codigo);
    avisar(r);
    setScan('');
    scanRef.current?.focus();
  };

  // Solo vale la respuesta de lo último que se escribió (una búsqueda vieja que tarda no pisa la nueva).
  const busquedaN = useRef(0);
  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    const n = ++busquedaN.current;
    const r = q.length >= 2 ? await buscarPorNombre(q) : [];
    if (n === busquedaN.current) setResults(r);
  }, [buscarPorNombre]);

  const pickProduct = async (p: Producto) => {
    const r = await agregarProducto(p);
    avisoToque();
    avisar(r);
    setQuery(''); setResults([]);
  };

  const subtotal = state.cart.reduce((s, c) => s + c.precio * c.qty, 0);
  const promosCalc = descuentoPromos(state.cart, promosDelLocal);
  // El descuento de la venta = promos automáticas + descuento manual, tope subtotal.
  const desc = Math.min(subtotal, Math.max(0, parseMonto(descuento) || 0) + promosCalc.monto); // nunca negativo: el server lo rechazaría
  const total = subtotal - desc;
  // Carrito vacío = cliente nuevo: el nombre y el descuento del anterior no pasan al siguiente.
  useEffect(() => {
    if (state.cart.length > 0) return;
    setCliente(''); setDescuento(''); setRecibido(''); setMasOpciones(false);
  }, [state.cart.length]);
  const totalItems = state.cart.reduce((s, c) => s + c.qty, 0);

  const handleConfirm = async () => {
    // Snapshot del carrito ANTES de confirmar (confirmarVenta vacía el carrito).
    const snap = {
      items: state.cart.map(c => ({ nombre: c.nombre, qty: c.qty, precio: c.precio })),
      subtotal, descuento: desc, total, metodoPago, cliente: cliente.trim(),
    };
    setProc(true);
    let r: Awaited<ReturnType<typeof confirmarVenta>>;
    try {
      r = await confirmarVenta({ metodoPago, cliente: cliente.trim(), descuento: desc, usuario: cajero?.nombre ?? null });
    } catch (e) {
      console.warn('[venta]', e);
      r = { ok: false, msg: 'La venta no se guardó. Probá de nuevo; si sigue, avisale al dueño.' };
    } finally {
      setProc(false); // si algo fallaba, el botón quedaba girando para siempre
    }
    if (r.ok) {
      const txt = armarTicket({
        comercio: comercio?.nombre ?? 'Almacén',
        sucursal: sucursalActiva?.nombre,
        fecha: new Date(),
        folio: (r.ventaId ?? '').replace(/-/g, '').slice(0, 6).toUpperCase() || '------',
        items: snap.items, subtotal: snap.subtotal, descuento: snap.descuento,
        total: snap.total, metodoPago: snap.metodoPago, cliente: snap.cliente,
        cajero: cajero?.nombre, legajo: cajero?.legajo,
      }, formatMoney);
      setTicket(txt);
      setQuitado(null); // lo que se sacó era de la venta que ya se cobró
      avisoVentaOk();
      setConfirm(false); setCliente(''); setDescuento(''); setRecibido(''); setMasOpciones(false); setMetodo('efectivo');
      toast$(r.msg, true);
    } else {
      toast$(r.msg, false);
    }
  };

  const compartirTicket = async () => {
    if (!ticket) return;
    try {
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: 'Comprobante de venta', text: ticket, dialogTitle: 'Compartir comprobante' });
      } else if (navigator.share) {
        await navigator.share({ text: ticket });
      } else {
        await navigator.clipboard.writeText(ticket);
        toast$('Comprobante copiado', true);
      }
    } catch { /* el usuario canceló el share */ }
  };

  const copiarTicket = async () => {
    if (!ticket) return;
    try { await navigator.clipboard.writeText(ticket); toast$('Comprobante copiado', true); }
    catch { toast$('No se pudo copiar', false); }
  };

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <SyncBanner queueLen={state.outboxLen} isOnline={state.isOnline} bloqueados={state.bloqueados} onReintentar={sincronizar} />
      <div role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{dicho}</div>

      {/* En tablet acostada: dos columnas (buscar | carrito), ver ventas.css. */}
      <div ref={lectorRef} className="venta-layout" style={{ padding: 'var(--space-4)', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))', paddingTop: 16 }}>
        {/* Header */}
        <div className="venta-cabecera" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>{comercio?.nombre ?? 'Almacén'}</h1>
            {sucursales.length > 1 ? (
              <div style={{ marginTop: 6 }}>
                <Opciones etiqueta="Local" columnas={Math.min(3, sucursales.length)} valor={sucursalActiva?.id ?? ''}
                  onChange={id => { const s = sucursales.find(x => x.id === id); if (s) setSucursalActiva(s); }}
                  opciones={sucursales.map(s => ({ valor: s.id, etiqueta: s.nombre }))} />
              </div>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 2 }}>{sucursalActiva?.nombre}</div>
            )}
            {cajero && (
              <button type="button"
                onClick={async () => { if (await confirmar(`¿Cerrar el turno de ${cajero.nombre}?`, { okText: 'Cerrar turno' })) cerrarTurno(); }}
                className="pressable"
                style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', minHeight: 44, borderRadius: 'var(--radius-full)', border: '1px solid var(--color-primary-border)', background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <IcoUserIcon width={16} height={16} /> {cajero.nombre} · salir
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {totalItems > 0 && (
              <div style={{ position: 'relative' }}>
                <ShoppingCartIcon size={26} color="var(--color-primary)" />
                <span key={totalItems} className="anim-rebote" style={{ position: 'absolute', top: -6, right: -8, background: 'var(--color-danger)', color: '#fff', fontSize: 14, fontWeight: 700, borderRadius: 'var(--radius-full)', padding: '1px 6px', minWidth: 16, textAlign: 'center' }}>{totalItems}</span>
              </div>
            )}
            {isUnlocked && (
              <button onClick={lock} aria-label="Salir de modo dueño" className="pressable"
                style={{ width: 48, height: 48, borderRadius: 'var(--radius-full)', border: '1px solid var(--color-primary-border)', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <LockClosedIcon size={22} color="var(--color-primary-dark)" />
              </button>
            )}
            {/* Caja y ventas anteriores: antes era la pestaña "Más" de la app de ventas */}
            <button type="button" onClick={() => history.push('/ventas/mas')} className="pressable"
              style={{ minHeight: 48, padding: '6px 14px', borderRadius: 'var(--radius)', border: 'none', boxShadow: 'var(--shadow-sm)', background: 'var(--surface)', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <BanknotesIcon size={22} /> Caja
            </button>
          </div>
        </div>

        <div className="venta-col-buscar">
        <AvisosDevolver />
        {/* Scanner: lector físico / tipeo + botón de cámara */}
        <Card variant="bordered" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--color-primary)', flexShrink: 0 }} />
          <input className="campo" ref={scanRef} value={scan} onChange={e => setScan(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && scan.trim()) handleScan(scan.trim()); }}
            placeholder="Escaneá el código" autoComplete="off" spellCheck={false} aria-label="Código de barras"
            style={{ flex: 1, minWidth: 0, minHeight: 44, border: 'none', outline: 'none', fontSize: 18, fontFamily: 'var(--font-sans)', color: 'var(--text)' }} />
          <button onClick={() => setShowScanner(true)} aria-label="Escanear con la cámara" className="pressable boton-marca"
            style={{ flexShrink: 0, width: 56, height: 48, borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IcoCameraIcon width={26} height={26} />
          </button>
        </Card>

        {/* Venta rápida: cobrar un monto sin producto del catálogo */}
        <button onClick={pedirMontoLibre} className="pressable"
          style={{ width: '100%', minHeight: 48, marginBottom: 10, borderRadius: 'var(--radius)', border: '1.5px dashed var(--border)', background: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 16, fontWeight: 600, fontFamily: 'inherit' }}>
          $ Cobrar un monto suelto (sin producto)
        </button>

        {/* Manual search */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <MagnifyingGlass size={18} color="var(--text-3)" />
            </span>
            <input className="campo" value={query} onChange={e => handleSearch(e.target.value)} placeholder="Buscar por nombre..."
              aria-label="Buscar producto por nombre"
              style={{ width: '100%', minHeight: 56, padding: '14px 14px 14px 40px', fontSize: 18, color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none' }} />
          </div>
          {results.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', overflow: 'hidden', marginTop: 4 }}>
              {results.map(p => (
                <button key={p.id} onClick={() => pickProduct(p)} className="pressable"
                  style={{ width: '100%', padding: '14px', border: 'none', borderBottom: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', textAlign: 'left', fontFamily: 'inherit' }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{p.nombre}</div>
                    <div style={{ fontSize: 14, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{p.codigo_barras}</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-primary-dark)', whiteSpace: 'nowrap', marginLeft: 10 }}>{formatMoney(p.precio)}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Favoritos: acceso rápido a los más vendidos (con carrito vacío, o siempre si hay lugar al lado) */}
        {(state.cart.length === 0 || ancha) && favoritos.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>Más vendidos</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {favoritos.map(p => (
                <button key={p.id} onClick={() => pickProduct(p)} className="pressable"
                  style={{ padding: '10px 12px', border: 'none', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 3, boxShadow: 'var(--shadow-sm)' }}>
                  {/* Dos renglones: cortado, "Leche La Serenísima Entera" y "Descremada" se veían iguales y se vendía la equivocada. */}
                  <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.nombre}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-primary-dark)', fontFamily: 'var(--font-mono)' }}>{formatMoney(p.precio)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        </div>

        <div className="venta-col-carrito">
        {quitado && (
          <div role="status" className="anim-entrar" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 14px', marginBottom: 10, borderRadius: 'var(--radius)', background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{quitado.texto}</span>
            <Button variant="secondary" onClick={deshacer} style={{ minHeight: 48, flexShrink: 0 }}>Deshacer</Button>
          </div>
        )}
        {/* Cart */}
        {state.cart.length === 0 ? (
          <EmptyState icon={<ShoppingCartIcon size={44} color="var(--text-3)" />} title="El carrito está vacío" description="Escaneá o buscá productos para comenzar la venta" />
        ) : (
          <>
            <div className="lista-animada" style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Carrito</span>
                <span style={{ fontSize: 15, color: 'var(--text-2)' }}>{totalItems} {totalItems !== 1 ? 'productos' : 'producto'}</span>
              </div>
              {state.cart.map((item, i) => (
                // Dos renglones: con letra grande y botones de 44 px no entra todo en una fila.
                <div key={item.productoId} id={`linea-${item.productoId}`} style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: i < state.cart.length - 1 ? '1px solid var(--border)' : 'none', background: item.qty > item.stockDisponible ? 'var(--color-danger-bg)' : undefined,
                  // El último que se tocó: raya de marca (queda) y un destello (ver ventas.css). El margen deja lugar a Cobrar y a la barra.
                  scrollMarginTop: 12, scrollMarginBottom: 170,
                  boxShadow: nuevo?.id === item.productoId ? 'inset 5px 0 0 var(--brand-500)' : undefined,
                  animation: nuevo?.id === item.productoId ? `venta-nuevo-${nuevo.n % 2 ? 'a' : 'b'} 1.4s ease-out` : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 17, lineHeight: 1.3 }}>{item.nombre}</div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{formatMoney(item.precio * item.qty)}</span>
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--text-2)' }}>
                    {formatMoney(item.precio)} c/u
                    {!item.productoId.startsWith('libre-') && (<>{' · '}
                    <span style={{ color: item.stockDisponible <= 0 ? 'var(--color-danger)' : item.stockDisponible <= 5 ? 'var(--color-warning-dark)' : 'var(--text-2)', fontWeight: item.stockDisponible <= 5 ? 600 : 400 }}>
                      {item.stockDisponible <= 0 ? 'sin stock' : `quedan ${item.stockDisponible}`}
                    </span></>)}
                    {!item.productoId.startsWith('libre-') && item.qty > item.stockDisponible && item.stockDisponible >= 0 && (
                      <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}> · vendés {item.qty - item.stockDisponible} de más</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button aria-label={`Restar uno a ${item.nombre}`} onClick={() => item.qty > 1 ? setQty(item.productoId, item.qty - 1) : quitarLinea(item)} className="pressable" style={{ width: 48, height: 48, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}><MinusIcon size={24} /></button>
                    <input className="campo" type="number" inputMode="numeric" value={item.qty} aria-label={`Cantidad de ${item.nombre}`}
                      onChange={e => { const v = parseInt(e.target.value); if (v > 0) setQty(item.productoId, v); /* vacío mientras escribe: no lo saca */ }}
                      onFocus={e => e.target.select()}
                      style={{ width: 60, height: 48, fontSize: 20, fontWeight: 700, textAlign: 'center', borderRadius: 'var(--radius-sm)', padding: '4px 2px', color: 'var(--text)', outline: 'none' }} />
                    <button aria-label={`Sumar uno a ${item.nombre}`} onClick={() => setQty(item.productoId, item.qty + 1)} className="pressable" style={{ width: 48, height: 48, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary-dark)' }}><PlusIcon size={24} /></button>
                    <span style={{ flex: 1 }} />
                    <button aria-label={`Quitar ${item.nombre} del carrito`} onClick={() => quitarLinea(item)} className="pressable" style={{ height: 48, padding: '0 14px', flexShrink: 0, border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)', fontSize: 16, fontWeight: 600, fontFamily: 'inherit' }}><XMarkIcon size={20} /> Quitar</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Total bar */}
            <div style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))', color: 'var(--text-on-brand)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: 'var(--shadow-md)' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Total</div>
                <div style={{ fontSize: 15, opacity: .75 }}>{totalItems} {totalItems !== 1 ? 'productos' : 'producto'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}><Contador valor={total} formato={formatMoney} /></div>
                {desc > 0 && <div style={{ fontSize: 15, opacity: .85 }}>con {formatMoney(desc)} de descuento</div>}
              </div>
            </div>

            <div className="venta-acciones">
              <Button variant="secondary" size="lg" aria-label="Vaciar carrito" onClick={() => { setQuitado({ items: state.cart, texto: 'Vaciaste el carrito' }); vaciar(); }} style={{ flex: 'none', width: 60 }}><TrashIcon size={22} /></Button>
              <Button size="lg" className="brillo-una-vez anim-pop" onClick={() => setConfirm(true)} style={{ flex: 1, fontSize: 20 }}><CheckIcon size={22} /> Cobrar {formatMoney(total)}</Button>
            </div>
          </>
        )}
        </div>
      </div>

      {/* Confirm modal */}
      <IonModal isOpen={showConfirm} onDidDismiss={() => setConfirm(false)} breakpoints={[0, 1]} initialBreakpoint={1}>
        <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
          <div style={{ padding: 'var(--space-5)', maxWidth: 520, margin: '0 auto' }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Cobrar</h2>

            {/* Receipt */}
            <Card variant="flat" style={{ marginBottom: 16, borderStyle: 'dashed', border: '2px dashed var(--border)' }}>
              {state.cart.map(c => (
                <div key={c.productoId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '3px 0' }}>
                  <span>{c.nombre} <span style={{ color: 'var(--text-3)' }}>x{c.qty}</span></span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(c.precio * c.qty)}</span>
                </div>
              ))}
              {promosCalc.lineas.map(l => (
                <div key={l.nombre} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '2px 0', color: 'var(--color-primary-dark)' }}>
                  <span>{l.nombre} <span style={{ opacity: 0.7 }}>({l.etiqueta})</span></span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>-{formatMoney(l.monto)}</span>
                </div>
              ))}
              {desc > promosCalc.monto && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '3px 0', color: 'var(--color-primary-dark)' }}><span>Descuento manual</span><span style={{ fontFamily: 'var(--font-mono)' }}>-{formatMoney(desc - promosCalc.monto)}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 17, paddingTop: 8, marginTop: 6, borderTop: '1px dashed var(--border)' }}>
                <span>Total</span><span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(total)}</span>
              </div>
            </Card>

            {/* Método de pago */}
            <label style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8 }}>¿Cómo paga?</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 16 }}>
              {payOptions.map(o => (
                <button key={o.key} onClick={() => setMetodo(o.key)} aria-pressed={metodoPago === o.key}
                  style={{ minHeight: 60, padding: 10, border: metodoPago === o.key ? '3px solid var(--color-primary)' : '2px solid transparent', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: metodoPago === o.key ? 'var(--color-primary-bg)' : 'var(--surface)', color: metodoPago === o.key ? 'var(--color-primary-dark)' : 'var(--text)', cursor: 'pointer', fontSize: 17, fontWeight: 700, fontFamily: 'inherit' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><o.Icono width={24} height={24} />{o.label}</span>
                </button>
              ))}
            </div>

            {/* Vuelto (solo efectivo) */}
            {metodoPago === 'efectivo' && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8 }}>¿Con cuánto paga?</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 8 }}>
                  {/* "Justo" primero (lo más común) y después los redondeos que le siguen a ESTE total. */}
                  {[total, ...billetesSugeridos(total)].map(v => (
                    <button key={v} onClick={() => setRecibido(String(v))} aria-pressed={recibido === String(v)}
                      style={{ minHeight: 52, padding: '8px 6px', border: recibido === String(v) ? '3px solid var(--color-primary)' : '2px solid transparent', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: recibido === String(v) ? 'var(--color-primary-bg)' : 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 17, fontWeight: 700, fontFamily: 'inherit' }}>
                      {v === total ? 'Justo' : formatMoney(v)}
                    </button>
                  ))}
                </div>
                <input className="campo" type="text" inputMode="decimal" value={recibido} onChange={e => setRecibido(e.target.value)} placeholder="Otro monto ($)"
                  aria-label="Monto con el que paga"
                  style={{ width: '100%', padding: 12, fontSize: 20, color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none', textAlign: 'center' }} />
                {/* El vuelto se muestra en el pie fijo, junto al botón de cobrar */}
                {recibido !== '' && (parseMonto(recibido) || 0) < total && (parseMonto(recibido) || 0) > 0 && (
                  <div style={{ marginTop: 8, fontSize: 17, fontWeight: 700, color: 'var(--color-danger)', textAlign: 'center' }}>
                    Falta {formatMoney(total - (parseMonto(recibido) || 0))}
                  </div>
                )}
              </div>
            )}

            {/* Lo menos común, plegado: descuento y nombre del cliente */}
            {!(masOpciones || descuento !== '' || cliente !== '') ? (
              <button type="button" onClick={() => setMasOpciones(true)}
                style={{ width: '100%', minHeight: 48, marginBottom: 16, border: '1.5px dashed var(--border)', borderRadius: 'var(--radius)', background: 'none', color: 'var(--text-2)', fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                + Descuento o nombre del cliente
              </button>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 15, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Nombre del cliente (opcional)</label>
                <input className="campo" value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Ej: Marta"
                  aria-label="Nombre del cliente"
                  style={{ width: '100%', padding: 12, fontSize: 17, color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none', marginBottom: 12 }} />

                <label style={{ fontSize: 15, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Descuento ($)</label>
                <input className="campo" type="text" inputMode="decimal" value={descuento} onChange={e => setDescuento(e.target.value)} placeholder="0"
                  aria-label="Descuento en pesos"
                  style={{ width: '100%', padding: 12, fontSize: 17, color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none', textAlign: 'center' }} />
              </div>
            )}

            {/* Pie fijo: la acción principal siempre a la vista, sin tener que bajar */}
            <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', paddingTop: 10, paddingBottom: 10, marginTop: 4, borderTop: '1px solid var(--border)' }}>
              {metodoPago === 'efectivo' && recibido !== '' && (parseMonto(recibido) || 0) >= total && (
                <div role="status" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, color: 'var(--color-primary-dark)' }}>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>Vuelto</span>
                  <span style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{formatMoney((parseMonto(recibido) || 0) - total)}</span>
                </div>
              )}
              <Button fullWidth size="lg" onClick={handleConfirm} loading={processing} style={{ fontSize: 20 }}><CheckIcon size={22} /> Listo, cobrado · {formatMoney(total)}</Button>
              {processing && (
                <p role="status" style={{ fontSize: 16, fontWeight: 600, textAlign: 'center', margin: '8px 0 0' }}>
                  Guardando la venta… Si la señal está floja tarda unos segundos. No hace falta tocar de nuevo.
                </p>
              )}
            </div>
            <Button fullWidth size="lg" variant="ghost" onClick={() => setConfirm(false)} style={{ marginTop: 8, marginBottom: 'calc(10px + var(--sab, env(safe-area-inset-bottom)))' }}>Volver al carrito</Button>
          </div>
        </IonContent>
      </IonModal>

      {/* Ticket / comprobante tras la venta */}
      <IonModal className="deja-leer" isOpen={!!ticket} onDidDismiss={() => setTicket(null)} breakpoints={[0, 1]} initialBreakpoint={1}>
        <IonContent>
          <div style={{ padding: 'var(--space-5)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <CheckDibujo />
              <h2 className="anim-entrar" style={{ '--i': 4, fontSize: 24, fontWeight: 800 } as React.CSSProperties}>¡Venta registrada!</h2>
            </div>
            <pre style={{
              fontFamily: 'var(--font-mono)', fontSize: 14.5, lineHeight: 1.5, whiteSpace: 'pre',
              background: 'var(--surface-2)', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)',
              padding: 'var(--space-4)', overflowX: 'auto', color: 'var(--text)', margin: 0, marginBottom: 16,
            }}>{ticket}</pre>
            <Button fullWidth size="lg" onClick={compartirTicket}>Compartir comprobante</Button>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button variant="secondary" onClick={copiarTicket} style={{ flex: 1 }}>Copiar</Button>
              <Button variant="ghost" onClick={() => setTicket(null)} style={{ flex: 1 }}>Listo</Button>
            </div>
          </div>
        </IonContent>
      </IonModal>

      {showScanner && (
        <ScannerModal
          onCodigoDetectado={(codigo) => { setShowScanner(false); handleScan(codigo); }}
          onCancel={() => setShowScanner(false)}
        />
      )}

      {/* Éxito: toast corto (el cajero agrega ítems rápido, no debe interrumpir);
          error: más largo para que se lea. */}
      <IonToast isOpen={toast.show} onDidDismiss={() => setToast(t => ({ ...t, show: false }))} message={toast.msg} duration={toast.color === 'danger' ? 6000 : 2500} position="top" color={toast.color} />
    </IonContent>
  );
};

export default VentaPage;
