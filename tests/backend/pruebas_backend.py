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

    print('\n── I) Migración 13: seguridad y consistencia')
    vf = str(uuid.uuid4())
    s, r = http('POST', '/rest/v1/rpc/registrar_venta', tok_e, {'p': {
        'id': vf, 'comercio_id': comercio, 'sucursal_id': sucursal, 'usuario': 'Juan', 'metodo_pago': 'efectivo',
        'cliente': 'Doña Rosa', 'fiado': True, 'descuento': 0, 'fecha': '2026-10-25T10:00:00Z',
        'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 1000}]}})
    http('PATCH', f'/rest/v1/ventas_ventas?id=eq.{vf}', tok_d, {'total': 1})
    http('DELETE', f'/rest/v1/ventas_ventas?id=eq.{vf}', tok_d)
    _, v = http('GET', f'/rest/v1/ventas_ventas?id=eq.{vf}&select=total', tok_d)
    caso('nadie edita ni borra una venta por la API', s == 200 and len(v) == 1 and float(v[0]['total']) == 1000, f'{s} {v}')
    s, r = http('POST', '/rest/v1/ventas_ventas', tok_d, {'id': str(uuid.uuid4()), 'comercio_id': comercio, 'total': 5})
    caso('una venta no se crea directo (solo con registrar_venta)', s >= 400, f'{s} {r}')
    s, r = http('POST', '/rest/v1/rpc/anular_venta', tok_e, {'p': {'venta_id': vf, 'comercio_id': comercio, 'usuario': 'Juan'}})
    caso('una cuenta de empleado NO puede anular ventas', s >= 400 and 'dueño' in json.dumps(r, ensure_ascii=False), f'{s} {r}')

    _, d = http('GET', f'/rest/v1/ventas_deudas?venta_id=eq.{vf}&select=id,monto', tok_d)
    deuda = d[0]['id']
    pago = str(uuid.uuid4())
    pagar = lambda pid, monto: http('POST', '/rest/v1/rpc/registrar_pago_fiado', tok_d, {'p': {
        'pago_id': pid, 'deuda_id': deuda, 'comercio_id': comercio, 'monto': monto, 'usuario': 'Marta'}})
    hilos = [threading.Thread(target=lambda: pagar(pago, 1000)) for _ in range(2)]
    [h.start() for h in hilos]
    [h.join() for h in hilos]
    s, r = pagar(str(uuid.uuid4()), 1000)  # otro equipo cobra de nuevo la misma deuda
    _, pg = http('GET', f'/rest/v1/ventas_pagos?deuda_id=eq.{deuda}&select=monto', tok_d)
    caso('el fiado se cobra una sola vez (reintento simultáneo y cobro repetido)',
         s == 200 and r.get('sin_saldo') and sum(float(x['monto']) for x in pg) == 1000, f'{s} {r} {pg}')
    http('DELETE', f'/rest/v1/ventas_pagos?deuda_id=eq.{deuda}', tok_d)
    _, pg2 = http('GET', f'/rest/v1/ventas_pagos?deuda_id=eq.{deuda}&select=id', tok_d)
    caso('los pagos de fiado no se borran por la API', len(pg2) == len(pg), f'{pg2}')

    leg = 'T' + secrets.token_hex(2)
    s, r = http('POST', '/rest/v1/rpc/guardar_empleado_venta', tok_d, {'p': {'comercio_id': comercio, 'legajo': leg, 'nombre': 'Prueba ' + leg, 'pass': '4321'}})
    emp = r['id'] if s == 200 else None
    _, h = sql_service('GET', f'/rest/v1/ventas_empleados?id=eq.{emp}&select=pass_hash')
    caso('las claves nuevas se guardan con bcrypt costo 10', bool(h) and h[0]['pass_hash'].startswith('$2a$10$'), f'{h}')
    hilos = [threading.Thread(target=lambda: http('POST', '/rest/v1/rpc/verificar_empleado_venta', tok_d,
                                                  {'p': {'comercio_id': comercio, 'legajo': leg, 'pass': '0000'}})) for _ in range(12)]
    [h.start() for h in hilos]
    [h.join() for h in hilos]
    s, r = http('POST', '/rest/v1/rpc/verificar_empleado_venta', tok_d, {'p': {'comercio_id': comercio, 'legajo': leg, 'pass': '4321'}})
    caso('12 intentos en paralelo igual traban la clave (ni la buena entra)', s == 200 and r.get('ok') is False, f'{s} {r}')
    http('POST', '/rest/v1/rpc/baja_empleado_venta', tok_d, {'p': {'id': emp, 'comercio_id': comercio}})

    mid = str(uuid.uuid4())
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    antes = l[0]['cantidad']
    salidas = []
    ajuste = lambda: salidas.append(http('POST', '/rest/v1/rpc/ajustar_stock', tok_e, {'p': {
        'mov_id': mid, 'comercio_id': comercio, 'lote_id': lote, 'tipo': 'ajuste', 'delta': -1,
        'cantidad_anterior': antes, 'usuario': 'Juan', 'notas': 'reintento'}}))
    hilos = [threading.Thread(target=ajuste) for _ in range(2)]
    [h.start() for h in hilos]
    [h.join() for h in hilos]
    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    caso('dos reintentos simultáneos del mismo ajuste: sin error y una sola vez',
         all(st == 200 for st, _ in salidas) and l[0]['cantidad'] == antes - 1, f'{salidas} cant={l[0]["cantidad"]}')

    _, mv = http('GET', f'/rest/v1/miembros?user_id=eq.{uid_v}&select=comercio_id', tok_v)
    otro = str(uuid.uuid4())
    http('POST', '/rest/v1/productos', tok_v, {'id': otro, 'comercio_id': mv[0]['comercio_id'], 'nombre': 'De otro comercio', 'categoria': 'X', 'precio': 1})
    s, r = http('POST', '/rest/v1/lotes', tok_d, {'id': str(uuid.uuid4()), 'comercio_id': comercio, 'producto_id': otro, 'sucursal_id': sucursal,
                                                  'cantidad': 1, 'fecha_vencimiento': '2027-01-01', 'dias_aviso': 7})
    caso('no se carga un lote con un producto de otro comercio', s >= 400, f'{s} {r}')

    http('POST', '/rest/v1/rpc/admin_cambiar_plan', tok_v, {'p': {'comercio_id': comercio, 'plan': 'trial', 'trial_hasta': '2026-01-01T00:00:00Z'}})
    s, r = http('POST', '/rest/v1/productos', tok_d, {'id': str(uuid.uuid4()), 'comercio_id': comercio, 'nombre': 'Con prueba vencida', 'categoria': 'X', 'precio': 1})
    s2, r2 = venta([{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 100}])
    http('POST', '/rest/v1/rpc/admin_cambiar_plan', tok_v, {'p': {'comercio_id': comercio, 'plan': 'trial', 'trial_hasta': '2027-01-31T23:59:59Z'}})
    caso('con la prueba vencida el servidor no acepta cargas ni ventas', s >= 400 and s2 >= 400, f'{s} {r} | {s2} {r2}')

    tok = 'prueba-' + secrets.token_hex(4)
    s, r = http('POST', '/rest/v1/rpc/registrar_push_token', tok_d, {'p_token': tok, 'p_comercio': comercio})
    _, pt = http('GET', f'/rest/v1/push_tokens?token=eq.{tok}&select=comercio_id,user_id', tok_d)
    caso('registrar_push_token deja el token en el comercio y la cuenta actuales',
         s in (200, 204) and pt and pt[0]['comercio_id'] == comercio and pt[0]['user_id'] == uid_d, f'{s} {r} {pt}')
    http('DELETE', f'/rest/v1/push_tokens?token=eq.{tok}', tok_d)

    print('\n── J) Migración 14: ventas firmes y sumas en el servidor')
    _, its = http('GET', f'/rest/v1/ventas_items?producto_id=eq.{prod}&select=cantidad,ventas_ventas!inner(anulada,fecha)', tok_d)
    esperado = sum(i['cantidad'] for i in its if not i['ventas_ventas']['anulada'])
    s, r = http('POST', '/rest/v1/rpc/vendido_por_producto', tok_d, {'p_comercio': comercio, 'p_dias': 3650})
    fila = next((x for x in (r if s == 200 else []) if x['producto_id'] == prod), None)
    caso('vendido_por_producto suma las unidades vendidas (sin anuladas)', fila is not None and float(fila['unidades']) == esperado,
         f'{s} {fila} esperado={esperado}')
    s, r = http('POST', '/rest/v1/rpc/vendido_por_producto', tok_v, {'p_comercio': comercio, 'p_dias': 3650})
    caso('otro comercio no ve lo vendido ajeno', s == 200 and r == [], f'{s} {r}')

    vid = str(uuid.uuid4())
    s, r = http('POST', '/rest/v1/rpc/registrar_venta', tok_e, {'p': {
        'id': vid, 'comercio_id': comercio, 'sucursal_id': sucursal, 'usuario': 'Juan', 'metodo_pago': 'efectivo',
        'fecha': '2099-01-01T10:00:00Z', 'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 10}]}})
    _, v = http('GET', f'/rest/v1/ventas_ventas?id=eq.{vid}&select=fecha', tok_d)
    caso('una venta con la fecha del equipo adelantada queda con la hora del servidor',
         s == 200 and v and v[0]['fecha'] < '2099', f'{s} {r} {v}')

    _, l = http('GET', f'/rest/v1/lotes?id=eq.{lote}&select=cantidad', tok_d)
    real = l[0]['cantidad']
    mid = str(uuid.uuid4())
    s, r = http('POST', '/rest/v1/rpc/ajustar_stock', tok_e, {'p': {
        'mov_id': mid, 'comercio_id': comercio, 'lote_id': lote, 'tipo': 'ajuste', 'delta': 1,
        'cantidad_anterior': 999, 'usuario': 'Juan', 'notas': 'antes viejo'}})
    _, mv = http('GET', f'/rest/v1/movimientos?id=eq.{mid}&select=cantidad_anterior,cantidad_nueva', tok_d)
    caso('el "antes" del ajuste lo pone el servidor (no el número viejo del equipo)',
         s == 200 and mv and mv[0]['cantidad_anterior'] == real and mv[0]['cantidad_nueva'] == real + 1, f'{s} {r} {mv} real={real}')

    print('\n── K) Migración 15: ofertas de lo que está por vencer')
    s, r = http('POST', '/rest/v1/ventas_liquidaciones', tok_d, {'comercio_id': comercio, 'producto_id': prod, 'pct': 30, 'hasta': '2027-01-01'})
    caso('el dueño pone un producto en oferta por vencer', s == 201, f'{s} {r}')
    s, r = http('POST', '/rest/v1/ventas_liquidaciones?on_conflict=comercio_id,producto_id', tok_e,
                {'comercio_id': comercio, 'producto_id': prod, 'pct': 90, 'hasta': '2027-01-01'}, {'Prefer': 'resolution=merge-duplicates'})
    _, lq = http('GET', f'/rest/v1/ventas_liquidaciones?producto_id=eq.{prod}&select=pct', tok_d)
    caso('una cuenta de empleado no cambia la oferta', s >= 400 and lq and float(lq[0]['pct']) == 30, f'{s} {r} {lq}')
    _, ajeno = http('GET', f'/rest/v1/ventas_liquidaciones?producto_id=eq.{prod}&select=pct', tok_v)
    caso('otro comercio no ve las ofertas ajenas', ajeno == [], f'{ajeno}')
    http('DELETE', f'/rest/v1/ventas_liquidaciones?producto_id=eq.{prod}', tok_d)

    print('\n── L) Migración 16: la sesión de la tablet no alcanza para ser dueño')
    s, r = http('GET', f'/rest/v1/ventas_config?comercio_id=eq.{comercio}&select=pin_hash', tok_d)
    caso('nadie lee el hash de la clave del dueño por la API', s >= 400 or r == [], f'{s} {r}')
    pin = str(secrets.randbelow(9000) + 1000)
    http('POST', '/rest/v1/rpc/configurar_pin', tok_d, {'p': {'comercio_id': comercio, 'pin': pin, 'pin_actual': U.get('pin_dueno', '')}})
    _, cfg = sql_service('GET', f'/rest/v1/ventas_config?comercio_id=eq.{comercio}&select=pin_hash')
    if not cfg:  # sin clave todavía: la primera se crea sin la actual
        http('POST', '/rest/v1/rpc/configurar_pin', tok_d, {'p': {'comercio_id': comercio, 'pin': pin}})
    s, r = http('POST', '/rest/v1/rpc/configurar_pin', tok_d, {'p': {'comercio_id': comercio, 'pin': '0000'}})
    _, ok_vieja = http('POST', '/rest/v1/rpc/verificar_pin', tok_d, {'p': {'comercio_id': comercio, 'pin': pin}})
    # Migración 17: sin la actual es un error (la app vieja mostraba un "ok: false" como "clave actualizada").
    caso('cambiar la clave sin la actual no se puede (y la vieja sigue valiendo)',
         s >= 400 and 'clave actual' in json.dumps(r, ensure_ascii=False) and ok_vieja is True, f'{s} {r} {ok_vieja}')
    s, r = http('POST', '/rest/v1/rpc/configurar_pin', tok_d, {'p': {'comercio_id': comercio, 'pin': pin, 'pin_actual': pin}})
    caso('con la clave actual sí se cambia', s == 200 and r.get('ok') is True, f'{s} {r}')
    U['pin_dueno'] = pin
    json.dump(U, open(ARCHIVO_USUARIOS, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)

    largo = 'X' * 40
    _, antes = sql_service('GET', f'/rest/v1/auth_intentos?comercio_id=eq.{comercio}&select=clave')
    http('POST', '/rest/v1/rpc/verificar_empleado_venta', tok_d, {'p': {'comercio_id': comercio, 'legajo': largo, 'pass': '1234'}})
    _, despues = sql_service('GET', f'/rest/v1/auth_intentos?comercio_id=eq.{comercio}&select=clave')
    caso('un legajo inventado larguísimo no deja filas en auth_intentos', len(despues or []) == len(antes or []), f'{len(antes or [])} → {len(despues or [])}')

    _, mdev = http('GET', f'/rest/v1/miembros?user_id=eq.{uid_v}&select=comercio_id', tok_v)
    _, sv = http('GET', f'/rest/v1/sucursales?comercio_id=eq.{mdev[0]["comercio_id"]}&select=id', tok_v)
    s, r = http('POST', '/rest/v1/movimientos', tok_d, {'id': str(uuid.uuid4()), 'comercio_id': comercio, 'producto_id': prod,
                                                        'sucursal_id': sv[0]['id'], 'tipo': 'ajuste', 'cantidad': 1,
                                                        'cantidad_anterior': 0, 'cantidad_nueva': 1, 'fecha': '2026-10-25T10:00:00Z'})
    caso('un movimiento no puede apuntar al local de otro comercio', s >= 400, f'{s} {r}')

    s, r = http('POST', '/rest/v1/rpc/comercios_del_usuario', None, {})
    caso('sin sesión no se puede llamar a comercios_del_usuario', s >= 400, f'{s} {r}')

    print('\n── M) Migración 17: ventas, fiado y stock')
    p2 = str(uuid.uuid4())
    http('POST', '/rest/v1/productos', tok_d, {'id': p2, 'comercio_id': comercio, 'nombre': 'Yogur M17', 'categoria': 'Lácteos', 'precio': 500, 'costo': 300})
    l_chico = str(uuid.uuid4())
    http('POST', '/rest/v1/lotes', tok_d, {'id': l_chico, 'comercio_id': comercio, 'producto_id': p2, 'sucursal_id': sucursal,
                                           'cantidad': 3, 'fecha_vencimiento': '2027-02-01', 'dias_aviso': 7})
    mid = str(uuid.uuid4())
    s, r = http('POST', '/rest/v1/rpc/ajustar_stock', tok_d, {'p': {'mov_id': mid, 'comercio_id': comercio, 'lote_id': l_chico,
                                                                    'tipo': 'retiro_roto', 'delta': -10, 'usuario': 'Rosa'}})
    _, mv = http('GET', f'/rest/v1/movimientos?id=eq.{mid}&select=cantidad,cantidad_anterior,cantidad_nueva', tok_d)
    caso('un retiro de más anota lo que de verdad bajó (3, no 10)', s == 200 and mv and mv[0]['cantidad'] == -3 and mv[0]['cantidad_nueva'] == 0, f'{s} {r} {mv}')

    # Un lote con stock dado de baja (borrado en la app) no revive con una venta sin stock.
    l_baja = str(uuid.uuid4())
    http('POST', '/rest/v1/lotes', tok_d, {'id': l_baja, 'comercio_id': comercio, 'producto_id': p2, 'sucursal_id': sucursal,
                                           'cantidad': 5, 'fecha_vencimiento': '2026-01-01', 'dias_aviso': 7})
    http('PATCH', f'/rest/v1/lotes?id=eq.{l_baja}', tok_d, {'retirado': True})
    vsin = str(uuid.uuid4())
    s, r = http('POST', '/rest/v1/rpc/registrar_venta', tok_d, {'p': {
        'id': vsin, 'comercio_id': comercio, 'sucursal_id': sucursal, 'usuario': 'Rosa', 'metodo_pago': 'efectivo',
        'items': [{'producto_id': p2, 'nombre': 'Yogur M17', 'cantidad': 2, 'precio': 500, 'costo': 123}]}})
    _, lb = http('GET', f'/rest/v1/lotes?id=eq.{l_baja}&select=cantidad,retirado', tok_d)
    _, its = http('GET', f'/rest/v1/ventas_items?venta_id=eq.{vsin}&select=lote_id,cantidad,sin_stock,costo_unit', tok_d)
    caso('vender sin stock no toca un lote dado de baja', s == 200 and lb and lb[0]['cantidad'] == 5 and lb[0]['retirado'] is True, f'{s} {r} {lb}')
    caso('el renglón vendido sin stock queda marcado', its and all(i['sin_stock'] for i in its) and its[0]['lote_id'] != l_baja, f'{its}')
    caso('el costo es el del momento de la venta (lo manda la app)', its and float(its[0]['costo_unit']) == 123, f'{its}')

    # Entra mercadería: el faltante se cubre del lote nuevo. Al anular, las unidades vuelven a ese lote nuevo.
    neg = its[0]['lote_id'] if its else None
    l_nuevo = str(uuid.uuid4())
    http('POST', '/rest/v1/lotes', tok_d, {'id': l_nuevo, 'comercio_id': comercio, 'producto_id': p2, 'sucursal_id': sucursal,
                                           'cantidad': 6, 'fecha_vencimiento': '2027-06-01', 'dias_aviso': 7})
    s, r = http('POST', '/rest/v1/rpc/anular_venta', tok_d, {'p': {'venta_id': vsin, 'comercio_id': comercio, 'usuario': 'Rosa'}})
    _, ln = http('GET', f'/rest/v1/lotes?id=in.({l_nuevo},{neg})&select=id,cantidad', tok_d)
    cant = {x['id']: x['cantidad'] for x in ln or []}
    caso('anular lo vendido sin stock devuelve al lote nuevo, no al vencido', s == 200 and cant.get(l_nuevo) == 6 and cant.get(neg) == 0, f'{s} {r} {cant}')

    # Un id de venta de otro comercio no se da por "duplicada".
    s, r = http('POST', '/rest/v1/rpc/registrar_venta', tok_v, {'p': {
        'id': vsin, 'comercio_id': mdev[0]['comercio_id'], 'sucursal_id': sv[0]['id'], 'metodo_pago': 'efectivo',
        'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 10}]}})
    caso('una venta con el id de otro comercio es un error, no "duplicada"', s >= 400, f'{s} {r}')

    # Fiado de $0 nace pagado; el cobro dice cuánto se cobró y una deuda sin saldo queda cerrada.
    vf0 = str(uuid.uuid4())
    http('POST', '/rest/v1/rpc/registrar_venta', tok_d, {'p': {
        'id': vf0, 'comercio_id': comercio, 'sucursal_id': sucursal, 'metodo_pago': 'efectivo', 'fiado': True, 'cliente': 'Marta M17',
        'descuento': 10, 'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 10}]}})
    _, d0 = http('GET', f'/rest/v1/ventas_deudas?venta_id=eq.{vf0}&select=monto,pagada', tok_d)
    caso('un fiado de $0 nace pagado', d0 and float(d0[0]['monto']) == 0 and d0[0]['pagada'] is True, f'{d0}')

    vf = str(uuid.uuid4())
    http('POST', '/rest/v1/rpc/registrar_venta', tok_d, {'p': {
        'id': vf, 'comercio_id': comercio, 'sucursal_id': sucursal, 'metodo_pago': 'efectivo', 'fiado': True, 'cliente': 'Marta M17',
        'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 1000}]}})
    _, dd = http('GET', f'/rest/v1/ventas_deudas?venta_id=eq.{vf}&select=id', tok_d)
    deuda = dd[0]['id']
    pago1 = str(uuid.uuid4())
    s, r = http('POST', '/rest/v1/rpc/registrar_pago_fiado', tok_d, {'p': {'pago_id': pago1, 'deuda_id': deuda, 'comercio_id': comercio,
                                                                          'monto': 1500, 'fecha': '2099-01-01T00:00:00Z'}})
    _, pg = http('GET', f'/rest/v1/ventas_pagos?id=eq.{pago1}&select=fecha', tok_d)
    caso('el cobro dice cuánto se cobró (no más que el saldo)', s == 200 and float(r.get('cobrado', -1)) == 1000, f'{s} {r}')
    caso('un cobro con fecha del futuro queda con la hora del servidor', pg and pg[0]['fecha'] < '2099', f'{pg}')
    s, r = http('POST', '/rest/v1/rpc/registrar_pago_fiado', tok_d, {'p': {'pago_id': str(uuid.uuid4()), 'deuda_id': deuda, 'comercio_id': comercio, 'monto': 200}})
    caso('cobrar una deuda ya saldada no cobra nada', s == 200 and r.get('sin_saldo') is True and float(r.get('cobrado', -1)) == 0, f'{s} {r}')

    print('\n── N) Migración 18: anular un fiado que ya tenía pagos')
    vfa = str(uuid.uuid4())
    http('POST', '/rest/v1/rpc/registrar_venta', tok_d, {'p': {
        'id': vfa, 'comercio_id': comercio, 'sucursal_id': sucursal, 'metodo_pago': 'efectivo', 'fiado': True, 'cliente': 'Rosa M18',
        'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 1000}]}})
    _, dfa = http('GET', f'/rest/v1/ventas_deudas?venta_id=eq.{vfa}&select=id', tok_d)
    http('POST', '/rest/v1/rpc/registrar_pago_fiado', tok_d, {'p': {'pago_id': str(uuid.uuid4()), 'deuda_id': dfa[0]['id'], 'comercio_id': comercio, 'monto': 400}})
    motivo = f'venta anulada {vfa[:8]}'
    s, r = http('POST', '/rest/v1/rpc/anular_venta', tok_d, {'p': {'venta_id': vfa, 'comercio_id': comercio, 'usuario': 'Dueño'}})
    _, sal = sql_service('GET', f'/rest/v1/ventas_caja_mov?comercio_id=eq.{comercio}&tipo=eq.egreso&motivo=like.*{vfa[:8]}*&select=monto,sucursal_id')
    caso('anular un fiado con $400 pagados devuelve 400 y anota la salida de caja en su local',
         s == 200 and float(r.get('devuelto', -1)) == 400 and sal and len(sal) == 1 and float(sal[0]['monto']) == 400 and sal[0]['sucursal_id'] == sucursal,
         f'{s} {r} {sal}')
    http('POST', '/rest/v1/rpc/anular_venta', tok_d, {'p': {'venta_id': vfa, 'comercio_id': comercio}})
    _, sal2 = sql_service('GET', f'/rest/v1/ventas_caja_mov?comercio_id=eq.{comercio}&tipo=eq.egreso&motivo=like.*{vfa[:8]}*&select=monto')
    caso('anular otra vez no anota otra salida', sal2 and len(sal2) == 1, f'{sal2}')
    vcom = str(uuid.uuid4())
    http('POST', '/rest/v1/rpc/registrar_venta', tok_d, {'p': {
        'id': vcom, 'comercio_id': comercio, 'sucursal_id': sucursal, 'metodo_pago': 'tarjeta',
        'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 300}]}})
    s, r = http('POST', '/rest/v1/rpc/anular_venta', tok_d, {'p': {'venta_id': vcom, 'comercio_id': comercio}})
    _, sal3 = sql_service('GET', f'/rest/v1/ventas_caja_mov?comercio_id=eq.{comercio}&motivo=like.*{vcom[:8]}*&select=monto')
    caso('una venta con tarjeta anulada no anota salida (la plata no sale del cajón)', s == 200 and float(r.get('devuelto', -1)) == 0 and sal3 == [], f'{s} {r} {sal3}')

    print('\n── O) Migración 19: tercera auditoría')
    # Anular en efectivo: salida por el total, con la fecha de la devolución.
    vef = str(uuid.uuid4())
    http('POST', '/rest/v1/rpc/registrar_venta', tok_d, {'p': {
        'id': vef, 'comercio_id': comercio, 'sucursal_id': sucursal, 'metodo_pago': 'efectivo',
        'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 800}]}})
    s, r = http('POST', '/rest/v1/rpc/anular_venta', tok_d, {'p': {'venta_id': vef, 'comercio_id': comercio, 'fecha': '2026-01-15T12:00:00Z'}})
    _, se = sql_service('GET', f'/rest/v1/ventas_caja_mov?comercio_id=eq.{comercio}&motivo=like.*{vef[:8]}*&select=monto,fecha')
    caso('anular en efectivo anota la salida por el total, con la fecha de la devolución',
         s == 200 and float(r.get('devuelto', -1)) == 800 and se and float(se[0]['monto']) == 800 and se[0]['fecha'].startswith('2026-01-15'), f'{s} {r} {se}')

    # Lo vencido se vende al final.
    p3 = str(uuid.uuid4())
    http('POST', '/rest/v1/productos', tok_d, {'id': p3, 'comercio_id': comercio, 'nombre': 'Yogur M19', 'categoria': 'Lácteos', 'precio': 500})
    l_vencido, l_fresco = str(uuid.uuid4()), str(uuid.uuid4())
    http('POST', '/rest/v1/lotes', tok_d, {'id': l_vencido, 'comercio_id': comercio, 'producto_id': p3, 'sucursal_id': sucursal,
                                           'cantidad': 3, 'fecha_vencimiento': '2020-01-01', 'dias_aviso': 7})
    http('POST', '/rest/v1/lotes', tok_d, {'id': l_fresco, 'comercio_id': comercio, 'producto_id': p3, 'sucursal_id': sucursal,
                                           'cantidad': 12, 'fecha_vencimiento': '2030-01-01', 'dias_aviso': 7})
    s, r = http('POST', '/rest/v1/rpc/registrar_venta', tok_d, {'p': {
        'id': str(uuid.uuid4()), 'comercio_id': comercio, 'sucursal_id': sucursal, 'metodo_pago': 'efectivo',
        'items': [{'producto_id': p3, 'nombre': 'Yogur M19', 'cantidad': 3, 'precio': 500}]}})
    _, lv = http('GET', f'/rest/v1/lotes?id=in.({l_vencido},{l_fresco})&select=id,cantidad', tok_d)
    cant = {x['id']: x['cantidad'] for x in lv or []}
    caso('la venta sale de lo fresco: lo vencido queda para darlo de baja', s == 200 and cant.get(l_vencido) == 3 and cant.get(l_fresco) == 9, f'{s} {r} {cant}')
    s, r = http('POST', '/rest/v1/rpc/registrar_venta', tok_d, {'p': {
        'id': str(uuid.uuid4()), 'comercio_id': comercio, 'sucursal_id': sucursal, 'metodo_pago': 'efectivo',
        'items': [{'producto_id': p3, 'nombre': 'Yogur M19', 'cantidad': 10, 'precio': 500}]}})
    _, lv = http('GET', f'/rest/v1/lotes?id=in.({l_vencido},{l_fresco})&select=id,cantidad', tok_d)
    cant = {x['id']: x['cantidad'] for x in lv or []}
    caso('si no alcanza lo fresco, recién ahí toca lo vencido', s == 200 and cant.get(l_fresco) == 0 and cant.get(l_vencido) == 2, f'{s} {r} {cant}')

    # Un local con ventas no se borra.
    _, ventas_antes = sql_service('GET', f'/rest/v1/ventas_ventas?sucursal_id=eq.{sucursal}&select=id&limit=1')
    s, r = http('DELETE', f'/rest/v1/sucursales?id=eq.{sucursal}', tok_d)
    _, sigue = http('GET', f'/rest/v1/sucursales?id=eq.{sucursal}&select=id', tok_d)
    caso('el dueño no puede borrar un local por la API', s >= 400 and sigue and ventas_antes, f'{s} {r} {sigue}')
    s, r = sql_service('DELETE', f'/rest/v1/sucursales?id=eq.{sucursal}')
    _, sigue = http('GET', f'/rest/v1/sucursales?id=eq.{sucursal}&select=id', tok_d)
    caso('ni el servidor borra un local con ventas (se desactiva)', s >= 400 and sigue, f'{s} {r} {sigue}')

    # Celulares para avisos: tope y sin quitarle el de otro.
    s, r = http('POST', '/rest/v1/push_tokens', tok_d, {'token': 'falso-' + secrets.token_hex(4), 'comercio_id': comercio, 'user_id': uid_d, 'plataforma': 'android'})
    caso('no se pueden cargar celulares directo a la tabla', s >= 400, f'{s} {r}')
    tok_propio = 'token-m19-' + secrets.token_hex(4)
    s, r = http('POST', '/rest/v1/rpc/registrar_push_token', tok_d, {'p_token': tok_propio, 'p_comercio': comercio})
    caso('registrar el celular por la función sigue andando', s < 300, f'{s} {r}')
    s, r = http('POST', '/rest/v1/rpc/registrar_push_token', tok_v, {'p_token': tok_propio, 'p_comercio': mdev[0]['comercio_id']})
    _, dueno_tok = sql_service('GET', f'/rest/v1/push_tokens?token=eq.{tok_propio}&select=comercio_id')
    caso('otra cuenta no le saca el celular a un comercio', dueno_tok and dueno_tok[0]['comercio_id'] == comercio, f'{s} {r} {dueno_tok}')
    ultimo = None
    for _i in range(21):
        ultimo = http('POST', '/rest/v1/rpc/registrar_push_token', tok_v, {'p_token': f'tope-{secrets.token_hex(6)}', 'p_comercio': mdev[0]['comercio_id']})
    caso('un comercio no puede cargar más de 20 celulares', ultimo[0] >= 400 and 'demasiados' in json.dumps(ultimo[1], ensure_ascii=False), f'{ultimo}')
    sql_service('DELETE', f'/rest/v1/push_tokens?comercio_id=eq.{mdev[0]["comercio_id"]}&token=like.tope-*')
    sql_service('DELETE', f'/rest/v1/push_tokens?token=eq.{tok_propio}')

    # Ids de otro comercio.
    _, pago_ajeno = sql_service('GET', f'/rest/v1/ventas_pagos?comercio_id=eq.{comercio}&select=id&limit=1')
    vdev = str(uuid.uuid4())
    http('POST', '/rest/v1/rpc/registrar_venta', tok_v, {'p': {
        'id': vdev, 'comercio_id': mdev[0]['comercio_id'], 'sucursal_id': sv[0]['id'], 'metodo_pago': 'efectivo', 'fiado': True, 'cliente': 'Otro',
        'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 10}]}})
    _, ddev = http('GET', f'/rest/v1/ventas_deudas?venta_id=eq.{vdev}&select=id', tok_v)
    s, r = http('POST', '/rest/v1/rpc/registrar_pago_fiado', tok_v, {'p': {'pago_id': pago_ajeno[0]['id'], 'deuda_id': ddev[0]['id'], 'comercio_id': mdev[0]['comercio_id'], 'monto': 1}})
    caso('un cobro con el id de otro comercio es un error', s >= 400, f'{s} {r}')
    _, mov_ajeno = sql_service('GET', f'/rest/v1/movimientos?comercio_id=eq.{comercio}&select=id&limit=1')
    s, r = http('POST', '/rest/v1/rpc/ajustar_stock', tok_v, {'p': {'mov_id': mov_ajeno[0]['id'], 'comercio_id': mdev[0]['comercio_id'], 'lote_id': str(uuid.uuid4()), 'delta': 1}})
    caso('un ajuste con el id de otro comercio es un error, no "duplicado"', s >= 400, f'{s} {r}')

    # Cobro: en el local donde entró la plata.
    vfl = str(uuid.uuid4())
    http('POST', '/rest/v1/rpc/registrar_venta', tok_d, {'p': {
        'id': vfl, 'comercio_id': comercio, 'sucursal_id': sucursal, 'metodo_pago': 'efectivo', 'fiado': True, 'cliente': 'Local M19',
        'items': [{'producto_id': None, 'nombre': 'Varios', 'cantidad': 1, 'precio': 100}]}})
    _, dfl = http('GET', f'/rest/v1/ventas_deudas?venta_id=eq.{vfl}&select=id', tok_d)
    otro_local = str(uuid.uuid4())
    http('POST', '/rest/v1/sucursales', tok_d, {'id': otro_local, 'comercio_id': comercio, 'nombre': 'Local M19'})
    pl = str(uuid.uuid4())
    http('POST', '/rest/v1/rpc/registrar_pago_fiado', tok_d, {'p': {'pago_id': pl, 'deuda_id': dfl[0]['id'], 'comercio_id': comercio, 'monto': 40, 'sucursal_id': otro_local}})
    pl2 = str(uuid.uuid4())
    http('POST', '/rest/v1/rpc/registrar_pago_fiado', tok_d, {'p': {'pago_id': pl2, 'deuda_id': dfl[0]['id'], 'comercio_id': comercio, 'monto': 10}})
    _, plr = http('GET', f'/rest/v1/ventas_pagos?id=in.({pl},{pl2})&select=id,sucursal_id', tok_d)
    locs = {x['id']: x['sucursal_id'] for x in plr or []}
    caso('el cobro queda en el local donde entró la plata (o el de la venta, con una app vieja)', locs.get(pl) == otro_local and locs.get(pl2) == sucursal, f'{locs}')
    http('PATCH', f'/rest/v1/sucursales?id=eq.{otro_local}', tok_d, {'activa': False})

    # Bloqueo: al vencer no arranca de cero.
    clave_l = 'legajo:' + 'M19' + secrets.token_hex(2).upper()
    com_dev = mdev[0]['comercio_id']
    legajo = clave_l.split(':')[1]
    for _i in range(5):
        http('POST', '/rest/v1/rpc/verificar_empleado_venta', tok_v, {'p': {'comercio_id': com_dev, 'legajo': legajo, 'pass': 'mal'}})
    _, ai = sql_service('GET', f'/rest/v1/auth_intentos?comercio_id=eq.{com_dev}&clave=eq.{clave_l}&select=fallos,bloqueado_hasta')
    caso('a los 5 fallos se bloquea', ai and ai[0]['fallos'] == 5 and ai[0]['bloqueado_hasta'], f'{ai}')
    sql_service('PATCH', f'/rest/v1/auth_intentos?comercio_id=eq.{com_dev}&clave=eq.{clave_l}', {'bloqueado_hasta': '2020-01-01T00:00:00Z'})
    http('POST', '/rest/v1/rpc/verificar_empleado_venta', tok_v, {'p': {'comercio_id': com_dev, 'legajo': legajo, 'pass': 'mal'}})
    _, ai = sql_service('GET', f'/rest/v1/auth_intentos?comercio_id=eq.{com_dev}&clave=eq.{clave_l}&select=fallos')
    caso('al vencer el bloqueo la cuenta sigue (no vuelve a cero)', ai and ai[0]['fallos'] == 6, f'{ai}')

    # Estadísticas sumadas en el servidor.
    s, r = http('POST', '/rest/v1/rpc/estadisticas_ventas', tok_d, {'p_comercio': comercio, 'p_dias': 30})
    caso('las estadísticas suman en el servidor', s == 200 and len(r.get('por_hora', [])) == 24 and sum(r['por_hora']) == r['ventas'] and r['ventas'] > 0, f'{s} {str(r)[:200]}')
    s, r = http('POST', '/rest/v1/rpc/estadisticas_ventas', tok_v, {'p_comercio': comercio, 'p_dias': 30})
    caso('otro comercio no ve las estadísticas ajenas', s >= 400, f'{s} {r}')

    # Cupo de claves por comercio.
    respuestas = [http('POST', '/rest/v1/rpc/verificar_empleado_venta', tok_v, {'p': {'comercio_id': com_dev, 'legajo': f'C{n}', 'pass': 'x'}})[0] for n in range(32)]
    _, cu = sql_service('GET', f'/rest/v1/auth_intentos?comercio_id=eq.{com_dev}&clave=like.cupo:*&select=fallos&order=actualizado_en.desc&limit=1')
    caso('el cupo de claves frena a quien prueba de más', all(x == 200 for x in respuestas) and cu and cu[0]['fallos'] > 30, f'{cu}')

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
    s2, r2 = http('POST', '/rest/v1/rpc/configurar_pin', tok_d, {'p': {'comercio_id': comercio, 'pin': U['pin_dueno'], 'pin_actual': U['pin_dueno']}})
    print('cajero:', s1, '| pin dueño:', s2, r2 if s2 != 200 else '')
    _, n = http('GET', f'/rest/v1/productos?comercio_id=eq.{comercio}&select=id', tok_d)
    print(f'{len(n)} productos en "{U["dueno"]["comercio"]}"')


if __name__ == '__main__':
    if '--datos' in sys.argv:
        cargar_datos_ejemplo()
    else:
        main()
