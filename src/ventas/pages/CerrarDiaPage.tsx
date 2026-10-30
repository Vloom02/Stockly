// ═══════════════════════════════════════════════════════════════════════════
// Cerrar el día (solo el dueño): todo el día en una pantalla. Lo vendido por forma de pago, el fiado
// dado y cobrado, el cierre de cada empleado con su diferencia, lo que vence mañana y qué pedir.
// Solo lee: los cierres de caja los sigue haciendo cada empleado al terminar su turno.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonToast } from '@ionic/react';
import { useAlVolver } from '../../lib/useAlVolver';
import { useHistory } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import { formatMoney } from '../context/VentasContext';
import { Card } from '../components/ui';
import Button from '../../components/ui/Button';
import BotonVolver from '../components/BotonVolver';
import { totalesPorMetodo, VentaCaja } from '../lib/caja';
import { fechaLocalISO, sumarFecha } from '../../lib/vencimientos';
import { compartirTexto } from '../../lib/compartir';

interface Cierre { cajero_nombre: string | null; total: number; diferencia: number | null }
const NOMBRE_METODO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', qr: 'QR', fiado: 'Fiado' };

const fila = (izq: React.ReactNode, der: React.ReactNode, fuerte = false) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 17, fontWeight: fuerte ? 800 : 500 }}>
    <span>{izq}</span><span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{der}</span>
  </div>
);

