import React, { useState, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  MoonIcon, SunIcon, BellAlertIcon, TagIcon,
  BuildingStorefrontIcon, ArrowRightOnRectangleIcon, PrinterIcon, ClipboardDocumentCheckIcon,
  InformationCircleIcon, ChevronRightIcon, UserCircleIcon,
  ArrowDownTrayIcon, ArrowUpTrayIcon, SwatchIcon, CloudIcon, BanknotesIcon,
} from '@heroicons/react/24/outline';
import {
  useStore, setSetting,
  DIAS_AVISO_DEFAULT, UMBRAL_AVISO, UMBRAL_URGENTE, UMBRAL_CRITICO, CATEGORIAS,
  DESC_CRITICO, DESC_URGENTE, DESC_AVISO,
} from '../context/StoreContext';
import { COLORES_MARCA, aplicarColorMarca, guardarColorMarca, obtenerColorMarcaGuardado } from '../lib/tema';
import { aplicarEscalaFont, guardarEscalaFont, obtenerEscalaFont, ESCALA_MIN, ESCALA_MAX } from '../lib/tipografia';
import { notificacionesActivas, setNotificacionesActivas, horaNotificacion, setHoraNotificacion, sincronizarNotificaciones } from '../lib/notificaciones';
import { stockACSV, movimientosACSV } from '../lib/exportar';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Field, Input, Textarea } from '../components/ui/Input';
import Logo from '../components/ui/Logo';

interface Props { onThemeToggle: () => void; isDark: boolean; }

