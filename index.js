const express = require("express");
const cors = require("cors");
const { db } = require("./firebase");

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// MIDDLEWARE DE SEGURIDAD (ADMINISTRADOR)
// ----------------------

// NOTA: En una aplicación real, se usaría JWT para verificar el token 
// y obtener el rol del usuario de forma segura. Aquí se usa una simulación.

const verificarToken = (req, res, next) => {
  // Busca el token en el header 'Authorization: Bearer <token>'
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "Acceso denegado. No se proporcionó token (Requiere Bearer Token)." });
  }

  // --- SIMULACIÓN DE ROL ---
  // Si el token existe, asumimos que el usuario está autenticado.
  // Esto es muy básico, DEBE MEJORARSE en producción.
  // Asumimos que el token es 'admin123' y el usuario es admin.
  if (token === 'admin123') {
    req.user = { rol: 'administrador' };
  } else {
    req.user = { rol: 'empleado' }; // O algún otro rol por defecto
  }

  next();
};

const soloAdmin = (req, res, next) => {
  // Verifica si el usuario (adjunto por verificarToken) tiene el rol 'administrador'
  if (!req.user || req.user.rol !== 'administrador') {
    return res.status(403).json({ error: "Acceso prohibido. Solo administradores pueden realizar esta acción." });
  }
  next();
};

// ----------------------
// GENERAR CODIGO VENTA
// ----------------------
async function generarCodigoVenta() {
  const ventas = await db.collection("ventas").get();
  const total = ventas.size + 1;
  return "V" + String(total).padStart(3, "0");
}

// ----------------------------------------------
// CRUD PRODUCTOS (ASEGURADOS CON MIDDLEWARE)
// ----------------------------------------------

// Crear producto(s)
app.post("/productos", verificarToken, soloAdmin, async (req, res) => {
  try {
    const productosParaGuardar = Array.isArray(req.body) ? req.body : [req.body];
    const snapshot = await db.collection("productos").get();
    let ultimoNumero = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.codigo) {
        const num = parseInt(data.codigo.replace("P", ""));
        if (num > ultimoNumero) ultimoNumero = num;
      }
    });

    const productosAgregados = [];
    let productosOmitidos = 0;

    for (const producto of productosParaGuardar) {
      if (!producto || !producto.nombre) {
        productosOmitidos++;
        continue;
      }

      ultimoNumero++;
      const nuevoCodigo = "P" + ultimoNumero.toString().padStart(3, "0");

      const nuevoProducto = {
        nombre: producto.nombre,
        precio: Number(producto.precio) || 0,
        precioCompra: Number(producto.precioCompra) || 0,
        categoria: producto.categoria || 'Sin Categoría',
        stock: Number(producto.stock) || 0,
        codigo: nuevoCodigo,
        creadoEn: new Date()
      };

      const productoRef = await db.collection("productos").add(nuevoProducto);

      productosAgregados.push({
        id: productoRef.id,
        nombre: nuevoProducto.nombre,
        codigo: nuevoCodigo
      });
    }

    if (productosAgregados.length === 0) {
      return res.status(400).json({ error: "No se encontró ningún producto válido para agregar." });
    }

    res.json({
      mensaje: "Productos agregados correctamente.",
      total_agregados: productosAgregados.length,
      total_omitidos: productosOmitidos,
      productos: productosAgregados
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al agregar productos" });
  }
});

