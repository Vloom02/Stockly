"""Pruebas del backend contra el Supabase LOCAL (nunca contra producción).

Crea (si faltan) tres usuarios de prueba y verifica, vía la API real (PostgREST +
GoTrue), los arreglos de la auditoría 2026-10: plan protegido, stock solo por
delta, movimientos inmutables, validación de registrar_venta, idempotencia sin
carrera y el panel de soporte.

Uso:  python -I pruebas_backend.py         (con `supabase start` corriendo)
Las contraseñas de prueba se generan una vez y quedan en usuarios-prueba.json.
"""
import json
import os
import secrets
import sys
import threading
import urllib.error
import urllib.request
import uuid

API = 'http://127.0.0.1:54321'
# Claves DEMO públicas del Supabase local (las mismas en cualquier instalación local).
ANON = ('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.'
        'CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0')
SERVICE = ('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.'
           'EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU')
AQUI = os.path.dirname(os.path.abspath(__file__))
ARCHIVO_USUARIOS = os.path.join(AQUI, 'usuarios-prueba.json')

assert API.startswith('http://127.0.0.1'), 'estas pruebas solo corren contra el Supabase local'
sys.stdout.reconfigure(encoding='utf-8')  # la consola de Windows usa cp1252


def http(method, path, token=None, body=None, extra_headers=None):
    headers = {'apikey': ANON, 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    headers.update(extra_headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except ValueError:
            return e.code, txt


def usuarios():
    if os.path.exists(ARCHIVO_USUARIOS):
        return json.load(open(ARCHIVO_USUARIOS, encoding='utf-8'))
    u = {
        'dueno':    {'email': 'dueno@prueba.test',    'password': 'prueba' + secrets.token_hex(5), 'nombre': 'Marta', 'comercio': 'Almacén de Prueba'},
        'empleado': {'email': 'empleado@prueba.test', 'password': 'prueba' + secrets.token_hex(5), 'nombre': 'Juan'},
        'dev':      {'email': 'dev@prueba.test',      'password': 'prueba' + secrets.token_hex(5), 'nombre': 'Soporte', 'comercio': 'Comercio del desarrollador'},
    }
    json.dump(u, open(ARCHIVO_USUARIOS, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    return u


def admin_crear_usuario(email, password, meta):
    s, r = http('POST', '/auth/v1/admin/users', SERVICE,
                {'email': email, 'password': password, 'email_confirm': True, 'user_metadata': meta},
                {'apikey': SERVICE})
    if s in (200, 201):
        return r['id']
    if s == 422 or (isinstance(r, dict) and 'already' in json.dumps(r)):
        return None  # ya existía
    raise SystemExit(f'no se pudo crear {email}: {s} {r}')


def login(u):
    s, r = http('POST', '/auth/v1/token?grant_type=password', body={'email': u['email'], 'password': u['password']})
    assert s == 200, (s, r)
    return r['access_token'], r['user']['id']


def sql_service(method, path, body=None, prefer=None):
    h = {'apikey': SERVICE}
    if prefer:
        h['Prefer'] = prefer
    return http(method, path, SERVICE, body, h)


resultados = []


def caso(nombre, ok, detalle=''):
    resultados.append((nombre, ok))
    print(('  OK   ' if ok else '  FALLA') + f'  {nombre}' + (f'  ({detalle})' if detalle and not ok else ''))


def main():
    U = usuarios()

    # ── Usuarios ──────────────────────────────────────────────────────────
    admin_crear_usuario(U['dueno']['email'], U['dueno']['password'],
                        {'nombre': U['dueno']['nombre'], 'nombre_comercio': U['dueno']['comercio']})
    tok_d, uid_d = login(U['dueno'])
    _, m = http('GET', f'/rest/v1/miembros?user_id=eq.{uid_d}&select=comercio_id,rol', tok_d)
    comercio = m[0]['comercio_id']
    _, sucs = http('GET', f'/rest/v1/sucursales?comercio_id=eq.{comercio}&select=id', tok_d)
    sucursal = sucs[0]['id']

    s, empleados = http('GET', f'/rest/v1/miembros?comercio_id=eq.{comercio}&rol=eq.empleado&select=user_id', tok_d)
    if not empleados:
        # La app ya no invita (migración 10); una cuenta de empleado vieja se simula
        # con una invitación cargada a mano, que el alta de usuarios todavía acepta.
        codigo = 'PRUEBA' + secrets.token_hex(3).upper()
        s, inv = sql_service('POST', '/rest/v1/invitaciones', {'comercio_id': comercio, 'codigo': codigo, 'creada_por': uid_d})
        assert s == 201, (s, inv)
        admin_crear_usuario(U['empleado']['email'], U['empleado']['password'],
                            {'nombre': U['empleado']['nombre'], 'codigo_invitacion': codigo})
    tok_e, uid_e = login(U['empleado'])

    admin_crear_usuario(U['dev']['email'], U['dev']['password'],
                        {'nombre': U['dev']['nombre'], 'nombre_comercio': U['dev']['comercio']})
    tok_v, uid_v = login(U['dev'])
    sql_service('POST', '/rest/v1/plataforma_admins', {'user_id': uid_v}, 'resolution=ignore-duplicates')

    print('Usuarios listos (contraseñas en usuarios-prueba.json)')
    print('\n── A) Plan protegido')
    s, r = http('PATCH', f'/rest/v1/comercios?id=eq.{comercio}', tok_d, {'plan': 'activo'})
    caso('el dueño NO puede cambiarse el plan', s >= 400 and 'plan' in json.dumps(r, ensure_ascii=False), f'{s} {r}')
    s, r = http('PATCH', f'/rest/v1/comercios?id=eq.{comercio}', tok_d, {'nombre': U['dueno']['comercio']},
                {'Prefer': 'return=representation'})
    caso('el dueño SÍ puede cambiar el nombre del comercio', s == 200 and r and r[0]['nombre'] == U['dueno']['comercio'], f'{s} {r}')

    print('\n── B) Stock: cantidad solo por delta, borrar solo el dueño')
    prod = str(uuid.uuid4())
    s, r = http('POST', '/rest/v1/productos', tok_d, {'id': prod, 'comercio_id': comercio, 'nombre': 'Leche 1L', 'categoria': 'Lácteos', 'precio': 1200})
    caso('el dueño crea un producto', s == 201, f'{s} {r}')
    s, r = http('POST', '/rest/v1/productos', tok_e, {'id': str(uuid.uuid4()), 'comercio_id': comercio, 'nombre': 'X', 'categoria': 'X', 'precio': 1})
    caso('el empleado NO puede crear productos (RLS)', s >= 400, f'{s} {r}')
    lote = str(uuid.uuid4())
    s, r = http('POST', '/rest/v1/lotes', tok_e, {'id': lote, 'comercio_id': comercio, 'producto_id': prod, 'sucursal_id': sucursal,
                                                  'cantidad': 10, 'fecha_vencimiento': '2027-01-01', 'dias_aviso': 7})
    caso('el empleado carga un lote (alta con cantidad)', s == 201, f'{s} {r}')
    http('PATCH', f'/rest/v1/lotes?id=eq.{lote}', tok_e, {'cantidad': 999})
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    caso('un UPDATE directo de cantidad no cambia el stock', l[0]['cantidad'] == 10, f'quedó {l[0]["cantidad"]}')
    s, r = http('POST', '/rest/v1/lotes?on_conflict=id', tok_e,
                {'id': lote, 'comercio_id': comercio, 'producto_id': prod, 'sucursal_id': sucursal, 'cantidad': 10,
                 'fecha_vencimiento': '2027-01-01', 'dias_aviso': 7},
                {'Prefer': 'resolution=merge-duplicates'})
    s2, r2 = http('POST', '/rest/v1/rpc/ajustar_stock', tok_e, {'p': {
        'mov_id': str(uuid.uuid4()), 'comercio_id': comercio, 'lote_id': lote, 'producto_id': prod, 'sucursal_id': sucursal,
        'tipo': 'ajuste', 'delta': -3, 'cantidad_anterior': 10, 'usuario': 'Juan', 'notas': 'prueba', 'fecha': '2026-10-25T10:00:00Z'}})
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    caso('ajustar_stock (delta -3) sí funciona para el empleado', s2 == 200 and l[0]['cantidad'] == 7, f'{s2} {r2} cant={l[0]["cantidad"]}')
    http('POST', '/rest/v1/lotes?on_conflict=id', tok_e,
         {'id': lote, 'comercio_id': comercio, 'producto_id': prod, 'sucursal_id': sucursal, 'cantidad': 10,
          'fecha_vencimiento': '2027-01-01', 'dias_aviso': 7}, {'Prefer': 'resolution=merge-duplicates'})
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    caso('reintentar el alta del lote no pisa el stock descontado', l[0]['cantidad'] == 7, f'quedó {l[0]["cantidad"]}')
    http('DELETE', f'/rest/v1/lotes?id=eq.{lote}', tok_e)
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=id', tok_d)
    caso('el empleado NO puede borrar lotes', len(l) == 1)

    print('\n── C) Movimientos inmutables')
    _, movs = http('GET', f'/rest/v1/movimientos?lote_id=eq.{lote}&select=id,notas&limit=1', tok_d)
    mov = movs[0]
    http('PATCH', f'/rest/v1/movimientos?id=eq.{mov["id"]}', tok_d, {'notas': 'editado'})
    http('DELETE', f'/rest/v1/movimientos?id=eq.{mov["id"]}', tok_d)
    _, m2 = http('GET', f'/rest/v1/movimientos?id=eq.{mov["id"]}&select=notas', tok_d)
    caso('nadie edita ni borra el historial desde la app', len(m2) == 1 and m2[0]['notas'] == mov['notas'], f'{m2}')

    print('\n── D) registrar_venta valida en el servidor')
    def venta(items, descuento=0, vid=None, token=tok_e):
        return http('POST', '/rest/v1/rpc/registrar_venta', token, {'p': {
            'id': vid or str(uuid.uuid4()), 'comercio_id': comercio, 'sucursal_id': sucursal, 'usuario': 'Juan',
            'metodo_pago': 'efectivo', 'descuento': descuento, 'fecha': '2026-10-25T10:00:00Z', 'items': items}})
    s, r = venta([{'producto_id': prod, 'nombre': 'Leche 1L', 'cantidad': 1, 'precio': -500}])
    caso('precio negativo → rechazada', s >= 400 and 'precio' in json.dumps(r, ensure_ascii=False), f'{s} {r}')
    s, r = venta([{'producto_id': prod, 'nombre': 'Leche 1L', 'cantidad': 1, 'precio': 1200}], descuento=-100)
    caso('descuento negativo → rechazada', s >= 400 and 'descuento' in json.dumps(r, ensure_ascii=False), f'{s} {r}')
    s, r = venta([{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 500}], descuento=9999)
    caso('descuento mayor al total → total 0 (no negativo)', s == 200 and float(r['total']) == 0, f'{s} {r}')
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    antes = l[0]['cantidad']
    s, r = venta([{'producto_id': prod, 'nombre': 'Leche 1L', 'cantidad': 2, 'precio': 1200}])
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    caso('venta normal descuenta stock (FEFO)', s == 200 and l[0]['cantidad'] == antes - 2 and float(r['total']) == 2400, f'{s} {r} {l}')

    print('\n── E) Dos reintentos simultáneos de la misma venta')
    vid = str(uuid.uuid4())
    salidas = []
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    antes = l[0]['cantidad']
    hilos = [threading.Thread(target=lambda: salidas.append(venta([{'producto_id': prod, 'nombre': 'Leche 1L', 'cantidad': 1, 'precio': 1200}], vid=vid)))
             for _ in range(2)]
    [h.start() for h in hilos]
    [h.join() for h in hilos]
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    ok_status = all(st == 200 for st, _ in salidas)
    dup = sorted(bool(r.get('duplicada')) for _, r in salidas if isinstance(r, dict))
    caso('ninguno da error, uno sale "duplicada" y el stock baja una sola vez',
         ok_status and dup == [False, True] and l[0]['cantidad'] == antes - 1, f'{salidas} cant={l[0]["cantidad"]}')

    print('\n── F) Panel de soporte')
    s, r = http('POST', '/rest/v1/rpc/es_admin_plataforma', tok_v, {})
    caso('el desarrollador es reconocido como admin', s == 200 and r is True, f'{s} {r}')
    s, r = http('POST', '/rest/v1/rpc/es_admin_plataforma', tok_d, {})
    caso('el dueño NO es admin', s == 200 and r is False, f'{s} {r}')
    s, r = http('POST', '/rest/v1/rpc/admin_listar_comercios', tok_d, {})
    caso('el dueño NO puede listar todos los comercios', s >= 400, f'{s} {r}')
    s, lista = http('POST', '/rest/v1/rpc/admin_listar_comercios', tok_v, {})
    fila = next((c for c in lista if c['id'] == comercio), None) if s == 200 else None
    caso('el desarrollador ve todos los comercios con sus números', bool(fila) and fila['productos'] >= 1 and fila['email_dueno'] == U['dueno']['email'], f'{s} {fila}')
    s, r = http('POST', '/rest/v1/rpc/admin_cambiar_plan', tok_v, {'p': {'comercio_id': comercio, 'plan': 'activo'}})
    _, c = http('GET', f'/rest/v1/comercios?id=eq.{comercio}&select=plan', tok_d)
    caso('el desarrollador activa el plan', s == 200 and c[0]['plan'] == 'activo', f'{s} {r} {c}')
    _, aud = sql_service('GET', f'/rest/v1/admin_auditoria?comercio_id=eq.{comercio}&select=accion,despues&order=id.desc&limit=1')
    caso('el cambio queda auditado', bool(aud) and aud[0]['despues']['plan'] == 'activo', f'{aud}')
    s, r = http('POST', '/rest/v1/rpc/admin_cambiar_plan', tok_d, {'p': {'comercio_id': comercio, 'plan': 'activo'}})
    caso('el dueño NO puede usar admin_cambiar_plan', s >= 400, f'{s} {r}')
    # Dejar el comercio de prueba en "trial" vigente para las pruebas de la app.
    http('POST', '/rest/v1/rpc/admin_cambiar_plan', tok_v, {'p': {'comercio_id': comercio, 'plan': 'trial', 'trial_hasta': '2027-01-31T23:59:59Z'}})

    print('\n── G) Stock negativo: vender sin stock y que el ingreso lo descuente')
    pol = str(uuid.uuid4())
    http('POST', '/rest/v1/productos', tok_d, {'id': pol, 'comercio_id': comercio, 'nombre': 'Polenta (prueba negativo)', 'categoria': 'Almacén', 'precio': 900})
    stock = lambda: sum(x['cantidad'] for x in http('GET', f'/rest/v1/lotes?producto_id=eq.{pol}&sucursal_id=eq.{sucursal}&select=cantidad', tok_d)[1])
    s, r = venta([{'producto_id': pol, 'nombre': 'Polenta', 'cantidad': 2, 'precio': 900}])
    caso('vender 2 polentas sin stock: la venta sale y avisa el faltante', s == 200 and r['faltantes'][0]['faltante'] == 2, f'{s} {r}')
    caso('el stock queda en -2', stock() == -2, f'stock={stock()}')
    _, mv = http('GET', f'/rest/v1/movimientos?producto_id=eq.{pol}&select=notas,usuario', tok_d)
    caso('queda el movimiento "Venta sin stock" con quién vendió', any(m['notas'].startswith('Venta sin stock') and m['usuario'] == 'Juan' for m in mv), f'{mv}')
    nuevo = str(uuid.uuid4())
    s, r = http('POST', '/rest/v1/lotes', tok_e, {'id': nuevo, 'comercio_id': comercio, 'producto_id': pol, 'sucursal_id': sucursal,
                                                   'cantidad': 6, 'fecha_vencimiento': '2027-03-01', 'dias_aviso': 7})
    _, ls = http('GET', f'/rest/v1/lotes?producto_id=eq.{pol}&select=id,cantidad,retirado', tok_d)
    caso('entran 6: quedan 4 en el lote nuevo y el negativo vuelve a 0 (retirado)',
         s == 201 and stock() == 4 and next(x for x in ls if x['id'] == nuevo)['cantidad'] == 4
         and all(x['retirado'] for x in ls if x['id'] != nuevo), f'{s} {ls}')
    s, r = venta([{'producto_id': pol, 'nombre': 'Polenta', 'cantidad': 5, 'precio': 900}])
    caso('hay 4 y se venden 5: vuelve a -1', s == 200 and stock() == -1, f'stock={stock()}')
    s, r = http('POST', '/rest/v1/rpc/anular_venta', tok_d, {'p': {'venta_id': r['venta_id'], 'comercio_id': comercio, 'usuario': 'Marta'}})
    caso('anular esa venta devuelve las 5: quedan 4', s == 200 and stock() == 4, f'{s} {r} stock={stock()}')
    venta([{'producto_id': pol, 'nombre': 'Polenta', 'cantidad': 6, 'precio': 900}])
    neg = next(x for x in http('GET', f'/rest/v1/lotes?producto_id=eq.{pol}&cantidad=lt.0&select=id,cantidad', tok_d)[1])
    s, r = http('POST', '/rest/v1/rpc/ajustar_stock', tok_d, {'p': {
        'mov_id': str(uuid.uuid4()), 'comercio_id': comercio, 'lote_id': neg['id'], 'tipo': 'ajuste', 'delta': 1,
        'cantidad_anterior': neg['cantidad'], 'usuario': 'Marta', 'notas': 'conteo'}})
    caso('al contar, un lote en -2 sube a -1 (no salta a 0)', s == 200 and r['cantidad'] == -1 and stock() == -1, f'{s} {r} stock={stock()}')

    print('\n── H) Costo y ganancia')
    s, r = http('PATCH', f'/rest/v1/productos?id=eq.{pol}', tok_d, {'costo': 600}, {'Prefer': 'return=representation'})
    caso('el dueño carga el costo de un producto', s == 200 and float(r[0]['costo']) == 600, f'{s} {r}')
    s, r = venta([{'producto_id': pol, 'nombre': 'Polenta', 'cantidad': 2, 'precio': 900}])
    _, it = http('GET', f"/rest/v1/ventas_items?venta_id=eq.{r['venta_id']}&select=costo_unit", tok_d)
    caso('la venta guarda el costo de ese día en cada ítem', s == 200 and it and all(float(x['costo_unit']) == 600 for x in it), f'{s} {it}')
    http('PATCH', f'/rest/v1/productos?id=eq.{pol}', tok_d, {'costo': 700})
    _, it2 = http('GET', f"/rest/v1/ventas_items?venta_id=eq.{r['venta_id']}&select=costo_unit", tok_d)
    caso('si después sube el costo, la venta vieja no cambia', all(float(x['costo_unit']) == 600 for x in it2), f'{it2}')

    fallas = [n for n, ok in resultados if not ok]
    print(f'\n{len(resultados) - len(fallas)}/{len(resultados)} pruebas OK')
    sys.exit(1 if fallas else 0)


def cargar_datos_ejemplo():
    """Productos con vencimientos variados, un cajero y el PIN del dueño (idempotente)."""
    import datetime as dt
    U = usuarios()
    tok_d, uid_d = login(U['dueno'])
    _, m = http('GET', f'/rest/v1/miembros?user_id=eq.{uid_d}&select=comercio_id', tok_d)
    comercio = m[0]['comercio_id']
    _, sucs = http('GET', f'/rest/v1/sucursales?comercio_id=eq.{comercio}&select=id', tok_d)
    sucursal = sucs[0]['id']
    hoy = dt.date.today()
    catalogo = [  # nombre, categoría, precio, código, [(cantidad, días hasta vencer)]
        ('Yogur bebible frutilla 1L', 'Lácteos', 1850, '7790080000011', [(6, 2)]),
        ('Pan lactal grande', 'Panificados', 2300, '7790080000028', [(3, -1)]),
        ('Fideos tirabuzón 500g', 'Almacén', 980, '7790080000035', [(24, 180)]),
        ('Gaseosa cola 2,25L', 'Bebidas', 2900, '7790080000042', [(12, 365)]),
        ('Queso cremoso x kg', 'Lácteos', 8900, '7790080000059', [(2, 5), (4, 25)]),
        ('Galletitas de agua', 'Almacén', 1100, '7790080000066', [(15, 60)]),
    ]
    _, existentes = http('GET', f'/rest/v1/productos?comercio_id=eq.{comercio}&select=nombre', tok_d)
    ya = {p['nombre'] for p in existentes}
    for nombre, cat, precio, codigo, lotes in catalogo:
        if nombre in ya:
            continue
        pid = str(uuid.uuid4())
        http('POST', '/rest/v1/productos', tok_d, {'id': pid, 'comercio_id': comercio, 'nombre': nombre, 'categoria': cat,
                                                   'precio': precio, 'codigo_barras': codigo, 'dias_aviso_default': 7})
        for cant, dias in lotes:
            http('POST', '/rest/v1/lotes', tok_d, {'id': str(uuid.uuid4()), 'comercio_id': comercio, 'producto_id': pid,
                                                   'sucursal_id': sucursal, 'cantidad': cant, 'dias_aviso': 7,
                                                   'fecha_vencimiento': (hoy + dt.timedelta(days=dias)).isoformat()})
    # Cajero y PIN de dueño (claves numéricas de prueba, guardadas junto a los usuarios)
    if 'cajero' not in U:
        U['cajero'] = {'nombre': 'Rosa', 'clave': f'{secrets.randbelow(9000) + 1000}'}
        U['pin_dueno'] = f'{secrets.randbelow(9000) + 1000}'
        json.dump(U, open(ARCHIVO_USUARIOS, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    s1, r1 = http('POST', '/rest/v1/rpc/guardar_empleado_venta', tok_d,
                  {'p': {'comercio_id': comercio, 'legajo': '01', 'nombre': U['cajero']['nombre'], 'pass': U['cajero']['clave']}})
    s2, r2 = http('POST', '/rest/v1/rpc/configurar_pin', tok_d, {'p': {'comercio_id': comercio, 'pin': U['pin_dueno']}})
    print('cajero:', s1, '| pin dueño:', s2, r2 if s2 != 200 else '')
    _, n = http('GET', f'/rest/v1/productos?comercio_id=eq.{comercio}&select=id', tok_d)
    print(f'{len(n)} productos en "{U["dueno"]["comercio"]}"')


if __name__ == '__main__':
    if '--datos' in sys.argv:
        cargar_datos_ejemplo()
    else:
        main()