const ConfigPage: React.FC<Props> = ({ onThemeToggle, isDark }) => {
  const { state, exportarBackup, importarBackup, estadoNube, sincronizarAhora, sincronizando, reintentarFallidos, lotesEnriquecidos } = useStore();
  const { comercio, miembro, cerrarSesion } = useAuth();
  const history = useHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [colorMarca, setColorMarca] = useState(obtenerColorMarcaGuardado());
  const [escalaFont, setEscalaFont] = useState(obtenerEscalaFont());
  const [notifOn, setNotifOn] = useState(notificacionesActivas());
  const [notifHora, setNotifHora] = useState(horaNotificacion());

  const [diasAviso, setDiasAviso] = useState(DIAS_AVISO_DEFAULT().toString());
  const [uAviso, setUAviso] = useState(UMBRAL_AVISO().toString());
  const [uUrgente, setUUrgente] = useState(UMBRAL_URGENTE().toString());
  const [uCritico, setUCritico] = useState(UMBRAL_CRITICO().toString());
  const [categorias, setCategorias] = useState(CATEGORIAS().join('\n'));
  const [descCritico, setDescCritico] = useState(DESC_CRITICO().toString());
  const [descUrgente, setDescUrgente] = useState(DESC_URGENTE().toString());
  const [descAviso, setDescAviso] = useState(DESC_AVISO().toString());
  const [toast, setToast] = useState({ show: false, msg: '' });

  const guardar = () => {
    setSetting('dias-aviso-default', diasAviso || '15');
    setSetting('umbral-aviso', uAviso || '60');
    setSetting('umbral-urgente', uUrgente || '30');
    setSetting('umbral-critico', uCritico || '7');
    setSetting('desc-critico', descCritico || '40');
    setSetting('desc-urgente', descUrgente || '20');
    setSetting('desc-aviso', descAviso || '10');
    setSetting('categorias', categorias);
    setToast({ show: true, msg: 'Configuración guardada' });
  };

  const cambiarColor = (id: string) => {
    setColorMarca(id);
    guardarColorMarca(id);
    aplicarColorMarca(id);
  };

  const cambiarEscala = (v: number) => {
    const r = Math.round(v * 100) / 100;
    setEscalaFont(r);
    aplicarEscalaFont(r);   // aplica en vivo
    guardarEscalaFont(r);   // persiste
  };

  const cambiarNotif = (on: boolean) => {
    setNotifOn(on);
    setNotificacionesActivas(on);
    sincronizarNotificaciones(lotesEnriquecidos()); // pide permiso / programa o cancela
    setToast({ show: true, msg: on ? 'Avisos de vencimiento activados' : 'Avisos desactivados' });
  };

  const cambiarNotifHora = (h: number) => {
    setNotifHora(h);
    setHoraNotificacion(h);
    if (notifOn) sincronizarNotificaciones(lotesEnriquecidos());
  };

  const salir = async () => {
    await cerrarSesion();
  };

  const exportar = async () => {
    const json = exportarBackup();
    const nombre = `stockly_backup_${new Date().toISOString().slice(0, 10)}.json`;

    if (Capacitor.isNativePlatform()) {
      // Android: guardar con Filesystem en la carpeta Documents
      try {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        await Filesystem.writeFile({
          path: nombre,
          data: json,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        setToast({ show: true, msg: `Backup guardado en Documentos: ${nombre}` });
      } catch (e) {
        setToast({ show: true, msg: 'No se pudo guardar el backup' });
      }
      return;
    }

    // Web: descarga clásica
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast({ show: true, msg: 'Backup exportado' });
  };

  // Guarda un texto como archivo (Documents en Android, descarga en web).
  const guardarTexto = async (nombre: string, contenido: string, mime: string) => {
    if (Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        await Filesystem.writeFile({ path: nombre, data: contenido, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
        setToast({ show: true, msg: `Guardado en Documentos: ${nombre}` });
      } catch {
        setToast({ show: true, msg: 'No se pudo guardar el archivo' });
      }
      return;
    }
    const blob = new Blob([contenido], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast({ show: true, msg: 'Planilla exportada' });
  };

  const fechaHoy = () => new Date().toISOString().slice(0, 10);
  const exportarStockCSV = () =>
    guardarTexto(`stockly_stock_${fechaHoy()}.csv`, stockACSV(lotesEnriquecidos()), 'text/csv');
  const exportarMovimientosCSV = () =>
    guardarTexto(`stockly_movimientos_${fechaHoy()}.csv`, movimientosACSV(state.movimientos, state.productos), 'text/csv');

  const importar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const texto = await file.text();
      const { ok, error } = await importarBackup(texto);
      setToast({ show: true, msg: `Importados: ${ok}${error ? ` · Errores: ${error}` : ''}` });
    } catch {
      setToast({ show: true, msg: 'No se pudo leer el archivo' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as any}>
        <div className="animate-fade-in" style={{
          padding: '20px 16px calc(96px + env(safe-area-inset-bottom)) 16px',
          maxWidth: 640, margin: '0 auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>Ajustes</h1>
            <Logo size={28} />
          </div>

          {/* Cuenta */}
          <Card padding="md" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 'var(--radius-md)',
                background: 'var(--brand-50)', color: 'var(--brand-600)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <UserCircleIcon width={28} height={28} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{comercio?.nombre || 'Mi comercio'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {miembro?.nombre} · {miembro?.rol === 'dueno' ? 'Dueño' : 'Empleado'}
                </div>
                {comercio?.plan === 'trial' && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600, marginTop: 2 }}>
                    Período de prueba
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Stats */}
          <Card padding="md" style={{ marginBottom: 12 }}>
            <SectionTitle icon={<InformationCircleIcon width={16} height={16} />}>Resumen</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 8 }}>
              <Stat label="Productos" value={state.productos.length} />
              <Stat label="Lotes" value={state.lotes.length} />
              <Stat label="Sucursales" value={state.sucursales.length} />
              <Stat label="Movim." value={state.movimientos.length} />
            </div>
          </Card>

          {/* Apariencia */}
          <Card padding="md" style={{ marginBottom: 12 }}>
            <SectionTitle icon={isDark ? <MoonIcon width={16} height={16} /> : <SunIcon width={16} height={16} />}>
              Apariencia
            </SectionTitle>
            <button type="button" onClick={onThemeToggle} style={rowBtn}>
              <span>{isDark ? 'Tema oscuro' : 'Tema claro'}</span>
              <span style={{ color: 'var(--text-3)', fontSize: 13 }}>Cambiar</span>
            </button>

            {/* Selector de color de marca */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <SwatchIcon width={16} height={16} style={{ color: 'var(--text-2)' }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>Color de la app</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {COLORES_MARCA.map(c => {
                  const seleccionado = c.id === colorMarca;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => cambiarColor(c.id)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                        background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: `linear-gradient(145deg, ${c.tonos[0]}, ${c.tonos[2]})`,
                        boxShadow: seleccionado ? `0 0 0 3px var(--surface), 0 0 0 5px ${c.tonos[1]}` : 'none',
                        transition: 'all 150ms',
                      }} />
                      <span style={{ fontSize: 11, color: seleccionado ? 'var(--text)' : 'var(--text-3)', fontWeight: seleccionado ? 600 : 400 }}>
                        {c.nombre}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tamaño de texto */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Tamaño de texto</span>
                <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'var(--font-mono, monospace)' }}>
                  {Math.round(escalaFont * 100)}%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>A</span>
                <input
                  type="range"
                  aria-label="Tamaño de texto"
                  min={ESCALA_MIN}
                  max={ESCALA_MAX}
                  step={0.05}
                  value={escalaFont}
                  onChange={e => cambiarEscala(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--brand-500)' }}
                />
                <span style={{ fontSize: 22, color: 'var(--text-3)', lineHeight: 1 }}>A</span>
              </div>
              {escalaFont !== 1 && (
                <button
                  type="button"
                  onClick={() => cambiarEscala(1)}
                  style={{
                    marginTop: 10, background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--brand-600)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', padding: 0,
                  }}
                >
                  Restablecer al 100%
                </button>
              )}
            </div>
          </Card>

          {/* Estado de la nube (diagnóstico) */}
          <Card padding="md" style={{ marginBottom: 12 }}>
            <SectionTitle icon={<CloudIcon width={16} height={16} />}>
              Sincronización
            </SectionTitle>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Conexión a la nube</span>
                <span style={{ fontWeight: 600, color: estadoNube.configurado ? 'var(--level-ok-fg)' : 'var(--level-vencido-fg)' }}>
                  {estadoNube.configurado ? 'Configurada' : 'NO configurada'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Cambios sin subir</span>
                <span style={{ fontWeight: 600 }}>{state.pendientesSync}</span>
              </div>
              {state.bloqueadosSync > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--level-vencido-fg)' }}>No sincronizados</span>
                  <span style={{ fontWeight: 700, color: 'var(--level-vencido-fg)' }}>{state.bloqueadosSync}</span>
                </div>
              )}
              {estadoNube.ultimaSyncOk && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Última sync OK</span>
                  <span style={{ fontWeight: 600 }}>{new Date(estadoNube.ultimaSyncOk).toLocaleString('es-AR')}</span>
                </div>
              )}
              {estadoNube.ultimoError && (
                <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: 'var(--level-vencido-bg)', color: 'var(--level-vencido-fg)', fontSize: 12 }}>
                  Último error: {estadoNube.ultimoError}
                </div>
              )}
            </div>
            <button type="button" onClick={sincronizarAhora} disabled={sincronizando} style={{ ...rowBtn, marginTop: 12, opacity: sincronizando ? 0.5 : 1 }}>
              <span>{sincronizando ? 'Sincronizando...' : 'Sincronizar ahora'}</span>
              <span style={{ color: 'var(--brand-600)', fontSize: 13 }}>↻</span>
            </button>
            {state.bloqueadosSync > 0 && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'var(--level-vencido-bg)' }}>
                <div style={{ fontSize: 12, color: 'var(--level-vencido-fg)', marginBottom: 8 }}>
                  Hay {state.bloqueadosSync} cambio{state.bloqueadosSync > 1 ? 's' : ''} que no se pudo sincronizar. No se perdieron: tocá para reintentar.
                </div>
                <Button variant="secondary" size="md" fullWidth onClick={reintentarFallidos} disabled={sincronizando}>
                  Reintentar no sincronizados
                </Button>
              </div>
            )}
          </Card>

          {/* Notificaciones */}
          <Card padding="md" style={{ marginBottom: 12 }}>
            <SectionTitle icon={<BellAlertIcon width={16} height={16} />}>Avisos de vencimiento</SectionTitle>
            <button type="button" onClick={() => cambiarNotif(!notifOn)} style={rowBtn}>
              <span>Notificarme productos por vencer</span>
              {/* mini switch */}
              <span style={{
                width: 42, height: 24, borderRadius: 999, padding: 2, flexShrink: 0,
                background: notifOn ? 'var(--brand-500)' : 'var(--border-strong)',
                display: 'inline-flex', alignItems: 'center',
                justifyContent: notifOn ? 'flex-end' : 'flex-start', transition: 'all 160ms',
              }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
              </span>
            </button>
            {notifOn && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14 }}>Hora del aviso</span>
                <select
                  value={notifHora}
                  onChange={e => cambiarNotifHora(parseInt(e.target.value, 10))}
                  style={{
                    fontFamily: 'inherit', fontSize: 14, padding: '8px 12px', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)',
                  }}
                >
                  {[7, 8, 9, 10, 11, 12, 18, 19, 20, 21].map(h => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
            )}
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
              Aviso diario en tu celular con los productos vencidos o por vencer. Funciona sin internet.
            </p>
          </Card>

          {/* Umbrales */}
          <Card padding="md" style={{ marginBottom: 12 }}>
            <SectionTitle icon={<BellAlertIcon width={16} height={16} />}>Niveles de alerta</SectionTitle>
            <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 12px' }}>
              Días de anticipación para cada nivel de escalado.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <UmbralField nivel="aviso" label="Aviso" value={uAviso} onChange={setUAviso} />
              <UmbralField nivel="urgente" label="Urgente" value={uUrgente} onChange={setUUrgente} />
              <UmbralField nivel="critico" label="Crítico" value={uCritico} onChange={setUCritico} />
            </div>
            <Field label="Días aviso default (nuevos lotes)">
              <Input value={diasAviso} onChange={e => setDiasAviso(e.target.value)} inputMode="numeric" />
            </Field>
          </Card>

          {/* Liquidación FEFO */}
          <Card padding="md" style={{ marginBottom: 12 }}>
            <SectionTitle icon={<BanknotesIcon width={16} height={16} />}>Liquidación FEFO</SectionTitle>
            <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 12px' }}>
              Descuento (%) sugerido para rematar lotes según su nivel de vencimiento. Poné 0 para desactivar uno.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <DescField nivel="critico" label="Crítico" value={descCritico} onChange={setDescCritico} />
              <DescField nivel="urgente" label="Urgente" value={descUrgente} onChange={setDescUrgente} />
              <DescField nivel="aviso" label="Aviso" value={descAviso} onChange={setDescAviso} />
            </div>
          </Card>

          {/* Categorías */}
          <Card padding="md" style={{ marginBottom: 12 }}>
            <SectionTitle icon={<TagIcon width={16} height={16} />}>Categorías</SectionTitle>
            <Field hint="Una por línea">
              <Textarea value={categorias} onChange={e => setCategorias(e.target.value)} rows={6} />
            </Field>
          </Card>

          <Button variant="primary" size="lg" fullWidth onClick={guardar} style={{ marginBottom: 12 }}>
            Guardar configuración
          </Button>

          {/* Backup */}
          <Card padding="none" style={{ marginBottom: 12, overflow: 'hidden' }}>
            <button type="button" onClick={exportarStockCSV} style={linkRow}>
              <span style={{ color: 'var(--brand-600)' }}><ArrowDownTrayIcon width={18} height={18} /></span>
              <span style={{ flex: 1, textAlign: 'left' }}>Exportar stock (planilla CSV)</span>
              <ChevronRightIcon width={16} height={16} style={{ color: 'var(--text-3)' }} />
            </button>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <button type="button" onClick={exportarMovimientosCSV} style={linkRow}>
              <span style={{ color: 'var(--brand-600)' }}><ArrowDownTrayIcon width={18} height={18} /></span>
              <span style={{ flex: 1, textAlign: 'left' }}>Exportar movimientos (planilla CSV)</span>
              <ChevronRightIcon width={16} height={16} style={{ color: 'var(--text-3)' }} />
            </button>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <button type="button" onClick={exportar} style={linkRow}>
              <span style={{ color: 'var(--brand-600)' }}><ArrowDownTrayIcon width={18} height={18} /></span>
              <span style={{ flex: 1, textAlign: 'left' }}>Exportar backup (JSON)</span>
              <ChevronRightIcon width={16} height={16} style={{ color: 'var(--text-3)' }} />
            </button>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} style={linkRow}>
              <span style={{ color: 'var(--brand-600)' }}><ArrowUpTrayIcon width={18} height={18} /></span>
              <span style={{ flex: 1, textAlign: 'left' }}>Importar backup (JSON)</span>
              <ChevronRightIcon width={16} height={16} style={{ color: 'var(--text-3)' }} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={importar}
              style={{ display: 'none' }}
            />
          </Card>

          {/* Sucursales + Etiquetas */}
          <Card padding="none" style={{ marginBottom: 12, overflow: 'hidden' }}>
            <button type="button" onClick={() => history.push('/sucursales')} style={linkRow}>
              <span style={{ color: 'var(--brand-600)' }}><BuildingStorefrontIcon width={18} height={18} /></span>
              <span style={{ flex: 1, textAlign: 'left' }}>Gestionar sucursales</span>
              <ChevronRightIcon width={16} height={16} style={{ color: 'var(--text-3)' }} />
            </button>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <button type="button" onClick={() => history.push('/inventario')} style={linkRow}>
              <span style={{ color: 'var(--brand-600)' }}><ClipboardDocumentCheckIcon width={18} height={18} /></span>
              <span style={{ flex: 1, textAlign: 'left' }}>Inventario físico (conteo)</span>
              <ChevronRightIcon width={16} height={16} style={{ color: 'var(--text-3)' }} />
            </button>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <button type="button" onClick={() => history.push('/etiquetas')} style={linkRow}>
              <span style={{ color: 'var(--brand-600)' }}><PrinterIcon width={18} height={18} /></span>
              <span style={{ flex: 1, textAlign: 'left' }}>Etiquetas de precios</span>
              <ChevronRightIcon width={16} height={16} style={{ color: 'var(--text-3)' }} />
            </button>
          </Card>

          {/* Cerrar sesión */}
          <Button variant="ghost" size="md" fullWidth onClick={salir}
            icon={<ArrowRightOnRectangleIcon width={18} height={18} />}
            style={{ color: 'var(--danger)' }}>
            Cerrar sesión
          </Button>

          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', marginTop: 20 }}>
            Stockly v1.0 · Datos en la nube
          </p>
        </div>

        <IonToast isOpen={toast.show} message={toast.msg} duration={2000}
          onDidDismiss={() => setToast({ show: false, msg: '' })} />
      </IonContent>
    </IonPage>
  );
};

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
    <span style={{ color: 'var(--brand-600)', display: 'flex' }}>{icon}</span>
    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>{children}</span>
  </div>
);
const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em' }}>{value}</div>
    <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
  </div>
);
const UmbralField: React.FC<{ nivel: string; label: string; value: string; onChange: (v: string) => void }> =
  ({ nivel, label, value, onChange }) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--level-${nivel}-fg)` }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{label}</span>
      </div>
      <Input value={value} onChange={e => onChange(e.target.value)} inputMode="numeric" />
      <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '4px 0 0', textAlign: 'center' }}>días</p>
    </div>
  );
const DescField: React.FC<{ nivel: string; label: string; value: string; onChange: (v: string) => void }> =
  ({ nivel, label, value, onChange }) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--level-${nivel}-fg)` }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{label}</span>
      </div>
      <Input value={value} onChange={e => onChange(e.target.value)} inputMode="numeric" />
      <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '4px 0 0', textAlign: 'center' }}>% desc.</p>
    </div>
  );
const rowBtn: React.CSSProperties = {
  width: '100%', padding: '12px 0', background: 'none', border: 'none',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
};
const linkRow: React.CSSProperties = {
  width: '100%', padding: 16, background: 'none', border: 'none',
  display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
  color: 'var(--text)', fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
};

export default ConfigPage;