// Listar productos
app.get("/productos", verificarToken, async (req, res) => {
  try {
    const snapshot = await db.collection("productos").get();
    const lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    lista.sort((a, b) => {
      const numA = parseInt(a.codigo.replace("P", ""));
      const numB = parseInt(b.codigo.replace("P", ""));
      return numA - numB;
    });

    res.json(lista);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar producto
app.put("/productos/:id", verificarToken, soloAdmin, async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (updateData.precio !== undefined) {
      updateData.precio = Number(updateData.precio) || 0;
    }
    if (updateData.stock !== undefined) {
      updateData.stock = Number(updateData.stock) || 0;
    }
    if (updateData.precioCompra !== undefined) {
      updateData.precioCompra = Number(updateData.precioCompra) || 0;
    }

    await db.collection("productos").doc(req.params.id).update(updateData);
    res.json({ mensaje: "Producto actualizado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar producto
app.delete("/productos/:id", verificarToken, soloAdmin, async (req, res) => {
  try {
    await db.collection("productos").doc(req.params.id).delete();
    res.json({ mensaje: "Producto eliminado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------
// GESTIÓN DE DATOS PELIGROSA (BORRADO TOTAL - SOLO ADMIN)
// ----------------------------------------------

async function deleteCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  return snapshot.size;
}

app.delete("/administracion/borrar-todo-peligro", verificarToken, soloAdmin, async (req, res) => {
  try {
    console.log("INICIANDO BORRADO TOTAL DE DATOS...");
    const productosBorrados = await deleteCollection("productos");
    const ventasBoradas = await deleteCollection("ventas");
    console.log("BORRADO TOTAL FINALIZADO.");

    res.json({
      mensaje: "PELIGRO! Todas las colecciones han sido vaciadas.",
      detalle: {
        productos_eliminados: productosBorrados,
        ventas_eliminadas: ventasBoradas,
      },
    });
  } catch (error) {
    console.error("Error en el borrado total:", error);
    res.status(500).json({ error: "Error fatal al intentar borrar colecciones" });
  }
});

// ----------------------------------------------
// VENTAS (ADAPTADAS PARA CARRITO - SOLO ADMIN)
// ----------------------------------------------

// Crear una venta (Soporta MÚLTIPLES ARTÍCULOS)
app.post("/ventas", verificarToken, soloAdmin, async (req, res) => {
  try {
    // Espera 'articulos' con el precioVenta ajustado (o base)
    const { articulos, total, monto, cambio, nota } = req.body;

    if (!articulos || !Array.isArray(articulos) || articulos.length === 0 || total === undefined || monto === undefined) {
      return res.status(400).json({ error: "Faltan datos obligatorios o la lista de artículos está vacía." });
    }

    let costoVentaTotal = 0;
    const batch = db.batch();
    const articulosVentaFinal = [];

    // 1. Validar y procesar cada artículo en el carrito
    for (const item of articulos) {
      const { productoId, cantidad, precioVenta } = item;

      const qty = Number(cantidad);
      const salePrice = Number(precioVenta);

      if (!productoId || qty <= 0 || salePrice <= 0 || isNaN(qty) || isNaN(salePrice)) {
        return res.status(400).json({ error: `Datos de artículo inválidos (ID: ${productoId}, Cantidad: ${cantidad}, Precio: ${precioVenta})` });
      }

      const productoRef = db.collection("productos").doc(productoId);
      const productoDoc = await productoRef.get();

      if (!productoDoc.exists) {
        return res.status(404).json({ error: `Producto no encontrado con ID: ${productoId}` });
      }

      const producto = productoDoc.data();

      // Validar stock
      if (producto.stock < qty) {
        return res.status(400).json({ error: `Stock insuficiente para el producto ${producto.nombre}. Disponible: ${producto.stock}, Solicitado: ${qty}` });
      }

      // Cálculo de Costo (usa el costo de la BD)
      const precioCompraUnidad = producto.precioCompra || 0;
      const costoMercanciaVendidaArticulo = precioCompraUnidad * qty;
      costoVentaTotal += costoMercanciaVendidaArticulo;

      // Preparar descuento de stock en el batch
      batch.update(productoRef, {
        stock: producto.stock - qty
      });

      // Agregar al array final de la venta
      articulosVentaFinal.push({
        productoId: productoId,
        cantidad: qty,
        precioVenta: salePrice, // <--- Este es el precio ajustado por el frontend
        subtotal: qty * salePrice,
        costoUnitario: precioCompraUnidad, // Costo de la BD, para registro de ganancia
      });
    }

    // 2. Ejecutar todas las actualizaciones de stock
    await batch.commit();

    // 3. Generar código de venta V00X
    const codigoVenta = await generarCodigoVenta();

    // 4. Calcular la ganancia total
    const gananciaTotal = Number(total) - costoVentaTotal;

    // 5. Crear objeto de venta principal
    const ventaData = {
      codigo: codigoVenta,
      articulos: articulosVentaFinal, // Lista de artículos
      total: Number(total),
      monto: Number(monto),
      cambio: Number(cambio),
      costoVenta: costoVentaTotal,
      ganancia: gananciaTotal,
      nota: nota || "",
      fecha: new Date()
    };

    // 6. Guardar venta
    const ventaRef = await db.collection("ventas").add(ventaData);

    res.json({
      mensaje: "Venta registrada correctamente (Multi-artículo)",
      id: ventaRef.id,
      venta: ventaData
    });

  } catch (error) {
    console.error("Error al registrar venta multi-artículo:", error);
    res.status(500).json({ error: error.message || "Error desconocido al registrar la venta" });
  }
});

// Obtener todas las ventas (Listado resumido)
app.get("/ventas", verificarToken, async (req, res) => {
  try {
    const ventasSnapshot = await db.collection("ventas").get();
    const productosSnapshot = await db.collection("productos").get();
    const productosMap = {};
    productosSnapshot.docs.forEach(doc => {
      productosMap[doc.id] = doc.data();
    });

    const ventas = [];

    for (const doc of ventasSnapshot.docs) {
      const venta = doc.data();
      venta.id = doc.id;

      // Calcular la ganancia
      const costoVenta = venta.costoVenta || 0;
      venta.ganancia = parseFloat((venta.total - costoVenta).toFixed(2));

      // --- RESUMEN PARA LA TABLA PRINCIPAL ---
      const articulos = venta.articulos || [];

      if (articulos.length > 0) {
        const primerArticulo = articulos[0];
        const producto = productosMap[primerArticulo.productoId];
        const numArticulos = articulos.length;

        if (producto) {
          // Resumen: Primer producto + X más
          venta.productoNombre = numArticulos > 1 ? `${producto.nombre} (+${numArticulos - 1} más)` : producto.nombre;
          venta.productoCodigo = producto.codigo;
          venta.cantidad = `${numArticulos} artículos`;
        } else {
          venta.productoNombre = `Venta con ${numArticulos} artículos (Detalles no disponibles)`;
          venta.productoCodigo = "-";
          venta.cantidad = `${numArticulos} artículos`;
        }
      } else {
        // Manejo de ventas unitarias antiguas o errores (Legacy Support)
        const productoId = venta.productoId;
        const producto = productoId ? productosMap[productoId] : null;

        venta.productoNombre = producto ? producto.nombre : "Venta sin detalles";
        venta.productoCodigo = producto ? producto.codigo : "-";
        venta.cantidad = venta.cantidad || 1;
      }
      // --------------------------------------------------

      ventas.push(venta);
    }

    res.json(ventas);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una venta específica (Detalle)
app.get("/ventas/:id", verificarToken, async (req, res) => {
  try {
    const id = req.params.id;

    const ventaSnapshot = await db.collection("ventas").doc(id).get();

    if (!ventaSnapshot.exists) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    const venta = ventaSnapshot.data();

    // Calcular la ganancia
    const costoVenta = venta.costoVenta || 0;
    venta.ganancia = parseFloat((venta.total - costoVenta).toFixed(2));

    return res.json(venta);
  } catch (error) {
    console.error("Error al obtener la venta:", error);
    return res.status(500).json({ error: "Error al obtener la venta" });
  }
});


// ------------------------------
// LOGIN y DASHBOARD (SIN CAMBIOS)
// ------------------------------

app.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ error: "Faltan credenciales" });
    }

    const ref = db.collection('usuarios');
    const query = await ref.where("usuario", "==", usuario).get();

    if (query.empty) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const userDoc = query.docs[0].data();

    if (userDoc.password !== password) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    // DEBES DEVOLVER UN TOKEN SEGURO, AQUÍ DEVOLVEMOS EL TOKEN SIMULADO 'admin123'
    return res.json({
      mensaje: "Inicio de sesión exitoso",
      token: userDoc.rol === 'administrador' ? 'admin123' : 'empleado_token',
      rol: userDoc.rol
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/dashboard/totales", verificarToken, async (req, res) => {
  try {
    // Este endpoint está protegido pero no requiere ser solo admin (puede ser visto por empleados)
    const productosSnapshot = await db.collection("productos").get();
    const totalProductos = productosSnapshot.size;

    const productosStockBajo = productosSnapshot.docs.filter(
      doc => doc.data().stock < 10
    ).length;

    const hoy = new Date();
    const hace7dias = new Date();
    hace7dias.setDate(hoy.getDate() - 7);

    const ventasSnapshot = await db.collection("ventas").get();

    let ventasUltimos7Dias = 0;

    ventasSnapshot.forEach(doc => {
      const venta = doc.data();
      // Asegurarse que es un objeto de Firebase Timestamp
      if (venta.fecha && venta.fecha.toDate) {
        const fechaVenta = venta.fecha.toDate();
        if (fechaVenta >= hace7dias) {
          ventasUltimos7Dias += venta.total;
        }
      }
    });

    res.json({
      totalProductos,
      productosStockBajo,
      ventasUltimos7Dias: ventasUltimos7Dias.toFixed(2)
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------
const PORT = 3000;
app.listen(PORT, () => console.log("API lista en puerto", PORT));