const CerrarDiaPage: React.FC = () => {
  const { comercio, sucursalActiva } = useAuth();
  const { state } = useStore();
  const history = useHistory();
  const [ventas, setVentas] = useState<VentaCaja[]>([]);
  const [cobrado, setCobrado] = useState(0);
  const [cierres, setCierres] = useState<Cierre[]>([]);
  const [sinInternet, setSinInternet] = useState(false);
  const [toast, setToast] = useState('');

  const cargar = useCallback(async () => {
    if (!comercio) return;
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    const desde = inicio.toISOString();
    let qv = supabase.from('ventas_ventas').select('total, metodo_pago, fiado').eq('comercio_id', comercio.id).eq('anulada', false).gte('fecha', desde);
    let qc = supabase.from('ventas_cierres').select('cajero_nombre, total, diferencia').eq('comercio_id', comercio.id).gte('hasta', desde);
    if (sucursalActiva) { qv = qv.eq('sucursal_id', sucursalActiva.id); qc = qc.eq('sucursal_id', sucursalActiva.id); }
    const [rv, rp, rc] = await Promise.all([
      qv, supabase.from('ventas_pagos').select('monto').eq('comercio_id', comercio.id).gte('fecha', desde), qc,
    ]);
    setSinInternet(!!(rv.error || rp.error || rc.error));
    if (!rv.error) setVentas((rv.data ?? []) as VentaCaja[]);
    if (!rp.error) setCobrado((rp.data ?? []).reduce((s, p: { monto: number }) => s + Number(p.monto), 0));
    if (!rc.error) setCierres((rc.data ?? []) as Cierre[]);
  }, [comercio, sucursalActiva]);
  useEffect(() => { cargar(); }, [cargar]);
  useAlVolver(() => { cargar(); });

  const porMetodo = useMemo(() => totalesPorMetodo(ventas), [ventas]);
  const total = ventas.reduce((s, v) => s + Number(v.total), 0);
  const fiadoHoy = ventas.filter(v => v.fiado).reduce((s, v) => s + Number(v.total), 0);

  // Lo que vence mañana (y lo ya vencido que sigue en góndola), del local activo.
  const hoy = fechaLocalISO(), manana = sumarFecha(1, 0);
  const nombre = useMemo(() => new Map(state.productos.map(p => [p.id, p.nombre])), [state.productos]);
  const lotes = state.lotes.filter(l => l.cantidad > 0 && l.sucursalId === state.sucursalActivaId);
  const vencenManana = lotes.filter(l => l.fechaVencimiento === manana);
  const vencidos = lotes.filter(l => l.fechaVencimiento < hoy || l.fechaVencimiento === hoy);

  const compartir = async () => {
    const lineas = [
      `Cierre del día ${new Date().toLocaleDateString('es-AR')} · ${comercio?.nombre ?? ''}`,
      `Vendido: ${formatMoney(total)} (${ventas.length} venta${ventas.length === 1 ? "" : "s"})`,
      ...Object.entries(porMetodo).map(([m, v]) => `• ${NOMBRE_METODO[m] ?? m}: ${formatMoney(v)}`),
      `Fiado dado: ${formatMoney(fiadoHoy)} · Fiado cobrado: ${formatMoney(cobrado)}`,
      ...cierres.map(c => `Caja de ${c.cajero_nombre ?? 'sin nombre'}: diferencia ${formatMoney(Number(c.diferencia ?? 0))}`),
      vencenManana.length ? `Vence mañana: ${vencenManana.map(l => `${l.cantidad} ${nombre.get(l.productoId) ?? ''}`).join(', ')}` : 'Mañana no vence nada',
    ];
    const r = await compartirTexto(lineas.join('\n'), 'Cierre del día');
    if (r === 'copiado') setToast('Copiado: pegalo en WhatsApp');
    else if (r === 'error') setToast('No se pudo compartir');
  };

  return (
    <IonContent>
      <div style={{ padding: 'var(--space-4)', maxWidth: 560, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <BotonVolver />
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>Cerrar el día</h1>
        <p style={{ fontSize: 16, color: 'var(--text-2)', margin: '0 0 16px' }}>
          {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}{sucursalActiva ? ` · ${sucursalActiva.nombre}` : ''}
        </p>
        {sinInternet && <p role="alert" style={{ fontSize: 16, color: 'var(--danger)', marginBottom: 12 }}>Sin internet: lo de la caja puede estar incompleto.</p>}

        <Card style={{ padding: 16, marginBottom: 12 }}>
          {fila(`Vendido (${ventas.length} venta${ventas.length === 1 ? "" : "s"})`, formatMoney(total), true)}
          {Object.entries(porMetodo).map(([m, v]) => <React.Fragment key={m}>{fila(NOMBRE_METODO[m] ?? m, formatMoney(v))}</React.Fragment>)}
        </Card>

        <Card style={{ padding: 16, marginBottom: 12 }}>
          {fila('Fiado dado hoy', formatMoney(fiadoHoy))}
          {fila('Fiado cobrado hoy', formatMoney(cobrado))}
        </Card>

        <Card style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Cajas de hoy</div>
          {cierres.length === 0
            ? <p style={{ fontSize: 16, color: 'var(--text-2)', margin: 0 }}>Nadie cerró caja todavía.</p>
            : cierres.map((c, i) => {
                const dif = Number(c.diferencia ?? 0);
                return <React.Fragment key={i}>{fila(c.cajero_nombre ?? 'Sin nombre',
                  <span style={{ color: dif === 0 ? 'var(--level-ok-fg)' : 'var(--danger)' }}>{dif === 0 ? 'Cuadró' : `${dif > 0 ? 'Sobró' : 'Faltó'} ${formatMoney(Math.abs(dif))}`}</span>)}</React.Fragment>;
              })}
        </Card>

        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Para mañana</div>
          {vencidos.length > 0 && <p style={{ fontSize: 16, color: 'var(--danger)', fontWeight: 700, margin: '0 0 6px' }}>
            Sacar de la góndola (vencido): {vencidos.map(l => `${l.cantidad} ${nombre.get(l.productoId) ?? ''}`).join(', ')}</p>}
          <p style={{ fontSize: 16, margin: 0 }}>
            {vencenManana.length ? `Vence mañana: ${vencenManana.map(l => `${l.cantidad} ${nombre.get(l.productoId) ?? ''}`).join(', ')}` : 'Mañana no vence nada.'}
          </p>
        </Card>

        <Button variant="primary" size="lg" fullWidth onClick={compartir} style={{ marginBottom: 10 }}>Mandar el resumen por WhatsApp</Button>
        <Button variant="secondary" size="lg" fullWidth onClick={() => history.push('/pedido')}>Ver qué tengo que pedir</Button>
      </div>
      <IonToast isOpen={!!toast} message={toast} duration={4500} position="top" onDidDismiss={() => setToast('')} />
    </IonContent>
  );
};

export default CerrarDiaPage;
